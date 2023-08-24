import { DirEnv } from '@arroyodev-llc/projen.component.dir-env'
import {
	ExtensionMatch,
	GitHooks,
	LintStaged,
	ValidGitHooks,
} from '@arroyodev-llc/projen.component.git-hooks'
import { LintConfig } from '@arroyodev-llc/projen.component.linting'
import { ToolVersions } from '@arroyodev-llc/projen.component.tool-versions'
import {
	Vitest,
	VitestConfigType,
} from '@arroyodev-llc/projen.component.vitest'
import {
	MonorepoProject,
	TSConfig,
} from '@arroyodev-llc/projen.project.nx-monorepo'
import {
	builders as tsBuilders,
	TypescriptBaseBuilder,
} from '@arroyodev-llc/projen.project.typescript'
import { applyOverrides } from '@arroyodev-llc/utils.projen'
import { builders, ProjectBuilder } from '@arroyodev-llc/utils.projen-builder'
import { NodePackageUtils } from '@aws-prototyping-sdk/nx-monorepo'
import {
	type CrisisCleanupConfig,
	flattenToScreamingSnakeCase,
	getConfigDefaults,
} from '@crisiscleanup/config'
// populate defaults metadata
import '@crisiscleanup/stacks.api/crisiscleanup.config'
import '@crisiscleanup/charts.crisiscleanup/crisiscleanup.config'
import {
	awscdk,
	cdk8s,
	DependencyType,
	javascript,
	LogLevel,
	type typescript,
	github,
} from 'projen'
import { secretToString } from 'projen/lib/github/util'

const CommonDefaultsBuilder = new builders.DefaultOptionsBuilder({
	defaultReleaseBranch: 'main',
	packageManager: javascript.NodePackageManager.PNPM,
	projenrcTs: true,
	minNodeVersion: '18.16.0',
	pnpmVersion: '8.6.12',
	typescriptVersion: '~5.1',
	author: 'CrisisCleanup',
	authorName: 'CrisisCleanup',
	authorOrganization: true,
	authorUrl: 'https://crisiscleanup.org',
	authorAddress: 'https://crisiscleanup.org',
	repositoryUrl: 'https://github.com/CrisisCleanup/infrastructure',
	logging: { level: LogLevel.INFO, usePrefix: true },
	libdir: 'dist',
} satisfies Partial<typescript.TypeScriptProjectOptions> &
	Partial<cdk8s.ConstructLibraryCdk8sOptions>)

const crisiscleanupBot = github.GithubCredentials.fromApp({
	appIdSecret: 'CCU_BOT_APP_ID',
	privateKeySecret: 'CCU_BOT_PRIVATE_KEY',
})

// public readonly workspace token.
const nxReadOnlyPublicToken =
	'OTZkOWY4NjQtMjlkNS00ODM0LWE2NTktY2YyZGRlMzk3ZTgxfHJlYWQ='

const NameSchemeBuilder = new builders.NameSchemeBuilder({
	scope: '@crisiscleanup',
})

const MonorepoBuilder = new ProjectBuilder(MonorepoProject)
	.add(CommonDefaultsBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))

const monorepo = MonorepoBuilder.build({
	name: 'crisiscleanup-infrastructure',
	devDeps: [
		'@arroyodev-llc/projen.project.nx-monorepo',
		'@arroyodev-llc/projen.project.typescript',
		'@arroyodev-llc/projen.component.tool-versions',
		'@arroyodev-llc/projen.component.dir-env',
		'@arroyodev-llc/projen.component.linting',
		'@arroyodev-llc/projen.component.git-hooks',
		'@arroyodev-llc/projen.component.vitest',
		'@arroyodev-llc/utils.projen-builder',
		'@arroyodev-llc/utils.projen',
		'@aws-prototyping-sdk/nx-monorepo',
		'zx',
		'defu',
		'destr',
		'zod',
		'zod-to-json-schema',
	],
	namingScheme: {
		scope: '@crisiscleanup',
		packagesDir: 'packages',
	},
	githubOptions: {
		projenCredentials: crisiscleanupBot,
	},
	projenCredentials: crisiscleanupBot,
	workspaceConfig: {
		linkLocalWorkspaceBins: true,
	},
	docgen: true,
})
monorepo.nx.useNxCloud(nxReadOnlyPublicToken)
monorepo.nx.npmScope = '@crisiscleanup'
monorepo.nx.nxIgnore.addPatterns('**/cdk.out/**')
monorepo.addGitIgnore('.env.*')
const esmTsConfig = monorepo.tsconfigContainer.configs.get(TSConfig.ESM)!
monorepo.tryRemoveFile(esmTsConfig.file.path)
monorepo.tsconfigContainer.defineConfig(TSConfig.ESM, {
	...esmTsConfig.compilerOptions,
	emitDecoratorMetadata: true,
	experimentalDecorators: true,
})
monorepo.package.addPackageResolutions('unbuild@^2.0.0-rc.0')
monorepo.pnpm.addPatch('unbuild@2.0.0-rc.0', 'patches/unbuild@2.0.0-rc.0.patch')
new Vitest(monorepo, { configType: VitestConfigType.WORKSPACE })

const applyWorkflowEnvOverrides = (workflowName: string, jobName: string) => {
	const workflow = github.GitHub.of(monorepo)!.tryFindWorkflow(workflowName)!
	monorepo.applyGithubJobNxEnv(workflow, jobName)
	const overrides = {
		[`jobs.${jobName}.env.GIGET_AUTH`]: secretToString('GH_CONFIGS_RO_PAT'),
		[`jobs.${jobName}.env.CCU_CONFIGS_DECRYPT`]: 'false',
		[`jobs.${jobName}.env.SKIP_SYNTH`]: '1',
	}
	applyOverrides(
		github.GitHub.of(monorepo)!.tryFindWorkflow(workflowName)!.file!,
		overrides,
	)
}
applyWorkflowEnvOverrides('build', 'build')
applyWorkflowEnvOverrides('static', 'deploy')

const tools = new ToolVersions(monorepo, {
	tools: {
		direnv: ['2.32.3'],
		nodejs: [monorepo.package.minNodeVersion!],
		pnpm: [monorepo.package.pnpmVersion!],
		kind: ['0.20.0'],
		awscli: ['2.13.11'],
		sops: ['3.7.3'],
		helm: ['3.12.2'],
		kubectl: ['1.27.3'],
		kubectx: ['0.9.5'],
	},
})

const dirEnv = new DirEnv(monorepo)
	.buildDefaultEnvRc({
		localEnvRc: '.envrc.local',
		minDirEnvVersion: tools.versionsOf('direnv')[0]!,
	})
	.addComment('Expose Tool Versions')
	.addEnvVar('TOOLS_AWSCLI_VERSION', tools.versionsOf('awscli')[0])
	.addEnvVar('TOOLS_SOPS_VERSION', tools.versionsOf('sops')[0])
	.addEnvVar('TOOLS_HELM_VERSION', tools.versionsOf('helm')[0])
	.addBlankLine()
	.addComment(
		'Set CCU_STAGE in .envrc.local (local|development|staging|production)',
	)
	.addComment(
		'Config values can then be overridden from the appropriate ".envrc.$CCU_STAGE" file.',
	)
	.addComment('')
	.addComment(' All config keys available for override:')

const envConfig = flattenToScreamingSnakeCase<
	Omit<CrisisCleanupConfig, 'chart'>
>(getConfigDefaults())
Object.keys(envConfig).forEach((key) => {
	dirEnv.addComment(`  ${key}`)
})

dirEnv
	.addBlankLine()
	.addBlankLine()
	.addComment('Load environment config overrides.')
	.addEnvVar('CCU_STAGE', '$CCU_STAGE', { defaultValue: 'local' })
	.addCommand('target_env=".envrc.${CCU_STAGE}"')
	.addSourceEnvIfExists('"$target_env"')

monorepo.gitignore.removePatterns('"$target_env"')
monorepo.gitignore.addPatterns('.envrc.*')

// Setup githooks
monorepo.applyRecursive(
	(project) => {
		if (project instanceof javascript.NodeProject) {
			new LintStaged(project, {
				entries: [
					{
						extensions: [ExtensionMatch.TS, ExtensionMatch.JS],
						commands: [
							NodePackageUtils.command.exec(
								project.package.packageManager,
								'eslint --cache --fix --no-error-on-unmatched-pattern',
							),
						],
					},
					{
						extensions: [ExtensionMatch.YAML],
						commands: [
							NodePackageUtils.command.exec(
								project.package.packageManager,
								'prettier --write',
							),
						],
					},
				],
			})
		}
		// ensure all readonly files are ignored
		project.files
			.filter((file) => file.readonly)
			.forEach((file) => {
				const lintConfig = LintConfig.of(project)
				lintConfig?.prettier?.addIgnorePattern?.(file.path)
				lintConfig?.eslint?.addIgnorePattern?.(file.path)
			})
	},
	{ immediate: false, includeSelf: true },
)
monorepo.lintConfig.prettier.addIgnorePattern('.github/workflows/deploy.yml')
monorepo.lintConfig.prettier.addIgnorePattern('.github/workflows/deploy-*.yml')

new GitHooks(monorepo, {
	hooks: {
		[ValidGitHooks.PreCommit]: NodePackageUtils.command.exec(
			monorepo.package.packageManager,
			'lint-staged',
		),
	},
	preserveUnused: true,
})

/**
 * Subprojects
 */

const WithParentBuilder = new builders.DefaultOptionsBuilder({
	parent: monorepo,
})

const TypescriptProjectBuilder = TypescriptBaseBuilder.add(
	CommonDefaultsBuilder,
	{ prepend: true },
)
	.add(WithParentBuilder, {
		prepend: true,
	})
	.add(NameSchemeBuilder)

const TsESMBuilder = new tsBuilders.TypescriptConfigBuilder({
	extendsDefault: (container) =>
		container.buildExtends(
			TSConfig.BASE,
			TSConfig.ESM,
			TSConfig.BUNDLER,
			TSConfig.COMPOSITE,
		),
})

const config = TypescriptProjectBuilder.build({
	name: 'config',
	deps: [
		'c12',
		'defu',
		'flat',
		'@antfu/utils',
		'debug',
		'type-fest',
		'destr',
		'reflect-metadata',
		'zod',
	],
	devDeps: ['@types/flat', '@types/debug', 'supports-color'],
})
config.tsconfig.file.addToArray('compilerOptions.types', 'reflect-metadata')
monorepo.addWorkspaceDeps(
	{ depType: DependencyType.DEVENV, addTsPath: true },
	config,
)
new Vitest(config)

const CdkVersionsBuilder = new builders.DefaultOptionsBuilder({
	jsiiVersion: '~5',
	constructsVersion: '10.2.69',
	cdkVersion: '2.93.0',
	cdk8sCliVersion: '2.56.0',
	cdk8sVersion: '2.55.0',
	cdksPlus: true,
	cdk8sPlusVersion: '2.6.0',
	k8sMinorVersion: 27,
	typescriptVersion: '~5.1',
})

/**
 * CDK8s Charts and Constructs
 */
const Cdk8sDefaultsBuilder = new builders.DefaultOptionsBuilder({
	prettier: true,
	unbuild: true,
})

const CDK8sPlus = `cdk8s-plus-${CdkVersionsBuilder.defaultOptions
	.k8sMinorVersion!}`

const Cdk8sConstructDefaultsBuilder = new builders.DefaultOptionsBuilder({
	devDeps: [`${CDK8sPlus}@*`],
	peerDeps: [CDK8sPlus],
	peerDependencyOptions: { pinnedDevDependency: false },
	unbuild: true,
	libdir: 'dist',
	entrypoint: 'dist/index.mjs',
})

const Cdk8sAppBuilder = new ProjectBuilder(cdk8s.Cdk8sTypeScriptApp)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(CdkVersionsBuilder)
	.add(Cdk8sDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder())
	.add(new tsBuilders.TypescriptBundlerBuilder())
	.add(new builders.OptionsPropertyBuilder<cdk8s.Cdk8sTypeScriptAppOptions>())

const Cdk8sConstructBuilder = new ProjectBuilder(cdk8s.ConstructLibraryCdk8s)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(CdkVersionsBuilder)
	.add(Cdk8sDefaultsBuilder)
	.add(Cdk8sConstructDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder())
	.add(new tsBuilders.TypescriptBundlerBuilder())

// K8s Constructs
const k8sComponentConstruct = Cdk8sConstructBuilder.build({
	name: 'k8s.construct.component',
	deps: ['debug', 'defu', 'js-yaml'],
	devDeps: ['@types/debug'],
	jest: false,
})
k8sComponentConstruct.tasks.tryFind('docgen')?.reset?.()

const apiConstruct = Cdk8sConstructBuilder.build({
	name: 'k8s.construct.api',
	deps: ['debug', 'defu'],
	devDeps: ['@types/debug'],
	workspaceDeps: [k8sComponentConstruct, config],
	jest: false,
})
apiConstruct.tasks.tryFind('docgen')?.reset?.()

// Charts
const crisiscleanup = Cdk8sAppBuilder.build({
	name: 'charts.crisiscleanup',
	cdk8sImports: [
		'https://raw.githubusercontent.com/kubernetes-sigs/secrets-store-csi-driver/main/charts/secrets-store-csi-driver/crds/secrets-store.csi.x-k8s.io_secretproviderclasses.yaml',
	],
	deps: ['defu', 'js-yaml', 'debug', 'type-fest', 'zod'],
	devDeps: ['@types/js-yaml', 'tsx', '@types/debug'],
	workspaceDeps: [k8sComponentConstruct, config, apiConstruct],
	jest: false,
})
crisiscleanup.addGitIgnore('cdk8s.out')
crisiscleanup.tsconfigDev.addInclude('crisiscleanup.config.ts')
crisiscleanup.lintConfig.eslint.addIgnorePattern('src/imports/**')
crisiscleanup.lintConfig.prettier.addIgnorePattern('src/imports/**')
crisiscleanup
	.tryFindObjectFile('cdk8s.yaml')!
	.addOverride('app', 'tsx src/main.ts')
crisiscleanup.package.file.addOverride(
	'exports.\\./crisiscleanup\\.config',
	'./crisiscleanup.config.ts',
)
const postCompile = crisiscleanup.tasks.tryFind('post-compile')!
postCompile.reset(crisiscleanup.formatExecCommand('tsc', '--build', '--clean'))
new Vitest(crisiscleanup)

/**
 * AWS CDK Stacks and Constructs
 */
const AwsCdkTsAppBuilder = new ProjectBuilder(awscdk.AwsCdkTypeScriptApp)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(CdkVersionsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder({ sideEffects: true }))

const AwsCdkTsConstructBuilder = new ProjectBuilder(
	awscdk.AwsCdkConstructLibrary,
)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(CdkVersionsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder({ sideEffects: true }))
	.add(new tsBuilders.TypescriptBundlerBuilder())

// Constructs
const ghPipelineConstruct = AwsCdkTsConstructBuilder.build({
	name: 'construct.awscdk.github-pipeline',
	deps: ['flat', 'defu', 'decamelize'],
	devDeps: ['@types/flat'],
	peerDeps: ['cdk-pipelines-github'],
	workspaceDeps: [config],
	prettier: true,
	jest: false,
	unbuild: true,
})
ghPipelineConstruct.package.file.addDeletionOverride('main')
ghPipelineConstruct.tasks.tryFind('docgen')?.reset?.()
new Vitest(ghPipelineConstruct)

// Stacks
const apiStack = AwsCdkTsAppBuilder.build({
	name: 'stacks.api',
	integrationTestAutoDiscover: true,
	workspaceDeps: [
		config,
		crisiscleanup,
		apiConstruct,
		k8sComponentConstruct,
		ghPipelineConstruct,
	],
	deps: [
		'zod',
		'cdk-sops-secrets',
		'@aws-quickstart/eks-blueprints',
		'@kubecost/kubecost-eks-blueprints-addon',
		'@aws-cdk/lambda-layer-kubectl-v27',
		'defu',
		'cdk-pipelines-github',
		'flat',
		'@cdklabs/cdk-validator-cfnguard',
		'cdk-ec2-key-pair',
		'cdk-redisdb',
		`cdk8s@${crisiscleanup.package.tryResolveDependencyVersion('cdk8s')!}`,
		`${CDK8sPlus}@${crisiscleanup.package.tryResolveDependencyVersion(
			CDK8sPlus,
		)!}`,
	],
	devDeps: ['@types/flat'],
	// use ts linting builder
	prettier: true,
	jest: false,
})
apiStack.cdkConfig.json.addOverride(
	'app',
	apiStack.formatExecCommand('tsx', 'src/main.ts'),
)
apiStack.tsconfigDev.addInclude('crisiscleanup.config.ts')
apiStack.addGitIgnore('cdk.context.json')
const stackPostCompile = apiStack.tasks.tryFind('post-compile')!
stackPostCompile.reset()
stackPostCompile.spawn(apiStack.tasks.tryFind('synth:silent')!, {
	condition: `bash -c '[[ -z "$SKIP_SYNTH" ]]'`,
})
new Vitest(apiStack)

const maintenanceStack = AwsCdkTsAppBuilder.build({
	name: 'stacks.maintenance-site',
	integrationTestAutoDiscover: true,
	workspaceDeps: [config, ghPipelineConstruct],
	deps: ['@aws-prototyping-sdk/static-website', 'cdk-pipelines-github'],
	jest: false,
	prettier: true,
})
maintenanceStack.addGitIgnore('cdk.context.json')
maintenanceStack.cdkConfig.json.addOverride(
	'app',
	maintenanceStack.formatExecCommand('tsx', 'src/main.ts'),
)
const maintenancePostCompile = maintenanceStack.tasks.tryFind('post-compile')!
maintenancePostCompile.reset()
maintenancePostCompile.spawn(maintenanceStack.tasks.tryFind('synth:silent')!, {
	condition: `bash -c '[[ -z "$SKIP_SYNTH" ]] && [[ -n "$MAINTENANCE_SITE_SOURCE" ]]'`,
})
new Vitest(maintenanceStack)

monorepo.addWorkspaceDeps(
	{ depType: DependencyType.DEVENV, addTsPath: true },
	crisiscleanup,
	apiConstruct,
	k8sComponentConstruct,
	apiStack,
)

monorepo.gitattributes.addAttributes('*.snap', 'linguist-generated')

const awsCdkLibVersion =
	apiStack.package.tryResolveDependencyVersion('aws-cdk-lib')!
monorepo.package.addPackageResolutions(
	`aws-cdk-lib@${awsCdkLibVersion}`,
	`constructs@${CdkVersionsBuilder.defaultOptions.constructsVersion!}`,
)

monorepo.synth()
