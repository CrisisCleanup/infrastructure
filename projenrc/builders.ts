import {
	type BuildOptions,
	type BuildOutput,
	type BuildStep,
	BaseBuildStep,
	type TypedPropertyDescriptorMap,
} from '@arroyodev-llc/utils.projen-builder'
import { NodePackageUtils } from '@aws/pdk/monorepo'
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
		project.cdkConfig.json.addOverride(
			'app',
			NodePackageUtils.command.exec(
				project.package.packageManager,
				'node',
				'--import',
				'tsx/esm',
				'src/main.ts',
			),
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
