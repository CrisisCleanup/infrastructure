import { stringifyObjectValues } from '@crisiscleanup/config'
import {
	Component,
	ComponentScaling,
	ContainerImage,
	Label,
} from '@crisiscleanup/k8s.construct.component'
import { ApiObject, Chart, Duration, JsonPatch, Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import { type EnvValue } from 'cdk8s-plus-27'
import { Construct } from 'constructs'
import createDebug from 'debug'
import defu from 'defu'
import {
	type ApiASGIProps,
	type ApiConfigProps,
	type ApiProps,
	type ApiWSGIProps,
	type CeleryProps,
	type IApiConfig,
	type IHttpProbable,
} from './types'

const debug = createDebug('@crisiscleanup:k8s.construct.api')

export class ApiConfig extends Construct implements IApiConfig {
	static of(construct: Construct): ApiConfig | undefined {
		return Chart.of(construct)
			.node.findAll()
			.find((c) => c instanceof ApiConfig) as ApiConfig
	}

	readonly configMap: kplus.ConfigMap
	readonly configSecret?: kplus.Secret

	private readonly envFroms: kplus.EnvFrom[]
	private envVars: { [key: string]: kplus.EnvValue }

	constructor(scope: Construct, id: string, props: ApiConfigProps) {
		super(scope, id)
		this.envFroms = []
		this.envVars = {}

		this.configMap = new kplus.ConfigMap(this, 'config', {
			data: stringifyObjectValues(props.config),
		})
		this.addEnvFrom(new kplus.EnvFrom(this.configMap))

		if (props.secrets && Object.keys(props.secrets).length) {
			this.configSecret = new kplus.Secret(this, 'config-secret', {
				stringData: stringifyObjectValues(props.secrets),
			})
			this.addEnvFrom(
				new kplus.EnvFrom(undefined, undefined, this.configSecret),
			)
		}
	}

	addEnvFrom(envFrom: kplus.EnvFrom): this {
		this.envFroms.push(envFrom)
		return this
	}

	addEnvVars(vars: { [key: string]: kplus.EnvValue }): this {
		this.envVars = {
			...this.envVars,
			...vars,
		}
		return this
	}

	get env(): kplus.Env {
		return new kplus.Env(this.envFroms, this.envVars)
	}
}

export abstract class ApiComponent<
	PropsT extends ApiProps = ApiProps,
> extends Component<PropsT> {
	static supportsProbes<T extends Construct>(
		construct: T,
	): construct is T & IHttpProbable {
		return (
			Object.hasOwnProperty.call(construct, 'httpProbePath') &&
			typeof (construct as T & { httpProbePath: unknown }).httpProbePath ===
				'string'
		)
	}

	readonly config: IApiConfig

	protected constructor(
		readonly scope: Construct,
		readonly id: string,
		props: PropsT,
	) {
		const { spread, ...restProps } = props
		const propsWithDefaults = defu(restProps as typeof props, {
			containerDefaults: {
				resources: {
					cpu: {
						request: kplus.Cpu.millis(100),
					},
					memory: {
						request: Size.gibibytes(1),
						limit: Size.gibibytes(1),
					},
				},
			},
		}) as PropsT
		super(scope, id, propsWithDefaults)
		debug('%s: (componentProps=%O)', id, propsWithDefaults)
		const config = props.config ?? ApiConfig.of(scope)
		if (!config) throw Error('Failed to resolve ApiConfig!')
		this.config = config
		if (spread) {
			const topoPatch = JsonPatch.add(
				'/spec/template/spec/topologySpreadConstraints',
				[
					{
						maxSkew: 2,
						whenUnsatisfiable: 'ScheduleAnyway',
						labelSelector: this.deployment
							.toPodSelector()!
							.toPodSelectorConfig()
							.labelSelector._toKube(),
						topologyKey: kplus.Topology.ZONE.key,
					},
				],
			)
			ApiObject.of(this.deployment).addJsonPatch(topoPatch)
			this.addPdb({
				selectors: this.deployment
					.toPodSelector()!
					.toPodSelectorConfig()
					.labelSelector._toKube(),
				minAvailable: '35%',
			})
		}
	}

	protected createHttpProbes(
		httpPath: string,
	): Pick<kplus.ContainerProps, 'readiness' | 'liveness' | 'startup'> {
		const liveProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			periodSeconds: Duration.seconds(10),
			timeoutSeconds: Duration.seconds(6),
			failureThreshold: 6,
		})

		const readyProbe = kplus.Probe.fromHttpGet(httpPath, {
			initialDelaySeconds: Duration.seconds(20),
			periodSeconds: Duration.seconds(10),
			timeoutSeconds: Duration.seconds(6),
			failureThreshold: 6,
		})

		const startProbe = kplus.Probe.fromHttpGet(httpPath, {
			failureThreshold: 30,
			periodSeconds: Duration.seconds(15),
		})
		return {
			liveness: liveProbe,
			readiness: readyProbe,
			startup: startProbe,
		}
	}

	mountCsiSecrets(
		csiVolume: kplus.Volume,
		secretNames: [key: string, env_name: kplus.EnvValue][],
	) {
		this.deployment.addVolume(csiVolume)
		this.containers.forEach((cont) => {
			cont.mount('/mnt/secrets-store', csiVolume, { readOnly: true })
			secretNames.forEach(([key, value]) => {
				cont.env.addVariable(key, value)
			})
		})
	}
}

export class ApiWSGI
	extends ApiComponent<ApiWSGIProps>
	implements IHttpProbable
{
	static componentName = 'wsgi'
	readonly httpProbePath = '/health'

	readonly migrateJob: kplus.Job
	readonly collectStaticJob: kplus.Job

	constructor(scope: Construct, id: string, props: ApiWSGIProps) {
		const securityContext = new kplus.ContainerSecurityContext({
			readOnlyRootFilesystem: false,
			user: 1000,
			group: 1000,
			ensureNonRoot: true,
		})
		const propsWithDefaults = defu(props, {
			containerDefaults: {
				securityContext,
			},
		}) as ApiWSGIProps
		super(scope, id, propsWithDefaults)

		const resources = this.getResources({
			cpu: {
				request: 1000,
				limit: 1800,
			},
			memory: {
				request: 1200,
				limit: 1200,
			},
		})

		const backend = this.addContainer({
			name: 'gunicorn',
			portNumber: 5000,
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			command: [
				'/serve.sh',
				'wsgi',
				`--workers=${props.workers ?? 2}`,
				`--threads=${props.threads ?? 4}`,
				'--worker-class=gthread',
				'--worker-tmp-dir=/worker-tmp',
				'--timeout=90',
			],
			...(props.probes ?? this.createHttpProbes(this.httpProbePath)),
			resources,
		})

		const staticVolume = kplus.Volume.fromEmptyDir(
			scope,
			'static-files',
			'staticfiles',
		)
		const workerTmpVolume = kplus.Volume.fromEmptyDir(
			scope,
			'worker-tmp',
			'worker-tmp',
			{
				medium: kplus.EmptyDirMedium.MEMORY,
			},
		)

		const jobResources: kplus.ContainerProps['resources'] = {
			cpu: this.props.containerDefaults!.resources!.cpu!,
			memory: {
				...this.props.containerDefaults!.resources!.memory!,
				limit: Size.gibibytes(3),
			},
		}

		// migrate + collectstatic jobs
		this.migrateJob = new kplus.Job(this, 'migrate', {
			serviceAccount: this.props.serviceAccount,
			securityContext,
			podMetadata: { labels: { component: 'api-migrate' } },
			terminationGracePeriod: Duration.minutes(5),
			activeDeadline: Duration.minutes(30),
			ttlAfterFinished: Duration.minutes(2),
		})

		this.migrateJob.addContainer({
			name: 'migrate',
			command: ['python', 'manage.py', 'migrate', '--noinput', '--verbosity=1'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext,
			...ContainerImage.fromProps(props.image!).containerProps,
			resources: jobResources,
		})

		this.collectStaticJob = new kplus.Job(this, 'collectstatic', {
			serviceAccount: this.props.serviceAccount,
			securityContext,
			volumes: [staticVolume],
			podMetadata: { labels: { component: 'api-static' } },
			terminationGracePeriod: Duration.minutes(5),
			activeDeadline: Duration.minutes(30),
			ttlAfterFinished: Duration.minutes(2),
		})
		const staticJobContainer = this.collectStaticJob.addContainer({
			name: 'collectstatic',
			...ContainerImage.fromProps(props.image!).containerProps,
			command: [
				'python',
				'manage.py',
				'collectstatic',
				'--no-post-process',
				'--noinput',
				'--verbosity=2',
			],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext,
			resources: jobResources,
		})

		// mount volumes
		staticJobContainer.mount('/app/staticfiles', staticVolume)
		backend.mount('/app/staticfiles', staticVolume)
		backend.mount('/worker-tmp', workerTmpVolume)
	}
}

export class ApiASGI
	extends ApiComponent<ApiASGIProps>
	implements IHttpProbable
{
	static componentName = 'asgi'
	httpProbePath = '/ws/health'

	ragStatefulSet: kplus.StatefulSet

	constructor(scope: Construct, id: string, props: ApiASGIProps) {
		super(scope, id, props)

		// Storage class for node-shared io2 volume pool for rag models.
		const storageClass = new kplus.k8s.KubeStorageClass(this, id + '-rag-sc', {
			metadata: {
				name: 'rag-models',
			},
			provisioner: 'ebs.csi.aws.com',
			volumeBindingMode: 'WaitForFirstConsumer',
			parameters: {
				type: 'io2',
				iops: '1000',
				allowAutoIOPSPerGBIncrease: 'true',
			},
		})

		this.addContainer({
			name: 'hypercorn',
			command: ['/serve.sh', 'asgi', `--workers=${props.workers ?? 2}`],
			portNumber: 5000,
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			...(props.probes ?? this.createHttpProbes(this.httpProbePath)),
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				// todo: properly expose via configs
				memory: this.props.containerDefaults!.resources!.memory!,
				cpu: {
					request: kplus.Cpu.millis(500),
					limit: kplus.Cpu.millis(1500),
				},
			},
		})

		// rag channels stateful set
		// TODO: probably move to a separate component
		// (need to figure scaling triggers/metrics)
		// Uses stateful set to reuse pvcs

		const ragService = new kplus.Service(this, id + '-rag-service', {
			type: kplus.ServiceType.CLUSTER_IP,
			clusterIP: 'None',
			ports: [
				{
					name: 'channels',
					port: 5000,
				},
			],
		})

		this.ragStatefulSet = new kplus.StatefulSet(this, 'rag', {
			spread: true,
			serviceAccount: props.serviceAccount,
			service: ragService,
			metadata: {
				...Chart.of(this).labels,
				[Label.NAME]: 'rag',
			},
		})
		new ComponentScaling(this, 'rag-scaling', {
			minReplicas: 1,
			maxReplicas: 6,
			cpuUtilPercent: 50,
			memUtilPercent: 80,
			target: this.ragStatefulSet,
		})

		// channels worker
		this.ragStatefulSet.addContainer({
			name: 'rag-channels',
			command: ['/serve.sh', 'channelsworker', 'rag-document'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			image: ContainerImage.fromProps(props.image!).imageFqn,
			imagePullPolicy: props.image!.pullPolicy as kplus.ImagePullPolicy,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources: {
				cpu: {
					//limit: kplus.Cpu.units(3),
					request: kplus.Cpu.millis(200),
				},
				memory: {
					limit: Size.gibibytes(4),
					request: Size.gibibytes(1),
				},
			},
		})

		// init volume + setup permissions
		this.ragStatefulSet.addInitContainer({
			name: 'host-mounts-init',
			command: ['sh', '-x', '-c', 'mkdir -p /ccu && chown -R 1000:1000 /ccu'],
			securityContext: {
				readOnlyRootFilesystem: false,
				ensureNonRoot: false,
				user: 0,
				group: 0,
			},
			image: 'public.ecr.aws/docker/library/busybox:stable',
			imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
			envFrom: undefined,
			envVariables: undefined,
			resources: {
				cpu: {
					request: kplus.Cpu.millis(20),
					limit: kplus.Cpu.millis(30),
				},
				memory: {
					request: Size.mebibytes(20),
					limit: Size.mebibytes(50),
				},
			},
		})
		this.containers.set(
			'host-mounts-init',
			this.ragStatefulSet.initContainers[0],
		)
		this.containers.set('rag-channels', this.ragStatefulSet.containers[0])

		// rag models volume claim template
		const volumeClaimTemplates = [
			{
				metadata: {
					name: 'rag-volume',
				},
				spec: {
					accessModes: ['ReadWriteOnce'],
					storageClassName: storageClass.metadata.name,
					requests: {
						// TODO(BUG): For some reason CDK refuses to synth this as anything
						// but undefined (even with more json patches and with overriding _toKube() or using Size).
						// Workaround for now is to manually modify it after synth and `.toJSON()` in cdk.
						storage: '10Gi',
					},
				},
			},
		]

		const patches = [
			JsonPatch.add('/spec/volumeClaimTemplates', []),
			JsonPatch.add('/spec/volumeClaimTemplates/-', volumeClaimTemplates[0]),
			// Leaving for reference, but neither fix the issue of undefined
			// JsonPatch.add('/spec/volumeClaimTemplates/0/spec/resources', {
			// 	requests: {
			// 		storage: '10Gi',
			// 	},
			// }),
			// JsonPatch.add(
			// 	'/spec/volumeClaimTemplates/0/spec/resources/requests/storage',
			// 	'10Gi',
			// ),
			JsonPatch.add('/spec/template/spec/containers/0/volumeMounts', []),
			JsonPatch.add('/spec/template/spec/initContainers/0/volumeMounts', []),
		]

		const mountsMap = {
			nltk_data: '/ccu/nltk_data',
			hf_data: '/ccu/.cache/huggingface',
			mp_data: '/ccu/.cache/matplotlib',
		}

		// cdk8s stateful step doesnt support volume claim templates well at all.
		Object.entries(mountsMap).forEach(([subPath, mountPath]) => {
			const mount = {
				name: 'rag-volume',
				mountPath,
				subPath,
			}
			patches.push(
				JsonPatch.add(`/spec/template/spec/containers/0/volumeMounts/-`, mount),
				JsonPatch.add(
					`/spec/template/spec/initContainers/0/volumeMounts/-`,
					mount,
				),
			)
		})

		ApiObject.of(this.ragStatefulSet).addJsonPatch(...patches)
	}

	mountCsiSecrets(
		csiVolume: kplus.Volume,
		secretNames: [key: string, env_name: EnvValue][],
	) {
		super.mountCsiSecrets(csiVolume, secretNames)
		this.ragStatefulSet.addVolume(csiVolume)
		this.ragStatefulSet.containers.forEach((cont) => {
			cont.mount('/mnt/secrets-store', csiVolume, { readOnly: true })
			secretNames.forEach(([key, value]) => {
				cont.env.addVariable(key, value)
			})
		})
	}
}

export class CeleryBeat extends ApiComponent {
	static componentName = 'celerybeat'

	constructor(scope: Construct, id: string, props: ApiProps) {
		super(scope, id, props)
		const resources = this.getResources({
			cpu: {
				request: 20,
			},
			memory: {
				request: 400,
				limit: 400,
			},
		})
		this.addContainer({
			name: 'celerybeat',
			command: ['/serve.sh', 'celerybeat'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources,
		})
	}

	protected createDeploymentProps(): kplus.DeploymentProps {
		return { replicas: 1 }
	}
}

export class CeleryWorker extends ApiComponent<CeleryProps> {
	static componentName = 'celeryworker'

	constructor(scope: Construct, id: string, props: CeleryProps) {
		super(scope, id, props)

		const name = props.name ?? props.queues.join('-')
		const hostname = `${name}@%%h`

		const queues = [...new Set(props.queues)]

		const resources = this.getResources({
			memory: {
				limit: 900,
				request: 900,
			},
		})

		this.addContainer({
			name,
			command: [
				'/serve.sh',
				'celeryworker',
				'-Q',
				queues.join(','),
				`--concurrency=${props.concurrency ?? 2}`,
				'--hostname',
				hostname,
				...(props.args ?? []),
			],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources,
		})
	}
}

export class AdminWebSocket extends ApiComponent {
	static componentName = 'adminwebsocket'

	constructor(scope: Construct, id: string, props: ApiProps) {
		super(scope, id, props)
		const resources = this.getResources({
			cpu: {
				request: 3,
			},
			memory: {
				request: 250,
				limit: 250,
			},
		})
		this.addContainer({
			name: 'adminwebsocket',
			command: ['/serve.sh', 'adminwebsocket'],
			envFrom: this.config.env.sources,
			envVariables: this.config.env.variables,
			securityContext: {
				readOnlyRootFilesystem: false,
				user: 1000,
				group: 1000,
			},
			resources,
		})
	}
}
