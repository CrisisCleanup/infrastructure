import type * as blueprints from '@aws-quickstart/eks-blueprints'
import type { Environment, StackProps } from 'aws-cdk-lib'
import type { GitHubEnvironment } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { GithubCodePipelineStack, type GithubCodePipelineBuilder } from './gh'

export interface PipelineProps {
	readonly id: string
	readonly connectionArn: string
	readonly rootDir?: string
}

export interface PipelineTarget {
	readonly name: string
	readonly environment: Environment
	readonly stackBuilder: blueprints.BlueprintBuilder
	readonly platformTeam: blueprints.PlatformTeam
	readonly githubEnvironment: GitHubEnvironment
}

class PipelineEnv implements Environment {
	static fromEnv(env: Environment, name: string) {
		return new this(String(env.account!), env.region!, name)
	}

	protected constructor(
		readonly account: string,
		readonly region: string,
		readonly id: string,
	) {}
}

export class Pipeline {
	static builder(props: PipelineProps): Pipeline {
		const pipe = GithubCodePipelineStack.builder()
			.owner('CrisisCleanup')
			.githubRepo(
				'infrastructure',
				'crisiscleanup-3-api',
				'crisiscleanup-4-web',
				'configs',
			)
			.rootDir(props.rootDir ?? process.cwd())
			.application('pnpm tsx src/main.ts')
			.name('crisiscleanup-infra-pipeline')
		return new Pipeline(props, pipe as GithubCodePipelineBuilder)
	}

	protected constructor(
		readonly props: PipelineProps,
		readonly pipeline: GithubCodePipelineBuilder,
	) {}

	target(target: PipelineTarget): this {
		const { name, environment, stackBuilder, platformTeam, githubEnvironment } =
			target
		const env = PipelineEnv.fromEnv(environment, name)
		const envStackBuilder = stackBuilder
			.clone(env.region, env.account)
			.teams(platformTeam)
			.name(this.props.id)
		this.pipeline.githubWave({
			id: name,
			stages: [
				{
					id: env.id,
					stackBuilder: envStackBuilder,
					stageProps: {
						gitHubEnvironment: githubEnvironment,
					},
				},
			],
		})
		return this
	}

	build(scope: Construct, props?: StackProps) {
		const pipe = this.pipeline.build(
			scope,
			'crisiscleanup-infra-pipeline-stack',
			props,
		)

		return pipe
	}
}
