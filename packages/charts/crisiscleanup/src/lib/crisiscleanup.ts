import {
	type ApiAppConfig,
	type ApiAppSecrets,
	flattenToScreamingSnakeCase,
} from '@crisiscleanup/config'
import {
	AdminWebSocket,
	ApiASGI,
	ApiConfig,
	type ApiConstructConfig,
	ApiWSGI,
	CeleryBeat,
	CeleryWorker,
	DatabaseSync,
} from '@crisiscleanup/k8s.construct.api'
import {
	type ContainerImageProps,
	type DeploymentProps,
	Label,
} from '@crisiscleanup/k8s.construct.component'
import { Chart, type ChartProps } from 'cdk8s'
import * as kplus from 'cdk8s-plus-31'
import { type Construct } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import type { PartialDeep } from 'type-fest'

const debug = createDebug('@crisiscleanup:charts.crisiscleanup')

export interface CrisisCleanupChartProps
	extends ChartProps,
		ApiConstructConfig {
	domainName: string
	apiAppConfig: ApiAppConfig
	apiAppSecrets: ApiAppSecrets
	apiImage?: ContainerImageProps
	webImage?: ContainerImageProps
	ingressAnnotations?: Record<string, string>
}

export class CrisisCleanupChart extends Chart {
	static backendDefaultProps: ApiConstructConfig
	static defaultProps: Partial<CrisisCleanupChartProps>

	static {
		const backendDefaults: DeploymentProps = {
			replicaCount: undefined,
		}

		this.backendDefaultProps = {
			wsgi: backendDefaults,
			asgi: backendDefaults,
			celeryBeat: backendDefaults,
			celery: {},
			adminWebsocket: {},
		}

		this.defaultProps = {
			namespace: 'local',
			labels: {
				[Label.PART_OF]: 'crisiscleanup',
			},
			domainName: 'local.crisiscleanup.io',
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
	readonly syncChart?: Chart

	readonly apiConfig: ApiConfig
	readonly wsgi: ApiWSGI
	readonly asgi: ApiASGI
	readonly sync?: DatabaseSync
	readonly adminWebsocket: AdminWebSocket
	readonly celeryBeat: CeleryBeat
	readonly celeryWorkers: CeleryWorker[]
	readonly ingress: kplus.Ingress

	constructor(scope: Construct, id: string, props: CrisisCleanupChartProps) {
		super(scope, id, props)

		this.namespaceChart = new Chart(this, 'namespace', {
			namespace: props.namespace,
			disableResourceNameHashes: true,
			labels: this.labels,
		})
		const namespace = new kplus.Namespace(this.namespaceChart, 'namespace', {
			metadata: {
				name: props.namespace,
				labels: {
					...this.labels,
					// see:
					// https://kubernetes-sigs.github.io/aws-load-balancer-controller/v2.2/deploy/pod_readiness_gate/
					'elbv2.k8s.aws/pod-readiness-gate-inject': 'enabled',
				},
			},
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

		this.apiConfig = new ApiConfig(this.configChart, 'api', {
			config: flattenToScreamingSnakeCase(props.apiAppConfig, {
				nestedDelimiter: '_',
			}),
			secrets: flattenToScreamingSnakeCase(props.apiAppSecrets, {
				nestedDelimiter: '_',
			}),
		})

		if (props.sync) {
			this.syncChart = new Chart(this, 'sync', {
				namespace: props.namespace,
				disableResourceNameHashes: true,
				labels: {
					...this.labels,
					[Label.COMPONENT]: 'sync',
				},
			})
			this.sync = new DatabaseSync(this.syncChart, 'sync', props.sync)
		}

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
		this.adminWebsocket = new AdminWebSocket(this.apiChart, 'admin-websocket', {
			...props.adminWebsocket,
			image: props.wsgi.image ?? props.apiImage,
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

		this.ingress = new kplus.Ingress(
			this,
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
	}
}
