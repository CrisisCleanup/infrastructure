/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />

// eslint-disable-next-line import/no-extraneous-dependencies
import { defineConfig } from '@crisiscleanup/config'

const celeryScaling = {
	scaling: {
		minReplicas: 1,
		maxReplicas: 4,
	},
}

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	$extends: ['github:CrisisCleanup/configs'],
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
	},
	$env: {
		development: {
			chart: {
				namespace: 'dev',
				domainName: 'dev.crisiscleanup.io',
			},
		},
	},
})
