import { flattenToScreamingSnakeCase, getConfig } from "@crisiscleanup/config";
import { Component, type DeploymentProps } from "@crisiscleanup/k8s.construct.component";
import { App, Chart, type ChartProps, Duration, Helm, Include, JsonPatch } from "cdk8s";
import * as kplus from "cdk8s-plus-24";
import { Construct } from "constructs";
import createDebug from "debug";
import defu from "defu";
import type { PartialDeep } from "type-fest";
import { Backend, BackendProps } from "@crisiscleanup/k8s.construct.api/src/api";

const debug = createDebug('@crisiscleanup:charts.crisiscleanup')

enum ContextKey {
	stage = 'stage',
}

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
const chart = CrisisCleanupChart.withDefaults(app, {
	backend: {
		stage: config.ccuStage,
		config: apiConfig,
		secrets: apiSecrets,
	},
})

if (config.ccuStage === 'local') {
	const localChart = new Chart(app, 'local')
	const igController = new NginxIngressController(
		localChart,
		'ingress-controller',
	)
	igController.createController({
		className: 'nginx',
	})
	new Helm(localChart, 'secrets-csi', {
		chart: 'secrets-store-csi-driver',
		namespace: 'kube-system',
		repo: 'https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts',
		releaseName: 'csi-secrets-store',
	})
	// secrets store csi
	new Include(localChart, 'secrets-store-driver-provider-aws', {
		url: 'https://raw.githubusercontent.com/aws/secrets-store-csi-driver-provider-aws/main/deployment/aws-provider-installer.yaml',
	})

	// headlamp
	const headlamp = new Helm(localChart, 'headlamp', {
		namespace: 'kube-system',
		releaseName: 'headlamp',
		chart: 'headlamp',
		repo: 'https://headlamp-k8s.github.io/headlamp/',
		helmFlags: ['--namespace=kube-system'],
	})
	headlamp.apiObjects.forEach((obj) => {
		obj.addJsonPatch(JsonPatch.add('/metadata/namespace', 'kube-system'))
	})

	const headlampService = headlamp.apiObjects.find(
		(obj) => obj.kind === 'Service',
	)!
	const externalHeadlamp = new kplus.Service(chart, 'headlamp-external', {
		type: kplus.ServiceType.EXTERNAL_NAME,
		externalName: `${headlampService.metadata.name!}.${
			headlampService.metadata.namespace ?? 'kube-system'
		}.svc.cluster.local`,
		ports: [{ port: 80 }],
	})
	chart.ingress.addHostDefaultBackend(
		'headlamp.local.crisiscleanup.io',
		kplus.IngressBackend.fromService(externalHeadlamp, { port: 80 }),
	)
	chart.addDependency(localChart)
}

app.synth()
