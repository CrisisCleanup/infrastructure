import * as kplus from 'cdk8s-plus-32'
import { type Construct, type Node } from 'constructs'
import defu from 'defu'

export interface ComponentScalingProps {
	readonly target: kplus.HorizontalPodAutoscalerProps['target']
	readonly maxReplicas: kplus.HorizontalPodAutoscalerProps['maxReplicas']
	readonly minReplicas?: kplus.HorizontalPodAutoscalerProps['minReplicas']
	readonly memUtilPercent?: number
	readonly cpuUtilPercent?: number
	/**
	 * Escape hatch
	 */
	readonly hpa?: kplus.HorizontalPodAutoscalerProps
}

export class ComponentScaling {
	readonly node: Node
	readonly hpa: kplus.HorizontalPodAutoscaler

	constructor(
		readonly scope: Construct,
		readonly id: string,
		readonly props: ComponentScalingProps,
	) {
		this.node = scope.node
		this.hpa = this.createHPA(this.createHPAProps(props.target))
	}

	protected createHPAProps(
		scalable: kplus.IScalable,
	): kplus.HorizontalPodAutoscalerProps {
		const resourceMetrics = [
			kplus.Metric.resourceCpu(
				kplus.MetricTarget.averageUtilization(this.props.cpuUtilPercent ?? 70),
			),
			kplus.Metric.resourceMemory(
				kplus.MetricTarget.averageUtilization(this.props.memUtilPercent ?? 85),
			),
		]
		const defaults: kplus.HorizontalPodAutoscalerProps = {
			minReplicas: this.props.minReplicas ?? 1,
			maxReplicas: this.props.maxReplicas,
			metrics: resourceMetrics,
			target: scalable,
		}
		return defu(this.props.hpa ?? {}, defaults)
	}

	protected createHPA(
		props: kplus.HorizontalPodAutoscalerProps,
	): kplus.HorizontalPodAutoscaler {
		return new kplus.HorizontalPodAutoscaler(
			this.scope,
			`${this.id}-hpa`,
			props,
		)
	}
}
