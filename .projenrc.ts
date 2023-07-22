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
	MonorepoProject,
	TSConfig,
} from '@arroyodev-llc/projen.project.nx-monorepo'
import {
	builders as tsBuilders,
	TypescriptBaseBuilder,
} from '@arroyodev-llc/projen.project.typescript'
import { builders, ProjectBuilder } from '@arroyodev-llc/utils.projen-builder'
import { NodePackageUtils } from '@aws-prototyping-sdk/nx-monorepo'
import {
	baseConfig,
	type CrisisCleanupConfig,
	flattenToScreamingSnakeCase,
} from '@crisiscleanup/config'
import {
	awscdk,
	cdk8s,
	DependencyType,
	javascript,
	LogLevel,
	type typescript,
} from 'projen'

const CommonDefaultsBuilder = new builders.DefaultOptionsBuilder({
	defaultReleaseBranch: 'main',
	packageManager: javascript.NodePackageManager.PNPM,
	projenrcTs: true,
	minNodeVersion: '18.16.0',
	pnpmVersion: '8.6.9',
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
		'@arroyodev-llc/utils.projen-builder',
		'@aws-prototyping-sdk/nx-monorepo',
		'zx',
		'defu',
		'destr',
	],
	namingScheme: {
		scope: '@crisiscleanup',
		packagesDir: 'packages',
	},
})

const tools = new ToolVersions(monorepo, {
	tools: {
		direnv: ['2.32.3'],
		nodejs: [monorepo.package.minNodeVersion!],
		pnpm: [monorepo.package.pnpmVersion!],
		kind: ['0.20.0'],
		awscli: ['2.13.0'],
		sops: ['3.7.3'],
		helm: ['3.12.2'],
		kubectl: ['1.24.12'],
		kubectx: ['0.9.5'],
	},
})

const dirEnv = new DirEnv(monorepo)
	.buildDefaultEnvRc({
		localEnvRc: '.envrc.local',
		minDirEnvVersion: tools.versionsOf('direnv')[0]!,
	})
	.addComment(
		'Set CCU_STAGE in .envrc.local (local|development|staging|production)',
	)
	.addComment(
		'Config values can then be overridden from the appropriate ".envrc.$CCU_STAGE" file.',
	)
	.addComment('')
	.addComment(' All config keys available for override:')

const envConfig =
	flattenToScreamingSnakeCase<Omit<CrisisCleanupConfig, 'chart'>>(baseConfig)
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
		container.buildExtends(TSConfig.BASE, TSConfig.ESM),
})

const config = TypescriptProjectBuilder.build({
	name: 'config',
	deps: ['c12', 'defu', 'flat', '@antfu/utils', 'debug', 'type-fest', 'destr'],
	devDeps: ['@types/flat', '@types/debug', 'supports-color'],
})
monorepo.addWorkspaceDeps(
	{ depType: DependencyType.DEVENV, addTsPath: true },
	config,
)

/**
 * CDK8s Charts and Constructs
 */
const Cdk8sDefaultsBuilder = new builders.DefaultOptionsBuilder({
	jsiiVersion: '~5',
	constructsVersion: '10.2.69',
	cdk8sCliVersion: '2.2',
	cdk8sVersion: '2.7.115',
	cdksPlus: true,
	cdk8sPlusVersion: '2.8.99',
	k8sMinorVersion: 24,
	typescriptVersion: '~5.1',
	eslint: false,
	prettier: false,
})

const Cdk8sConstructDefaultsBuilder = new builders.DefaultOptionsBuilder({
	devDeps: [
		`cdk8s-plus-${Cdk8sDefaultsBuilder.defaultOptions.k8sMinorVersion!}@*`,
	],
	peerDeps: [
		`cdk8s-plus-${Cdk8sDefaultsBuilder.defaultOptions.k8sMinorVersion!}`,
	],
	peerDependencyOptions: { pinnedDevDependency: false },
})

const Cdk8sAppBuilder = new ProjectBuilder(cdk8s.Cdk8sTypeScriptApp)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(Cdk8sDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder())
	.add(new builders.OptionsPropertyBuilder<cdk8s.Cdk8sTypeScriptAppOptions>())

const Cdk8sConstructBuilder = new ProjectBuilder(cdk8s.ConstructLibraryCdk8s)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(Cdk8sDefaultsBuilder)
	.add(Cdk8sConstructDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder())

// K8s Constructs
const k8sComponentConstruct = Cdk8sConstructBuilder.build({
	name: 'k8s.construct.component',
	bundledDeps: ['defu', 'js-yaml'],
	jest: false,
})

const apiConstruct = Cdk8sConstructBuilder.build({
	name: 'k8s.construct.api',
	deps: ['debug'],
	devDeps: ['@types/debug'],
	workspaceDeps: [k8sComponentConstruct, config],
	jest: false,
})

// Charts
const crisiscleanup = Cdk8sAppBuilder.build({
	name: 'charts.crisiscleanup',
	cdk8sImports: [
		'https://raw.githubusercontent.com/kubernetes-sigs/secrets-store-csi-driver/main/charts/secrets-store-csi-driver/crds/secrets-store.csi.x-k8s.io_secretproviderclasses.yaml',
	],
	deps: ['defu', 'js-yaml', 'debug', 'type-fest'],
	devDeps: ['@types/js-yaml', 'tsx', '@types/debug'],
	workspaceDeps: [k8sComponentConstruct, config, apiConstruct],
})
crisiscleanup.lintConfig.eslint.addIgnorePattern('src/imports')
crisiscleanup
	.tryFindObjectFile('cdk8s.yaml')!
	.addOverride('app', 'tsx src/main.ts')

/**
 * AWS CDK Stacks and Constructs
 */
const AwsCdkTsAppBuilder = new ProjectBuilder(awscdk.AwsCdkTypeScriptApp)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder())
	.add(new tsBuilders.TypescriptESMManifestBuilder({ sideEffects: true }))

// Stacks
const apiStack = AwsCdkTsAppBuilder.build({
	name: 'stacks.api',
	cdkVersion: '2.87.0',
	integrationTestAutoDiscover: true,
	workspaceDeps: [config, crisiscleanup, apiConstruct],
	deps: ['cdk-sops-secrets'],
})
apiStack.cdkConfig.json.addOverride(
	'app',
	apiStack.formatExecCommand('tsx', 'src/main.ts'),
)

monorepo.addWorkspaceDeps(
	{ depType: DependencyType.DEVENV, addTsPath: true },
	crisiscleanup,
	apiConstruct,
	k8sComponentConstruct,
)

monorepo.synth()
