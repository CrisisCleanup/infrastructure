import { defineConfig } from '@crisiscleanup/config'

const celeryScaling = {
	scaling: {
		minReplicas: 1,
		maxReplicas: 4,
	},
}

// Chart config defaults for local development.
export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	chart: {
		namespace: 'local',
		domainName: 'local.crisiscleanup.io',
		apiImage: {
			repository: 'crisiscleanup-api',
			tag: 'latest',
			pullPolicy: 'IfNotPresent',
		},
		webImage: {
			repository: 'crisiscleanup-web',
			tag: 'latest',
			pullPolicy: 'IfNotPresent',
		},
		frontend: {
			web: {
				replicaCount: undefined,
				scaling: {
					minReplicas: 2,
					maxReplicas: 4,
				},
			},
		},
		wsgi: {
			scaling: {
				minReplicas: 2,
				maxReplicas: 6,
			},
		},
		asgi: {
			scaling: {
				minReplicas: 2,
				maxReplicas: 4,
			},
		},
		celeryBeat: {
			replicaCount: 1,
		},
		celery: [
			{ queues: ['celery'], ...celeryScaling },
			{ queues: ['phone'], ...celeryScaling },
			{ queues: ['signal'], ...celeryScaling },
			{
				queues: ['metrics'],
				args: ['--prefetch-multiplier=5'],
				...celeryScaling,
			},
		],
		ingressAnnotations: {
			'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80}, {"HTTPS":443}]',
			'alb.ingress.kubernetes.io/ssl-redirect': '443',
			'alb.ingress.kubernetes.io/scheme': 'internet-facing',
			'alb.ingress.kubernetes.io/target-type': 'ip',
			'alb.ingress.kubernetes.io/target-group-attributes':
				'load_balancing.algorithm.type=least_outstanding_requests',
			'alb.ingress.kubernetes.io/healthcheck-path': '/health',
			'alb.ingress.kubernetes.io/load-balancer-attributes':
				'idle_timeout.timeout_seconds=120',
		},
	},
})
