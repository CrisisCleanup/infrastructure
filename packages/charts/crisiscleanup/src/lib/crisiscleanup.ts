import {
	type ApiAppConfig,
	type ApiAppSecrets,
	flattenToScreamingSnakeCase,
} from '@crisiscleanup/config'
import {
	ApiASGI,
	ApiConfig,
	type ApiConstructConfig,
	ApiWSGI,
	CeleryBeat,
	CeleryWorker,
} from '@crisiscleanup/k8s.construct.api'
import {
	Component,
	Label,
	type ContainerImageProps,
	type DeploymentProps,
} from '@crisiscleanup/k8s.construct.component'
import { Chart, type ChartProps, Duration, Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { Construct } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import type { PartialDeep } from 'type-fest'

const debug = createDebug('@crisiscleanup:charts.crisiscleanup')

export interface FrontendProps {
	web: DeploymentProps
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
			resources: {
				cpu: {
					limit: kplus.Cpu.millis(6),
					request: kplus.Cpu.millis(2),
				},
				memory: {
					limit: Size.mebibytes(100),
					request: Size.mebibytes(50),
				},
			},
		})
	}
}

export class Frontend extends Construct {
	web: Web

	constructor(scope: Construct, id: string, props: FrontendProps) {
		super(scope, id)
		this.web = new Web(this, 'web', props.web)
	}
}

export interface CrisisCleanupChartProps
	extends ChartProps,
		ApiConstructConfig {
	frontend: FrontendProps
	domainName: string
	apiAppConfig: ApiAppConfig
	apiAppSecrets: ApiAppSecrets
	apiImage?: ContainerImageProps
	webImage?: ContainerImageProps
	ingressAnnotations?: Record<string, string>
}

export class CrisisCleanupChart extends Chart {
	static frontendDefaultProps: FrontendProps
	static backendDefaultProps: ApiConstructConfig

	static defaultProps: Partial<CrisisCleanupChartProps>

	static {
		const backendDefaults: DeploymentProps = {
			replicaCount: undefined,
		}
		this.frontendDefaultProps = {
			web: {
				replicaCount: undefined,
			},
		}

		this.backendDefaultProps = {
			wsgi: backendDefaults,
			asgi: backendDefaults,
			celeryBeat: backendDefaults,
			celery: {},
		}

		this.defaultProps = {
			namespace: 'local',
			labels: {
				[Label.PART_OF]: 'crisiscleanup',
			},
			domainName: 'local.crisiscleanup.io',
			frontend: this.frontendDefaultProps,
			...this.backendDefaultProps,
		} as Partial<CrisisCleanupChartProps>
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

	readonly namespaceChart: Chart
	readonly configChart: Chart
	readonly apiChart: Chart
	readonly celeryChart: Chart
	readonly webChart: Chart
	readonly ingressChart: Chart

	readonly apiConfig: ApiConfig
	readonly wsgi: ApiWSGI
	readonly asgi: ApiASGI
	readonly celeryBeat: CeleryBeat
	readonly celeryWorkers: CeleryWorker[]
	readonly frontend: Frontend
	readonly ingress: kplus.Ingress

	constructor(scope: Construct, id: string, props: CrisisCleanupChartProps) {
		super(scope, id, props)

		this.namespaceChart = new Chart(this, 'namespace', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: this.labels,
		})
		const namespace = new kplus.Namespace(this.namespaceChart, 'namespace', {
			metadata: { name: props.namespace },
		})

		this.configChart = new Chart(this, 'config', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: { ...this.labels, [Label.COMPONENT]: 'config' },
		})
		this.configChart.addDependency(namespace)

		this.apiChart = new Chart(this, 'api', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: {
				...this.labels,
				[Label.COMPONENT]: 'api',
			},
		})

		this.celeryChart = new Chart(this, 'celery', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: {
				...this.labels,
				[Label.COMPONENT]: 'task-queue',
			},
		})

		this.webChart = new Chart(this, 'web', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: {
				...this.labels,
				[Label.COMPONENT]: 'web',
			},
		})

		this.ingressChart = new Chart(this, 'ingress', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: {
				...this.labels,
				[Label.COMPONENT]: 'ingress',
			},
		})

		this.apiConfig = new ApiConfig(this.configChart, 'api', {
			config: flattenToScreamingSnakeCase(props.apiAppConfig, {
				nestedDelimiter: '_',
			}),
			secrets: flattenToScreamingSnakeCase(props.apiAppSecrets, {
				nestedDelimiter: '_',
			}),
		})

		this.celeryChart.addDependency(this.apiConfig)
		this.apiChart.addDependency(this.celeryChart)

		this.wsgi = new ApiWSGI(this.apiChart, 'wsgi', {
			...props.wsgi,
			image: props.wsgi.image ?? props.apiImage,
			config: this.apiConfig,
		})
		this.asgi = new ApiASGI(this.apiChart, 'asgi', {
			...props.asgi,
			image: props.asgi.image ?? props.apiImage,
			config: this.apiConfig,
		})

		this.celeryBeat = new CeleryBeat(this.celeryChart, 'celerybeat', {
			...props.celeryBeat,
			image: props.celeryBeat.image ?? props.apiImage,
			config: this.apiConfig,
		})

		this.celeryWorkers = Object.entries(props.celery).map(
			([name, celeryProps]) =>
				new CeleryWorker(this.celeryChart, `celery-${name}`, {
					...celeryProps,
					image: celeryProps.image ?? props.apiImage,
					name,
					config: this.apiConfig,
				}),
		)
		this.frontend = new Frontend(this.webChart, 'frontend', {
			web: {
				...props.frontend.web,
				image: props.frontend.web.image ?? props.webImage,
			},
		})

		this.ingress = new kplus.Ingress(
			this.ingressChart,
			'ingress',
			props.ingressAnnotations
				? {
						metadata: { annotations: props.ingressAnnotations },
				  }
				: undefined,
		)

		this.ingress.addHostRule(
			`api.${props.domainName}`,
			'/ws/',
			kplus.IngressBackend.fromService(
				this.asgi.deployment.exposeViaService({
					serviceType: kplus.ServiceType.CLUSTER_IP,
				}),
			),
			kplus.HttpIngressPathType.PREFIX,
		)
		this.ingress.addHostDefaultBackend(
			`api.${props.domainName}`,
			kplus.IngressBackend.fromService(
				this.wsgi.deployment.exposeViaService({
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
		this.ingress.addHostRule(
			`app.${props.domainName}`,
			'/',
			webBackend,
			kplus.HttpIngressPathType.PREFIX,
		)
	}
}
