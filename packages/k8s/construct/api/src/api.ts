import { stringifyObjectValues } from '@crisiscleanup/config'
import {
	Component,
	ContainerImage,
} from '@crisiscleanup/k8s.construct.component'
import { Chart, Duration, Size, JsonPatch, ApiObject } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import { Construct } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import {
	type ApiASGIProps,
	type ApiConfigProps,
	type ApiProps,
	type ApiWSGIProps,
	type CeleryProps,
	type IApiConfig,
	type IHttpProbable,
} from './types'

const debug = createDebug('@crisiscleanup:k8s.construct.api')

export class ApiConfig extends Construct implements IApiConfig {
	static of(construct: Construct): ApiConfig | undefined {
		return Chart.of(construct)
			.node.findAll()
			.find((c) => c instanceof ApiConfig) as ApiConfig
	}

	readonly configMap: kplus.ConfigMap
	readonly configSecret?: kplus.Secret

	private readonly envFroms: kplus.EnvFrom[]
	private envVars: { [key: string]: kplus.EnvValue }

	constructor(scope: Construct, id: string, props: ApiConfigProps) {
		super(scope, id)
		this.envFroms = []
		this.envVars = {}

		this.configMap = new kplus.ConfigMap(this, 'config', {
			data: stringifyObjectValues(props.config),
		})
		this.addEnvFrom(new kplus.EnvFrom(this.configMap))

		if (props.secrets && Object.keys(props.secrets).length) {
			this.configSecret = new kplus.Secret(this, 'config-secret', {
				stringData: stringifyObjectValues(props.secrets),
			})
			this.addEnvFrom(
				new kplus.EnvFrom(undefined, undefined, this.configSecret),
			)
		}
	}

	addEnvFrom(envFrom: kplus.EnvFrom): this {
		this.envFroms.push(envFrom)
		return this
	}

	addEnvVars(vars: { [key: string]: kplus.EnvValue }): this {
		this.envVars = {
			...this.envVars,
			...vars,
		}
		return this
	}

	get env(): kplus.Env {
		return new kplus.Env(this.envFroms, this.envVars)
	}
}

export abstract class ApiComponent<
	PropsT extends ApiProps = ApiProps,
> extends Component<PropsT> {
	static supportsProbes<T extends Construct>(
		construct: T,
	): construct is T & IHttpProbable {
		return (
			Object.hasOwnProperty.call(construct, 'httpProbePath') &&
			typeof (construct as T & { httpProbePath: unknown }).httpProbePath ===
				'string'
		)
	}

	readonly config: IApiConfig

	protected constructor(
		readonly scope: Construct,
		readonly id: string,
		props: PropsT,
	) {
		const propsWithDefaults = defu(props, {
			containerDefaults: {
				resources: {
					cpu: {
						request: kplus.Cpu.millis(100),
					},
					memory: {
						request: Size.gibibytes(1),
						limit: Size.gibibytes(1),
					},
				},
			},
		}) as PropsT
		super(scope, id, propsWithDefaults)
		debug('%s: (componentProps=%O)', id, propsWithDefaults)
		const config = props.config ?? ApiConfig.of(scope)
		if (!config) throw Error('Failed to resolve ApiConfig!')
		this.config = config
		this.deployment.scheduling.attract(
			kplus.Node.labeled(
				kplus.NodeLabelQuery.notIn('eks.amazonaws.com/compute-type', [
					'fargate',
				]),
			),
		)
		const topoPatch = JsonPatch.add(
			'/spec/template/spec/topologySpreadConstraints',
			[
				{
					maxSkew: 2,
					whenUnsatisfiable: 'ScheduleAnyway',
					labelSelector: this.deployment
						.toPodSelector()!
						.toPodSelectorConfig()!
						.labelSelector._toKube(),
					topologyKey: kplus.Topology.ZONE.key,
				},
			],
		)
		ApiObject.of(this.deployment).addJsonPatch(topoPatch)
	}

	protected createHttpProbes(
		httpPath: string,
	): Pick<kplus.ContainerProps, 'readiness' | 'liveness' | 'startup'> {
		const liveProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			periodSeconds: Duration.seconds(10),
			timeoutSeconds: Duration.seconds(3),
			failureThreshold: 4,
		})

		const readyProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			periodSeconds: Duration.seconds(10),
		})

		const startProbe = kplus.Probe.fromHttpGet(httpPath, {
			failureThreshold: 30,
			periodSeconds: Duration.seconds(15),
		})
		return {
			liveness: liveProbe,
			readiness: readyProbe,
			startup: startProbe,
		}
	}
}

export class ApiWSGI
	extends ApiComponent<ApiWSGIProps>
	implements IHttpProbable
{
	static componentName = 'wsgi'
	readonly httpProbePath = '/health'

	readonly migrateJob: kplus.Job
	readonly collectStaticJob: kplus.Job

	constructor(scope: Construct, id: string, props: ApiWSGIProps) {
		const securityContext = new kplus.ContainerSecurityContext({
			readOnlyRootFilesystem: false,
			user: 1000,
			group: 1000,
			ensureNonRoot: true,
		})
		const propsWithDefaults = defu(props, {
			containerDefaults: {
				securityContext,
			},
		}) as ApiWSGIProps
		super(scope, id, propsWithDefaults)

		const backend = this.addContainer({
			name: 'gunicorn',
			portNumber: 5000,
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			command: [
				'/serve.sh',
				'wsgi',
				`--workers=${props.workers ?? 2}`,
				`--threads=${props.threads ?? 4}`,
				'--worker-class=gthread',
				'--worker-tmp-dir=/worker-tmp',
				'--timeout=300',
			],
			...(props.probes ?? this.createHttpProbes(this.httpProbePath)),
			resources: {
				cpu: this.props.containerDefaults!.resources!.cpu!,
				memory: {
					request: Size.mebibytes(1200),
					limit: Size.mebibytes(1200),
				},
			},
		})

		const staticVolume = kplus.Volume.fromEmptyDir(
			scope,
			'static-files',
			'staticfiles',
		)
		const workerTmpVolume = kplus.Volume.fromEmptyDir(
			scope,
			'worker-tmp',
			'worker-tmp',
			{
				medium: kplus.EmptyDirMedium.MEMORY,
			},
		)

		const jobResources: kplus.ContainerProps['resources'] = {
			cpu: this.props.containerDefaults!.resources!.cpu!,
			memory: this.props.containerDefaults!.resources!.memory!,
		}

		// migrate + collectstatic jobs
		this.migrateJob = new kplus.Job(this, 'migrate', {
			serviceAccount: this.props.serviceAccount,
			securityContext,
			podMetadata: { labels: { component: 'api-migrate' } },
			terminationGracePeriod: Duration.minutes(5),
			activeDeadline: Duration.minutes(30),
			ttlAfterFinished: Duration.minutes(2),
		})

		this.migrateJob.addContainer({
			name: 'migrate',
			command: ['python', 'manage.py', 'migrate', '--noinput', '--verbosity=1'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext,
			...ContainerImage.fromProps(props.image!).containerProps,
			resources: jobResources,
		})

		this.collectStaticJob = new kplus.Job(this, 'collectstatic', {
			serviceAccount: this.props.serviceAccount,
			securityContext,
			volumes: [staticVolume],
			podMetadata: { labels: { component: 'api-static' } },
			terminationGracePeriod: Duration.minutes(5),
			activeDeadline: Duration.minutes(30),
			ttlAfterFinished: Duration.minutes(2),
		})
		const staticJobContainer = this.collectStaticJob.addContainer({
			name: 'collectstatic',
			...ContainerImage.fromProps(props.image!).containerProps,
			command: [
				'python',
				'manage.py',
				'collectstatic',
				'--no-post-process',
				'--noinput',
				'--verbosity=2',
			],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext,
			resources: jobResources,
		})

		// mount volumes
		staticJobContainer.mount('/app/staticfiles', staticVolume)
		backend.mount('/app/staticfiles', staticVolume)
		backend.mount('/worker-tmp', workerTmpVolume)
	}
}

export class ApiASGI
	extends ApiComponent<ApiASGIProps>
	implements IHttpProbable
{
	static componentName = 'asgi'
	httpProbePath = '/ws/health'

	constructor(scope: Construct, id: string, props: ApiASGIProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'hypercorn',
			command: ['/serve.sh', 'asgi', `--workers=${props.workers ?? 1}`],
			portNumber: 5000,
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			...(props.probes ?? this.createHttpProbes(this.httpProbePath)),
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
		})
	}
}

export class CeleryBeat extends ApiComponent {
	static componentName = 'celerybeat'

	constructor(scope: Construct, id: string, props: ApiProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'celerybeat',
			command: ['/serve.sh', 'celerybeat'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				cpu: {
					request: kplus.Cpu.millis(20),
				},
				memory: {
					request: Size.mebibytes(300),
					limit: Size.mebibytes(300),
				},
			},
		})
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return { replicas: 1 }
	}
}

export class CeleryWorker extends ApiComponent<CeleryProps> {
	static componentName = 'celeryworker'

	constructor(scope: Construct, id: string, props: CeleryProps) {
		super(scope, id, props)

		const name = props.name ?? props.queues.join('-')
		const hostname = `${name}@%%h`

		const queues = [...new Set(props.queues)]

		this.addContainer({
			name,
			command: [
				'/serve.sh',
				'celeryworker',
				'-Q',
				queues.join(','),
				`--concurrency=${props.concurrency ?? 2}`,
				'--hostname',
				hostname,
				...(props.args ?? []),
			],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				cpu: this.props.containerDefaults!.resources!.cpu!,
				memory: {
					limit: Size.mebibytes(900),
					request: Size.mebibytes(900),
				},
			},
		})
	}
}

export class AdminWebSocket extends ApiComponent {
	static componentName = 'adminwebsocket'

	constructor(scope: Construct, id: string, props: ApiProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'adminwebsocket',
			command: ['/serve.sh', 'adminwebsocket'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				cpu: {
					request: kplus.Cpu.millis(3),
				},
				memory: {
					request: Size.mebibytes(250),
					limit: Size.mebibytes(250),
				},
			},
		})
	}
}
