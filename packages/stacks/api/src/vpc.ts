import type * as blueprints from '@aws-quickstart/eks-blueprints'
import * as ec2 from 'aws-cdk-lib/aws-ec2'

export interface SingleGatewayVpcProviderProps {
	createIsolatedSubnet: boolean
}

export class SingleGatewayVpcProvider
	implements blueprints.ResourceProvider<ec2.IVpc>
{
	readonly props: SingleGatewayVpcProviderProps

	constructor(props: SingleGatewayVpcProviderProps) {
		this.props = props
	}

	provide(context: blueprints.ResourceContext): ec2.IVpc {
		const createIsolated = this.props.createIsolatedSubnet ?? false
		return new ec2.Vpc(context.scope, 'single-gateway-vpc', {
			maxAzs: 2,
			natGateways: 1,
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
				...(createIsolated
					? [
							{
								name: 'Isolated',
								subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
								cidrMask: 28,
							},
					  ]
					: []),
			],
		})
	}
}
