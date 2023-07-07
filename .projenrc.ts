import { javascript } from "projen";
import {MonorepoProject} from '@arroyodev-llc/projen.project.nx-monorepo'
import {ToolVersions} from '@arroyodev-llc/projen.component.tool-versions'

const monorepo = new MonorepoProject({
  name: "crisiscleanup-infrastructure",
  devDeps: [
    "@arroyodev-llc/projen.project.nx-monorepo",
    "@arroyodev-llc/projen.component.tool-versions",
    "@aws-prototyping-sdk/nx-monorepo"
  ],
  packageManager: javascript.NodePackageManager.PNPM,
  projenrcTs: true,
  minNodeVersion: '18.16.0',
  pnpmVersion: '8.6.6'
});

new ToolVersions(monorepo, {
  tools: {
    nodejs: [monorepo.package.minNodeVersion!],
    pnpm: [monorepo.package.pnpmVersion!]
  }
})

monorepo.synth();
