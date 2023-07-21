import {
	type ApiAppConfig,
	type ApiAppSecrets,
	type FlattenObject,
	flattenToScreamingSnakeCase,
	getConfig,
	type ScreamingSnakeCaseProperties,
	stringifyObjectValues,
} from '@crisiscleanup/config'
import {
	Component,
	type DeploymentProps,
} from '@crisiscleanup/k8s.construct.component'
import {
	App,
	Chart,
	type ChartProps,
	Duration,
	Helm,
	Include,
	JsonPatch,
} from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { Construct } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import yaml from 'js-yaml'
import type { PartialDeep } from 'type-fest'
import { SecretProviderClass } from './imports/secrets-store.csi.x-k8s.io'

const debug = createDebug('@crisiscleanup:charts.crisiscleanup')

enum ContextKey {
	stage = 'stage',
}

export interface BackendConfigProps {
	config: ScreamingSnakeCaseProperties<FlattenObject<ApiAppConfig, '_'>>
	secrets: ScreamingSnakeCaseProperties<FlattenObject<ApiAppSecrets, '_'>>
}

export interface BackendApiProps extends DeploymentProps {
	config: BackendConfig
}

export interface CeleryQueueProps {
	name: string
	args?: string[]
}

export interface CeleryProps extends BackendApiProps {
	queues?: CeleryQueueProps[]
}

export interface BackendProps {
	asgi: Omit<BackendApiProps, 'config'>
	wsgi: Omit<BackendApiProps, 'config'>
	celery: Omit<CeleryProps, 'config'>
	config: Record<any, any>
	secrets?: Record<any, any>
	stage?: string
}

export interface FrontendProps {
	web: DeploymentProps
}

export class BackendConfig extends Construct {
	configMap: kplus.ConfigMap
	configSecret: kplus.Secret
	constructor(scope: Construct, id: string, props: BackendConfigProps) {
		super(scope, id)

		const stage = this.node.getContext(ContextKey.stage) as string

		this.configMap = new kplus.ConfigMap(this, 'config', {
			data: stringifyObjectValues(props.config),
		})

		this.configSecret = new kplus.Secret(this, 'config-secret', {
			stringData: stringifyObjectValues(props.secrets),
		})

		const secretObjects = Object.entries(
			stringifyObjectValues(props.secrets),
		).map(([key]) => ({
			objectAlias: key,
			objectName: `${stage}/${key}`,
			objectType: 'secretsmanager',
		}))

		new SecretProviderClass(this, 'aws-secrets', {
			metadata: { name: 'aws-secrets' },
			spec: {
				provider: 'aws',
				parameters: {
					region: 'us-east-1',
					objects: yaml.dump(secretObjects),
				},
			},
		})
	}

	get envFrom(): kplus.EnvFrom[] {
		return [
			new kplus.EnvFrom(this.configMap),
			new kplus.EnvFrom(undefined, undefined, this.configSecret),
		]
	}
}

export class BackendWSGI extends Component<BackendApiProps> {
	static componentName = 'wsgi'

	constructor(scope: Construct, id: string, props: BackendApiProps) {
		super(scope, id, props)

		const staticVolume = kplus.Volume.fromEmptyDir(
			scope,
			'static-files',
			'staticfiles',
		)
		const secretsVolume = kplus.Volume.fromCsi(
			scope,
			'secrets',
			'secrets-store.csi.k8s.io',
			{
				readOnly: true,
				attributes: {
					secretProviderClass: 'aws-secrets',
				},
			},
		)

		this.addContainer({
			name: 'backend',
			portNumber: 5000,
			...(props.probes ?? {}),
			envFrom: props.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			volumeMounts: [
				{ volume: staticVolume, path: '/app/staticfiles' },
				// { volume: secretsVolume, path: '/run/secrets' },
			],
			command: ['/serve.sh', 'wsgi'],
		})

		this.addContainer({
			name: 'migrate',
			command: ['python', 'manage.py', 'migrate', '--noinput', '--verbosity=1'],
			init: true,
			envFrom: props.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
			},
		})

		this.addContainer({
			name: 'collectstatic',
			command: [
				'python',
				'manage.py',
				'collectstatic',
				'--link',
				'--no-post-process',
				'--noinput',
				'--verbosity=2',
			],
			init: true,
			envFrom: props.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			volumeMounts: [{ volume: staticVolume, path: '/app/staticfiles' }],
		})
	}
}

export class BackendASGI extends Component<BackendApiProps> {
	static componentName = 'asgi'

	constructor(scope: Construct, id: string, props: BackendApiProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'backend',
			command: ['/serve.sh', 'asgi'],
			portNumber: 5000,
			...(props.probes ?? {}),
			envFrom: props.config.envFrom,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
		})
	}
}

export class CeleryBeat extends Component<BackendApiProps> {
	static componentName = 'celerybeat'

	constructor(scope: Construct, id: string, props: BackendApiProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'celerybeat',
			command: ['/serve.sh', 'celerybeat'],
			envFrom: props.config.envFrom,
			securityContext: { readOnlyRootFilesystem: false },
		})
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return { replicas: 1 }
	}
}

export class CeleryWorkers extends Component<BackendApiProps> {
	static componentName = 'celeryworker'

	addWorkerQueue(queue: CeleryQueueProps): this {
		this.addContainer({
			name: queue.name.replaceAll(',', '-'),
			command: [
				'/serve.sh',
				'celeryworker',
				'-Q',
				queue.name,
				'--concurrency=1',
				...(queue.args ?? []),
			],
			envFrom: this.props.config.envFrom,
			securityContext: { readOnlyRootFilesystem: false },
		})
		return this
	}
}

export class Celery extends Construct {
	beat: CeleryBeat
	workers: CeleryWorkers

	constructor(
		scope: Construct,
		id: string,
		readonly props: CeleryProps,
	) {
		super(scope, id)
		this.beat = new CeleryBeat(this, 'beat', props)
		this.workers = new CeleryWorkers(this, 'workers', props)
		if (props.queues)
			props.queues.forEach((queue) => this.workers.addWorkerQueue(queue))
	}
}

export class AdminWebSocket extends Component<BackendApiProps> {
	static componentName = 'adminwebsocket'

	constructor(scope: Construct, id: string, props: BackendApiProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'adminwebsocket',
			command: ['/serve.sh', 'adminwebsocket'],
			envFrom: this.props.config.envFrom,
		})
	}
}

export class Web extends Component {
	static componentName = 'web'

	constructor(scope: Construct, id: string, props: DeploymentProps) {
		super(scope, id, props)
		const probe = kplus.Probe.fromHttpGet('/', {
			failureThreshold: 3,
			periodSeconds: Duration.seconds(10),
		})
		this.addContainer({
			name: 'web',
			portNumber: 80,
			liveness: probe,
			readiness: probe,
			securityContext: { ensureNonRoot: false, readOnlyRootFilesystem: false },
		})
	}
}

export class Backend extends Construct {
	wsgi: BackendWSGI
	asgi: BackendASGI
	celery: Celery
	adminWebSocket: AdminWebSocket

	constructor(scope: Construct, id: string, props: BackendProps) {
		super(scope, id)

		const config = new BackendConfig(this, 'config', {
			config: props.config,
			secrets: props.secrets,
		})

		this.wsgi = new BackendWSGI(this, 'wsgi', {
			config,
			probes: this.createHttpProbes('/health'),
			...props.wsgi,
		})
		this.asgi = new BackendASGI(this, 'asgi', {
			config,
			probes: this.createHttpProbes('/ws/health'),
			...props.asgi,
		})
		this.celery = new Celery(this, 'celery', {
			config,
			...props.celery,
		})
		this.adminWebSocket = new AdminWebSocket(this, 'adminwebsocket', {
			config,
			...props.wsgi,
			replicaCount: 1,
		})
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

export class Frontend extends Construct {
	web: Web

	constructor(scope: Construct, id: string, props: FrontendProps) {
		super(scope, id)
		this.web = new Web(this, 'web', props.web)
	}
}

export interface IngressControllerProps {
	className: string
	annotations?: Record<string, string>
}

abstract class IngressController {
	abstract createController(props: IngressControllerProps): void
}

class NginxIngressController extends Construct implements IngressController {
	createController(props: IngressControllerProps) {
		new Include(this, 'controller', {
			url: 'https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml',
		})
	}
}

export interface CrisisCleanupChartProps extends ChartProps {
	backend: BackendProps
	frontend: FrontendProps
	domainName: string
}

export class CrisisCleanupChart extends Chart {
	static frontendDefaultProps: FrontendProps
	static backendDefaultProps: BackendProps

	static defaultProps: CrisisCleanupChartProps

	static {
		const backendDefaults: DeploymentProps = {
			replicaCount: 1,
			image: {
				repository:
					'240937704012.dkr.ecr.us-east-1.amazonaws.com/crisiscleanup-api',
				tag: 'latest',
				pullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
			},
		}
		this.frontendDefaultProps = {
			web: {
				replicaCount: 1,
				image: {
					repository:
						'240937704012.dkr.ecr.us-east-1.amazonaws.com/crisiscleanup-web',
					tag: 'latest',
					pullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
				},
			},
		}

		this.backendDefaultProps = {
			config: {},
			secrets: {},
			asgi: backendDefaults,
			celery: {
				...backendDefaults,
				queues: [
					{ name: 'celery' },
					{ name: 'phone' },
					{ name: 'metrics', args: ['--prefetch-multiplier=5'] },
				],
			},
			wsgi: backendDefaults,
		}

		this.defaultProps = {
			namespace: 'local',
			labels: {
				app: 'crisiscleanup',
			},
			domainName: 'local.crisiscleanup.io',
			backend: this.backendDefaultProps,
			frontend: this.frontendDefaultProps,
		}
	}

	static withDefaults(
		scope: Construct,
		props: PartialDeep<CrisisCleanupChartProps>,
	) {
		const defaults = Object.assign({}, this.defaultProps)
		const values = defu(Object.assign({}, props), defaults)
		debug('input props: %O', props)
		debug('chart props: %O', values)
		return new this(scope, 'crisiscleanup', values as CrisisCleanupChartProps)
	}

	backend: Backend
	frontend: Frontend
	ingress: kplus.Ingress

	constructor(scope: Construct, id: string, props: CrisisCleanupChartProps) {
		super(scope, id, props)

		this.node.setContext(ContextKey.stage, props.backend.stage ?? 'local')

		new kplus.Namespace(this, 'namespace', {
			metadata: { name: props.namespace },
		})

		this.backend = new Backend(this, 'backend', props.backend)
		this.frontend = new Frontend(this, 'frontend', props.frontend)

		this.ingress = new kplus.Ingress(this, 'ingress')
		this.ingress.addHostRule(
			`api.${props.domainName}`,
			'/ws/',
			kplus.IngressBackend.fromService(
				this.backend.asgi.deployment.exposeViaService({
					serviceType: kplus.ServiceType.CLUSTER_IP,
				}),
			),
			kplus.HttpIngressPathType.PREFIX,
		)
		this.ingress.addHostDefaultBackend(
			`api.${props.domainName}`,
			kplus.IngressBackend.fromService(
				this.backend.wsgi.deployment.exposeViaService({
					serviceType: kplus.ServiceType.CLUSTER_IP,
				}),
			),
		)

		const webService = this.frontend.web.deployment.exposeViaService({
			serviceType: kplus.ServiceType.CLUSTER_IP,
		})
		const webBackend = kplus.IngressBackend.fromService(webService)
		this.ingress.addHostRule(
			props.domainName,
			'/',
			webBackend,
			kplus.HttpIngressPathType.PREFIX,
		)
		this.ingress.addHostRule(
			`www.${props.domainName}`,
			'/',
			webBackend,
			kplus.HttpIngressPathType.PREFIX,
		)
	}
}

const { config } = await getConfig()
const apiConfig = flattenToScreamingSnakeCase(config.api.config, {
	nestedDelimiter: '_',
})
const apiSecrets = flattenToScreamingSnakeCase(config.api.secrets, {
	nestedDelimiter: '_',
})

const app = new App({ recordConstructMetadata: true })
const ingressChart = new Chart(app, 'ingress')
const igController = new NginxIngressController(
	ingressChart,
	'ingress-controller',
)
igController.createController({
	className: 'nginx',
})
const chart = CrisisCleanupChart.withDefaults(app, {})
chart.addDependency(ingressChart)
app.synth()
