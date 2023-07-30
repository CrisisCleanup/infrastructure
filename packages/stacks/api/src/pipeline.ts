import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type Environment, type StackProps } from 'aws-cdk-lib'
import { type Construct } from 'constructs'

export interface PipelineProps {
	readonly id: string
	readonly connectionArn: string
}

export interface PipelineTarget {
	readonly name: string
	readonly environment: Environment
	readonly stackBuilder: blueprints.BlueprintBuilder
}

class PipelineEnv implements Environment {
	static fromEnv(env: Environment, name: string) {
		return new this(
			String(env.account!),
			env.region!,
			`${name}-${env.account!}-${env.region!}`,
		)
	}

	protected constructor(
		readonly account: string,
		readonly region: string,
		readonly id: string,
	) {}
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
		const { name, environment, stackBuilder } = target
		const env = PipelineEnv.fromEnv(environment, `${this.props.id}-${name}`)
		const envStackBuilder = stackBuilder
			.clone(env.region, env.account)
			.name(env.id)
		this.pipeline.stage({
			id: name,
			stackBuilder: envStackBuilder,
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
