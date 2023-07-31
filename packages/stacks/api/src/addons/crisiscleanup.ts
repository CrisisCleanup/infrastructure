/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />

import type * as blueprints from '@aws-quickstart/eks-blueprints'
import { CrisisCleanupChart } from '@crisiscleanup/charts.crisiscleanup'
import type { CrisisCleanupConfig } from '@crisiscleanup/config'
import { App } from 'cdk8s'
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

		const subCharts = [
			chart.namespaceChart,
			chart.configChart,
			chart.apiChart,
			chart.celeryChart,
			chart.webChart,
		]

		subCharts.forEach((sub) =>
			clusterInfo.cluster.addCdk8sChart(sub.node.id, sub),
		)

		return Promise.resolve(
			clusterInfo.cluster.addCdk8sChart('crisiscleanup', chart),
		)
	}
}
