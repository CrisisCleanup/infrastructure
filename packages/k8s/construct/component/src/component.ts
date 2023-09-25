import { Chart, Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import { type Construct, type Node } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import { ContainerImage, type ContainerImageProps } from './container-image'
import { Label } from './labels'
import { PodDisruptionBudget, type PodDisruptionBudgetProps } from './pdb'
import { ComponentScaling, type ComponentScalingProps } from './scaling'

const debug = createDebug('@crisiscleanup:k8s.construct.component')

export interface DeploymentProps extends kplus.WorkloadProps {
	replicaCount?: number
	image?: ContainerImageProps
	probes?: Pick<kplus.ContainerProps, 'liveness' | 'startup' | 'readiness'>
	scaling?: ComponentScalingProps
	containerDefaults?: Partial<kplus.ContainerProps>
}

export type ComponentContainerProps = Omit<kplus.ContainerProps, 'image'> & {
	image?: ContainerImageProps
	init?: boolean
}

export class Component<PropsT extends DeploymentProps = DeploymentProps> {
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
		const mergedProps = defu(
			deploymentProps,
			{
				...(props.replicaCount ? { replicas: props.replicaCount } : {}),
				metadata: {
					labels: {
						...Chart.of(scope).labels,
						[Label.NAME]: componentName,
					},
				},
			},
			props,
		)
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
										// @ts-expect-error - defu converts Size to object
										resources.memory.request.amount,
									),
							  }
							: {}),
						...(resources.memory.limit
							? {
									// @ts-expect-error - defu converts Size to object
									// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
									limit: Size[resources.memory.limit.unit.label](
										// @ts-expect-error - defu converts Size to object
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

	addPdb(props: PodDisruptionBudgetProps): this {
		new PodDisruptionBudget(this.scope, this.id, props)
		return this
	}
}
