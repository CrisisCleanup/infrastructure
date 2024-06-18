import { getConfig } from '@crisiscleanup/config'
import {
	ActionsContext,
	GithubCodePipeline,
	interpolateValue,
} from '@crisiscleanup/construct.awscdk.github-pipeline'
import { App } from 'aws-cdk-lib'
import { MaintenanceStage } from './stages'

const { config, cwd } = await getConfig({
	strict: true,
	useEnvOverrides: true,
	decrypt: false,
})

const app = new App()

// general maintenance
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
	.defaultTools()
	.clone({
		workflowTriggers: {},
	})
	.build(app)
	.onWorkflowCall()
	.onWorkflowDispatch()
	.concurrency({ group: 'deploy-maintenance', cancelInProgress: false })
	.addStage(
		new MaintenanceStage(app, 'pipeline', { env: config.cdkEnvironment }),
	)

// au offline
GithubCodePipeline.create({
	rootDir: cwd!,
	assetsS3Bucket: 'crisiscleanup-pipeline-assets',
	assetsS3Prefix: 'au-offline-site',
	workflowName: 'Deploy AU Offline Site',
})
	.addConfigsEnv()
	.addNxEnv()
	.synthCheckout({
		ref: 'master',
		repository: 'CrisisCleanup/au-offline-site',
		path: '.au-offline-site',
	})
	.addSynthEnv({
		CCU_CONFIGS_DECRYPT: 'false',
		MAINTENANCE_SITE_SOURCE:
			interpolateValue(ActionsContext.GITHUB, 'workspace') +
			'/.au-offline-site',
	})
	.synthTarget({
		packageName: 'stacks.maintenance-site',
		workingDirectory: 'packages/stacks/maintenance-site',
	})
	.defaultTools()
	.clone({
		workflowTriggers: {},
	})
	.build(app)
	.onWorkflowCall()
	.onWorkflowDispatch()
	.concurrency({ group: 'deploy-offline-au', cancelInProgress: false })
	.addStage(
		new MaintenanceStage(app, 'au-offline-pipeline', {
			env: config.$env!['production-au']!,
		}),
	)

app.synth()
