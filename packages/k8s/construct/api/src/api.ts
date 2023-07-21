import { stringifyObjectValues } from '@crisiscleanup/config'
import {
	Component,
	ContainerImage,
} from '@crisiscleanup/k8s.construct.component'
import { Chart, Duration } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { Construct } from 'constructs'
import {
	type ApiASGIProps,
	type ApiConfigProps,
	type ApiProps,
	type ApiWSGIProps,
	type CeleryProps,
	type IApiConfig,
	type IHttpProbable,
} from './types'

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
		readonly props: PropsT,
	) {
		super(scope, id, props)
		const config = props.config ?? ApiConfig.of(scope)
		if (!config) throw Error('Failed to resolve ApiConfig!')
		this.config = config
	}

	protected createHttpProbes(
		httpPath: string,
	): Pick<kplus.ContainerProps, 'readiness' | 'liveness' | 'startup'> {
		const liveProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(10),
			periodSeconds: Duration.seconds(5),
		})

		const readyProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(5),
			periodSeconds: Duration.seconds(5),
		})

		const startProbe = kplus.Probe.fromHttpGet(httpPath, {
			failureThreshold: 30,
			periodSeconds: Duration.seconds(10),
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
		super(scope, id, props)
		const securityContext = new kplus.ContainerSecurityContext({
			readOnlyRootFilesystem: false,
			user: 1000,
			group: 1000,
			ensureNonRoot: true,
		})

		const backend = this.addContainer({
			name: 'gunicorn',
			portNumber: 5000,
			securityContext,
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

		this.addContainer({
			name: 'migrate',
			command: ['python', 'manage.py', 'migrate', '--noinput', '--verbosity=1'],
			init: true,
			envFrom: this.config.envFrom,
			securityContext,
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

		// migrate + collectstatic jobs
		const migrateJob = new kplus.Job(this, 'migrate', {
			securityContext,
			podMetadata: { labels: { component: 'api-migrate' } },
		})

		migrateJob.addContainer({
			name: 'migrate',
			command: ['python', 'manage.py', 'migrate', '--noinput', '--verbosity=1'],
			envFrom: this.config.envFrom,
			securityContext,
			image: ContainerImage.fromProps(props.image).imageFqn,
		})

		const staticJob = new kplus.Job(this, 'collectstatic', {
			securityContext,
			volumes: [staticVolume],
			podMetadata: { labels: { component: 'api-static' } },
		})
		const staticJobContainer = staticJob.addContainer({
			name: 'collectstatic',
			image: ContainerImage.fromProps(props.image).imageFqn,
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
		})
	}
}
