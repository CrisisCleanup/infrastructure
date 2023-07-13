import { App, Chart, type ChartProps, Duration, Include } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { ImagePullPolicy, Ingress } from 'cdk8s-plus-24'
import { Construct } from 'constructs'
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
}

export interface CeleryQueueProps {
	name: string
	args?: string[]
}

export interface CeleryProps extends DeploymentProps {
	queues?: CeleryQueueProps[]
}

export interface BackendProps {
	asgi: DeploymentProps
	wsgi: DeploymentProps
	celery: CeleryProps
}

export interface FrontendProps {
	web: DeploymentProps
}

class Component<
	PropsT extends DeploymentProps = DeploymentProps,
> extends Construct {
	static componentName: string = ''
	deployment: kplus.Deployment

	constructor(
		scope: Construct,
		id: string,
		readonly props: PropsT,
	) {
		super(scope, id)
		const deploymentProps = this.createDeploymentProps()
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		const componentName = Object.getPrototypeOf(this).constructor
			.componentName as string
		this.deployment = this.createDeployment('deployment', {
			metadata: {
				labels: {
					app: 'crisiscleanup',
					component: componentName,
				},
				...(deploymentProps.metadata ?? {}),
			},
			spread: true,
			...deploymentProps,
		})
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return {}
	}

	protected createDeployment(
		id: string,
		props: kplus.DeploymentProps,
	): kplus.Deployment {
		return new kplus.Deployment(this, id, props)
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

export class BackendWSGI extends Component {
	static componentName = 'wsgi'

	constructor(scope: Construct, id: string, props: DeploymentProps) {
		super(scope, id, props)

		this.addContainer({
			name: 'backend',
			portNumber: 5000,
			...(props.probes ?? {}),
		})
			.addContainer({
				name: 'migrate',
				command: ['python', 'manage.py', 'migrate', '--noinput'],
				init: true,
			})
			.addContainer({
				name: 'collectstatic',
				command: ['python', 'manage.py', 'collectstatic', '--noinput'],
				init: true,
			})
	}
}

export class BackendASGI extends Component {
	static componentName = 'asgi'

	constructor(scope: Construct, id: string, props: DeploymentProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'backend',
			command: ['./serve.sh', 'asgi'],
			portNumber: 5000,
			...(props.probes ?? {}),
		})
	}
}

export class CeleryBeat extends Component {
	static componentName = 'celerybeat'

	constructor(scope: Construct, id: string, props: DeploymentProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'celerybeat',
			command: ['./start-celerybeat.sh'],
		})
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return { replicas: 1 }
	}
}

export class CeleryWorkers extends Component {
	static componentName = 'celeryworker'

	addWorkerQueue(queue: CeleryQueueProps): this {
		this.addContainer({
			name: queue.name,
			command: [
				'./start-celeryworker.sh',
				'-Q',
				queue.name,
				...(queue.args ?? []),
			],
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

export class AdminWebSocket extends Component {
	static componentName = 'adminwebsocket'

	constructor(scope: Construct, id: string, props: DeploymentProps) {
		super(scope, id, props)
		this.addContainer({
			name: 'adminwebsocket',
			command: ['./start-adminwebsocket.sh'],
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

		this.wsgi = new BackendWSGI(this, 'wsgi', {
			probes: this.createHttpProbes('/health'),
			...props.wsgi,
		})
		this.asgi = new BackendASGI(this, 'asgi', {
			probes: this.createHttpProbes('/ws/health'),
			...props.asgi,
		})
		this.celery = new Celery(this, 'celery', props.celery)
		this.adminWebSocket = new AdminWebSocket(this, 'adminwebsocket', {
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
				pullPolicy: ImagePullPolicy.ALWAYS,
			},
		}
		this.frontendDefaultProps = {
			web: {
				replicaCount: 1,
				image: {
					repository:
						'240937704012.dkr.ecr.us-east-1.amazonaws.com/crisiscleanup-api',
					tag: 'latest',
					pullPolicy: ImagePullPolicy.ALWAYS,
				},
			},
		}

		this.backendDefaultProps = {
			asgi: backendDefaults,
			celery: {
				...backendDefaults,
				queues: [
					{ name: 'default' },
					{ name: 'phone' },
					{ name: 'phone-metrics', args: ['--prefetch-multiplier=5'] },
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

		this.backend = new Backend(this, 'backend', props.backend)
		this.frontend = new Frontend(this, 'frontend', props.frontend)

		this.ingress = new kplus.Ingress(this, 'ingress')
		this.ingress.addHostRule(
			`api.${props.domainName}`,
			'/ws/',
			kplus.IngressBackend.fromService(
				this.backend.asgi.deployment.exposeViaService(),
			),
			kplus.HttpIngressPathType.PREFIX,
		)
		this.ingress.addHostDefaultBackend(
			`api.${props.domainName}`,
			kplus.IngressBackend.fromService(
				this.backend.wsgi.deployment.exposeViaService(),
			),
		)

		const webService = this.frontend.web.deployment.exposeViaService()
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
