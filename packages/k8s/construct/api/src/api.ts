import { stringifyObjectValues } from '@crisiscleanup/config'
import {
	Component,
	ContainerImage,
} from '@crisiscleanup/k8s.construct.component'
import { Chart, Duration, Size, SizeRoundingBehavior } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
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
	readonly configSecret: kplus.Secret

	constructor(scope: Construct, id: string, props: ApiConfigProps) {
		super(scope, id)
		this.configMap = new kplus.ConfigMap(this, 'config', {
			data: stringifyObjectValues(props.config),
		})

		this.configSecret = new kplus.Secret(this, 'config-secret', {
			stringData: stringifyObjectValues(props.secrets),
		})
	}

	get envFrom(): kplus.EnvFrom[] {
		return [
			new kplus.EnvFrom(this.configMap),
			new kplus.EnvFrom(undefined, undefined, this.configSecret),
		]
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
						limit: kplus.Cpu.millis(500),
					},
					memory: {
						request: Size.mebibytes(1000),
						limit: Size.mebibytes(2000),
					},
				},
			},
		}) as PropsT
		super(scope, id, propsWithDefaults)
		debug('%s: (componentProps=%O)', id, propsWithDefaults)
		const config = props.config ?? ApiConfig.of(scope)
		if (!config) throw Error('Failed to resolve ApiConfig!')
		this.config = config
	}

	protected createHttpProbes(
		httpPath: string,
	): Pick<kplus.ContainerProps, 'readiness' | 'liveness' | 'startup'> {
		const liveProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			periodSeconds: Duration.seconds(5),
		})

		const readyProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			periodSeconds: Duration.seconds(5),
		})

		const startProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			failureThreshold: 6,
			periodSeconds: Duration.seconds(20),
			timeoutSeconds: Duration.seconds(3),
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
			envFrom: this.config.envFrom,
			command: [
				'/serve.sh',
				'wsgi',
				'--workers',
				String(props.workers ?? 2),
				'--threads',
				String(props.threads ?? 4),
				'--worker-class=gthread',
				'--worker-tmp-dir=/worker-tmp',
			],
			...(props.probes ?? this.createHttpProbes(this.httpProbePath)),
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
			cpu: {
				request: kplus.Cpu.millis(500),
				limit: kplus.Cpu.millis(1500),
			},
			memory: this.props.containerDefaults!.resources!.memory!,
		}

		// migrate + collectstatic jobs
		const migrateJob = new kplus.Job(this, 'migrate', {
			securityContext,
			podMetadata: { labels: { component: 'api-migrate' } },
			terminationGracePeriod: Duration.minutes(5),
		})

		migrateJob.addContainer({
			name: 'migrate',
			command: ['python', 'manage.py', 'migrate', '--noinput', '--verbosity=1'],
			envFrom: this.config.envFrom,
			securityContext,
			...ContainerImage.fromProps(props.image!).containerProps,
			resources: jobResources,
		})

		const staticJob = new kplus.Job(this, 'collectstatic', {
			securityContext,
			volumes: [staticVolume],
			podMetadata: { labels: { component: 'api-static' } },
			terminationGracePeriod: Duration.minutes(5),
		})
		const staticJobContainer = staticJob.addContainer({
			name: 'collectstatic',
			...ContainerImage.fromProps(props.image!).containerProps,
			command: [
				'python',
				'manage.py',
				'collectstatic',
				'--link',
				'--no-post-process',
				'--noinput',
				'--verbosity=2',
			],
			envFrom: this.config.envFrom,
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
			command: ['/serve.sh', 'asgi', '--workers', String(props.workers ?? 2)],
			portNumber: 5000,
			envFrom: this.config.envFrom,
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
			envFrom: this.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				cpu: {
					request: kplus.Cpu.millis(3),
					limit: kplus.Cpu.millis(15),
				},
				memory: {
					request: Size.mebibytes(250),
					limit: Size.mebibytes(500),
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

		this.addContainer({
			name,
			command: [
				'/serve.sh',
				'celeryworker',
				'-Q',
				props.queues.join(','),
				'--concurrency',
				String(props.concurrency ?? 2),
				'--hostname',
				hostname,
				...(props.args ?? []),
			],
			envFrom: this.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
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
			envFrom: this.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				cpu: {
					request: kplus.Cpu.millis(3),
					limit: kplus.Cpu.millis(15),
				},
				memory: {
					request: Size.mebibytes(200),
					limit: Size.mebibytes(300),
				},
			},
		})
	}
}
