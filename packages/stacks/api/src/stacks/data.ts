import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as rds from 'aws-cdk-lib/aws-rds'
import { type ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { KeyPair } from 'cdk-ec2-key-pair'
import { Construct } from 'constructs'
import { type DatabaseConfig } from '../schema'

export interface DatabaseProps extends DatabaseConfig {
	vpc: ec2.IVpc
	encryptionKey: kms.IKey
	credentialsSecret: ISecret
}

export class Database extends Construct {
	readonly securityGroup: ec2.SecurityGroup
	readonly cluster: rds.DatabaseClusterFromSnapshot

	constructor(
		scope: Construct,
		id: string,
		readonly props: DatabaseProps,
	) {
		super(scope, id)

		const { vpc, encryptionKey } = props

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

		const readers: rds.IClusterInstance[] = []
		if (this.props.numReplicas) {
			for (let i = 0; i <= this.props.numReplicas; i++) {
				readers.push(
					rds.ClusterInstance.serverlessV2(id + `-cluster-reader-${i}`),
				)
			}
		}

		const updateBehavior =
			readers.length >= 1
				? rds.InstanceUpdateBehaviour.BULK
				: rds.InstanceUpdateBehaviour.ROLLING

		const clusterProps: rds.DatabaseClusterFromSnapshotProps = {
			vpc,
			engine,
			vpcSubnets: {
				subnetType,
			},
			securityGroups: [this.securityGroup],
			snapshotCredentials: rds.SnapshotCredentials.fromGeneratedSecret(
				this.props.username ?? 'postgres',
			),
			iamAuthentication: true,
			port: 5432,
			storageType: this.props.ioOptimized
				? rds.DBClusterStorageType.AURORA_IOPT1
				: rds.DBClusterStorageType.AURORA,
			storageEncrypted: true,
			serverlessV2MinCapacity: this.props.minAcu,
			serverlessV2MaxCapacity: this.props.maxAcu,
			writer,
			readers,
			storageEncryptionKey: encryptionKey,
			instanceUpdateBehaviour: updateBehavior,
			cloudwatchLogsExports: ['postgresql'],
			cloudwatchLogsRetention: this.props.cloudwatchLogsRetentionDays,
			deletionProtection: this.props.deletionProtection,
			backup: {
				retention: cdk.Duration.days(this.props.backupRetentionDays),
			},
			defaultDatabaseName: this.props.databaseName,
			snapshotIdentifier: this.props.snapshotIdentifier,
		}
		this.cluster = new rds.DatabaseClusterFromSnapshot(
			this,
			id + '-cluster',
			clusterProps,
		)
	}
}

interface DatabaseBastionProps {
	readonly database: rds.IDatabaseCluster
	readonly vpc: ec2.IVpc
	readonly allowCidrs: string[]
	readonly encryptionKey: kms.IKey
}

export class DatabaseBastion extends Construct {
	readonly bastion: ec2.BastionHostLinux
	readonly securityGroup: ec2.ISecurityGroup
	readonly allowPrefixList: ec2.IPrefixList
	readonly keyPair: KeyPair

	constructor(scope: Construct, id: string, props: DatabaseBastionProps) {
		super(scope, id)

		const { database, vpc, encryptionKey, allowCidrs } = props

		this.securityGroup = new ec2.SecurityGroup(this, id + '-security-group', {
			vpc,
			allowAllOutbound: true,
			description: 'Security group for bastion host',
		})
		database.connections.allowFrom(
			this.securityGroup,
			ec2.Port.tcp(5432),
			'Allow inbound from bastion host',
		)
		this.securityGroup.connections.allowTo(
			database,
			ec2.Port.tcp(5432),
			'Allow outbound to database',
		)

		this.allowPrefixList = new ec2.PrefixList(this, id + '-prefix-list', {
			addressFamily: ec2.AddressFamily.IP_V4,
			entries: allowCidrs.map((cidr) => ({
				cidr,
				description: 'Bastion allowlist.',
			})),
			maxEntries: 50,
		})

		this.securityGroup.addIngressRule(
			ec2.Peer.prefixList(this.allowPrefixList.prefixListId),
			ec2.Port.tcp(22),
			'Bastion Allow list.',
		)

		this.keyPair = new KeyPair(this, id + '-key-pair', {
			kms: encryptionKey as kms.Key,
			description: 'SSH key pair for bastion host',
			name: 'database/bastion/key-pair',
			storePublicKey: true,
		})

		this.bastion = new ec2.BastionHostLinux(this, id + '-bastion', {
			vpc,
			securityGroup: this.securityGroup,
			instanceType: ec2.InstanceType.of(
				ec2.InstanceClass.T4G,
				ec2.InstanceSize.NANO,
			),
			subnetSelection: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
		})
		this.bastion.instance.instance.addPropertyOverride(
			'KeyName',
			this.keyPair.keyPairName,
		)
		this.bastion.allowSshAccessFrom(
			ec2.Peer.prefixList(this.allowPrefixList.prefixListId),
		)
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

		new DatabaseBastion(this, id + '-bastion', {
			vpc: props.vpc,
			encryptionKey: this.encryptionKey,
			allowCidrs: props.clusterProps.bastionAllowList,
			database: this.dbCluster.cluster,
		})
	}
}
