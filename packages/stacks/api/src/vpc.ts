import type * as blueprints from '@aws-quickstart/eks-blueprints'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import defu from 'defu'

export interface VpcProviderProps {
	createIsolatedSubnet: boolean
	maxAzs?: number
	natGateways?: number
}

export class VpcProvider implements blueprints.ResourceProvider<ec2.IVpc> {
	readonly props: VpcProviderProps

	constructor(props: VpcProviderProps) {
		this.props = props
	}

	provide(context: blueprints.ResourceContext): ec2.IVpc {
		const createIsolated = this.props.createIsolatedSubnet ?? false
		const id = context.scope.node.id

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
		]

		if (
			typeof this.props.maxAzs === 'number' ||
			typeof this.props.natGateways === 'number'
		) {
			vpcProps.push({
				maxAzs: this.props.maxAzs,
				natGateways: this.props.natGateways,
			})
		}

		if (createIsolated) {
			vpcProps.push({
				subnetConfiguration: [
					{
						name: 'Isolated',
						subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
						cidrMask: 28,
					},
				],
			})
		}

		const mergedVpcProps = defu({}, ...vpcProps) as ec2.VpcProps

		return new ec2.Vpc(context.scope, id + '-vpc', mergedVpcProps)
	}
}
