import * as blueprints from '@aws-quickstart/eks-blueprints'
import { getConfig } from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import { buildClusterBuilder, buildEKSStack, buildKarpenter } from './cluster'
import { DatabaseProvider, DatabaseSecretProvider } from './database'
import { SingleGatewayVpcProvider } from './vpc'

const { config } = await getConfig()
if (!config) throw Error('No config found')
console.log(config)

blueprints.HelmAddOn.validateHelmVersions = true

const app = new App({
	context: {
		config,
	},
})

enum ResourceNames {
	DATABASE = 'database',
	DATABASE_SECRET = 'database-secret',
}

const provideDatabase = (
	builder: blueprints.BlueprintBuilder,
): blueprints.BlueprintBuilder => {
	return builder
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
			}),
		)
}

const clusterBuilder = buildClusterBuilder(config)
const cluster = clusterBuilder.build()
const eksStackBuilder = buildEKSStack(config).clusterProvider(cluster)

const singleNatStack = eksStackBuilder
	.resourceProvider(
		blueprints.GlobalResources.Vpc,
		new SingleGatewayVpcProvider({
			createIsolatedSubnet: config.apiStack.isolateDatabase,
		}),
	)
	.addOns(
		buildKarpenter('crisiscleanup', [
			'crisiscleanup/single-gateway-vpc/PrivateSubnet1',
			'crisiscleanup/single-gateway-vpc/PrivateSubnet2',
		]),
	)

await provideDatabase(singleNatStack).buildAsync(app, 'crisiscleanup')

app.synth()
