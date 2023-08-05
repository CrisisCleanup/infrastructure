import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CrisisCleanupConfig,
	type CrisisCleanupConfigLayerMetaSources,
	getConfig,
	type Stage as ConfigStage,
} from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { CrisisCleanupAddOn, RedisStackAddOn } from './addons'
import {
	buildClusterBuilder,
	buildEKSStack,
	buildKarpenter,
	getDefaultAddons,
} from './cluster'
import { DatabaseProvider, DatabaseSecretProvider } from './database'
import { KeyProvider } from './kms'
import { Pipeline } from './pipeline'
import { SopsSecretProvider } from './secrets'
import { VpcProvider } from './vpc'

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

enum ResourceNames {
	DATABASE = 'database',
	DATABASE_SECRET = 'database-secret',
	DATABASE_KEY = 'database-key',
}

const provideDatabase = (
	builder: blueprints.BlueprintBuilder,
	stageConfig: CrisisCleanupConfig,
): blueprints.BlueprintBuilder => {
	return builder
		.resourceProvider(
			ResourceNames.DATABASE_KEY,
			new KeyProvider({
				name: 'crisiscleanup-database-key',
			}),
		)
		.resourceProvider(
			ResourceNames.DATABASE_SECRET,
			new DatabaseSecretProvider(),
		)
		.resourceProvider(
			ResourceNames.DATABASE,
			new DatabaseProvider({
				...stageConfig.apiStack.database,
				isolated: stageConfig.apiStack.isolateDatabase,
				vpcResourceName: blueprints.GlobalResources.Vpc,
				databaseSecretResourceName: ResourceNames.DATABASE_SECRET,
				databaseKeyResourceName: ResourceNames.DATABASE_KEY,
			}),
		)
}

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
	const withVpc = provideVPC(stack, stageConfig)
	return provideDatabase(withVpc, stageConfig)
}

const provideVPC = (
	builder: blueprints.BlueprintBuilder,
	stageConfig: CrisisCleanupConfig,
) => {
	return builder.resourceProvider(
		blueprints.GlobalResources.Vpc,
		new VpcProvider({
			createIsolatedSubnet: stageConfig.apiStack.isolateDatabase,
			maxAzs: 2,
			natGateways: 1,
		}),
	)
}

const devSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-development-api',
	sopsFilePath: configsSources.development.secretsPath,
})

const stagingSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-staging-api',
	sopsFilePath: configsSources.staging.secretsPath,
})

const devStack = buildStack(config.$env.development).addOns(
	buildKarpenter(),
	new RedisStackAddOn(),
	new CrisisCleanupAddOn({
		config: {
			...config.$env.development,
			api: {
				...config.$env.development.api,
				// use defaults just to get the keys (nothing confidential here)
				secrets: config.$env.development.api.secrets ?? config.api.secrets,
			},
		},
		databaseSecretResourceName: ResourceNames.DATABASE_SECRET,
		databaseResourceName: ResourceNames.DATABASE,
		secretsProvider: devSecretsProvider,
	}),
)

const stagingStack = buildStack(config.$env.staging).addOns(
	buildKarpenter(),
	new RedisStackAddOn(),
	new CrisisCleanupAddOn({
		config: {
			...config.$env.staging,
			api: {
				...config.$env.staging.api,
				secrets: config.$env.staging.api.secrets ?? config.api.secrets,
			},
		},
		databaseResourceName: ResourceNames.DATABASE,
		databaseSecretResourceName: ResourceNames.DATABASE_SECRET,
		secretsProvider: stagingSecretsProvider,
	}),
)

const pipeline = Pipeline.builder({
	id: 'crisiscleanup',
	connectionArn: config.apiStack.codeStarConnectionArn,
	rootDir: cwd,
})
	.target({
		name: 'development',
		stackBuilder: devStack,
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
	})
	.target({
		name: 'staging',
		stackBuilder: stagingStack,
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
