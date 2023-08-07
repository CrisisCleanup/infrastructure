import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as rds from 'aws-cdk-lib/aws-rds'
import { type ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'
import { type DatabaseConfig } from '../types'

export interface DatabaseProps extends DatabaseConfig {
	vpc: ec2.IVpc
	encryptionKey: kms.IKey
	credentialsSecret: ISecret
}

export class Database extends Construct {
	readonly securityGroup: ec2.SecurityGroup
	readonly cluster: rds.DatabaseCluster

	constructor(
		scope: Construct,
		id: string,
		readonly props: DatabaseProps,
	) {
		super(scope, id)

		const { vpc, credentialsSecret, encryptionKey } = props

		this.securityGroup = new ec2.SecurityGroup(this, id + '-security-group', {
			vpc,
		})

		this.securityGroup.addIngressRule(
			ec2.Peer.ipv4(vpc.vpcCidrBlock),
			ec2.Port.tcp(5432),
			'Ingress within VPC',
		)

		const subnetType = props.isolated
			? ec2.SubnetType.PRIVATE_ISOLATED
			: ec2.SubnetType.PRIVATE_WITH_EGRESS

		const engineVersion = rds.AuroraPostgresEngineVersion.of(
			props.engineVersion,
			props.engineVersion.split('.')[0],
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
			securityGroups: [this.securityGroup],
			credentials: rds.Credentials.fromSecret(credentialsSecret),
			iamAuthentication: true,
			port: 5432,
			storageType: this.props.ioOptimized
				? rds.DBClusterStorageType.AURORA_IOPT1
				: rds.DBClusterStorageType.AURORA,
			storageEncrypted: true,
			serverlessV2MinCapacity: this.props.minAcu,
			serverlessV2MaxCapacity: this.props.maxAcu,
			writer,
			readers: [rds.ClusterInstance.serverlessV2(id + '-cluster-reader-1')],
			storageEncryptionKey: encryptionKey,
		}

		this.cluster = new rds.DatabaseCluster(this, id + '-cluster', clusterProps)
	}
}

export interface DataStackProps {
	vpc: ec2.IVpc
	encryptionKey?: kms.IKey
	credentialsSecret?: ISecret
	clusterProps: DatabaseConfig
}

export class DataStack extends cdk.Stack {
	readonly encryptionKey: kms.IKey
	readonly credentialsSecret: ISecret
	readonly dbCluster: Database

	constructor(
		scope: Construct,
		id: string,
		readonly props: DataStackProps,
		stackProps?: cdk.StackProps,
	) {
		super(scope, id, stackProps)

		this.encryptionKey =
			props.encryptionKey ??
			new kms.Key(this, id + '-database-key', {
				alias: 'database-key',
			})

		this.credentialsSecret =
			props.credentialsSecret ??
			new Secret(this, id + '-credentials-secret', {
				generateSecretString: {
					secretStringTemplate: JSON.stringify({
						username: props.clusterProps.username ?? 'postgres',
					}),
					excludePunctuation: true,
					includeSpace: false,
					generateStringKey: 'password',
				},
			})

		this.dbCluster = new Database(this, id + '-database', {
			vpc: props.vpc,
			encryptionKey: this.encryptionKey,
			credentialsSecret: this.credentialsSecret,
			...props.clusterProps,
		})
	}
}
