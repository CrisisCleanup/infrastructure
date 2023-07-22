import * as kplus from 'cdk8s-plus-24'
import { type Construct, type Node } from 'constructs'
import defu from 'defu'

export interface ContainerImageProps {
	repository: string
	tag: string
	pullPolicy?: kplus.ImagePullPolicy | string
}

export class ContainerImage implements ContainerImageProps {
	static fromProps(props: ContainerImageProps): ContainerImage {
		if (props instanceof ContainerImage) return props
		return new ContainerImage(
			props.repository,
			props.tag,
			props.pullPolicy as kplus.ImagePullPolicy,
		)
	}

	protected constructor(
		public readonly repository: string,
		public readonly tag: string,
		public readonly pullPolicy?: kplus.ImagePullPolicy,
	) {}

	get imageFqn(): string {
		return `${this.repository}:${this.tag}`
	}

	get containerProps(): {
		image: string
		imagePullPolicy?: kplus.ImagePullPolicy
	} {
		return { image: this.imageFqn, imagePullPolicy: this.pullPolicy }
	}
}

export interface HorizontalPodAutoscalerProps
	extends Pick<
		kplus.HorizontalPodAutoscalerProps,
		'minReplicas' | 'maxReplicas' | 'target'
	> {
	memUtilPercent?: number
	cpuUtilPercent?: number
	/**
	 * Escape hatch
	 */
	hpa?: kplus.HorizontalPodAutoscalerProps
}

export interface DeploymentProps extends kplus.WorkloadProps {
	replicaCount?: number
	image?: ContainerImageProps
	probes?: Pick<kplus.ContainerProps, 'liveness' | 'startup' | 'readiness'>
	scaling?: HorizontalPodAutoscalerProps
}

export type ComponentContainerProps = Omit<kplus.ContainerProps, 'image'> & {
	image?: ContainerImageProps
	init?: boolean
}

export class ComponentScaling<
	PropsT extends HorizontalPodAutoscalerProps = HorizontalPodAutoscalerProps,
> implements Construct
{
	readonly node: Node
	readonly hpa: kplus.HorizontalPodAutoscaler

	constructor(
		readonly scope: Construct,
		readonly id: string,
		readonly props: PropsT,
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
				kplus.MetricTarget.averageUtilization(this.props.memUtilPercent ?? 70),
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

export class Component<PropsT extends DeploymentProps = DeploymentProps>
	implements Construct
{
	static componentName: string = ''
	readonly deployment: kplus.Deployment
	readonly scaling?: ComponentScaling = undefined
	readonly node: Node
	#containers: Map<string, kplus.Container> = new Map()

	constructor(
		public readonly scope: Construct,
		public readonly id: string,
		public readonly props: PropsT,
	) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		const componentName = Object.getPrototypeOf(this).constructor
			.componentName as string
		const deploymentProps = this.createDeploymentProps()
		const mergedProps = defu(deploymentProps, {
			...(props.replicaCount ? { replicas: props.replicaCount } : {}),
			metadata: {
				labels: {
					app: 'crisiscleanup',
					component: componentName,
				},
			},
			spread: props.spread ?? false,
		})
		this.deployment = this.createDeployment(
			mergedProps as kplus.DeploymentProps,
		)
		if (!props.replicaCount) {
			this.scaling = new ComponentScaling(this.scope, this.id, {
				...(props.scaling ?? { maxReplicas: 2 }),
				target: this.deployment,
			})
		}
		this.node = this.deployment.node
	}

	get containers(): Map<string, kplus.Container> {
		return new Map(this.#containers)
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return {}
	}

	protected createDeployment(props: kplus.DeploymentProps): kplus.Deployment {
		return new kplus.Deployment(this.scope, this.id, props)
	}

	addContainer(props: ComponentContainerProps): kplus.Container {
		const { init = false, ...containerPropsInput } = props
		const containerProps = {
			...ContainerImage.fromProps(props.image ?? this.props.image)
				.containerProps,
			...containerPropsInput,
		} as kplus.ContainerProps
		const container = init
			? this.deployment.addInitContainer(containerProps)
			: this.deployment.addContainer(containerProps)
		this.#containers.set(container.name, container)
		return container
	}
}
