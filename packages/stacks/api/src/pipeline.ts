import { KubectlV27Layer } from '@aws-cdk/lambda-layer-kubectl-v27'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CdkEnvironment,
	type CrisisCleanupConfig,
} from '@crisiscleanup/config'
import { PDFRendererFunction } from '@crisiscleanup/construct.awscdk.pdf-renderer'
import {
	NestedStack,
	type Environment,
	type NestedStackProps,
	Stack,
	type StackProps,
	Duration,
} from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'

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
import { CacheStack, DataStack, NetworkStack } from './stacks'
import { DelegatorZoneStack } from './stacks/zones'

export interface PipelineProps {
	readonly id: string
	readonly rootDir?: string
	readonly repos?: string[]
	readonly pipelineEnvironment: Environment
}

export interface PipelineTarget {
	readonly name: string
	readonly environment?: Environment
	readonly stackBuilder: (
		builder: blueprints.BlueprintBuilder,
		builderConfig: CrisisCleanupConfig,
	) => blueprints.BlueprintBuilder
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
			.githubRepo(...(props.repos ?? ['infrastructure']))
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
		const pipelineEnv = PipelineEnv.fromEnv(
			this.props.pipelineEnvironment,
			'pipeline',
		)
		const env = PipelineEnv.fromEnv(environment ?? config.cdkEnvironment, name)
		const envStackBuilder = stackBuilder(
			blueprints.EksBlueprint.builder()
				.clone(env.region, env.account)
				.resourceProvider(
					blueprints.GlobalResources.KmsKey,
					new blueprints.CreateKmsKeyProvider('cluster-key'),
				)
				.resourceProvider(ResourceNames.KUBE_LAYER, {
					provide: (ctx) => new KubectlV27Layer(ctx.scope, 'kubectllayer-27'),
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
				),
			config,
		)

		const stageStackBuilder: blueprints.AsyncStackBuilder = {
			build(
				scope: Construct,
				id: string,
				stackProps?: StackProps,
			): blueprints.EksBlueprint {
				// TODO: this is getting messy. refactor soon
				const delegatorZone = new DelegatorZoneStack(
					scope,
					env.id + '-delegator-zone',
					{
						delegateAccountId: env.account,
						zoneName:
							env.id === 'production'
								? 'crisiscleanup.org'
								: 'crisiscleanup.io',
						roleName: 'CrossAccountZoneDelegationRole-' + env.id,
					},
					{
						env: pipelineEnv.env,
					},
				)
				const delegateZoneStack = new Stack(scope, env.id + '-delegate-zone', {
					env: env.env,
				})
				const subdomains = {
					production: 'crisiscleanup.org',
					staging: 'staging.crisiscleanup.io',
					development: 'dev.crisiscleanup.io',
					'production-au': 'au.crisiscleanup.io',
				}
				const subZoneDomain = subdomains[env.id as keyof typeof subdomains]
				const subZone = delegatorZone.delegate(
					delegateZoneStack,
					subZoneDomain + '-delegate-zone',
					{
						subdomain: subZoneDomain,
					},
				)

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
				data.bastion.createDnsRecord(subZone)

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
						new blueprints.NestedStackAddOn({
							id: 'pdf-renderer',
							builder: {
								build(
									nestedScope: Construct,
									nestedId: string,
									nestedStackProps?: NestedStackProps,
								): NestedStack {
									const nestedStack = new NestedStack(
										nestedScope,
										nestedId + '-pdf-renderer',
										nestedStackProps,
									)
									const pdfRendererFunction = new PDFRendererFunction(
										nestedStack,
										nestedId + '-function',
										{
											// vpc: blueprints.getNamedResource(
											// 	blueprints.GlobalResources.Vpc,
											// ),
											timeout: Duration.seconds(28),
											memorySize: 3000,
											layers: [
												lambda.LayerVersion.fromLayerVersionArn(
													nestedStack,
													id + '-chrome-layer',
													'arn:aws:lambda:us-east-1:764866452798:layer:chrome-aws-lambda:33',
												),
											],
										},
									)

									const api = new apigateway.RestApi(nestedStack, 'PdfApi', {
										restApiName: 'CCU PDF Service',
										description: 'API Service to generate PDFs.',
										binaryMediaTypes: ['application/pdf'],
									})

									const renderResource = api.root.addResource('render')
									const integration = new apigateway.LambdaIntegration(
										pdfRendererFunction,
									)
									renderResource.addMethod('POST', integration)

									return nestedStack
								},
							},
						}),
						buildKarpenter(
							undefined,
							undefined,
							config.apiStack!.eks.instanceTypes ?? undefined,
						),
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
