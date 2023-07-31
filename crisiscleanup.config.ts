// eslint-disable-next-line import/no-extraneous-dependencies
import '@crisiscleanup/charts.crisiscleanup/crisiscleanup.config'
// eslint-disable-next-line import/no-extraneous-dependencies
import '@crisiscleanup/stacks.api/crisiscleanup.config'

// eslint-disable-next-line import/no-extraneous-dependencies
import { defineConfig } from '@crisiscleanup/config'

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	$extends: [
		'github:CrisisCleanup/configs',
		'./packages/charts/crisiscleanup',
		'./packages/stacks/api',
	],
})
