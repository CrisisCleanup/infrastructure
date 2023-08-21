import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import type * as elasticache from 'aws-cdk-lib/aws-elasticache'
import { RedisDB } from 'cdk-redisdb'
import { type Construct } from 'constructs'
import { type CacheConfig } from '../schema'

export interface CacheProps extends CacheConfig {
	vpc: ec2.IVpc
}

/**
 * AWS Managed Elasticache Redis stack.
 */
export class CacheStack extends cdk.Stack {
	readonly securityGroup: ec2.ISecurityGroup
	readonly redis: RedisDB

	constructor(
		scope: Construct,
		id: string,
		props: CacheProps,
		stackProps?: cdk.StackProps,
	) {
		super(scope, id, stackProps)

		this.securityGroup = new ec2.SecurityGroup(this, id + '-security-group', {
			vpc: props.vpc,
			description: 'Security group for RedisDB',
			allowAllOutbound: false,
		})

		this.securityGroup.addIngressRule(
			ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
			ec2.Port.tcp(6379),
			'Ingress within VPC',
		)

		this.securityGroup.addEgressRule(
			ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
			ec2.Port.allTcp(),
			'Egress within VPC',
		)

		this.redis = new RedisDB(this, id + '-redis', {
			nodes: props.nodes,
			nodeType: props.nodeType,
			replicas: props.replicas,
			...(typeof props.memoryAutoscalingTarget === 'number'
				? { memoryAutoscalingTarget: props.memoryAutoscalingTarget }
				: {}),
			engineVersion: props.engineVersion,
			existingVpc: props.vpc,
			existingSecurityGroup: this.securityGroup,
			atRestEncryptionEnabled: true,
		})
		if (!props.clusterMode) {
			this.replicationGroup.addOverride(
				'Properties.CacheParameterGroupName',
				'default.redis7',
			)
		}
	}

	get replicationGroup(): elasticache.CfnReplicationGroup {
		return this.redis.replicationGroup
	}
}
