import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type ClusterInfo } from '@aws-quickstart/eks-blueprints'
import { type ServiceAccount } from 'aws-cdk-lib/aws-eks'
import { type ContainerResources } from 'cdk8s-plus-27'
import type { Construct } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import { getRequiredResource } from '../util.ts'

const debug = createDebug('@crisiscleanup:stacks.api:addons.arc')

export interface ARCScaleSetControllerProps
	extends blueprints.HelmAddOnUserProps {
	/**
	 * Container resources.
	 */
	resources?: Pick<ContainerResources, 'cpu' | 'memory'>
}

export enum ScaleSetContainer {
	INIT_DIND = 'init-dind-externals',
	INIT_RUNNER = 'init-runner',
	RUNNER = 'runner',
	DIND = 'dind',
}

export interface ARCScaleSetProps extends blueprints.HelmAddOnUserProps {
	/**
	 * Create namespace.
	 * @default true
	 */
	createNamespace?: boolean
	/**
	 * Container resources.
	 */
	resources?: Pick<ContainerResources, 'cpu' | 'memory'>
	/**
	 * URL where runners should be configured.
	 * @example https://github.com/myorg
	 * @example https://github.com/myorg/myrepo
	 */
	githubConfigUrl: string
	/**
	 * Name of github config secret.
	 */
	githubConfigSecret: string
	/**
	 * Minimum number of runners to scale down too.
	 * @default 0
	 */
	minRunners?: number
	/**
	 * Maximum number of runners to scale up too.
	 * @default 5
	 */
	maxRunners?: number
	/**
	 * Name of runner group.
	 * @default 'default'
	 */
	runnerGroup?: string
	/**
	 * Name of scale set.
	 * @default 'arc-runner-set'
	 */
	runnerScaleSetName?: string
	/**
	 * Image overrides for containers.
	 */
	containerImages?: Partial<Record<ScaleSetContainer, string>>
}

const scaleSetControllerDefaultProps: blueprints.HelmAddOnProps &
	Partial<ARCScaleSetControllerProps> = {
	name: 'gha-scale-set-controller',
	chart: 'gha-scale-set-controller',
	repository:
		'oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller',
	release: 'arc',
	namespace: 'arc-systems',
	version: '0.6.0',
	values: {},
}

const scaleSetDefaultProps: blueprints.HelmAddOnProps &
	Partial<ARCScaleSetProps> = {
	name: 'arc-runner-set',
	chart: 'arc-runner-set',
	release: 'arc-runner-set',
	version: scaleSetControllerDefaultProps.version,
	repository:
		'oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set',
	createNamespace: true,
	namespace: 'arc-runners',
	values: {},
}

const ARC_SERVICE_ACCOUNT_RESOURCE_ID = 'ARC_SERVICE_ACCOUNT'

export class ARCScaleSetController extends blueprints.HelmAddOn {
	readonly options: ARCScaleSetControllerProps

	constructor(props?: ARCScaleSetControllerProps) {
		super({ ...scaleSetControllerDefaultProps, ...props })
		this.options = this.props as ARCScaleSetControllerProps
	}

	/**
	 * @inheritDoc
	 */
	deploy(clusterInfo: ClusterInfo): Promise<Construct> {
		const cluster = clusterInfo.cluster
		const namespace = blueprints.utils.createNamespace(
			this.options.namespace!,
			clusterInfo.cluster,
		)

		const sa = cluster.addServiceAccount('arc-scale-set-sa', {
			name: this.options.release!,
			namespace: this.options.namespace!,
		})
		sa.node.addDependency(namespace)
		clusterInfo
			.getResourceContext()
			.add<ServiceAccount>(ARC_SERVICE_ACCOUNT_RESOURCE_ID, {
				provide: () => sa,
			})

		const values: blueprints.Values[] = [
			this.options.values ?? {},
			{
				serviceAccount: {
					create: false,
					name: sa.serviceAccountName,
				},
			},
		]
		if (this.options.resources) {
			const { cpu, memory } = this.options.resources
			const valuesResources = defu(
				{},
				cpu?.limit && { limit: { cpu: cpu.limit.amount } },
				cpu?.request && { request: { cpu: cpu.request.amount } },
				memory?.limit && { limit: { memory: memory.limit.toMebibytes() } },
				memory?.request && {
					request: { memory: memory.request.toMebibytes() },
				},
			)
			values.push({ resources: valuesResources })
		}
		const mergedValues = defu({}, ...values) as blueprints.Values
		const chart = this.addHelmChart(clusterInfo, mergedValues)
		return Promise.resolve(chart)
	}
}

export class ARCScaleSet extends blueprints.HelmAddOn {
	readonly options: ARCScaleSetProps
	constructor(props?: ARCScaleSetProps) {
		super({ ...scaleSetDefaultProps, ...props })
		this.options = this.props as ARCScaleSetProps
	}

	@blueprints.utils.dependable(
		ARCScaleSetController.name,
		blueprints.addons.SecretsStoreAddOn.name,
	)
	deploy(clusterInfo: ClusterInfo): Promise<Construct> {
		const resourceContext = clusterInfo.getResourceContext()

		const sa = getRequiredResource<ServiceAccount>(
			resourceContext,
			ARC_SERVICE_ACCOUNT_RESOURCE_ID,
		)

		const values: blueprints.Values[] = [
			{
				githubConfigUrl: this.options.githubConfigUrl,
				githubConfigSecret: this.options.githubConfigSecret,
				template: this.createTemplateSpec(),
				controllerServiceAccount: {
					namespace: sa.serviceAccountNamespace,
					name: sa.serviceAccountName,
				},
			},
			this.options.minRunners && { minRunners: this.options.minRunners },
			this.options.maxRunners && { maxRunners: this.options.maxRunners },
			this.options.runnerGroup && { runnerGroup: this.options.runnerGroup },
			this.options.runnerScaleSetName && {
				runnerScaleSetName: this.options.runnerScaleSetName,
			},
		].filter(Boolean) as blueprints.Values[]

		const mergedValues = defu(this.options.values ?? {}, ...values)
		debug('merged values: %O', mergedValues)
		clusterInfo.cluster.addManifest(
			'arc-storage-class',
			this.createStorageClassTemplate(),
		)
		const chart = this.addHelmChart(clusterInfo, mergedValues)
		if (this.options.createNamespace) {
			const namespace = blueprints.utils.createNamespace(
				this.options.namespace!,
				clusterInfo.cluster,
			)
			chart.node.addDependency(namespace)
		}
		return Promise.resolve(chart)
	}

	/**
	 * Create the template spec for storage class.
	 * @protected
	 */
	protected createStorageClassTemplate() {
		return {
			apiVersion: 'storage.k8s.io/v1',
			kind: 'StorageClass',
			metadata: {
				name: 'arc-gp3-sc',
			},
			provisioner: 'ebs.csi.aws.com',
			volumeBindingMode: 'WaitForFirstConsumer',
			reclaimPolicy: 'Delete',
			allowVolumeExpansion: true,
			parameters: {
				type: 'gp3',
			},
		}
	}

	/**
	 * Create the template spec for volume claim.
	 * @param storageRequest Request amount and unit.
	 * @protected
	 */
	protected createVolumeClaimTemplate(storageRequest: string) {
		return {
			spec: {
				accessModes: ['ReadWriteOnce'],
				storageClassName: 'arc-gp3-sc',
				resources: {
					requests: {
						storage: storageRequest,
					},
				},
			},
		}
	}

	/**
	 * Create the template spec for dind container.
	 * @protected
	 */
	protected createDindContainerSpec() {
		const initImage =
			this.options.containerImages?.[ScaleSetContainer.INIT_DIND] ??
			this.options.containerImages?.[ScaleSetContainer.RUNNER] ??
			'ghcr.io/actions/actions-runner:latest'
		const dindImage =
			this.options.containerImages?.[ScaleSetContainer.DIND] ?? 'docker:dind'
		const init = {
			initContainers: [
				{
					name: ScaleSetContainer.INIT_DIND,
					image: initImage,
					imagePullPolicy: 'IfNotPresent',
					command: [
						'cp',
						'-r',
						'-v',
						'/home/runner/externals/.',
						'/home/runner/tmpDir/',
					],
					volumeMounts: [
						{
							name: 'dind-externals',
							mountPath: '/home/runner/tmpDir',
						},
						{
							name: 'var-lib-docker',
							mountPath: '/var/lib/docker',
						},
					],
				},
			],
		}
		const dind = {
			containers: [
				{
					name: ScaleSetContainer.DIND,
					image: dindImage,
					imagePullPolicy: 'IfNotPresent',
					resources: this.containerResources,
					securityContext: {
						privileged: true,
					},
					volumeMounts: [
						{
							name: 'work',
							mountPath: '/home/runner/_work',
						},
						{
							name: 'dind-cert',
							mountPath: '/certs/client',
						},
						{
							name: 'dind-externals',
							mountPath: '/home/runner/externals',
						},
					],
				},
			],
		}

		return {
			spec: { ...init, ...dind },
		}
	}

	protected get containerResources() {
		return {
			limits: {
				cpu: '4.0',
				memory: '8Gi',
			},
			requests: {
				cpu: '2.0',
				memory: '4Gi',
			},
		}
	}

	/**
	 * Create the template spec for runner container.
	 * @protected
	 */
	protected createRunnerContainerSpec() {
		const runnerImage =
			this.options.containerImages?.[ScaleSetContainer.RUNNER] ??
			'ghcr.io/actions/actions-runner:latest'

		const initCommands = [
			'sudo chown -R runner:docker /home/runner',
			'cp -r /runnertmp/* /home/runner/',
			'mkdir -p /home/runner/externals',
			'mv /home/runner/externalstmp/* /home/runner/externals/',
			'sudo chown -R runner:docker /home/runner',
		]

		const runnerInit = {
			initContainers: [
				{
					name: ScaleSetContainer.INIT_RUNNER,
					image: runnerImage,
					imagePullPolicy: 'IfNotPresent',
					command: ['sh', '-c', initCommands.join(' && ')],
					volumeMounts: [
						{
							name: 'runner',
							mountPath: '/home/runner',
						},
						{
							name: 'work',
							mountPath: '/home/runner/_work',
						},
					],
				},
			],
		}

		const runner = {
			containers: [
				{
					name: ScaleSetContainer.RUNNER,
					image: runnerImage,
					imagePullPolicy: 'IfNotPresent',
					command: ['/home/runner/run.sh'],
					env: [
						{
							name: 'DOCKER_HOST',
							value: 'tcp://localhost:2376',
						},
						{
							name: 'DOCKER_TLS_VERIFY',
							value: '1',
						},
						{
							name: 'DOCKER_CERT_PATH',
							value: '/certs/client',
						},
					],
					volumeMounts: [
						{
							name: 'runner',
							mountPath: '/home/runner',
						},
						{
							name: 'work',
							mountPath: '/home/runner/_work',
						},
						{
							name: 'dind-cert',
							mountPath: '/certs/client',
							readOnly: true,
						},
					],
				},
			],
		}
		return { spec: { ...runner, ...runnerInit } }
	}

	/**
	 * Create the template spec for ephemeral runners.
	 * @protected
	 */
	protected createTemplateSpec() {
		const volumes = {
			spec: {
				volumes: [
					{
						name: 'work',
						ephemeral: {
							volumeClaimTemplate: this.createVolumeClaimTemplate('10Gi'),
						},
					},
					{
						name: 'runner',
						emptyDir: {},
					},
					{
						name: 'var-lib-docker',
						ephemeral: {
							volumeClaimTemplate: this.createVolumeClaimTemplate('10Gi'),
						},
					},
					{
						name: 'dind-cert',
						emptyDir: {},
					},
					{
						name: 'dind-externals',
						emptyDir: {},
					},
				],
			},
		}
		return defu(
			{},
			volumes,
			this.createDindContainerSpec(),
			this.createRunnerContainerSpec(),
		)
	}
}
