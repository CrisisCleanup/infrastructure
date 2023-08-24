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

const deploymentSchema = z.object({
	image: containerImageSchema.optional(),
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

export const chartConfigSchema = z.object({
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
			'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80}, {"HTTPS":443}]',
			'alb.ingress.kubernetes.io/ssl-redirect': '443',
			'alb.ingress.kubernetes.io/scheme': 'internet-facing',
			'alb.ingress.kubernetes.io/target-type': 'ip',
			'alb.ingress.kubernetes.io/target-group-attributes':
				'load_balancing.algorithm.type=least_outstanding_requests',
			'alb.ingress.kubernetes.io/healthcheck-path': '/health',
			'alb.ingress.kubernetes.io/load-balancer-attributes':
				'idle_timeout.timeout_seconds=120',
		}),
	web: baseComponentSchema
		.describe('Frontend web component.')
		.default({ replicaCount: 2 }),
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
		celery: { queues: ['celery'], scaling: { minReplicas: 1, maxReplicas: 2 } },
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
})

export interface CrisisCleanupChartConfig
	extends z.infer<typeof chartConfigSchema> {}
