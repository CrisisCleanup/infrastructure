import { javascript } from "projen";
import {MonorepoProject} from '@arroyodev-llc/projen.project.nx-monorepo'
import {ToolVersions} from '@arroyodev-llc/projen.component.tool-versions'
import {DirEnv} from '@arroyodev-llc/projen.component.dir-env'

const monorepo = new MonorepoProject({
  name: "crisiscleanup-infrastructure",
  devDeps: [
    "@arroyodev-llc/projen.project.nx-monorepo",
    "@arroyodev-llc/projen.project.typescript",
    "@arroyodev-llc/projen.component.tool-versions",
    "@arroyodev-llc/projen.component.dir-env",
    "@arroyodev-llc/projen.component.linting",
    "@aws-prototyping-sdk/nx-monorepo",
    "cdk8s-cli",
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
    packagesDir: 'packages'
  }
});

const tools = new ToolVersions(monorepo, {
  tools: {
    direnv: ['2.32.3'],
    nodejs: [monorepo.package.minNodeVersion!],
    pnpm: [monorepo.package.pnpmVersion!],
  }
})

new DirEnv(monorepo).buildDefaultEnvRc({
  localEnvRc: '.envrc.local',
  minDirEnvVersion: tools.versionsOf('direnv')[0]!,
})

monorepo.synth();
