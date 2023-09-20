import { getConfig } from '@crisiscleanup/config'
import {
	GithubCodePipeline,
	interpolateValue,
	ActionsContext,
} from '@crisiscleanup/construct.awscdk.github-pipeline'
import { App } from 'aws-cdk-lib'
import { GitHubStage, type GitHubStageProps } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { CrisisCleanupWeb } from './web'

const { config, cwd } = await getConfig({
	strict: true,
	useEnvOverrides: true,
	decrypt: true,
})

const app = new App()

interface CrisisCleanupWebStageProps {
	/**
	 * Domain name.
	 */
	domain: string
	/**
	 * App fqdn.
	 */
	fqdn: string
}

class CrisisCleanupWebStage extends GitHubStage {
	constructor(
		scope: Construct,
		id: string,
		props: CrisisCleanupWebStageProps,
		stageProps: GitHubStageProps,
	) {
		super(scope, id, stageProps)
		const source = process.env.CCU_WEB_SITE_SOURCE
		const domain = props.domain ?? process.env.CCU_WEB_SITE_DOMAIN
		if (!source) throw new Error('CCU_WEB_SITE_SOURCE is required')
		if (!domain) throw new Error('CCU_WEB_SITE_DOMAIN is required')
		new CrisisCleanupWeb(
			this,
			'crisiscleanup-web',
			{
				source: source,
				domainName: domain,
				fqdn: props.fqdn,
			},
			{
				env: config.cdkEnvironment,
				description: 'CrisisCleanup Web',
				stackName: 'crisiscleanup-web',
			},
		)
	}
}

const pipeline = GithubCodePipeline.create({
	rootDir: cwd!,
	assetsS3Bucket: 'crisiscleanup-pipeline-assets',
	assetsS3Prefix: 'crisiscleanup-web',
	workflowName: 'Deploy CrisisCleanup Site',
})
	.addConfigsEnv()
	.addNxEnv()
	.synthCheckout({
		ref: 'master',
		repository: 'CrisisCleanup/crisiscleanup-4-web',
	})
	.addSynthEnv({
		CCU_CONFIGS_DECRYPT: 'true',
		CCU_WEB_SITE_SOURCE:
			interpolateValue(ActionsContext.GITHUB, 'workspace') + '/dist',
	})
	.synthTarget({
		packageName: 'stacks.web',
		workingDirectory: 'packages/stacks/web',
	})
	.defaultTools()
	.clone({
		workflowTriggers: {},
	})
	.build(app)
	.onWorkflowCall()
	.onWorkflowDispatch()
	.concurrency({ group: 'deploy-web', cancelInProgress: false })

pipeline.addStage(
	new CrisisCleanupWebStage(
		app,
		'development',
		{
			domain: 'dev.crisiscleanup.io',
			fqdn: 'app.dev.crisiscleanup.io',
		},
		{ env: config.$env!.development!.cdkEnvironment },
	),
)
pipeline.addStage(
	new CrisisCleanupWebStage(
		app,
		'staging',
		{
			domain: 'staging.crisiscleanup.io',
			fqdn: 'app.staging.crisiscleanup.io',
		},
		{
			env: config.$env!.staging!.cdkEnvironment,
		},
	),
)
pipeline.addStage(
	new CrisisCleanupWebStage(
		app,
		'production',
		{
			domain: 'crisiscleanup.org',
			fqdn: 'crisiscleanup.org',
		},
		{
			env: config.$env!.production!.cdkEnvironment,
		},
	),
)

app.synth()
