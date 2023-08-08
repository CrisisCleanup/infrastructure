/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />

import * as blueprints from '@aws-quickstart/eks-blueprints'
import { CrisisCleanupChart } from '@crisiscleanup/charts.crisiscleanup'
import {
	flatKeysToFlatScreamingSnakeCaseKeys,
	type CrisisCleanupConfig,
} from '@crisiscleanup/config'
import type { Component } from '@crisiscleanup/k8s.construct.component'
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager'
import { type IStringParameter } from 'aws-cdk-lib/aws-ssm'
import { App, type Chart } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import type { Construct } from 'constructs'
import defu from 'defu'
import { type NamedSecretsProvider } from '../secrets'
import { getRequiredResource } from '../util'

export interface CrisisCleanupAddOnProps {
	readonly databaseResourceName: string
	readonly databaseSecretResourceName: string
	readonly config: CrisisCleanupConfig
	/**
	 * Secret provider for CSI driver.
	 */
	readonly secretsProvider: blueprints.SecretProvider | NamedSecretsProvider
	/**
	 * Name of secret provided via secrets provider.
	 */
	readonly secretName?: string
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

		let secretName = this.props.secretName
		if ('secretName' in this.props.secretsProvider) {
			secretName = secretName ?? this.props.secretsProvider.secretName
		}
		if (!secretName) throw new Error('Must provide secret name!')

		const secretKeys = flatKeysToFlatScreamingSnakeCaseKeys(
			this.props.config.api.secrets,
			{ nestedDelimiter: '_' },
		)

		// paths provided via database secret
		const dbSecretPaths: blueprints.JmesPathObject[] = [
			{ path: 'username', objectAlias: 'POSTGRES_USER' },
			{ path: 'password', objectAlias: 'POSTGRES_PASSWORD' },
			{ path: 'host', objectAlias: 'POSTGRES_HOST' },
		]

		const externalDbKeys = dbSecretPaths.map(({ path }) =>
			['postgres', path].join('.'),
		)
		const secretPaths: blueprints.JmesPathObject[] = Object.entries(secretKeys)
			.filter(([key, _]) => !externalDbKeys.includes(key))
			.map(([key, value]) => ({
				path: ['api', 'secrets', key].join('.'),
				objectAlias: value,
			}))

		const databaseSecret = getRequiredResource<ISecret>(
			clusterInfo.getResourceContext(),
			this.props.databaseSecretResourceName,
		)

		const csiProvider = new blueprints.SecretProviderClass(
			clusterInfo,
			sa,
			'crisiscleanup-api',
			{
				secretProvider: this.props.secretsProvider,
				jmesPath: secretPaths,
				// sync provided secrets to a k8s secret named 'crisiscleanup-api-secrets'
				kubernetesSecret: {
					secretName: 'crisiscleanup-api-secrets',
					data: secretPaths.map((secretObj) => ({
						key: secretObj.objectAlias,
						objectName: secretObj.objectAlias,
					})),
				},
			},
			{
				secretProvider: {
					provide(_): ISecret | IStringParameter {
						return databaseSecret
					},
				},
				jmesPath: dbSecretPaths,
				kubernetesSecret: {
					secretName: 'crisiscleanup-db-secrets',
					data: dbSecretPaths.map((secretObj) => ({
						key: secretObj.objectAlias,
						objectName: secretObj.objectAlias,
					})),
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
		const dbSecretLookup = kplus.Secret.fromSecretName(
			chart.configChart,
			'crisiscleanup-db-secrets',
			'crisiscleanup-db-secrets',
		)
		const dbAliases = dbSecretPaths.map(({ objectAlias }) => objectAlias)
		const secretEnvsValues = Object.values(secretKeys).map((key) => [
			key,
			kplus.EnvValue.fromSecretValue({
				key: key,
				secret: dbAliases.includes(key) ? dbSecretLookup : secretLookup,
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
