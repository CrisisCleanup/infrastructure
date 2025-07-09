import { Chart, Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-30'
import { type Construct, type Node } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import { z } from 'zod'
import { ContainerImage, type ContainerImageProps } from './container-image'
import { Label } from './labels'
import { PodDisruptionBudget, type PodDisruptionBudgetProps } from './pdb'
import { ComponentScaling, type ComponentScalingProps } from './scaling'
import {
	VerticalPodAutoscaler,
	type ContainerPolicy,
	type ResourceLimits,
} from './vertical-pod-autoscaler'

const debug = createDebug('@crisiscleanup:k8s.construct.component')

export interface ContainerResources {
	cpu?: kplus.CpuResources
	memory?: kplus.MemoryResources
}

export interface ContainerResourceProps {
	cpu?: {
		request?: number
		limit?: number
	}
	memory?: {
		request?: number
		limit?: number
	}
}

export interface VerticalAutoscalingDeploymentProps {
	enabled?: boolean
	policies?: ContainerPolicy[]
}

const K8sMillicores = z
	.number()
	.describe('Kubernetes CPU Millicores')
	.transform((v) => kplus.Cpu.millis(v))
const K8sMemoryMebibytes = z
	.number()
	.describe('Kubernetes Memory Mebibytes')
	.transform((v) => Size.mebibytes(v))

const K8sCpuToMillicores = z.string().transform((v) => {
	if (v.endsWith('m')) {
		return parseInt(v.slice(0, -1))
	}
	return parseInt(v) * 1000
})

const resourcesSchema = z
	.object({
		cpu: z.object({
			limit: K8sMillicores.optional(),
			request: K8sMillicores.optional(),
		}),
		memory: z.object({
			limit: K8sMemoryMebibytes.optional(),
			request: K8sMemoryMebibytes.optional(),
		}),
	})
	.describe('Kubernetes resource limits/requests')
	.partial()

/**
 * @see https://github.com/colinhacks/zod/issues/384
 */
const CpuInstanceSchema = z.custom<kplus.Cpu>(
	(data) => data instanceof kplus.Cpu,
)
const SizeInstanceSchema = z.custom<Size>((data) => data instanceof Size)

const resourcesRangeSchema = z
	.object({
		cpu: z.union([CpuInstanceSchema, K8sMillicores]).optional(),
		memory: z.union([SizeInstanceSchema, K8sMemoryMebibytes]).optional(),
	})
	.describe('Resource limits for vertical scaling.')
	.partial()
	.pipe(
		z.object({
			cpu: CpuInstanceSchema.optional(),
			memory: SizeInstanceSchema.optional(),
		}),
	)

export interface DeploymentProps extends kplus.WorkloadProps {
	replicaCount?: number
	image?: ContainerImageProps
	probes?: Pick<kplus.ContainerProps, 'liveness' | 'startup' | 'readiness'>
	scaling?: ComponentScalingProps
	containerDefaults?: Partial<kplus.ContainerProps>
	resources?: ContainerResourceProps
	verticalScaling?: VerticalAutoscalingDeploymentProps
}

export type ComponentContainerProps = Omit<kplus.ContainerProps, 'image'> & {
	image?: ContainerImageProps
	init?: boolean
}

export class Component<PropsT extends DeploymentProps = DeploymentProps> {
	static componentName: string = ''
	readonly deployment: kplus.Deployment
	readonly scaling?: ComponentScaling = undefined
	readonly vpa?: VerticalPodAutoscaler = undefined
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
		if (props.verticalScaling?.enabled) {
			this.vpa = new VerticalPodAutoscaler(this.scope, this.id + '-VPA', {
				target: this.deployment,
				resourcePolicy: props.verticalScaling?.policies
					? {
							containerPolicies: props.verticalScaling?.policies?.map?.(
								({ containerName, minAllowed, maxAllowed }) => ({
									containerName,
									minAllowed: minAllowed
										? (resourcesRangeSchema.parse(minAllowed) as ResourceLimits)
										: undefined,
									maxAllowed: maxAllowed
										? (resourcesRangeSchema.parse(maxAllowed) as ResourceLimits)
										: undefined,
								}),
							),
					  }
					: undefined,
			})
		}
		this.node = this.deployment.node
	}

	get containers(): Map<string, kplus.Container> {
		return new Map(this.#containers)
	}

	protected getResources(
		defaults?: ContainerResourceProps,
	): ContainerResources {
		const { cpu: cpuDefaults, memory: memoryDefaults } =
			this.props.containerDefaults?.resources ?? {}
		const containerDefaults = {
			...(cpuDefaults
				? {
						cpu: {
							limit: cpuDefaults.limit
								? K8sCpuToMillicores.parse(cpuDefaults.limit.amount)
								: undefined,
							request: cpuDefaults.request
								? K8sCpuToMillicores.parse(cpuDefaults.request.amount)
								: undefined,
						},
				  }
				: {}),
			...(memoryDefaults
				? {
						memory: {
							limit: memoryDefaults.limit
								? memoryDefaults.limit.toMebibytes()
								: undefined,
							request: memoryDefaults.request
								? memoryDefaults.request.toMebibytes()
								: undefined,
						},
				  }
				: {}),
		}
		const resourcesIn = defu(
			this.props.resources ?? {},
			defaults ?? {},
			containerDefaults,
		)
		return resourcesSchema.parse(resourcesIn)
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
