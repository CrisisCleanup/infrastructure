import { getConfig } from '@crisiscleanup/config'
import {
	ActionsContext,
	GithubCodePipeline,
	interpolateObject,
	interpolateValue,
} from '@crisiscleanup/construct.awscdk.github-pipeline'
import { App } from 'aws-cdk-lib'
import { GitHubStage, type GitHubStageProps } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { CrisisCleanupWeb, type CrisisCleanupWebProps } from './web'

const { config, cwd } = await getConfig({
	strict: true,
	useEnvOverrides: true,
	decrypt: true,
})

const app = new App()

class CrisisCleanupWebStage extends GitHubStage {
	constructor(
		scope: Construct,
		id: string,
		props: Pick<CrisisCleanupWebProps, 'fqdn'> & Partial<CrisisCleanupWebProps>,
		stageProps: GitHubStageProps,
	) {
		super(scope, id, stageProps)
		const {
			domainName = process.env.CCU_WEB_SITE_DOMAIN,
			source = process.env.CCU_WEB_SITE_SOURCE,
			...rest
		} = props
		if (!source) throw new Error('CCU_WEB_SITE_SOURCE is required')
		if (!domainName) throw new Error('CCU_WEB_SITE_DOMAIN is required')
		if (!stageProps.env) throw new Error('Missing stage cdk environment!')
		new CrisisCleanupWeb(
			this,
			'crisiscleanup-web',
			{
				source,
				domainName,
				...rest,
			},
			{
				description: 'CrisisCleanup Web',
				stackName: 'crisiscleanup-web',
				env: stageProps.env,
			},
		)
	}
}

const webRoot =
	interpolateValue(ActionsContext.GITHUB, 'workspace') + '/.crisiscleanup-4-web'
const webDist = webRoot + '/dist'
const pipeline = GithubCodePipeline.create({
	rootDir: cwd!,
	assetsS3Bucket: 'crisiscleanup-pipeline-assets',
	assetsS3Prefix: 'crisiscleanup-web',
	workflowName: 'Deploy CrisisCleanup Site',
})
	.addConfigsEnv()
	.addNxEnv()
	.addSynthEnv({
		...interpolateObject(
			ActionsContext.VARS,
			'VITE_APP_API_BASE_URL',
			'VITE_APP_BASE_URL',
			'VITE_APP_WS_URL',
			'VITE_APP_AWS_CCP_URL',
			'VITE_APP_CCP_INSTANCE',
			'VITE_APP_STAGE',
			'VITE_APP_PORTAL_KEY',
			'VITE_APP_PHONE_DEFAULT_USERNAME',
			'VITE_APP_PHONE_DEFAULT_PASSWORD',
			'VITE_APP_ENGLISH_PHONE_GATEWAY',
			'VITE_APP_SPANISH_PHONE_GATEWAY',
			'VITE_APP_DEFAULT_CALLER_ID',
			'VITE_APP_CRISISCLEANUP_WEB_CLIENT_ID',
		),
		...interpolateObject(
			ActionsContext.SECRET,
			'VITE_APP_WHAT_3_WORDS_API_KEY',
			'VITE_APP_PITNEYBOWES_BASIC_AUTH_TOKEN',
			'VITE_APP_PITNEYBOWES_API_KEY',
			'VITE_APP_GOOGLE_TRANSLATE_API_KEY',
			'VITE_APP_GOOGLE_MAPS_API_KEY',
			'SENTRY_DSN',
		),
		CCU_CONFIGS_DECRYPT: 'true',
	})
	.synthPreStep({
		name: 'Build Web',
		workingDirectory: webRoot,
		env: interpolateObject(ActionsContext.VARS, 'NODE_ENV'),
		run: 'pnpm --ignore-workspace build:app',
	})
	.synthPreStep({
		name: 'Install Web',
		workingDirectory: webRoot,
		run: 'pnpm --ignore-workspace install',
	})
	.synthCheckout({
		ref: 'master',
		repository: 'CrisisCleanup/crisiscleanup-4-web',
		path: webRoot,
	})
	.synthTarget({
		packageName: 'stacks.web',
		workingDirectory: 'packages/stacks/web',
		commandEnv: {
			CCU_WEB_SITE_SOURCE: webDist,
		},
		environment: {
			name: interpolateValue(ActionsContext.INPUTS, 'environment'),
			url: interpolateValue(ActionsContext.VARS, 'VITE_APP_BASE_URL'),
		},
	})
	.defaultTools()
	.clone({
		workflowTriggers: {},
	})
	.build(app)
	.onWorkflowCall({
		environment: {
			type: 'string',
			description: 'Environment to deploy.',
			default: 'development',
		},
	})
	.concurrency({
		group:
			'deploy-web-' + interpolateValue(ActionsContext.INPUTS, 'environment'),
		cancelInProgress: false,
	})

const wave = pipeline.addGitHubWave('deploy')
wave.addStageWithGitHubOptions(
	new CrisisCleanupWebStage(
		app,
		'development',
		{
			domainName: 'dev.crisiscleanup.io',
			fqdn: 'app.dev.crisiscleanup.io',
		},
		{
			env: config.$env!.development!.cdkEnvironment,
			gitHubEnvironment: {
				name: 'development',
				url: 'https://app.dev.crisiscleanup.io',
			},
		},
	),
	{
		jobSettings: {
			if: `inputs.environment == 'development'`,
		},
	},
)
wave.addStageWithGitHubOptions(
	new CrisisCleanupWebStage(
		app,
		'staging',
		{
			domainName: 'staging.crisiscleanup.io',
			fqdn: 'app.staging.crisiscleanup.io',
			enableBlogRedirect: true,
		},
		{
			env: config.$env!.staging!.cdkEnvironment,
			gitHubEnvironment: {
				name: 'staging',
				url: 'https://app.staging.crisiscleanup.io',
			},
		},
	),
	{
		jobSettings: {
			if: `inputs.environment == 'staging'`,
		},
	},
)
wave.addStageWithGitHubOptions(
	new CrisisCleanupWebStage(
		app,
		'production',
		{
			domainName: 'crisiscleanup.org',
			fqdn: 'crisiscleanup.org',
			globalPriceClass: true,
			additionalDomains: ['www.crisiscleanup.org'],
			enableBlogRedirect: true,
		},
		{
			env: config.$env!.production!.cdkEnvironment,
			gitHubEnvironment: {
				name: 'production',
				url: 'https://crisiscleanup.org',
			},
		},
	),
	{
		jobSettings: {
			if: `inputs.environment == 'production'`,
		},
	},
)
wave.addStageWithGitHubOptions(
	new CrisisCleanupWebStage(
		app,
		'production-au',
		{
			domainName: 'crisiscleanup.org.au',
			fqdn: 'crisiscleanup.org.au',
			globalPriceClass: true,
			additionalDomains: ['www.crisiscleanup.org.au'],
		},
		{
			env: config.$env!['production-au']!.cdkEnvironment,
			gitHubEnvironment: {
				name: 'production-au',
				url: 'https://crisiscleanup.org.au',
			},
		},
	),
	{
		jobSettings: {
			if: `inputs.environment == 'production-au'`,
		},
	},
)

app.synth()
