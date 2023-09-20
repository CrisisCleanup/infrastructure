import assert from 'node:assert'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	GithubCodePipeline,
	type GithubWorkflowPipeline,
} from '@crisiscleanup/construct.awscdk.github-pipeline'
import type { Stack, StackProps } from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as ghpipelines from 'cdk-pipelines-github'
import type { Construct } from 'constructs'

export interface GithubPipelineProps {
	repos?: string[]
	rootDir?: string
	owner?: string
}

export interface GithubCodePipelineProps
	extends Omit<blueprints.PipelineProps, 'repository'>,
		GithubPipelineProps {}

export interface StackStage extends blueprints.StackStage {
	stageProps?: ghpipelines.AddGitHubStageOptions
}

export interface PipelineWave extends blueprints.PipelineWave {
	stages: StackStage[]
}

/**
 * Extension of {@link @aws-quickstart/eks-blueprints#CodePipeline} for integration with {@link cdk-pipelines-github}
 */
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
		const fullProps = this.props as unknown as GithubCodePipelineProps
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
		this.githubProps.repos = Array.from(new Set([...current, ...repos]))
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

/**
 * Adapted from {@link @aws-quickstart/eks-blueprints#CodePipelineStack} for integration with {@link cdk-pipelines-github}
 * @see https://github.com/aws-quickstart/cdk-eks-blueprints/blob/main/lib/pipelines/code-pipeline.ts
 */
export class GithubCodePipelineStack extends cdk.Stack {
	static builder(): GithubCodePipelineBuilder {
		return new GithubCodePipelineBuilder()
	}

	private asyncTask: Promise<GithubWorkflowPipeline>

	constructor(
		scope: Construct,
		pipelineProps: GithubCodePipelineProps,
		id: string,
		props?: StackProps,
	) {
		super(scope, id, props)

		const pipeline = PipelineBuilder.build(this, pipelineProps)

		const promises: Promise<ApplicationStage>[] = []

		for (const stage of pipelineProps.stages) {
			const appStage = new ApplicationStage(this, stage.id, stage.stackBuilder)
			promises.push(appStage.waitForAsyncTasks())
		}

		this.asyncTask = Promise.all(promises)
			.then((stages) => {
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
						pipeline.addStageWithGitHubOptions(stages[i], stage.stageProps)
					}
				}
			})
			.catch(console.error)
			.then(() => pipeline)
	}

	async waitForAsyncTasks(): Promise<GithubWorkflowPipeline> {
		const pipeline = await this.asyncTask
		return pipeline
	}
}

/**
 * Adaption of {@link @aws-quickstart/eks-blueprints#ApplicationStage} for integration with {@link cdk-pipelines-github}.
 * @see https://github.com/aws-quickstart/cdk-eks-blueprints/blob/main/lib/pipelines/code-pipeline.ts
 */
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

class PipelineBuilder {
	static build(scope: Construct, props: GithubCodePipelineProps) {
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
		pipelineS3.addLifecycleRule({
			id: 'cleanup-build-stale-cache',
			enabled: true,
			expiration: cdk.Duration.days(30),
			abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
			prefix: 'build-cache',
		})

		const pipelineKms = new kms.Key(scope, 'pipeline-kms', {
			alias: 'pipeline-key',
		})
		pipelineKms.grantDecrypt(actionsRole.role)

		return GithubCodePipeline.create({
			rootDir: props.rootDir!,
			workflowName: 'Deploy',
			assetsS3Bucket: pipelineS3BucketName,
		})
			.addNxEnv()
			.addConfigsEnv()
			.synthTarget({
				packageName: 'stacks.api',
				workingDirectory: 'packages/stacks/api',
			})
			.defaultTools()
			.clone({ workflowTriggers: {} })
			.build(scope, props.name)
			.onWorkflowCall({
				runner: {
					type: 'string',
					default: 'ubuntu-latest',
					description: 'Runner to use.',
					required: false,
				},
				environments: {
					type: 'string',
					description: 'Environments to deploy.',
					default: 'development,staging',
					required: false,
				},
			})
			.onWorkflowDispatch({
				runner: {
					type: 'choice',
					description: 'Runner to use.',
					options: ['ubuntu-latest', 'self-hosted'],
					default: 'ubuntu-latest',
				},
				environments: {
					type: 'choice',
					description: 'Environments to deploy.',
					options: [
						'development',
						'staging',
						'production',
						'development,staging',
						'development,staging,production',
					],
					default: 'development,staging',
				},
			})
			.concurrency({
				group: 'deploy-infra',
				cancelInProgress: false,
			})
	}
}
