/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />
import { defineConfig } from '@crisiscleanup/config'

const celeryScaling = {
	scaling: {
		minReplicas: 1,
		maxReplicas: 2,
	},
}

const spread = false

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
				spread,
				replicaCount: 2,
			},
		},
		wsgi: {
			spread,
			scaling: {
				minReplicas: 2,
				maxReplicas: 3,
			},
		},
		asgi: {
			spread,
			scaling: {
				minReplicas: 1,
				maxReplicas: 2,
			},
		},
		celeryBeat: {
			spread,
			replicaCount: 1,
		},
		celery: {
			celery: { queues: ['celery'], ...celeryScaling, spread },
			signal: {
				queues: ['signal', 'phone', 'metrics'],
				...celeryScaling,
				spread,
			},
		},
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
