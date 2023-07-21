import { getConfig } from '@crisiscleanup/config'
import { App, Chart, Helm, Include, JsonPatch } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { CrisisCleanupChart, NginxIngressController } from './lib'

const { config } = await getConfig()

const app = new App({ recordConstructMetadata: true })
const chart = CrisisCleanupChart.withDefaults(app, {
	apiAppConfig: config.api.config,
	apiAppSecrets: config.api.secrets,
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
	new Helm(localChart, 'metrics-server', {
		chart: 'metrics-server',
		repo: 'https://kubernetes-sigs.github.io/metrics-server/',
		releaseName: 'metrics-server',
		namespace: 'kube-system',
		values: {
			args: [
				'--kubelet-insecure-tls',
				'--kubelet-preferred-address-types=InternalIP',
			],
		},
	})
	chart.ingress.addHostDefaultBackend(
		'headlamp.local.crisiscleanup.io',
		kplus.IngressBackend.fromService(externalHeadlamp, { port: 80 }),
	)
	chart.addDependency(localChart)
}

app.synth()
