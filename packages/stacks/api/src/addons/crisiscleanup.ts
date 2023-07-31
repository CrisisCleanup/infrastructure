/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />

import type * as blueprints from '@aws-quickstart/eks-blueprints'
import { CrisisCleanupChart } from '@crisiscleanup/charts.crisiscleanup'
import type { CrisisCleanupConfig } from '@crisiscleanup/config'
import { App, type Chart } from 'cdk8s'
import type { Construct } from 'constructs'

export interface CrisisCleanupAddOnProps {
	readonly databaseResourceName: string
	readonly config: CrisisCleanupConfig
}

export class CrisisCleanupAddOn implements blueprints.ClusterAddOn {
	constructor(readonly props: CrisisCleanupAddOnProps) {}

	deploy(clusterInfo: blueprints.ClusterInfo): Promise<Construct> | void {
		const cdk8sApp = new App()
		const chart = CrisisCleanupChart.withDefaults(cdk8sApp, {
			...this.props.config.chart,
			apiAppConfig: this.props.config.api.config,
			apiAppSecrets: this.props.config.api.secrets,
			disableResourceNameHashes: true,
		})

		const addChart = (inChart: Chart) =>
			clusterInfo.cluster.addCdk8sChart(inChart.node.id, inChart)

		const nsChart = addChart(chart.namespaceChart)
		const configChart = addChart(chart.configChart)
		const apiChart = addChart(chart.apiChart)
		const celeryChart = addChart(chart.celeryChart)
		const webChart = addChart(chart.webChart)

		configChart.node.addDependency(nsChart)
		celeryChart.node.addDependency(configChart)
		apiChart.node.addDependency(celeryChart)
		webChart.node.addDependency(nsChart)

		const chartObj = addChart(chart)
		chartObj.node.addDependency(apiChart, webChart)

		return Promise.resolve(chartObj)
	}
}
