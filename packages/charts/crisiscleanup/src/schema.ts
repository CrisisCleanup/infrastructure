import { Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-32'
import { z } from 'zod'

const ImagePullPolicyEnum = z.enum(['Always', 'Never', 'IfNotPresent'])

const containerImageSchema = z
	.object({
		repository: z.string(),
		tag: z.string().default('latest'),
		pullPolicy: ImagePullPolicyEnum,
	})
	.describe('Container Image Configuration')

const metricPercent = z.number().min(0).max(100)

/**
 * @see https://github.com/colinhacks/zod/issues/384
 */
const CpuInstanceSchema = z.custom<kplus.Cpu>(
	(data) => data instanceof kplus.Cpu,
)
const SizeInstanceSchema = z.custom<Size>((data) => data instanceof Size)

const K8sMillicores = z.number().describe('Kubernetes CPU Millicores')
const K8sMemoryMebibytes = z.number().describe('Kubernetes Memory Mebibytes')

const K8sMillicoresToCpu = K8sMillicores.transform((v) => kplus.Cpu.millis(v))
const K8sMemoryMebibytesToSize = K8sMemoryMebibytes.transform((v) =>
	Size.mebibytes(v),
)

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
	.deepPartial()

const scalingSchema = z
	.object({
		minReplicas: z.number().optional(),
		maxReplicas: z
			.number()
			.default(2)
			.describe('Maximum number of replicas to scale up too.'),
		cpuUtilPercent: metricPercent
			.default(70)
			.describe('Target average cpu utilization percentage.'),
		memUtilPercent: metricPercent
			.default(85)
			.describe('Target average memory utilization percentage.'),
	})
	.describe('Horizontal Autoscaling Parameters')
	.passthrough()

const resourcesRangeSchema = z
	.object({
		cpu: z.union([CpuInstanceSchema, K8sMillicoresToCpu]).optional(),
		memory: z.union([SizeInstanceSchema, K8sMemoryMebibytesToSize]).optional(),
	})
	.describe('Resource limits for vertical scaling.')
	.partial()
	.pipe(
		z.object({
			cpu: CpuInstanceSchema.optional(),
			memory: SizeInstanceSchema.optional(),
		}),
	)
	.describe('Resource limits for vertical scaling.')

const verticalScalingContainerPolicySchema = z
	.object({
		containerName: z
			.string()
			.describe('Name or pattern of containers to target.'),
		minAllowed: resourcesRangeSchema.optional(),
		maxAllowed: resourcesRangeSchema.optional(),
	})
	.describe('Container policy for resource adjustments.')

const verticalScalingSchema = z
	.object({
		enabled: z.boolean().default(true),
		policies: z
			.array(verticalScalingContainerPolicySchema)
			.optional()
			.describe('Container policies for resource adjustments.'),
	})
	.describe('Vertical Pod Autoscaler Configuration')

const deploymentSchema = z.object({
	image: containerImageSchema.optional(),
	spread: z.boolean().default(false),
	resources: resourcesSchema.optional(),
	verticalScaling: verticalScalingSchema.optional().default({ enabled: true }),
})

const withScaling = <T extends typeof deploymentSchema>(inSchema: T) =>
	z.union([
		inSchema.merge(z.object({ scaling: scalingSchema })).passthrough(),
		inSchema
			.merge(
				z.object({
					replicaCount: z
						.number()
						.min(0)
						.describe('Static number of replicas to create.'),
				}),
			)
			.passthrough(),
	])

const celerySchema = z.record(
	z.string().min(1).describe('Celery worker deployment name.'),
	withScaling(
		deploymentSchema.merge(
			z.object({
				queues: z.array(z.string()).min(1),
			}),
		),
	),
)

const baseComponentSchema = withScaling(deploymentSchema)

const CronOptions = z.object({
	minute: z.string().optional(),
	hour: z.string().optional(),
	day: z.string().optional(),
	month: z.string().optional(),
	weekDay: z.string().optional(),
})

const syncSchema = z.object({
	image: containerImageSchema.optional(),
	schedule: CronOptions.default({ hour: '0' }),
	sourceDsn: z.string().nullable().default(null),
	target: z.object({
		bastionHost: z.string(),
		bastionKey: z.string(),
		databaseDsn: z.string(),
		dev: z.boolean().default(true),
	}),
})

export const chartConfigSchema = z
	.object({
		namespace: z
			.string()
			.min(1)
			.default('local')
			.describe('Target k8s namespace name.'),
		domainName: z.string().min(1).default('local.crisiscleanup.io'),
		apiImage: containerImageSchema
			.describe('Default image to use for api components.')
			.optional()
			.default({
				repository: 'crisiscleanup-api',
				tag: 'latest',
				pullPolicy: 'IfNotPresent',
			}),
		webImage: containerImageSchema
			.describe('Default image to use for web components.')
			.optional()
			.default({
				repository: 'crisiscleanup-web',
				tag: 'latest',
				pullPolicy: 'IfNotPresent',
			}),
		ingressAnnotations: z
			.record(z.string())
			.describe('Annotations to add to ingress resource.')
			.default({
				'alb.ingress.kubernetes.io/listen-ports':
					'[{"HTTP": 80}, {"HTTPS":443}]',
				'alb.ingress.kubernetes.io/ssl-redirect': '443',
				'alb.ingress.kubernetes.io/scheme': 'internet-facing',
				'alb.ingress.kubernetes.io/target-type': 'ip',
				'alb.ingress.kubernetes.io/target-group-attributes':
					'load_balancing.algorithm.type=least_outstanding_requests',
				'alb.ingress.kubernetes.io/healthcheck-path': '/health',
				'alb.ingress.kubernetes.io/load-balancer-attributes':
					'idle_timeout.timeout_seconds=120',
			}),
		wsgi: baseComponentSchema.describe('Django Api WSGI component.').default({
			scaling: {
				minReplicas: 1,
				maxReplicas: 3,
			},
		}),
		asgi: baseComponentSchema.describe('Django Api ASGI component.').default({
			scaling: {
				minReplicas: 1,
				maxReplicas: 2,
			},
		}),
		celeryBeat: baseComponentSchema.describe('Celery Beat component.').default({
			replicaCount: 1,
		}),
		celery: celerySchema.describe('Celery worker components.').default({
			celery: {
				queues: ['celery'],
				scaling: { minReplicas: 1, maxReplicas: 2 },
			},
			signal: {
				queues: ['signal', 'phone', 'metrics'],
				scaling: { minReplicas: 1, maxReplicas: 2 },
			},
		}),
		adminWebsocket: baseComponentSchema
			.describe('Connect Admin Websocket component')
			.default({
				replicaCount: 1,
			}),
		sync: syncSchema.optional(),
	})
	.partial({ sync: true })

export interface CrisisCleanupChartConfig
	extends z.infer<typeof chartConfigSchema> {}
