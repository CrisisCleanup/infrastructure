import assert from 'node:assert'
import path from 'node:path'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import type { Stack, StackProps } from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
import * as cdkpipelines from 'aws-cdk-lib/pipelines'
import * as ghpipelines from 'cdk-pipelines-github'
import type { Construct } from 'constructs'

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

	githubWave(...waves: PipelineWave[]): GithubCodePipelineBuilder {
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

		void Promise.all(promises).then((stages) => {
			let currentWave: cdkpipelines.Wave | undefined

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
						currentWave = pipeline.addWave(stage.waveId, { ...waveProps.props })
					}
					currentWave.addStage(stages[i], stage.stageProps)
				} else {
					pipeline.addStage(stages[i], stage.stageProps)
				}
			}
		})
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

		const repoNames = props.repos ?? [
			'infrastructure',
			'configs',
			'crisiscleanup-3-api',
			'crisiscleanup-4-web',
		]
		const repos = repoNames.map((name) => [props.owner, name].join('/'))

		const creds = new ghpipelines.GitHubActionRole(
			scope,
			'github-action-role',
			{
				repos,
			},
		)

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

		const awsCreds = ghpipelines.AwsCredentials.fromOpenIdConnect({
			gitHubActionRoleArn:
				'arn:aws:iam::${{ secrets.AWS_PIPELINE_ACCOUNT_ID }}:role/GithubActionsRole',
			roleSessionName: 'gh-actions-infrastructure',
		})

		return new ghpipelines.GitHubWorkflow(scope, props.name, {
			awsCreds,
			synth,
			publishAssetsAuthRegion: 'us-east-1',
			workflowPath: props.rootDir
				? path.join(props.rootDir, '.github', 'workflows', 'deploy.yml')
				: undefined,
		})
	}
}
