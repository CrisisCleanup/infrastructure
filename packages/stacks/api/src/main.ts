import * as blueprints from '@aws-quickstart/eks-blueprints'
import { getConfig } from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { RedisStackAddOn, CrisisCleanupAddOn } from './addons'
import { buildClusterBuilder, buildEKSStack, buildKarpenter } from './cluster'
import { DatabaseProvider, DatabaseSecretProvider } from './database'
import { KeyProvider } from './kms'
import { Pipeline } from './pipeline'
import { VpcProvider } from './vpc'

const { config } = await getConfig()

blueprints.HelmAddOn.validateHelmVersions = true

const app = new App({
	autoSynth: true,
	context: {
		config,
	},
})

enum ResourceNames {
	DATABASE = 'database',
	DATABASE_SECRET = 'database-secret',
	DATABASE_KEY = 'database-key',
}

const provideDatabase = (
	builder: blueprints.BlueprintBuilder,
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
				isolated: config.apiStack.isolateDatabase,
				ioOptimized: config.apiStack.database.ioOptimized,
				engineVersion: config.apiStack.database.engineVersion,
				vpcResourceName: blueprints.GlobalResources.Vpc,
				databaseSecretResourceName: ResourceNames.DATABASE_SECRET,
				databaseKeyResourceName: ResourceNames.DATABASE_KEY,
			}),
		)
}

const clusterBuilder = buildClusterBuilder(config)
const cluster = clusterBuilder.build()
const eksStackBuilder = buildEKSStack(config).clusterProvider(cluster)

const singleNatStack = eksStackBuilder.resourceProvider(
	blueprints.GlobalResources.Vpc,
	new VpcProvider({
		createIsolatedSubnet: config.apiStack.isolateDatabase,
		maxAzs: 2,
		natGateways: 1,
	}),
)

const devStack = provideDatabase(singleNatStack).addOns(
	buildKarpenter(),
	new RedisStackAddOn(),
	new CrisisCleanupAddOn({
		config: config.$env.development,
		databaseResourceName: ResourceNames.DATABASE,
	}),
)

export default await Pipeline.builder({
	id: 'crisiscleanup',
	connectionArn: config.apiStack.codeStarConnectionArn,
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
	})
	.build(app, {
		env: {
			account: String(config.cdkEnvironment.account),
			region: config.cdkEnvironment.region,
		},
		crossRegionReferences: true,
	})
