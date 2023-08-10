import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { type Construct } from 'constructs'
import defu from 'defu'
import { type NetworkConfig } from '../schema'

export class NetworkStack extends cdk.Stack {
	readonly vpc: ec2.Vpc

	constructor(
		scope: Construct,
		id: string,
		readonly props: NetworkConfig,
		stackProps?: cdk.StackProps,
	) {
		super(scope, id, stackProps)

		const { cidr, natGateways, createIsolatedSubnet, maxAzs } = this.props

		const vpcProps: Array<Partial<ec2.VpcProps>> = [
			{
				subnetConfiguration: [
					{
						name: 'Private',
						subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
						cidrMask: 24,
					},
					{
						name: 'Public',
						subnetType: ec2.SubnetType.PUBLIC,
						cidrMask: 24,
					},
				],
			},
			cidr && { ipAddresses: ec2.IpAddresses.cidr(cidr) },
			typeof maxAzs === 'number' && { maxAzs },
			typeof natGateways === 'number' && { natGateways },
			createIsolatedSubnet && {
				subnetConfiguration: [
					{
						name: 'Isolated',
						subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
						cidrMask: 28,
					},
				],
			},
		].filter(Boolean) as Array<Partial<ec2.VpcProps>>

		const mergedVpcProps = defu({}, ...vpcProps) as ec2.VpcProps
		this.vpc = new ec2.Vpc(this, id + '-vpc', mergedVpcProps)
	}
}
