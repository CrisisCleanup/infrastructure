import { baseConfig } from '@crisiscleanup/config'
import { type App, Chart, Size, Testing } from 'cdk8s'
import { Cpu, ImagePullPolicy } from 'cdk8s-plus-27'
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
	[
		'with sync',
		{
			sync: {
				schedule: {
					minute: '0',
					hour: '0',
				},
				target: {
					dev: true,
					bastionHost: 'bastion.example.com',
					bastionKey: 'some/path.pem',
					databaseDsn: 'postgres://myurl:5432/mydb',
				},
				image: {
					repository: 'myrepo',
					tag: 'synctag',
				},
			},
		},
	],
	[
		'with vertical scaling',
		{
			asgi: {
				spread: true,
				replicaCount: 4,
				verticalScaling: { enabled: true },
			},
			wsgi: {
				spread: true,
				replicaCount: 4,
				verticalScaling: {
					enabled: true,
					policies: [
						{
							containerName: '*',
							minAllowed: {
								cpu: Cpu.millis(500),
								memory: Size.mebibytes(1200),
							},
							maxAllowed: {
								cpu: Cpu.units(3),
								memory: Size.gibibytes(3),
							},
						},
					],
				},
			},
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
