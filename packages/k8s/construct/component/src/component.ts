import * as kplus from 'cdk8s-plus-24'
import { type Construct, type Node } from 'constructs'
import defu from 'defu'

export interface ContainerImageProps {
	repository: string
	tag: string
	pullPolicy?: kplus.ImagePullPolicy
}

export class ContainerImage implements ContainerImageProps {
	static fromProps(props: ContainerImageProps): ContainerImage {
		if (props instanceof ContainerImage) return props
		return new ContainerImage(props.repository, props.tag, props.pullPolicy)
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

export interface DeploymentProps {
	replicaCount: number
	image: ContainerImageProps
	probes?: Pick<kplus.ContainerProps, 'liveness' | 'startup' | 'readiness'>
	spread?: boolean
}

export type ComponentContainerProps = Omit<kplus.ContainerProps, 'image'> & {
	image?: ContainerImageProps
	init?: boolean
}

export class Component<PropsT extends DeploymentProps = DeploymentProps>
	implements Construct
{
	static componentName: string = ''
	deployment: kplus.Deployment
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
			{
				replicas: props.replicaCount,
				metadata: {
					labels: {
						app: 'crisiscleanup',
						component: componentName,
					},
				},
				spread: props.spread ?? false,
			},
			deploymentProps,
		)
		this.deployment = this.createDeployment(mergedProps)
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
