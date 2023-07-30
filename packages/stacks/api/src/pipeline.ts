import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type Environment, type StackProps } from 'aws-cdk-lib'
import { type Construct } from 'constructs'

export interface PipelineProps {
	readonly pipelineEnv: Environment
	readonly devEnv: Environment
	readonly stagingEnv: Environment
	readonly prodEnv: Environment

	readonly connectionArn: string

	readonly devStack: blueprints.BlueprintBuilder
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
	readonly props: PipelineProps

	constructor(props: PipelineProps) {
		this.props = props
	}

	async build(scope: Construct, id: string, props?: StackProps) {
		const devEnv = PipelineEnv.fromEnv(this.props.devEnv, id + '-development')
		// const stagingEnv = PipelineEnv.fromEnv(this.props.devEnv, 'staging')
		// const prodEnv = PipelineEnv.fromEnv(this.props.devEnv, 'production')

		const pipe = blueprints.CodePipelineStack.builder()
			.application('npx tsx src/main.ts')
			.name('crisiscleanup-infra-pipeline')
			.owner('crisiscleanup')
			.codeBuildPolicies(blueprints.DEFAULT_BUILD_POLICIES)
			.enableCrossAccountKeys()
			.repository({
				repoUrl: 'infrastructure',
				targetRevision: 'main',
				codeStarConnectionArn:
					'arn:aws:codestar-connections:us-east-1:971613762022:connection/fa675d04-034e-445d-8918-5e4cf2ca8899',
			})
			.stage({
				id: 'development',
				stackBuilder: this.props.devStack
					.clone(devEnv.region, devEnv.account)
					.name(devEnv.id),
			})
			// .wave({
			// 	id: 'dev',
			// 	stages: [
			// 		{
			// 			id: devEnv.id,
			// 			stackBuilder: this.props.devStack
			// 				.clone(devEnv.region, devEnv.account)
			// 				.name(devEnv.id),
			// 		},
			// 	],
			// })
			// .wave({
			// 	id: 'staging',
			// 	stages: [
			// 		{
			// 			id: stagingEnv.id,
			// 			stackBuilder: this.props.devStack
			// 				.clone(devEnv.region, devEnv.account)
			// 				.name(stagingEnv.id),
			// 		},
			// 	],
			// })
			// .wave({
			// 	id: 'prod',
			// 	stages: [
			// 		{
			// 			id: prodEnv.id,
			// 			stackBuilder: this.props.devStack
			// 				.clone(prodEnv.region, prodEnv.account)
			// 				.name(prodEnv.id),
			// 		},
			// 	],
			// })
			.build(scope, 'crisiscleanup-infra-pipeline-stack', props)

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		pipe.node.tryFindChild(
			'crisiscleanup-infra-pipeline',
			// @ts-ignore
		)!.synth.installCommands = [
			'n stable',
			'npm install -g pnpm aws-cdk@2.88.0',
			'pnpm install',
		]

		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		pipe.node.tryFindChild(
			'crisiscleanup-infra-pipeline',
			// @ts-ignore
		)!.synth.commands = [
			'pnpm build',
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
	}
}
