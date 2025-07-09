import { type CrisisCleanupConfig, getConfig } from '@crisiscleanup/config'
import { App } from 'cdk8s'
import * as kplus from 'cdk8s-plus-30'
import { CrisisCleanupChart, LocalChart } from './lib'

export const createChart = (app: App, config: CrisisCleanupConfig) => {
	const chart = CrisisCleanupChart.withDefaults(app, {
		...config.chart,
		apiAppConfig: config.api.config,
		apiAppSecrets: config.api.secrets,
		disableResourceNameHashes: true,
	})
	return chart
}

export const createLocalChart = (app: App, ccuChart: CrisisCleanupChart) => {
	const localChart = new LocalChart(app, 'local')
	const headlampService = localChart.headlamp.apiObjects.find(
		(obj) => obj.kind === 'Service',
	)!
	// create ingress rules for headlamp
	const externalHeadlamp = new kplus.Service(ccuChart, 'headlamp-external', {
		type: kplus.ServiceType.EXTERNAL_NAME,
		externalName: `${headlampService.metadata.name!}.${
			headlampService.metadata.namespace ?? 'kube-system'
		}.svc.cluster.local`,
		ports: [{ port: 80 }],
	})
	ccuChart.ingress.addHostDefaultBackend(
		'headlamp.local.crisiscleanup.io',
		kplus.IngressBackend.fromService(externalHeadlamp, { port: 80 }),
	)
	ccuChart.addDependency(localChart)
}

export const createApp = async () => {
	const app = new App({ recordConstructMetadata: true, outdir: 'cdk8s.out' })
	const { config } = await getConfig()

	const ccuChart = createChart(app, config)
	if (config.ccuStage === 'local') {
		createLocalChart(app, ccuChart)
	}

	return app
}

const app = await createApp()
app.synth()
