import { KubectlV27Layer } from '@aws-cdk/lambda-layer-kubectl-v27'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CdkEnvironment,
	type CrisisCleanupConfig,
} from '@crisiscleanup/config'
import type { Environment, Stack, StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import { type GitHubEnvironment, StackCapabilities } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { CrisisCleanupAddOn } from './addons'
import {
	buildClusterBuilder,
	buildKarpenter,
	getCoreAddons,
	getDefaultAddons,
	ResourceNames,
} from './cluster'
import { type GithubCodePipelineBuilder, GithubCodePipelineStack } from './gh'
import { NetworkStack, DataStack, CacheStack } from './stacks'

export interface PipelineProps {
	readonly id: string
	readonly rootDir?: string
}

export interface PipelineTarget {
	readonly name: string
	readonly environment?: Environment
	readonly stackBuilder: blueprints.BlueprintBuilder
	readonly clusterBuilder?: blueprints.ClusterBuilder
	readonly platformTeam?: blueprints.PlatformTeam
	readonly githubEnvironment?: GitHubEnvironment
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
			clusterBuilder,
			platformTeam,
			githubEnvironment,
			config,
			secretsProvider,
		} = target
		const env = PipelineEnv.fromEnv(environment ?? config.cdkEnvironment, name)
		const envStackBuilder = stackBuilder
			.clone(env.region, env.account)
			.resourceProvider(
				blueprints.GlobalResources.KmsKey,
				new blueprints.CreateKmsKeyProvider('cluster-key'),
			)
			.resourceProvider(ResourceNames.KUBE_LAYER, {
				provide: (ctx) => new KubectlV27Layer(ctx.scope, 'kubectllayer27'),
			})
			.resourceProvider(
				ResourceNames.EBS_KEY,
				new blueprints.CreateKmsKeyProvider('ebs-csi-key'),
			)
			.addOns(
				...getDefaultAddons(config.apiStack!.eks),
				...getCoreAddons(config.apiStack!.eks),
			)
			.teams(
				platformTeam ??
					new blueprints.PlatformTeam({
						name: 'platform',
						users: config.apiStack!.eks.platformArns.map(
							(arn) => new iam.ArnPrincipal(arn),
						),
					}),
			)

		const stageStackBuilder: blueprints.AsyncStackBuilder = {
			build(
				scope: Construct,
				id: string,
				stackProps?: StackProps,
			): blueprints.EksBlueprint {
				const network = new NetworkStack(
					scope,
					env.id + '-network',
					config.apiStack!.network,
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
						clusterProps: config.apiStack!.database,
					},
					{
						env: env.env,
						...stackProps,
					},
				)

				if (config.apiStack!.cache.enabled) {
					new CacheStack(
						scope,
						env.id + '-cache',
						{
							vpc: network.vpc,
							...config.apiStack!.cache,
						},
						{ env: env.env, ...stackProps },
					)
				}

				return envStackBuilder
					.resourceProvider(
						blueprints.GlobalResources.Vpc,
						new blueprints.DirectVpcProvider(network.vpc),
					)
					.resourceProvider(ResourceNames.DATABASE_SECRET, {
						provide: () => data.dbCluster.cluster.secret!,
					})
					.resourceProvider(ResourceNames.DATABASE_KEY, {
						provide: () => data.encryptionKey,
					})
					.clusterProvider(
						(
							clusterBuilder ??
							buildClusterBuilder(config.apiStack!.eks.k8s.version)
						).build(),
					)
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
			async buildAsync(
				scope: Construct,
				id: string,
				stackProps?: StackProps,
			): Promise<Stack> {
				const stack = this.build(
					scope,
					id,
					stackProps,
				) as blueprints.EksBlueprint
				return stack.waitForAsyncTasks()
			},
		}

		this.pipeline.githubWave({
			id: 'deploy',
			stages: [
				{
					id: name,
					stackBuilder: stageStackBuilder,
					stageProps: {
						jobSettings: {
							if: `contains((github.event.inputs.environments || inputs.environments), '${name}')`,
						},
						gitHubEnvironment: githubEnvironment ?? {
							name: config.ccuStage,
							url: config.api.config.ccu.webUrl,
						},
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
