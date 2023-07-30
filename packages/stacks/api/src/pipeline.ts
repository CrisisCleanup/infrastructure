import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type Environment, type StackProps } from 'aws-cdk-lib'
import { type Construct } from 'constructs'

export interface PipelineProps {
	readonly pipelineEnv: Environment
	readonly devEnv: Environment
	readonly stagingEnv: Environment
	readonly prodEnv: Environment

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

	build(scope: Construct, id: string, props?: StackProps) {
		const devEnv = PipelineEnv.fromEnv(this.props.devEnv, id + '-development')
		// const stagingEnv = PipelineEnv.fromEnv(this.props.devEnv, 'staging')
		// const prodEnv = PipelineEnv.fromEnv(this.props.devEnv, 'production')

		blueprints.CodePipelineStack.builder()
			.application('npx tsx src/main.ts')
			.name('crisiscleanup-infra-pipeline')
			.owner('crisiscleanup')
			.codeBuildPolicies(blueprints.DEFAULT_BUILD_POLICIES)
			.enableCrossAccountKeys()
			.repository({
				repoUrl: 'infrastructure',
				credentialsSecretName: 'github-token',
				path: 'packages/api/stacks',
				targetRevision: 'main',
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
	}
}
