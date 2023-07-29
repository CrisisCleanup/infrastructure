import type * as blueprints from '@aws-quickstart/eks-blueprints'
import { type ResourceContext } from '@aws-quickstart/eks-blueprints'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import { type ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager'

export interface DatabaseProviderProps {
	vpcResourceName: string
	databaseSecretResourceName: string

	engineVersion: string
	isolated: boolean
	ioOptimized: boolean

	databasePort?: number
}

export class DatabaseSecretProvider
	implements blueprints.ResourceProvider<ISecret>
{
	provide(context: ResourceContext): ISecret {
		return new Secret(context.scope, 'database-secret', {
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'postgres' }),
				excludePunctuation: true,
				includeSpace: false,
				generateStringKey: 'password',
			},
		})
	}
}

export class DatabaseProvider
	implements blueprints.ResourceProvider<rds.DatabaseCluster>
{
	readonly props: DatabaseProviderProps

	constructor(props: DatabaseProviderProps) {
		this.props = props
	}

	provide(context: ResourceContext): rds.DatabaseCluster {
		const id = context.scope.node.id
		const databasePort = this.props.databasePort ?? 5432
		const subnetType = this.props.isolated
			? ec2.SubnetType.PRIVATE_ISOLATED
			: ec2.SubnetType.PRIVATE_WITH_EGRESS

		const credentialsSecret = context.get<ISecret>(
			this.props.databaseSecretResourceName,
		)
		if (!credentialsSecret) throw Error('Missing database credentials secret!')

		const vpc = context.get<ec2.IVpc>(this.props.vpcResourceName)
		if (!vpc) throw Error('Missing VPC!')

		const securityGroup = new ec2.SecurityGroup(
			context.scope,
			id + '-security-group',
			{
				vpc,
			},
		)

		securityGroup.addIngressRule(
			ec2.Peer.ipv4(vpc.vpcCidrBlock),
			ec2.Port.tcp(databasePort),
			'Ingress within VPC',
		)

		const engineVersion = rds.AuroraPostgresEngineVersion.of(
			this.props.engineVersion,
			this.props.engineVersion.split('.')[0],
			{ s3Export: true, s3Import: true },
		)
		const engine = rds.DatabaseClusterEngine.auroraPostgres({
			version: engineVersion,
		})

		const writer = rds.ClusterInstance.serverlessV2(id + '-cluster-writer')

		const clusterProps: rds.DatabaseClusterProps = {
			vpc,
			engine,
			vpcSubnets: {
				subnetType,
			},
			securityGroups: [securityGroup],
			credentials: rds.Credentials.fromSecret(credentialsSecret),
			iamAuthentication: true,
			port: databasePort,
			storageType: this.props.ioOptimized
				? rds.DBClusterStorageType.AURORA_IOPT1
				: rds.DBClusterStorageType.AURORA,
			storageEncrypted: true,
			serverlessV2MaxCapacity: 1,
			writer,
			readers: [rds.ClusterInstance.serverlessV2(id + '-cluster-reader-1')],
		}

		const cluster = new rds.DatabaseCluster(
			context.scope,
			id + '-database-cluster',
			clusterProps,
		)

		return cluster
	}
}
