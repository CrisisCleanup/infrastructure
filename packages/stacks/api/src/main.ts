import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CrisisCleanupConfig,
	type CrisisCleanupConfigLayerMeta,
	getConfig,
	type Stage as ConfigStage,
} from '@crisiscleanup/config'
import { App, Tags } from 'aws-cdk-lib'
import {
	KubePrometheusStackAddOn,
	RedisStackAddOn,
	ARCScaleSet,
	ARCScaleSetController,
} from './addons'
import { noFargateNodeAffinitySelector } from './cluster.ts'
import { Pipeline } from './pipeline'
import { SopsSecretProvider } from './secrets'

const { config, cwd, layers } = await getConfig({
	strict: true,
	useEnvOverrides: true,
})
const configsLayer = layers!.find(
	(layer) => layer.meta?.repo === 'configs' && 'sources' in layer.meta,
)
// @ts-expect-error todo: fix sources
const configsSources: Record<ConfigStage, CrisisCleanupConfigLayerMeta> =
	Object.fromEntries(
		configsLayer!.meta!.sources!.map((source) => [source.name, source]),
	)

blueprints.HelmAddOn.validateHelmVersions = true

const app = new App({
	context: {
		config,
		// seems to be failing due to patches?
		'cdk-pipelines-github:diffProtection': 'false',
	},
})

const devSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-development-api',
	sopsFilePath: <string>configsSources.development.secretsPath,
})

const stagingSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-staging-api',
	sopsFilePath: <string>configsSources.staging.secretsPath,
})

const prodSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-production-api',
	sopsFilePath: <string>configsSources.production.secretsPath,
})

const prodAUSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-productionau-api',
	// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
	sopsFilePath: <string>configsSources['production-au'].secretsPath,
})

const pipeline = Pipeline.builder({
	id: 'crisiscleanup',
	rootDir: cwd,
	repos: config.pipeline.repositories,
	pipelineEnvironment: config.cdkEnvironment,
})
	.target({
		name: 'development',
		stackBuilder: (builder) => builder.addOns(new RedisStackAddOn()),
		config: config.$env!.development as unknown as CrisisCleanupConfig,
		secretsProvider: devSecretsProvider,
	})
	.target({
		name: 'staging',
		stackBuilder: (builder) => builder.addOns(new RedisStackAddOn()),
		config: {
			...(config.$env!.staging as unknown as CrisisCleanupConfig),
			chart: {
				...((config.$env!.staging as unknown as CrisisCleanupConfig)?.chart ||
					{}),
				wsgi: {
					...((config.$env!.staging as unknown as CrisisCleanupConfig)?.chart
						?.wsgi || {}),
					resources: {
						memory: {
							request: 2048,
							limit: 2048,
						},
					},
				},
			},
		} as CrisisCleanupConfig,
		secretsProvider: stagingSecretsProvider,
	})
	.target({
		name: 'production',
		stackBuilder: (builder, builderConfig) =>
			builder
				.enableControlPlaneLogTypes(
					<blueprints.ControlPlaneLogType>'api',
					<blueprints.ControlPlaneLogType>'controllerManager',
					<blueprints.ControlPlaneLogType>'audit',
					<blueprints.ControlPlaneLogType>'authenticator',
					<blueprints.ControlPlaneLogType>'scheduler',
				)
				.addOns(
					new ARCScaleSetController({
						values: {
							flags: {
								runnerMaxConcurrentReconciles: 8,
							},
							metrics: {
								controllerManagerAddr: ':8080',
								listenerAddr: ':8080',
								listenerEndpoint: '/metrics',
							},
						},
					}),
					new ARCScaleSet({
						minRunners: builderConfig.apiStack!.arc.minRunners ?? undefined,
						maxRunners: builderConfig.apiStack!.arc.maxRunners ?? undefined,
						githubConfigUrl: 'https://github.com/CrisisCleanup',
						runnerScaleSetName: 'crisiscleanup-arc',
						githubConfigSecret: 'arc-github-credentials',
						containerImages: builderConfig.apiStack!.arc.images,
						useDindRunner: false,
					}),
				)
				.addOns(
					new KubePrometheusStackAddOn({
						values: {
							'prometheus-node-exporter': {
								affinity: {
									nodeAffinity: {
										requiredDuringSchedulingIgnoredDuringExecution: {
											nodeSelectorTerms: [noFargateNodeAffinitySelector],
										},
									},
								},
							},
						},
					}),
				),
		config: config.$env!.production as unknown as CrisisCleanupConfig,
		secretsProvider: prodSecretsProvider,
	})
	.target({
		name: 'production-au',
		stackBuilder: (builder) =>
			builder.enableControlPlaneLogTypes(
				<blueprints.ControlPlaneLogType>'api',
				<blueprints.ControlPlaneLogType>'controllerManager',
				<blueprints.ControlPlaneLogType>'audit',
				<blueprints.ControlPlaneLogType>'authenticator',
				<blueprints.ControlPlaneLogType>'scheduler',
			),
		config: config.$env!['production-au'] as unknown as CrisisCleanupConfig,
		secretsProvider: prodAUSecretsProvider,
	})
	.build(app, {
		env: {
			account: String(config.cdkEnvironment.account),
			region: config.cdkEnvironment.region,
		},
		crossRegionReferences: true,
	})

await pipeline.waitForAsyncTasks()
if (config.pipeline.appRegistryTag) {
	Tags.of(pipeline).add('awsApplication', config.pipeline.appRegistryTag)
}
app.synth({ validateOnSynthesis: true })

export default pipeline
