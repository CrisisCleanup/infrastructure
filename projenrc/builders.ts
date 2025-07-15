import {
	type BuildOptions,
	type BuildOutput,
	type BuildStep,
	BaseBuildStep,
	type TypedPropertyDescriptorMap,
} from '@arroyodev-llc/utils.projen-builder'
import { type awscdk, type ProjectOptions } from 'projen'

export class CdkTsAppCompileBuilder extends BaseBuildStep<{
	synthPostCompileCondition?: string
}> {
	constructor(private options?: { synthPostCompileCondition?: string }) {
		super()
	}

	applyOptions(
		options: ProjectOptions & BuildOptions<this>,
	): ProjectOptions & BuildOptions<this> {
		return options
	}

	applyProject(
		project: awscdk.AwsCdkTypeScriptApp,
	): TypedPropertyDescriptorMap<BuildOutput<BuildStep>> {
		project.addGitIgnore('cdk.context.json')
		// Add tsx as a dev dependency since we're using it for CDK execution
		project.addDevDeps('tsx@^3.14.0')
		project.cdkConfig.json.addOverride(
			'app',
			`node --import tsx/esm src/main.ts`,
		)
		const postCompile = project.tasks.tryFind('post-compile')!
		postCompile.reset()
		postCompile.spawn(project.tasks.tryFind('synth:silent')!, {
			condition:
				this.options?.synthPostCompileCondition ??
				`bash -c '[[ -z "$SKIP_SYNTH" ]]'`,
		})
		return {} as TypedPropertyDescriptorMap<BuildOutput<BuildStep>>
	}
}
