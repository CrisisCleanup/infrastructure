import { getConfig } from '@crisiscleanup/config'
import {
	GithubCodePipeline,
	interpolateValue,
	ActionsContext,
} from '@crisiscleanup/construct.awscdk.github-pipeline'
import { App } from 'aws-cdk-lib'
import { GitHubStage, type GitHubStageProps } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { MaintenanceSite } from './maintenance-site'

const { config, cwd } = await getConfig({
	strict: true,
	useEnvOverrides: true,
	decrypt: false,
})

const app = new App()

class MaintenanceStage extends GitHubStage {
	constructor(scope: Construct, id: string, props: GitHubStageProps) {
		super(scope, id, props)
		const source = process.env.MAINTENANCE_SITE_SOURCE
		if (!source) throw new Error('MAINTENANCE_SITE_SOURCE is required')
		new MaintenanceSite(
			this,
			'maintenance-site',
			{
				source: source,
			},
			{
				env: config.cdkEnvironment,
				description: 'Maintenance Site',
				stackName: 'maintenance-site',
			},
		)
	}
}

GithubCodePipeline.create({
	rootDir: cwd!,
	assetsS3Bucket: 'crisiscleanup-pipeline-assets',
	assetsS3Prefix: 'maintenance-site',
	workflowName: 'Deploy Maintenance Site',
})
	.addConfigsEnv()
	.addNxEnv()
	.synthCheckout({
		ref: 'master',
		repository: 'CrisisCleanup/maintenance-site',
		path: '.maintenance-site',
	})
	.addSynthEnv({
		CCU_CONFIGS_DECRYPT: 'false',
		MAINTENANCE_SITE_SOURCE:
			interpolateValue(ActionsContext.GITHUB, 'workspace') +
			'/.maintenance-site',
	})
	.synthTarget({
		packageName: 'stacks.maintenance-site',
		workingDirectory: 'packages/stacks/maintenance-site',
	})
	.clone({
		workflowTriggers: {},
	})
	.build(app)
	.onWorkflowCall()
	.onWorkflowDispatch()
	.addStage(
		new MaintenanceStage(app, 'pipeline', { env: config.cdkEnvironment }),
	)

app.synth()
