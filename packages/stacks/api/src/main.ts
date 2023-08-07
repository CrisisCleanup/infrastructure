import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CrisisCleanupConfig,
	type CrisisCleanupConfigLayerMetaSources,
	getConfig,
	type Stage as ConfigStage,
} from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { RedisStackAddOn } from './addons'
import { buildClusterBuilder, buildEKSStack, getDefaultAddons } from './cluster'
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
const configsSources: Record<ConfigStage, CrisisCleanupConfigLayerMetaSources> =
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

const buildStack = (
	stageConfig: CrisisCleanupConfig,
	defaultAddons: boolean = true,
) => {
	const clusterBuilder = buildClusterBuilder(stageConfig)
	const cluster = clusterBuilder.build()
	let stack = buildEKSStack(stageConfig).clusterProvider(cluster)
	if (defaultAddons) {
		stack = stack.addOns(...getDefaultAddons(stageConfig))
	}
	return stack
}

const devSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-development-api',
	sopsFilePath: configsSources.development.secretsPath,
})

const stagingSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-staging-api',
	sopsFilePath: configsSources.staging.secretsPath,
})

const pipeline = Pipeline.builder({
	id: 'crisiscleanup',
	connectionArn: config.apiStack.codeStarConnectionArn,
	rootDir: cwd,
})
	.target({
		name: 'development',
		stackBuilder: buildStack(config.$env.development).addOns(
			new RedisStackAddOn(),
		),
		environment: config.$env.development.cdkEnvironment,
		platformTeam: new blueprints.PlatformTeam({
			name: 'platform',
			users: config.$env.development.apiStack.eks.platformArns.map(
				(arn) => new iam.ArnPrincipal(arn),
			),
		}),
		githubEnvironment: {
			name: 'development',
			url: 'https://app.dev.crisiscleanup.io',
		},
		config: config.$env.development,
		secretsProvider: devSecretsProvider,
	})
	.target({
		name: 'staging',
		stackBuilder: buildStack(config.$env.staging).addOns(new RedisStackAddOn()),
		environment: config.$env.staging.cdkEnvironment,
		platformTeam: new blueprints.PlatformTeam({
			name: 'platform',
			users: config.$env.staging.apiStack.eks.platformArns.map(
				(arn) => new iam.ArnPrincipal(arn),
			),
		}),
		githubEnvironment: {
			name: 'staging',
			url: 'https://app.staging.crisiscleanup.io',
		},
		config: config.$env.staging,
		secretsProvider: stagingSecretsProvider,
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
