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

enum ScaleSetVolumes {
	WORK = 'work',
	RUNNER = 'runner',
	VAR_DOCKER = 'var-lib-docker',
	TMP = 'tmp',
	DIND_CERT = 'dind-cert',
	DIND_EXTERNALS = 'dind-externals',
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
	/**
	 * User docker-in-docker runner image.
	 */
	useDindRunner?: boolean
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
		const scManifest = clusterInfo.cluster.addManifest(
			'arc-storage-class',
			this.createStorageClassTemplate({
				name: 'arc-gp3-sc',
				reclaimPolicy: 'Delete',
			}),
		)
		const dockerScManifest = clusterInfo.cluster.addManifest(
			'arc-docker-storage-class',
			this.createStorageClassTemplate({
				name: 'arc-docker-sc',
				reclaimPolicy: 'Retain',
			}),
		)
		const chart = this.addHelmChart(clusterInfo, mergedValues)
		chart.node.addDependency(scManifest)
		chart.node.addDependency(dockerScManifest)
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
	protected createStorageClassTemplate(options: {
		name: string
		reclaimPolicy: 'Retain' | 'Delete'
	}) {
		return {
			apiVersion: 'storage.k8s.io/v1',
			kind: 'StorageClass',
			metadata: {
				name: options.name,
			},
			provisioner: 'ebs.csi.aws.com',
			volumeBindingMode: 'WaitForFirstConsumer',
			reclaimPolicy: options.reclaimPolicy,
			allowVolumeExpansion: true,
			parameters: {
				type: 'gp3',
			},
		}
	}

	/**
	 *
	 * Create the template spec for volume claim.
	 * @param storageRequest Request amount and unit.
	 * @param storageClassName Storage class name.
	 * @protected
	 */
	protected createVolumeClaimTemplate(
		storageRequest: string,
		storageClassName: string,
	) {
		return {
			spec: {
				accessModes: ['ReadWriteOnce'],
				storageClassName: storageClassName,
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
					env: [
						{
							name: 'POD_NAME',
							valueFrom: {
								fieldRef: {
									fieldPath: 'metadata.name',
								},
							},
						},
					],
					volumeMounts: [
						this.templateVolumeMounts[ScaleSetVolumes.WORK],
						this.templateVolumeMounts[ScaleSetVolumes.DIND_CERT],
						this.templateVolumeMounts[ScaleSetVolumes.DIND_EXTERNALS],
						this.templateVolumeMounts[ScaleSetVolumes.TMP],
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
					resources: this.containerResources.dind,
					securityContext: {
						privileged: true,
					},
					env: [
						{
							name: 'POD_NAME',
							valueFrom: {
								fieldRef: {
									fieldPath: 'metadata.name',
								},
							},
						},
					],
					volumeMounts: [
						this.templateVolumeMounts[ScaleSetVolumes.WORK],
						this.templateVolumeMounts[ScaleSetVolumes.VAR_DOCKER],
						this.templateVolumeMounts[ScaleSetVolumes.DIND_CERT],
						this.templateVolumeMounts[ScaleSetVolumes.DIND_EXTERNALS],
						this.templateVolumeMounts[ScaleSetVolumes.TMP],
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
			runner: {
				limits: {
					cpu: '50m',
					memory: '300Mi',
				},
				requests: {
					cpu: '20m',
					memory: '210Mi',
				},
			},
			dind: {
				limits: {
					cpu: '3.0',
					memory: '4Gi',
				},
				requests: {
					cpu: '1.0',
					memory: '2Gi',
				},
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
			'cp -r /home/runner/* /runner/',
			'mkdir -p /runner/externals',
			'(mv /home/runner/externalstmp/* /home/runner/externals/ || true)',
			'(sudo mv /runnertmp/* /home/runner/externals/ || true)',
			'sudo chown -R runner:docker /home/runner',
			'sudo chown -R runner:docker /runner || true',
			'sudo chown -R runner:docker /tmp || true',
		]

		const volumeMounts = [
			this.templateVolumeMounts[ScaleSetVolumes.WORK],
			this.templateVolumeMounts[ScaleSetVolumes.TMP],
		]

		const env: Array<Record<string, unknown>> = [
			{
				name: 'POD_NAME',
				valueFrom: {
					fieldRef: {
						fieldPath: 'metadata.name',
					},
				},
			},
			{
				name: 'RUNNER_WAIT_FOR_DOCKER_IN_SECONDS',
				value: '250',
			},
		]

		if (this.options.useDindRunner) {
			volumeMounts.push(this.templateVolumeMounts[ScaleSetVolumes.VAR_DOCKER])
		} else {
			env.push(
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
			)
		}

		const runnerInit = {
			initContainers: [
				{
					name: ScaleSetContainer.INIT_RUNNER,
					image: runnerImage,
					imagePullPolicy: 'IfNotPresent',
					command: ['sh', '-c', initCommands.join(' && ')],
					env: [
						{
							name: 'POD_NAME',
							valueFrom: {
								fieldRef: {
									fieldPath: 'metadata.name',
								},
							},
						},
					],
					volumeMounts: [
						...volumeMounts,
						{
							...this.templateVolumeMounts[ScaleSetVolumes.RUNNER],
							mountPath: '/runner',
						},
					],
				},
			],
		}

		const dindCommand = [
			"sudo sed -i 's#startup.sh#/home/runner/run.sh#g' /usr/bin/entrypoint-dind.sh",
			'/usr/bin/entrypoint-dind.sh',
		]

		const runner = {
			containers: [
				{
					name: ScaleSetContainer.RUNNER,
					image: runnerImage,
					imagePullPolicy: 'IfNotPresent',
					resources: this.containerResources.runner,
					command: this.options.useDindRunner
						? ['bash', '-c', dindCommand.join(' && ')]
						: ['/home/runner/run.sh'],
					env,
					volumeMounts: [
						this.templateVolumeMounts[ScaleSetVolumes.RUNNER],
						this.templateVolumeMounts[ScaleSetVolumes.DIND_CERT],
						...volumeMounts,
					],
				},
			],
		}
		return { spec: { ...runner, ...runnerInit } }
	}

	protected get templateVolumes() {
		const volumes = {
			[ScaleSetVolumes.WORK]: {
				ephemeral: {
					volumeClaimTemplate: this.createVolumeClaimTemplate(
						'10Gi',
						'arc-gp3-sc',
					),
				},
			},
			[ScaleSetVolumes.RUNNER]: {
				emptyDir: {},
			},
			[ScaleSetVolumes.VAR_DOCKER]: {
				ephemeral: {
					volumeClaimTemplate: this.createVolumeClaimTemplate(
						'10Gi',
						'arc-docker-sc',
					),
				},
			},
			[ScaleSetVolumes.TMP]: {
				emptyDir: {
					medium: 'Memory',
				},
			},
			[ScaleSetVolumes.DIND_CERT]: {
				emptyDir: {
					medium: 'Memory',
				},
			},
			[ScaleSetVolumes.DIND_EXTERNALS]: {
				emptyDir: {},
			},
		}
		return Object.fromEntries(
			Object.entries(volumes).map(([name, spec]) => [name, { ...spec, name }]),
		)
	}

	protected get templateVolumeMounts() {
		const mounts = {
			[ScaleSetVolumes.WORK]: {
				mountPath: '/home/runner/_work',
				subPathExpr: '$(POD_NAME)-work',
			},
			[ScaleSetVolumes.RUNNER]: {
				mountPath: '/home/runner',
				subPathExpr: '$(POD_NAME)-runner',
			},
			[ScaleSetVolumes.VAR_DOCKER]: {
				mountPath: '/var/lib/docker',
			},
			[ScaleSetVolumes.TMP]: {
				mountPath: '/tmp',
				subPathExpr: '$(POD_NAME)-tmp',
			},
			[ScaleSetVolumes.DIND_CERT]: {
				mountPath: '/certs/client',
				subPathExpr: '$(POD_NAME)-dind-cert',
			},
			[ScaleSetVolumes.DIND_EXTERNALS]: {
				mountPath: '/home/runner/externals',
				subPathExpr: '$(POD_NAME)-dind-externals',
			},
		}
		return Object.fromEntries(
			Object.entries(mounts).map(([name, spec]) => [name, { ...spec, name }]),
		)
	}

	/**
	 * Create the template spec for ephemeral runners.
	 * @protected
	 */
	protected createTemplateSpec() {
		const volumeDefs = Object.values(this.templateVolumes)
		const volumes = {
			spec: {
				volumes: volumeDefs,
			},
		}
		return defu(
			{},
			volumes,
			this.options.useDindRunner ? {} : this.createDindContainerSpec(),
			this.createRunnerContainerSpec(),
		)
	}
}
