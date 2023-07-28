import { Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-24'
import { type Construct, type Node } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import { ContainerImage, type ContainerImageProps } from './container-image'

const debug = createDebug('@crisiscleanup:k8s.construct.component')

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
	containerDefaults?: Partial<kplus.ContainerProps>
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

	protected createContainerProps(
		source: Partial<kplus.ContainerProps>,
		...props: Partial<kplus.ContainerProps>[]
	): kplus.ContainerProps {
		debug('container props layers (name=%s, layers=%O)', source.name, [
			source,
			this.props.containerDefaults,
			...props,
		])
		const merged = defu(
			source,
			this.props.containerDefaults ?? {},
			...props,
		) as kplus.ContainerProps
		const { resources, ...rest } = merged
		if (resources && resources.memory) {
			return {
				...rest,
				resources: {
					...resources,
					memory: {
						...(resources.memory.request
							? {
									// @ts-expect-error - defu converts Size to object
									// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
									request: Size[resources.memory.request.unit.label](
										// @ts-expect-error
										resources.memory.request.amount,
									),
							  }
							: {}),
						...(resources.memory.limit
							? {
									// @ts-expect-error - defu converts Size to object
									// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
									limit: Size[resources.memory.limit.unit.label](
										// @ts-expect-error
										resources.memory.limit.amount,
									),
							  }
							: {}),
					},
				},
			}
		}
		return { resources, ...rest }
	}

	addContainer(props: ComponentContainerProps): kplus.Container {
		const { init = false, image, ...containerPropsInput } = props
		const containerProps = this.createContainerProps(
			containerPropsInput,
			ContainerImage.fromProps(
				(image as ContainerImageProps) ?? this.props.image,
			).containerProps,
		)
		debug(
			'%s: adding container (name=%s, props=%O)',
			this.deployment.name,
			containerProps.name,
			containerProps,
		)
		const container = init
			? this.deployment.addInitContainer(containerProps)
			: this.deployment.addContainer(containerProps)
		this.#containers.set(container.name, container)
		return container
	}
}
