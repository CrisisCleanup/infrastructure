import assert from 'node:assert'
import path from 'node:path'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import type { Stack, StackProps } from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cdkpipelines from 'aws-cdk-lib/pipelines'
import * as ghpipelines from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import flat from 'flat'

export interface GithubPipelineProps {
	repos?: string[]
	rootDir?: string
	owner?: string
}

export interface PipelineProps
	extends Omit<blueprints.PipelineProps, 'repository'>,
		GithubPipelineProps {}

export interface StackStage extends blueprints.StackStage {
	stageProps?: ghpipelines.AddGitHubStageOptions
}

export interface PipelineWave extends blueprints.PipelineWave {
	stages: StackStage[]
}

export class GithubCodePipelineBuilder extends blueprints.CodePipelineBuilder {
	protected githubProps: GithubPipelineProps

	constructor() {
		super()
		this.githubProps = {}
	}

	build(
		scope: Construct,
		id: string,
		stackProps?: StackProps,
	): GithubCodePipelineStack {
		// @ts-ignore
		const fullProps = this.props as unknown as PipelineProps
		const mergedProps = { ...fullProps, ...this.githubProps }
		return new GithubCodePipelineStack(scope, mergedProps, id, stackProps)
	}

	protected formatRepo(owner: string, repoString: string): string {
		if (repoString.includes('/')) return repoString
		return [owner, repoString].join('/')
	}

	owner(owner: string): this {
		super.owner(owner)
		this.githubProps.owner = owner
		if (this.githubProps.repos) {
			this.githubProps.repos = this.githubProps.repos.map((repo) =>
				this.formatRepo(owner, repo),
			)
		}
		return this
	}

	githubWave(...waves: PipelineWave[]): this {
		super.wave(...(waves as blueprints.PipelineWave[]))
		return this
	}

	githubRepo(...repos: string[]): this {
		const current = this.githubProps.repos ?? []
		this.githubProps.repos = [...current, ...repos]
		const owner = this.githubProps.owner
		if (owner) {
			this.githubProps.repos = this.githubProps.repos.map((repo) =>
				this.formatRepo(owner, repo),
			)
		}
		return this
	}

	rootDir(value: string): this {
		this.githubProps.rootDir = value
		return this
	}
}

export class GithubCodePipelineStack extends cdk.Stack {
	static builder(): GithubCodePipelineBuilder {
		return new GithubCodePipelineBuilder()
	}

	private asyncTask: Promise<any>

	constructor(
		scope: Construct,
		pipelineProps: PipelineProps,
		id: string,
		props?: StackProps,
	) {
		super(scope, id, props)

		const pipeline = GithubCodePipeline.build(this, pipelineProps)

		const promises: Promise<ApplicationStage>[] = []

		for (const stage of pipelineProps.stages) {
			const appStage = new ApplicationStage(this, stage.id, stage.stackBuilder)
			promises.push(appStage.waitForAsyncTasks())
		}

		this.asyncTask = Promise.all(promises).then((stages) => {
			let currentWave: ghpipelines.GitHubWave | undefined

			// eslint-disable-next-line @typescript-eslint/no-for-in-array
			for (const i in stages) {
				const stage = pipelineProps.stages[i]
				if (stage.waveId) {
					if (currentWave == null || currentWave.id != stage.waveId) {
						const waveProps = pipelineProps.waves.find(
							(wave) => wave.id === stage.waveId,
						)
						assert(
							waveProps,
							`Specified wave ${stage.waveId} is not found in the pipeline definition ${id}`,
						)
						currentWave = pipeline.addGitHubWave(stage.waveId, {
							...waveProps.props,
						})
					}
					currentWave.addStageWithGitHubOptions(stages[i], stage.stageProps)
				} else {
					pipeline.addStage(stages[i], stage.stageProps)
				}
			}
		})
	}

	async waitForAsyncTasks() {
		await this.asyncTask
	}
}

export class ApplicationStage extends ghpipelines.GitHubStage {
	private asyncTask: Promise<any> | undefined = undefined

	constructor(
		scope: Stack,
		id: string,
		builder: blueprints.StackBuilder | blueprints.AsyncStackBuilder,
		props?: ghpipelines.GitHubStageProps,
	) {
		super(scope, id, props)
		if ((<blueprints.AsyncStackBuilder>builder).buildAsync !== undefined) {
			this.asyncTask = (<blueprints.AsyncStackBuilder>builder).buildAsync(
				this,
				`${id}-blueprint`,
				props,
			)
		} else {
			builder.build(this, `${id}-blueprint`, props)
		}
	}

	public async waitForAsyncTasks(): Promise<ApplicationStage> {
		if (this.asyncTask) {
			return this.asyncTask.then(() => {
				return this
			})
		}
		return Promise.resolve(this)
	}
}

class GithubCodePipeline {
	static build(scope: Construct, props: PipelineProps) {
		const sopsInstall = [
			'echo Installing Sops...',
			'curl -L https://github.com/mozilla/sops/releases/download/v3.7.3/sops-v3.7.3.linux -o sops',
			'chmod 755 sops',
			'mv sops /usr/local/bin',
			'sops --version',
		]

		const helmInstall = [
			'echo Installing Helm...',
			'curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3',
			'chmod 700 get_helm.sh',
			'./get_helm.sh',
			'helm version',
		]

		const actionsRole = new ghpipelines.GitHubActionRole(
			scope,
			'github-action-role',
			{
				repos: props.repos ?? [],
			},
		)

		const pipelineS3BucketName = 'crisiscleanup-pipeline-assets'
		const pipelineS3 = new s3.Bucket(scope, 'pipeline-assets', {
			autoDeleteObjects: true,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
			transferAcceleration: true,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			bucketName: pipelineS3BucketName,
		})
		pipelineS3.grantReadWrite(actionsRole.role)
		pipelineS3.addLifecycleRule({
			id: 'cleanup-stale-assets',
			enabled: true,
			expiration: cdk.Duration.days(30),
			abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
			prefix: 'cdk-assets',
		})

		const installCommands = [
			'n stable',
			...sopsInstall,
			...helmInstall,
			'npm install -g pnpm aws-cdk@2.88.0',
			'pnpm install',
		]

		const commands = [
			'pnpm build',
			"pnpm -F 'stacks.api' run synth:silent",
			'cp -r packages/stacks/api/cdk.out ./cdk.out',
		]

		const synth = new cdkpipelines.ShellStep(`${props.name}-synth`, {
			installCommands,
			commands,
			env: {
				GIGET_AUTH: '${{ secrets.GIGET_AUTH }}',
			},
		})

		const actionsRoleArn =
			'arn:aws:iam::${{secrets.AWS_PIPELINE_ACCOUNT_ID}}:role/GitHubActionRole'
		const awsCreds = ghpipelines.AwsCredentials.fromOpenIdConnect({
			gitHubActionRoleArn: actionsRoleArn,
		})

		const maskValues: [ActionsContext, string][] = props.stages.map((stage) => [
			ActionsContext.SECRET,
			`AWS_ACCOUNT_ID_${stage.waveId ?? stage.id}`,
		])
		const maskStep = MaskValueStep.values('Mask IDs', ...maskValues, [
			ActionsContext.SECRET,
			'AWS_PIPELINE_ACCOUNT_ID',
		])

		const workflow = new PipelineWorkflow(scope, props.name, {
			awsCreds,
			synth,
			publishAssetsAuthRegion: 'us-east-1',
			preBuildSteps: [
				...maskStep.jobSteps,
				...awsCreds.credentialSteps('us-east-1'),
			],
			workflowPath: props.rootDir
				? path.join(props.rootDir, '.github', 'workflows', 'deploy.yml')
				: undefined,
			assetsS3Bucket: pipelineS3BucketName,
			assetsS3Prefix: 'cdk-assets',
			workflowTriggers: {
				push: { branches: ['main'] },
				workflowRun: {},
				workflowDispatch: {},
			},
		})

		return workflow
	}
}

enum ActionsContext {
	GITHUB = 'github',
	SECRET = 'secrets',
	ENV = 'env',
	INTERPOLATE = 'interpolate',
}

interface ActionsContextValue {
	context: ActionsContext
	key: string
}

/**
 * Interpolate a value for use in a workflow file.
 * @param value ActionsContextValue
 */
function interpolateValue(value: ActionsContextValue): string
function interpolateValue(context: ActionsContext, key: string): string
function interpolateValue(
	...args: [ActionsContextValue] | [ActionsContext, string]
): string {
	let [context, key] = args
	if (typeof context === 'object') {
		key = context.key
		context = context.context
	}
	const wrap = (inner: string) => '${{' + inner + '}}'
	if (context === ActionsContext.INTERPOLATE) {
		return wrap(key as string)
	}
	const body = [context, key].join('.')
	return wrap(body)
}

/**
 * Mask given values from workflow logs.
 */
class MaskValueStep extends ghpipelines.GitHubActionStep {
	/**
	 * Create job steps from given values.
	 * @param id Step id.
	 * @param values Values to mask.
	 */
	static values(
		id: string,
		...values: [context: ActionsContext, key: string][]
	): MaskValueStep {
		return new this(
			id,
			values.map(([context, key]) => ({ context, key })),
		)
	}

	constructor(
		id: string,
		values: ActionsContextValue[],
		props?: Omit<ghpipelines.GitHubActionStepProps, 'jobSteps'>,
	) {
		const mask = (value: string) => `echo ::add-mask::${value}`
		const steps: ghpipelines.JobStep[] = [
			{
				name: 'Mask values',
				run: values.map((value) => mask(interpolateValue(value))).join('\n'),
			},
		]
		super(id, {
			...(props ?? {}),
			jobSteps: steps,
		})
	}
}

interface PipelineWorkflowProps extends ghpipelines.GitHubWorkflowProps {
	assetsS3Bucket: string
	assetsS3Prefix: string
}

class PipelineWorkflow extends ghpipelines.GitHubWorkflow {
	constructor(
		scope: Construct,
		id: string,
		readonly props: PipelineWorkflowProps,
	) {
		super(scope, id, props)
	}

	getStageAccountIds(): Record<string, string> {
		const accountIds: [string, string][] = this.waves.map((wave) => [
			wave.stages[0].stacks[0].account!,
			wave.id,
		])
		return Object.fromEntries(accountIds)
	}

	protected doBuildPipeline() {
		super.doBuildPipeline()
		const patches = Array.from(this.iterPatches())
		this.workflowFile.patch(...patches)
		this.workflowFile.writeFile()
	}

	buildAssetsS3Path(): string {
		const assetsRun = [
			interpolateValue(ActionsContext.GITHUB, 'run_id'),
			interpolateValue(ActionsContext.GITHUB, 'run_attempt'),
		].join('-')
		return [
			`s3://${this.props.assetsS3Bucket}`,
			this.props.assetsS3Prefix,
			assetsRun,
			'cdk.out',
		].join('/')
	}

	buildAssetsSync(
		target: string,
		direction: 'pull' | 'push',
	): ghpipelines.JobStep[] {
		const s3Path = this.buildAssetsS3Path()
		const source = direction === 'pull' ? s3Path : target
		const dest = direction === 'pull' ? target : s3Path
		const stageAccountIds = this.getStageAccountIds()
		const maskValues: [ActionsContext, string][] = Object.values(
			stageAccountIds,
		).map((envName) => [
			ActionsContext.SECRET,
			`AWS_ACCOUNT_ID_${envName.toUpperCase()}`,
		])
		const maskStep = MaskValueStep.values('Mask IDs', ...maskValues, [
			ActionsContext.SECRET,
			'AWS_PIPELINE_ACCOUNT_ID',
		])
		const maskRun = maskStep.jobSteps[0].run!
		return [
			{
				name: `${
					direction.charAt(0).toUpperCase() + direction.slice(1)
				} assets`,
				env: {
					SOURCE: source,
					DESTINATION: dest,
				},
				run: [maskRun, 'aws s3 sync $SOURCE $DESTINATION'].join('\n'),
			},
		]
	}

	protected stepsToSyncAssemblyPatch(key: string, value: string | number) {
		const isUpload = String(value).startsWith('actions/upload-artifact')
		const isDownload = String(value).startsWith('actions/download-artifact')
		if (!isUpload && !isDownload) return
		const direction = isUpload ? 'push' : 'pull'
		// drop the '/uses'
		const targetKey = '/' + key.split('/').slice(0, -1).join('/')
		const newStep = this.buildAssetsSync('cdk.out', direction)
		return ghpipelines.JsonPatch.replace(targetKey, newStep[0])
	}

	protected moveAssetAuthenticationPatch(key: string, value: string | number) {
		// move asset authenticate step to start of job
		const isAssetsJob = key.startsWith('jobs/Assets-')
		const isUsesKey = key.endsWith('uses')
		const isUsesConfigure = String(value).startsWith('aws-actions/configure')
		const isTarget = isAssetsJob && isUsesKey && isUsesConfigure
		if (!isTarget) return
		// '/jobs/Assets-FileAsset5/2' -> '/jobs/Assets-FileAsset5/0'
		const fromKey = `/${key.split('/uses')[0]}`
		const toKey = fromKey.split('/').slice(0, -1).join('/') + '/0'
		return ghpipelines.JsonPatch.move(fromKey, toKey)
	}

	protected maskAccountIdPatch(key: string, value: string | number) {
		const stageAccountIds = this.getStageAccountIds()
		const accountIds = Object.keys(stageAccountIds)
		const aidFound = accountIds.find((aid) => String(value).includes(aid))
		if (!aidFound) return
		// mask account ids
		const envName = stageAccountIds[aidFound]
		const inter = interpolateValue(
			ActionsContext.SECRET,
			`AWS_ACCOUNT_ID_${envName.toUpperCase()}`,
		)
		const newValue = String(value).replaceAll(aidFound, inter)
		return ghpipelines.JsonPatch.replace(`/${key}`, newValue)
	}

	*iterPatches() {
		// @ts-expect-error - private property
		const workflowObj = this.workflowFile.obj as object
		const flatWorkflow: Record<string, string | number> = flat.flatten(
			workflowObj,
			{ delimiter: '/' },
		)
		for (const [key, value] of Object.entries(flatWorkflow)) {
			const patches: ghpipelines.JsonPatch[] = [
				this.stepsToSyncAssemblyPatch(key, value),
				this.moveAssetAuthenticationPatch(key, value),
				this.maskAccountIdPatch(key, value),
			].filter(Boolean) as ghpipelines.JsonPatch[]
			yield* patches
		}
	}
}
