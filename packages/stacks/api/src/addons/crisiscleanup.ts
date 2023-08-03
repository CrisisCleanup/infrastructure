/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />

import * as blueprints from '@aws-quickstart/eks-blueprints'
import { CrisisCleanupChart } from '@crisiscleanup/charts.crisiscleanup'
import {
	flatKeysToFlatScreamingSnakeCaseKeys,
	type CrisisCleanupConfig,
} from '@crisiscleanup/config'
import type { Component } from '@crisiscleanup/k8s.construct.component'
import { App, type Chart } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import type { Construct } from 'constructs'
import defu from 'defu'

export interface CrisisCleanupAddOnProps {
	readonly databaseResourceName: string
	readonly secretsProvider: blueprints.SecretProvider
	readonly config: CrisisCleanupConfig
}

export class CrisisCleanupAddOn implements blueprints.ClusterAddOn {
	constructor(readonly props: CrisisCleanupAddOnProps) {}

	@blueprints.utils.dependable(blueprints.addons.SecretsStoreAddOn.name)
	deploy(clusterInfo: blueprints.ClusterInfo): Promise<Construct> {
		const cluster = clusterInfo.cluster
		const chartConfig = this.props.config.chart
		if (!chartConfig) throw new Error('Missing chart config!')

		const sa = cluster.addServiceAccount('crisiscleanup-api', {
			namespace: chartConfig.namespace,
			name: 'crisiscleanup-api',
		})

		const cdk8sApp = new App()
		const saProps = {
			serviceAccount: kplus.ServiceAccount.fromServiceAccountName(
				cdk8sApp,
				'crisiscleanup-service-account',
				'crisiscleanup-api',
			),
		}
		const chart = CrisisCleanupChart.withDefaults(cdk8sApp, {
			...this.props.config.chart,
			apiAppConfig: this.props.config.api.config,
			apiAppSecrets: {},
			disableResourceNameHashes: true,
			wsgi: defu(chartConfig.wsgi, saProps),
			asgi: defu(chartConfig.asgi, saProps),
			celeryBeat: defu(chartConfig.celeryBeat, saProps),
			celery: Object.fromEntries(
				Object.entries(chartConfig.celery).map(([key, values]) => [
					key,
					defu(values, saProps),
				]),
			),
		})

		const secretKeys = flatKeysToFlatScreamingSnakeCaseKeys(
			this.props.config.api.secrets,
			{ nestedDelimiter: '_' },
		)
		const secretPaths: blueprints.JmesPathObject[] = Object.entries(
			secretKeys,
		).map(([key, value]) => ({
			path: key,
			objectAlias: value,
		}))

		const csiProvider = new blueprints.SecretProviderClass(
			clusterInfo,
			sa,
			'crisiscleanup-api',
			{
				secretProvider: this.props.secretsProvider,
				jmesPath: secretPaths,
				kubernetesSecret: {
					secretName: 'crisiscleanup-api-secrets',
				},
			},
		)

		const addChart = (inChart: Chart) =>
			cluster.addCdk8sChart(inChart.node.id, inChart)

		const namespaceChart = addChart(chart.namespaceChart)
		sa.node.addDependency(namespaceChart)

		const csiVolume = kplus.Volume.fromCsi(
			chart.configChart,
			'secrets-volume',
			'secrets-store.csi.k8s.io',
			{
				readOnly: true,
				name: 'secrets-store-inline',
				attributes: {
					secretProviderClass: 'crisiscleanup-api',
				},
			},
		)
		const secretLookup = kplus.Secret.fromSecretName(
			chart.configChart,
			'crisiscleanup-api-secrets',
			'crisiscleanup-api-secrets',
		)
		const secretEnvsValues = Object.values(secretKeys).map((key) => [
			key,
			kplus.EnvValue.fromSecretValue({
				key: key,
				secret: secretLookup,
			}),
		])

		chart.apiConfig.addEnvVars(
			Object.fromEntries(secretEnvsValues) as { [p: string]: kplus.EnvValue },
		)

		const configChart = addChart(chart.configChart)
		configChart.node.addDependency(namespaceChart)
		csiProvider.addDependent(configChart)

		const mountCsiContainer = (cont: kplus.Container) => {
			cont.mount('/mnt/secrets-store', csiVolume, { readOnly: true })
			secretEnvsValues.forEach(([key, value]) => {
				cont.env.addVariable(key as string, value as kplus.EnvValue)
			})
		}

		const mountCsiComponent = (comp: Component) => {
			comp.deployment.addVolume(csiVolume)
			comp.containers.forEach((cont) => mountCsiContainer(cont))
		}

		mountCsiComponent(chart.wsgi)
		chart.wsgi.collectStaticJob.containers.map((c) => mountCsiContainer(c))
		chart.wsgi.migrateJob.containers.map((c) => mountCsiContainer(c))

		mountCsiComponent(chart.asgi)
		mountCsiComponent(chart.celeryBeat)
		chart.celeryWorkers.forEach(mountCsiComponent)

		const apiChart = addChart(chart.apiChart)
		const celeryChart = addChart(chart.celeryChart)

		const webChart = addChart(chart.webChart)

		celeryChart.node.addDependency(configChart)
		apiChart.node.addDependency(celeryChart)
		webChart.node.addDependency(namespaceChart)

		const chartObj = addChart(chart)
		chartObj.node.addDependency(apiChart, webChart)

		return Promise.resolve(chartObj)
	}
}
