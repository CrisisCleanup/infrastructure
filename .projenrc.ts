import { javascript } from "projen";
import {MonorepoProject} from '@arroyodev-llc/projen.project.nx-monorepo'

const project = new MonorepoProject({
  name: "crisiscleanup-infrastructure",
  devDeps: [
    "@arroyodev-llc/projen.project.nx-monorepo",
    "@aws-prototyping-sdk/nx-monorepo"
  ],
  packageManager: javascript.NodePackageManager.PNPM,
  projenrcTs: true,

  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();
