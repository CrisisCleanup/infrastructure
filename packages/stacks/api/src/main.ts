import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CrisisCleanupConfig,
	type CrisisCleanupConfigLayerMeta,
	getConfig,
	type Stage as ConfigStage,
} from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import {
	ARCScaleSet,
	ARCScaleSetController,
	RedisStackAddOn,
	ScaleSetContainer,
} from './addons'
import { Pipeline } from './pipeline'
import { SopsSecretProvider } from './secrets'

const { config, cwd, layers } = await getConfig({
	strict: true,
	useEnvOverrides: true,
})
const configsLayer = layers!.find(
	(layer) => layer.meta?.repo === 'configs' && 'sources' in layer.meta,
)
// @ts-ignore
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

const pipeline = Pipeline.builder({
	id: 'crisiscleanup',
	rootDir: cwd,
	repos: config.pipeline.repositories,
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
		config: config.$env!.staging as unknown as CrisisCleanupConfig,
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
					new ARCScaleSetController(),
					new ARCScaleSet({
						minRunners: builderConfig.apiStack!.arc.minRunners ?? undefined,
						maxRunners: builderConfig.apiStack!.arc.maxRunners ?? undefined,
						githubConfigUrl: 'https://github.com/CrisisCleanup',
						runnerScaleSetName: 'crisiscleanup-arc',
						githubConfigSecret: 'arc-github-credentials',
						containerImages: {
							[ScaleSetContainer.RUNNER]:
								'summerwind/actions-runner:ubuntu-20.04',
							[ScaleSetContainer.INIT_DIND]:
								'ghcr.io/actions/actions-runner:2.308.0',
							[ScaleSetContainer.DIND]: 'docker:dind',
						},
					}),
				),
		config: config.$env!.production as unknown as CrisisCleanupConfig,
		secretsProvider: prodSecretsProvider,
	})
	.build(app, {
		env: {
			account: String(config.cdkEnvironment.account),
			region: config.cdkEnvironment.region,
		},
		crossRegionReferences: true,
	})

await pipeline.waitForAsyncTasks()
app.synth({ validateOnSynthesis: true })

export default pipeline
