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
import { NodePackageUtils } from '@aws-prototyping-sdk/nx-monorepo'
import { cdk8s, javascript, typescript, type YamlFile } from 'projen'

const monorepo = new MonorepoProject({
	name: 'crisiscleanup-infrastructure',
	devDeps: [
		'@arroyodev-llc/projen.project.nx-monorepo',
		'@arroyodev-llc/projen.project.typescript',
		'@arroyodev-llc/projen.component.tool-versions',
		'@arroyodev-llc/projen.component.dir-env',
		'@arroyodev-llc/projen.component.linting',
		'@arroyodev-llc/projen.component.git-hooks',
		'@aws-prototyping-sdk/nx-monorepo',
		'cdk8s-cli',
	],
	packageManager: javascript.NodePackageManager.PNPM,
	projenrcTs: true,
	minNodeVersion: '18.16.0',
	pnpmVersion: '8.6.6',
	authorName: 'CrisisCleanup',
	authorEmail: 'help@crisiscleanup.org',
	authorOrganization: true,
	authorUrl: 'https://crisiscleanup.org',
	namingScheme: {
		scope: '@crisiscleanup',
		packagesDir: 'packages',
	},
	tsconfig: {
		compilerOptions: {
			isolatedModules: false,
		},
	},
})

const tools = new ToolVersions(monorepo, {
	tools: {
		direnv: ['2.32.3'],
		nodejs: [monorepo.package.minNodeVersion!],
		pnpm: [monorepo.package.pnpmVersion!],
	},
})

new LintConfig(monorepo)

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

// Charts
const crisiscleanup = new cdk8s.Cdk8sTypeScriptApp({
	name: 'crisiscleanup',
	parent: monorepo,
	packageManager: monorepo.package.packageManager,
	outdir: 'packages/charts/crisiscleanup',
	authorName: 'CrisisCleanup',
	authorEmail: 'help@crisiscleanup.org',
	authorOrganization: true,
	authorUrl: 'https://crisiscleanup.org',
	cdk8sCliVersion: '2.2.105',
	cdk8sVersion: '2.7.102',
	cdk8sPlus: true,
	defaultReleaseBranch: 'main',
	disableTsconfigDev: true,
	k8sMinorVersion: 24,
})
new LintConfig(crisiscleanup)
crisiscleanup.tryRemoveFile('tsconfig.json')
new javascript.TypescriptConfig(crisiscleanup, {
	include: ['src/*.ts', 'src/**/*.ts'],
	fileName: 'tsconfig.json',
	compilerOptions: {
		outDir: 'dist',
	},
	extends: monorepo.tsconfigContainer.buildExtends(TSConfig.BASE, TSConfig.ESM),
})
crisiscleanup.addDevDeps('tsx')
const cdk8sConfig = crisiscleanup.tryFindObjectFile('cdk8s.yaml')! as YamlFile
cdk8sConfig.addOverride('app', 'tsx src/main.ts')

monorepo.synth()
