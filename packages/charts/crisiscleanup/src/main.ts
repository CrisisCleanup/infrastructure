import process from 'node:process'
import { App, Chart, type ChartProps, Duration, Include } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { Construct, type Node } from 'constructs'
import defu from 'defu'

export interface ContainerImageProps {
	repository: string
	tag: string
	pullPolicy?: kplus.ImagePullPolicy
}

export class ContainerImage implements ContainerImageProps {
	static fromProps(props: ContainerImageProps): ContainerImage {
		if (props instanceof ContainerImage) return props
		return new ContainerImage(props.repository, props.tag, props.pullPolicy)
	}

	protected constructor(
		public readonly repository: string,
		public readonly tag: string,
		public readonly pullPolicy?: kplus.ImagePullPolicy,
	) {}

	get imageFqn(): string {
		return `${this.repository}:${this.tag}`
	}

	get containerProps(): {
		image: string
		imagePullPolicy?: kplus.ImagePullPolicy
	} {
		return { image: this.imageFqn, imagePullPolicy: this.pullPolicy }
	}
}

export interface DeploymentProps {
	replicaCount: number
	image: ContainerImageProps
	probes?: Pick<kplus.ContainerProps, 'liveness' | 'startup' | 'readiness'>
	spread?: boolean
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
}

export interface FrontendProps {
	web: DeploymentProps
}

class Component<PropsT extends DeploymentProps = DeploymentProps>
	implements Construct
{
	static componentName: string = ''
	deployment: kplus.Deployment
	readonly node: Node

	constructor(
		public readonly scope: Construct,
		public readonly id: string,
		public readonly props: PropsT,
	) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		const componentName = Object.getPrototypeOf(this).constructor
			.componentName as string
		const deploymentProps = this.createDeploymentProps()
		const mergedProps = defu<kplus.DeploymentProps>(
			{
				replicas: props.replicaCount,
				metadata: {
					labels: {
						app: 'crisiscleanup',
						component: componentName,
					},
				},
				spread: props.spread ?? false,
			},
			deploymentProps,
		)
		this.deployment = this.createDeployment(mergedProps)
		this.node = this.deployment.node
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return {}
	}

	protected createDeployment(props: kplus.DeploymentProps): kplus.Deployment {
		return new kplus.Deployment(this.scope, this.id, props)
	}

	addContainer(
		props: Omit<kplus.ContainerProps, 'image'> & {
			image?: ContainerImageProps
			init?: boolean
		},
	): this {
		const { init = false, ...containerPropsInput } = props
		const containerProps = {
			...ContainerImage.fromProps(props.image ?? this.props.image)
				.containerProps,
			...containerPropsInput,
		} as kplus.ContainerProps
		if (init) {
			this.deployment.addInitContainer(containerProps)
		} else {
			this.deployment.addContainer(containerProps)
		}
		return this
	}
}

export class BackendConfig extends Construct {
	configMap: kplus.ConfigMap
	constructor(
		scope: Construct,
		id: string,
		readonly props: { config: Record<string, string> },
	) {
		super(scope, id)

		this.configMap = new kplus.ConfigMap(this, 'config', {
			data: props.config,
		})
	}
}

export class BackendWSGI extends Component<BackendApiProps> {
	static componentName = 'wsgi'

	constructor(scope: Construct, id: string, props: BackendApiProps) {
		super(scope, id, props)

		const staticVolume = kplus.Volume.fromEmptyDir(
			this,
			'static-files',
			'staticfiles',
		)
		this.addContainer({
			name: 'backend',
			portNumber: 5000,
			...(props.probes ?? {}),
			envFrom: [new kplus.EnvFrom(props.config.configMap)],
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			volumeMounts: [{ volume: staticVolume, path: '/app/staticfiles' }],
			command: ['/serve.sh', 'wsgi'],
		})
			.addContainer({
				name: 'migrate',
				command: [
					'python',
					'manage.py',
					'migrate',
					'--noinput',
					'--verbosity=1',
				],
				init: true,
				envFrom: [new kplus.EnvFrom(props.config.configMap)],
				securityContext: {
					readOnlyRootFilesystem: false,
				},
			})
			.addContainer({
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
				envFrom: [new kplus.EnvFrom(props.config.configMap)],
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
			envFrom: [new kplus.EnvFrom(props.config.configMap)],
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
			envFrom: [new kplus.EnvFrom(props.config.configMap)],
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
			envFrom: [new kplus.EnvFrom(this.props.config.configMap)],
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
			envFrom: [new kplus.EnvFrom(props.config.configMap)],
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
			config: {
				CELERY_ALWAYS_EAGER: 'False',
				DATABASE_PORT: '5432',
				DJANGO_ACCOUNT_ALLOW_REGISTRATION: 'True',
				DJANGO_ADMIN_URL: '^ccadmin/',
				DJANGO_ALLOWED_HOSTS: '*',
				DJANGO_CSRF_COOKIE_SECURE: 'False',
				DJANGO_SECURE_SSL_REDIRECT: 'False',
				DJANGO_SESSION_COOKIE_SECURE: 'False',
				ELASTIC_SEARCH_HOST:
					'https://search-crisiscleanup-weyohcdj6uiduuj65scqkmxxjy.us-east-1.es.amazonaws.com/',
				NEW_RELIC_CONFIG_FILE: '/app/newrelic.ini',
				CCU_NEWRELIC_DISABLE: '1',
				FORCE_DOCKER: 'True',
				SENTRY_TRACE_EXCLUDE_URLS:
					'/,/health,/health/,/ws/health,/ws/health/,/version,/version/,/{var}health/,/{var}version/,crisiscleanup.common.tasks.get_request_ip,crisiscleanup.common.tasks.create_signal_log',
				// dev
				DATABASE_HOST: '172.17.0.1',
				POSTGRES_DBNAME: 'crisiscleanup_dev',
				POSTGRES_HOST: '172.17.0.1',
				REDIS_HOST: '172.17.0.1',
				// REDIS_HOST_REPLICAS:
				DJANGO_EMAIL_BACKEND: 'django.core.mail.backends.dummy.EmailBackend',
				CCU_WEB_URL: 'https://local.crisiscleanup.io',
				CCU_API_URL: 'https://api.local.crisiscleanup.io',
				SAML_AWS_ROLE: 'arn:aws:iam::182237011124:role/CCUDevConnectRole',
				SAML_AWS_PROVIDER: 'arn:aws:iam::182237011124:saml-provider/ccuDev',
				CONNECT_INSTANCE_ID: '87fbcad4-9f58-4153-84e8-d5b7202693e8',
				AWS_DYNAMO_STAGE: 'dev',
				PHONE_CHECK_TIMEZONE: 'False',
				DJANGO_SETTINGS_MODULE: 'config.settings.local',
				// todo: use csi secrets
				POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
				POSTGRES_USER: process.env.POSTGRES_USER,
				DJANGO_SECRET_KEY: process.env.DJANGO_SECRET_KEY,
				JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY,
				JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
				CLOUDFRONT_PUBLIC_KEY: process.env.CLOUDFRONT_PUBLIC_KEY,
				CLOUDFRONT_PRIVATE_KEY: process.env.CLOUDFRONT_PRIVATE_KEY,
				AWS_ACCESS_KEY_ID: process.env.LOCAL_AWS_ACCESS_KEY_ID,
				AWS_SECRET_ACCESS_KEY: process.env.LOCAL_AWS_SECRET_ACCESS_KEY,
				AWS_DEFAULT_REGION: process.env.LOCAL_AWS_DEFAULT_REGION,
				DJANGO_MANDRILL_API_KEY: process.env.DJANGO_MANDRILL_API_KEY,
				ZENDESK_API_KEY: process.env.ZENDESK_API_KEY,
				CONNECT_FIRST_PASSWORD: process.env.CONNECT_FIRST_PASSWORD,
			},
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
		props: Partial<CrisisCleanupChartProps>,
	) {
		const defaults = Object.assign({}, this.defaultProps)
		const values = defu(Object.assign({}, props), defaults)
		return new this(scope, 'crisiscleanup', values)
	}

	backend: Backend
	frontend: Frontend
	ingress: kplus.Ingress

	constructor(scope: Construct, id: string, props: CrisisCleanupChartProps) {
		super(scope, id, props)

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
					serviceType: kplus.ServiceType.NODE_PORT,
				}),
			),
			kplus.HttpIngressPathType.PREFIX,
		)
		this.ingress.addHostDefaultBackend(
			`api.${props.domainName}`,
			kplus.IngressBackend.fromService(
				this.backend.wsgi.deployment.exposeViaService({
					serviceType: kplus.ServiceType.NODE_PORT,
				}),
			),
		)

		const webService = this.frontend.web.deployment.exposeViaService({
			serviceType: kplus.ServiceType.NODE_PORT,
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
