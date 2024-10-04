import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type Construct } from 'constructs'
import defu from 'defu'

export interface VerticalPodAutoscalerAddOnProps
	extends blueprints.HelmAddOnProps {}

const vpaStackDefaults: VerticalPodAutoscalerAddOnProps = {
	name: 'vertical-pod-autoscaler',
	version: '9.9.0',
	chart: 'vertical-pod-autoscaler',
	namespace: 'kube-system',
	release: 'vertical-pod-autoscaler',
	repository: 'https://cowboysysop.github.io/charts',
}

export class VerticalPodAutoscalerAddOn extends blueprints.HelmAddOn {
	readonly props: VerticalPodAutoscalerAddOnProps

	constructor(props?: Partial<VerticalPodAutoscalerAddOnProps>) {
		const withDefaults = defu(
			props ?? {},
			vpaStackDefaults,
		) as VerticalPodAutoscalerAddOnProps
		super(withDefaults)
		this.props = withDefaults
	}

	deploy(clusterInfo: blueprints.ClusterInfo): void | Promise<Construct> {
		return Promise.resolve(
			this.addHelmChart(
				clusterInfo,
				this.props.values,
				this.props.namespace !== 'kube-system',
				true,
			),
		)
	}
}
