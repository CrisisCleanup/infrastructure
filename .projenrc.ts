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
import { builders as tsBuilders } from '@arroyodev-llc/projen.project.typescript'
import { builders, ProjectBuilder } from '@arroyodev-llc/utils.projen-builder'
import { NodePackageUtils } from '@aws-prototyping-sdk/nx-monorepo'
import { cdk8s, javascript, LogLevel, typescript } from 'projen'

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
		'cdk8s-cli',
		'zx',
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
	},
})

new DirEnv(monorepo).buildDefaultEnvRc({
	localEnvRc: '.envrc.local',
	minDirEnvVersion: tools.versionsOf('direnv')[0]!,
})

// Setup githooks
monorepo.applyRecursive(
	(project) => {
		if (project instanceof typescript.TypeScriptProject) {
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

const TsESMBuilder = new tsBuilders.TypescriptConfigBuilder({
	extendsDefault: (container) =>
		container.buildExtends(TSConfig.BASE, TSConfig.ESM),
})

const Cdk8sDefaultsBuilder = new builders.DefaultOptionsBuilder({
	cdk8sCliVersion: '2.2',
	cdk8sVersion: '2.7.115',
	cdksPlus: true,
	cdk8sPlusVersion: '2.8',
	k8sMinorVersion: 24,
	typescriptVersion: '~5.1',
	eslint: false,
	prettier: false,
})

const Cdk8sAppBuilder = new ProjectBuilder(cdk8s.Cdk8sTypeScriptApp)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(Cdk8sDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder())

const Cdk8sConstructBuilder = new ProjectBuilder(cdk8s.ConstructLibraryCdk8s)
	.add(WithParentBuilder)
	.add(NameSchemeBuilder)
	.add(CommonDefaultsBuilder)
	.add(Cdk8sDefaultsBuilder)
	.add(TsESMBuilder)
	.add(new tsBuilders.TypescriptLintingBuilder({ useTypeInformation: true }))
	.add(new tsBuilders.TypescriptESMManifestBuilder())

// K8s Constructs
const k8sComponentConstruct = Cdk8sConstructBuilder.build({
	name: 'k8s.construct.component',
	deps: ['defu', 'js-yaml'],
})

// Charts
const crisiscleanup = Cdk8sAppBuilder.build({
	name: 'charts.crisiscleanup',
	cdk8sImports: [
		'https://raw.githubusercontent.com/kubernetes-sigs/secrets-store-csi-driver/main/charts/secrets-store-csi-driver/crds/secrets-store.csi.x-k8s.io_secretproviderclasses.yaml',
	],
	deps: ['defu', 'js-yaml'],
	devDeps: ['type-fest', '@types/js-yaml', 'tsx'],
	workspaceDeps: [k8sComponentConstruct],
})
crisiscleanup.lintConfig.eslint.addIgnorePattern('src/imports')
crisiscleanup
	.tryFindObjectFile('cdk8s.yaml')!
	.addOverride('app', 'tsx src/main.ts')

monorepo.synth()
