import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type Environment,
	type IAnyProducer,
	type IResolveContext,
	Lazy,
	type StackProps,
} from 'aws-cdk-lib'
import { type Construct } from 'constructs'
import { buildKarpenter } from './cluster'

export interface PipelineProps {
	readonly id: string
	readonly connectionArn: string
}

export interface PipelineTarget {
	readonly name: string
	readonly environment: Environment
	readonly stackBuilder: blueprints.BlueprintBuilder
	readonly platformTeam: blueprints.PlatformTeam
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

function lazyClusterInfo<T>(
	fn: (context: IResolveContext, clusterInfo: blueprints.ClusterInfo) => T,
): IAnyProducer {
	let value: T | undefined = undefined
	return {
		produce(context: IResolveContext): T {
			if (value) return value
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			const clusterInfo: blueprints.ClusterInfo =
				// @ts-ignore
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
				context.scope.node.host.stack.clusterInfo
			value = fn(context, clusterInfo)
			return value
		},
	}
}

export class Pipeline {
	static builder(props: PipelineProps): Pipeline {
		const pipe = blueprints.CodePipelineStack.builder()
			.application('npx tsx src/main.ts')
			.name('crisiscleanup-infra-pipeline')
			.owner('crisiscleanup')
			.codeBuildPolicies(blueprints.DEFAULT_BUILD_POLICIES)
			.enableCrossAccountKeys()
			.repository({
				repoUrl: 'infrastructure',
				targetRevision: 'main',
				codeStarConnectionArn: props.connectionArn,
			})
		return new Pipeline(props, pipe)
	}

	protected constructor(
		readonly props: PipelineProps,
		readonly pipeline: blueprints.CodePipelineBuilder,
	) {}

	target(target: PipelineTarget): this {
		const { name, environment, stackBuilder, platformTeam } = target
		const env = PipelineEnv.fromEnv(environment, name)
		const envStackBuilder = stackBuilder
			.clone(env.region, env.account)
			.teams(platformTeam)
			.name(this.props.id)
			.addOns(
				buildKarpenter(
					Lazy.uncachedString(
						lazyClusterInfo(
							(_, clusterInfo) => clusterInfo.cluster.clusterName,
						),
					),
					Lazy.uncachedString(
						lazyClusterInfo((_, clusterInfo) =>
							clusterInfo.cluster.vpc.privateSubnets
								.map((subnet) => subnet.node.path)
								.join(','),
						),
					),
				),
			)
		this.pipeline.wave({
			id: name,
			stages: [
				{
					id: env.id,
					stackBuilder: envStackBuilder,
				},
			],
		})
		return this
	}

	async build(scope: Construct, props?: StackProps) {
		const pipe = this.pipeline.build(
			scope,
			'crisiscleanup-infra-pipeline-stack',
			props,
		)

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

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		pipe.node.tryFindChild(
			'crisiscleanup-infra-pipeline',
			// @ts-ignore
		)!.synth.installCommands = [
			'n stable',
			...sopsInstall,
			...helmInstall,
			'npm install -g pnpm aws-cdk@2.88.0',
			'pnpm install',
		]

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		pipe.node.tryFindChild(
			'crisiscleanup-infra-pipeline',
			// @ts-ignore
		)!.synth.commands = [
			'pnpm post-compile',
			"pnpm -F 'stacks.api' run synth",
			'cp -r packages/stacks/api/cdk.out ./cdk.out',
		]

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		pipe.node.tryFindChild(
			'crisiscleanup-infra-pipeline',
			// @ts-ignore
		)!.synth.env.GIGET_AUTH = await blueprints.utils.getSecretValue(
			'github-token',
			'us-east-1',
		)
		return pipe
	}
}
