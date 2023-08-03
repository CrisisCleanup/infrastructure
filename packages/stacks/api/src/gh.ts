import assert from 'node:assert'
import path from 'node:path'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import type { Stack, StackProps } from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
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

		new ghpipelines.GitHubActionRole(scope, 'github-action-role', {
			repos: props.repos ?? [],
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
			'arn:aws:iam::${{secrets.AWS_PIPELINE_ACCOUNT_ID}}:role/GithubActionRole'
		const awsCreds = ghpipelines.AwsCredentials.fromOpenIdConnect({
			gitHubActionRoleArn: actionsRoleArn,
		})

		const workflow = new ghpipelines.GitHubWorkflow(scope, props.name, {
			awsCreds,
			synth,
			publishAssetsAuthRegion: 'us-east-1',
			preBuildSteps: [...awsCreds.credentialSteps('us-east-1', actionsRoleArn)],
			workflowPath: props.rootDir
				? path.join(props.rootDir, '.github', 'workflows', 'deploy.yml')
				: undefined,
		})

		// nothing to see here...
		// just a gross hack to mask account ids (for what little its worth)...

		// @ts-ignore
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
		const jobForDeploy = workflow.jobForDeploy.bind(workflow)
		// @ts-ignore
		workflow.jobForDeploy = (node, stack, _captureOutputs) => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
			const account = String(stack.account)
			// stack.account = '${{secrets.DEV_ACCOUNT_ID}}'
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment
			const job = jobForDeploy(node, stack, _captureOutputs)
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
			const envName = job.definition.environment.name.toUpperCase()
			const accountSecretName = `secrets.AWS_ACCOUNT_ID_${envName as string}`
			const accountSecret = '${{' + accountSecretName + '}}'
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
			const flatDef: Record<string, string | number> = flat.flatten(
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				job.definition,
			)
			Object.keys(flatDef).forEach((key) => {
				const value = flatDef[key]
				if (typeof value === 'string' && value.includes(account)) {
					flatDef[key] = value.replaceAll(account, accountSecret)
				}
			})
			const newDef = flat.unflatten(flatDef)
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return { ...job, definition: newDef }
		}

		return workflow
	}
}
