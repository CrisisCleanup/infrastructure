import * as blueprints from '@aws-quickstart/eks-blueprints'
import { getConfig } from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
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

const clusterBuilder = buildClusterBuilder(app, config)
const cluster = clusterBuilder.build()
const eksStackBuilder = buildEKSStack(config).clusterProvider(cluster)

const singleNatStack = eksStackBuilder
	.resourceProvider(
		blueprints.GlobalResources.Vpc,
		new VpcProvider({
			createIsolatedSubnet: config.apiStack.isolateDatabase,
			maxAzs: 2,
			natGateways: 1,
		}),
	)
	.addOns(
		buildKarpenter('development-blueprint', [
			'crisiscleanup-infra-pipeline-stack/development/development-blueprint/development-blueprint-vpc/PrivateSubnet*',
		]),
	)

await new Pipeline({
	devStack: provideDatabase(singleNatStack),
	pipelineEnv: config.cdkEnvironment,
	connectionArn: config.apiStack.codeStarConnectionArn,
	devEnv: config.$env.development.cdkEnvironment,
	stagingEnv: config.$env.staging.cdkEnvironment,
	prodEnv: config.$env.production.cdkEnvironment,
}).build(app, 'crisiscleanup', {
	crossRegionReferences: true,
	env: {
		account: String(config.cdkEnvironment.account),
		region: config.cdkEnvironment.region,
	},
})
