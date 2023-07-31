import { baseConfig } from '@crisiscleanup/config'
import { Testing } from 'cdk8s'
import { ImagePullPolicy } from 'cdk8s-plus-27'
import { test, expect, describe, it } from 'vitest'
import defaultChartConfig from '../crisiscleanup.config'
import { CrisisCleanupChart } from '../src'

describe('CrisisCleanupChart', () => {
	const app = Testing.app()
	const chart = CrisisCleanupChart.withDefaults(app, {
		...defaultChartConfig.chart,
		apiAppConfig: baseConfig.api.config,
		apiAppSecrets: baseConfig.api.secrets,
		apiImage: {
			repository: 'test-api',
			tag: 'test',
			pullPolicy: ImagePullPolicy.ALWAYS,
		},
		webImage: {
			repository: 'test-web',
			tag: 'test',
			pullPolicy: ImagePullPolicy.ALWAYS,
		},
		namespace: 'test',
		domainName: 'test.crisiscleanup.io',
		frontend: { web: { replicaCount: 1 } },
	})

	it.each([
		['chart', chart],
		['web', chart.webChart],
		['api', chart.apiChart],
		['celery', chart.celeryChart],
		['namespace', chart.namespaceChart],
		['config', chart.configChart],
	])('%s: matches snapshot', (name, c) => {
		expect(Testing.synth(c)).toMatchSnapshot(name)
	})
})
