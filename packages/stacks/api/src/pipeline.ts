import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CdkEnvironment,
	type CrisisCleanupConfig,
} from '@crisiscleanup/config'
import type { Environment, Stack, StackProps } from 'aws-cdk-lib'
import { type GitHubEnvironment, StackCapabilities } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { CrisisCleanupAddOn } from './addons'
import { buildKarpenter, ResourceNames } from './cluster'
import { type GithubCodePipelineBuilder, GithubCodePipelineStack } from './gh'
import { NetworkStack, DataStack } from './stacks'

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
	readonly config: CrisisCleanupConfig
	readonly secretsProvider: blueprints.SecretProvider
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

	get env(): CdkEnvironment {
		return { account: this.account, region: this.region }
	}
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
		const {
			name,
			environment,
			stackBuilder,
			platformTeam,
			githubEnvironment,
			config,
			secretsProvider,
		} = target
		const env = PipelineEnv.fromEnv(environment, name)
		const envStackBuilder = stackBuilder
			.clone(env.region, env.account)
			.teams(platformTeam)
			.name(this.props.id)

		this.pipeline.githubWave({
			id: name,
			stages: [
				{
					id: name,
					stackBuilder: {
						build(
							scope: Construct,
							id: string,
							stackProps?: StackProps,
						): Stack {
							const network = new NetworkStack(
								scope,
								env.id + '-network',
								config.apiStack.network,
								{
									env: env.env,
									...stackProps,
								},
							)
							const data = new DataStack(
								scope,
								env.id + '-data',
								{
									vpc: network.vpc,
									clusterProps: config.apiStack.database,
								},
								{
									env: env.env,
									...stackProps,
								},
							)
							return envStackBuilder
								.resourceProvider(
									blueprints.GlobalResources.Vpc,
									new blueprints.DirectVpcProvider(network.vpc),
								)
								.resourceProvider(ResourceNames.DATABASE_SECRET, {
									provide: () => data.credentialsSecret,
								})
								.resourceProvider(ResourceNames.DATABASE_KEY, {
									provide: () => data.encryptionKey,
								})
								.addOns(
									buildKarpenter(),
									new CrisisCleanupAddOn({
										config,
										secretsProvider,
										databaseResourceName: ResourceNames.DATABASE,
										databaseSecretResourceName: ResourceNames.DATABASE_SECRET,
									}),
								)
								.build(scope, id, stackProps)
						},
					},
					stageProps: {
						gitHubEnvironment: githubEnvironment,
						stackCapabilities: [
							StackCapabilities.IAM,
							StackCapabilities.NAMED_IAM,
						],
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
