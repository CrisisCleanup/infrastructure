/// <reference types="@crisiscleanup/charts.crisiscleanup/src/config" />

// eslint-disable-next-line import/no-extraneous-dependencies
import { defineConfig } from '@crisiscleanup/config'

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	$extends: ['github:CrisisCleanup/configs', './packages/charts/crisiscleanup'],
})
