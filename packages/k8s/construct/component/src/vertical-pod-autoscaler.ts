import { ApiObject, Lazy, type Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import { type Construct } from 'constructs'

export interface VerticalPodAutoscalerProps extends kplus.ResourceProps {
	/**
	 * The workload to scale up or down.
	 *
	 * Scalable workload types:
	 * * Deployment
	 * * StatefulSet
	 */
	readonly target: kplus.IScalable
	/**
	 * The update mode for the VPA.
	 *
	 * Possible values are 'Off', 'Initial', 'Auto'.
	 * @default - 'Auto'
	 */
	readonly updateMode?: 'Off' | 'Initial' | 'Auto'
	/**
	 * The resource policy for the VPA.
	 */
	readonly resourcePolicy?: ResourcePolicy
}

export interface ResourcePolicy {
	/**
	 * Container policies for resource adjustments.
	 */
	readonly containerPolicies: ContainerPolicy[]
}

export interface ContainerPolicy {
	/**
	 * The name of the container.
	 */
	readonly containerName: string
	/**
	 * The minimum allowed resources.
	 */
	readonly minAllowed?: ResourceLimits
	/**
	 * The maximum allowed resources.
	 */
	readonly maxAllowed?: ResourceLimits
}

export interface ResourceLimits {
	/**
	 * CPU limit.
	 */
	readonly cpu?: kplus.Cpu
	/**
	 * Memory limit.
	 */
	readonly memory?: Size
}

export interface ResourceLimitsSpec {
	/**
	 * CPU limit.
	 */
	readonly cpu?: string
	/**
	 * Memory limit.
	 */
	readonly memory?: string
}

export interface KubeVerticalPodAutoscalerSpec {
	/**
	 * Reference to the target resource to scale.
	 */
	readonly targetRef: {
		apiVersion: string
		kind: string
		name: string
	}
	/**
	 * Update policy for the VPA.
	 */
	readonly updatePolicy: {
		updateMode: 'Off' | 'Initial' | 'Auto'
	}
	/**
	 * Resource policy for the VPA.
	 */
	readonly resourcePolicy?: {
		containerPolicies: {
			containerName: string
			minAllowed?: ResourceLimitsSpec
			maxAllowed?: ResourceLimitsSpec
		}[]
	}
}

/**
 * Represents a Vertical Pod Autoscaler (VPA) resource in Kubernetes.
 *
 * The VerticalPodAutoscaler automatically adjusts the resources requested by
 * a pod's containers based on historical CPU and memory usage.
 *
 * Depends on availability of the Vertical Pod Autoscaler API in the cluster.
 *
 */
export class VerticalPodAutoscaler extends kplus.Resource {
	/**
	 * @see base.Resource.apiObject
	 */
	protected readonly apiObject: ApiObject
	public readonly resourceType = 'VerticalPodAutoscaler'
	/**
	 * The workload to scale up or down.
	 */
	public readonly target: kplus.IScalable
	/**
	 * The update mode for the VPA.
	 */
	public readonly updateMode: 'Off' | 'Initial' | 'Auto'
	/**
	 * Container policies for the VPA.
	 */
	public readonly containerPolicies: ContainerPolicy[]

	constructor(scope: Construct, id: string, props: VerticalPodAutoscalerProps) {
		super(scope, id)

		this.target = props.target
		this.updateMode = props.updateMode ?? 'Auto'
		this.containerPolicies = props.resourcePolicy?.containerPolicies ?? []

		// this.target.markHasAutoscaler()

		this.apiObject = new ApiObject(this, 'Resource', {
			apiVersion: 'autoscaling.k8s.io/v1',
			kind: 'VerticalPodAutoscaler',
			metadata: props.metadata,
			spec: Lazy.any({
				produce: () => this._toKube(),
			}) as KubeVerticalPodAutoscalerSpec,
		})
	}

	/**
	 * Resource policy for the VPA.
	 */
	public get resourcePolicy(): ResourcePolicy | undefined {
		return this.containerPolicies.length
			? {
					containerPolicies: this.containerPolicies,
			  }
			: undefined
	}

	/**
	 * @internal
	 */
	public _toKube(): KubeVerticalPodAutoscalerSpec {
		const scalingTarget = this.target.toScalingTarget()
		return {
			targetRef: {
				apiVersion: scalingTarget.apiVersion,
				kind: scalingTarget.kind,
				name: scalingTarget.name,
			},
			updatePolicy: {
				updateMode: this.updateMode,
			},
			resourcePolicy: this.resourcePolicy
				? {
						containerPolicies: this.resourcePolicy.containerPolicies.map(
							(policy) => ({
								containerName: policy.containerName,
								minAllowed: policy.minAllowed
									? {
											cpu: policy.minAllowed.cpu?.amount,
											memory: policy.minAllowed.memory
												? `${policy.minAllowed.memory.toMebibytes()}Mi`
												: undefined,
									  }
									: undefined,
								maxAllowed: policy.maxAllowed
									? {
											cpu: policy.maxAllowed.cpu?.amount,
											memory: policy.maxAllowed.memory
												? `${policy.maxAllowed.memory.toMebibytes()}Mi`
												: undefined,
									  }
									: undefined,
							}),
						),
				  }
				: undefined,
		}
	}

	/**
	 * Add a container policy to the resource policy.
	 * @param policy The container policy to add.
	 */
	public addContainerPolicy(policy: ContainerPolicy): this {
		this.containerPolicies.push(policy)
		return this
	}
}
