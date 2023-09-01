import { baseConfig } from '@crisiscleanup/config'
import { type App, Chart, Testing } from 'cdk8s'
import { ImagePullPolicy } from 'cdk8s-plus-27'
import defu from 'defu'
import { describe, expect, it } from 'vitest'
import defaultChartConfig from '../crisiscleanup.config'
import { CrisisCleanupChart, type CrisisCleanupChartProps } from '../src'

const buildChart = (app: App, values: Partial<CrisisCleanupChartProps>) => {
	return CrisisCleanupChart.withDefaults(
		app,
		defu(
			values as CrisisCleanupChartProps,
			{
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
			} as unknown as CrisisCleanupChartProps,
		),
	)
}

const propCases: [
	name: string,
	props?: Partial<CrisisCleanupChartProps>,
	chartIds?: string[],
][] = [
	['defaults'],
	[
		'with spread',
		{
			asgi: { spread: true, replicaCount: 4 },
			wsgi: { spread: true, replicaCount: 4 },
		},
	],
]

describe.each(propCases)('CrisisCleanupChart: %o', (caseName, props, keys) => {
	const app = Testing.app()
	const chart = buildChart(app, props ?? {})
	const children = chart.node.children
		.filter((c) => Chart.isChart(c))
		.filter((subchart) => (keys ? keys.includes(subchart.node.id) : true))
	const targets = [chart, ...children]

	it.each(targets.map((targ) => [targ.node.id, targ]))(
		`%s matches snapshot`,
		(name, target) => {
			expect(Testing.synth(target as Chart)).toMatchSnapshot(
				caseName + '-' + name,
			)
		},
	)
})
