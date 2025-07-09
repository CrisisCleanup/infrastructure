import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	CrisisCleanupChart,
	type CrisisCleanupChartConfig,
	type CrisisCleanupChartProps,
} from '@crisiscleanup/charts.crisiscleanup'
import {
	type CrisisCleanupConfig,
	flatKeysToFlatScreamingSnakeCaseKeys,
} from '@crisiscleanup/config'
import type { Component } from '@crisiscleanup/k8s.construct.component'
import { KubernetesManifest } from 'aws-cdk-lib/aws-eks'
import type { ISecret } from 'aws-cdk-lib/aws-secretsmanager'
import { type IStringParameter } from 'aws-cdk-lib/aws-ssm'
import { App, type Chart } from 'cdk8s'
import * as kplus from 'cdk8s-plus-30'
import type { Construct } from 'constructs'
import defu from 'defu'
import { VerticalPodAutoscalerAddOn } from './vertical-pod-autoscaler'
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
	constructor(readonly props: CrisisCleanupAddOnProps) {
		// TODO: resolve esbuild transform error that is occurring with tsx/esbuild.
		const newDeploy = blueprints.utils.dependable(
			blueprints.addons.SecretsStoreAddOn.name,
			VerticalPodAutoscalerAddOn.name,
		)(
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			Object.getPrototypeOf(this),
			'deploy',
			Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'deploy')!,
		)
		Object.defineProperty(Object.getPrototypeOf(this), 'deploy', newDeploy)
	}

	deploy(clusterInfo: blueprints.ClusterInfo): Promise<Construct> {
		const cluster = clusterInfo.cluster
		const chartConfig: CrisisCleanupChartConfig = this.props.config
			.chart as CrisisCleanupChartConfig

		const sa = cluster.addServiceAccount('crisiscleanup-api', {
			namespace: chartConfig.namespace,
			name: 'crisiscleanup-api',
			labels: {
				'app.kubernetes.io/app': 'crisiscleanup',
			},
		})

		const cdk8sApp = new App()
		const saProps = {
			serviceAccount: kplus.ServiceAccount.fromServiceAccountName(
				cdk8sApp,
				'crisiscleanup-service-account',
				'crisiscleanup-api',
				{ namespaceName: chartConfig.namespace },
			),
		}
		const chart = CrisisCleanupChart.withDefaults(cdk8sApp, {
			...(this.props.config.chart as CrisisCleanupChartConfig),
			apiAppConfig: this.props.config.api.config,
			apiAppSecrets: {},
			disableResourceNameHashes: true,
			// TODO: better way to accomplish this.
			wsgi: defu(chartConfig.wsgi, saProps) as CrisisCleanupChartProps['wsgi'],
			asgi: defu(chartConfig.asgi, saProps) as CrisisCleanupChartProps['asgi'],
			celeryBeat: defu(
				chartConfig.celeryBeat,
				saProps,
			) as CrisisCleanupChartProps['celeryBeat'],
			celery: Object.fromEntries(
				Object.entries(chartConfig.celery).map(([key, values]) => [
					key,
					defu(values, saProps),
				]),
			) as CrisisCleanupChartProps['celery'],
			adminWebsocket: defu(
				chartConfig.adminWebsocket,
				saProps,
			) as CrisisCleanupChartProps['adminWebsocket'],
			sync: (chartConfig.sync
				? defu(chartConfig.sync, saProps)
				: chartConfig.sync) as CrisisCleanupChartProps['sync'],
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

		const externalDbAliases = dbSecretPaths.map(
			({ objectAlias }) => objectAlias,
		)
		const secretPaths: blueprints.JmesPathObject[] = Object.entries(secretKeys)
			.filter(([, value]) => !externalDbAliases.includes(value))
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
					provide(): ISecret | IStringParameter {
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
		const apiSecretEnvValues = Object.values(secretKeys)
			.filter((key) => !externalDbAliases.includes(key))
			.map((key) => [
				key,
				kplus.EnvValue.fromSecretValue({
					key: key,
					secret: secretLookup,
				}),
			])
		const dbSecretEnvValues = externalDbAliases.map((dbSecretAlias) => [
			dbSecretAlias,
			kplus.EnvValue.fromSecretValue({
				key: dbSecretAlias,
				secret: dbSecretLookup,
			}),
		])
		const secretEnvsValues = [...apiSecretEnvValues, ...dbSecretEnvValues]

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

		chart.asgi.mountCsiSecrets(
			csiVolume,
			secretEnvsValues as [key: string, secretName: kplus.EnvValue][],
		)
		mountCsiComponent(chart.celeryBeat)
		chart.celeryWorkers.forEach(mountCsiComponent)
		mountCsiComponent(chart.adminWebsocket)

		// mount for sync cronjob
		chart.sync?.syncCronJob?.addVolume?.(csiVolume)
		chart.sync?.syncCronJob?.containers?.forEach?.((cont) =>
			mountCsiContainer(cont),
		)

		// TODO(BUG): Workaround for cdk8s refusing to synth storage requests for volume claim templates
		const apiChartJson = chart.apiChart.toJson()
		const apiChartPatchedJson = apiChartJson.map((obj) => {
			if (
				// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
				obj.metadata?.name?.includes?.('rag') &&
				'spec' in obj &&
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				'volumeClaimTemplates' in obj.spec
			) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				obj.spec.volumeClaimTemplates[0].spec.resources = {
					requests: {
						storage: '10Gi',
					},
				}
			}
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return obj
		})

		const apiChart = new KubernetesManifest(cluster, chart.apiChart.node.id, {
			cluster,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			manifest: apiChartPatchedJson,
		})
		// const apiChart = addChart(chart.apiChart)
		const celeryChart = addChart(chart.celeryChart)

		celeryChart.node.addDependency(configChart)
		apiChart.node.addDependency(celeryChart)

		if (chart.syncChart) {
			const syncChart = addChart(chart.syncChart)
			syncChart.node.addDependency(configChart)
		}

		const chartObj = addChart(chart)
		chartObj.node.addDependency(apiChart)

		return Promise.resolve(chartObj)
	}
}
