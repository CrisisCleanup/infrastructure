/// <reference path="src/config.d.ts" />

import { defineConfig } from '@crisiscleanup/config'
import { apiStackConfigSchema } from './src/schema'

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	apiStack: apiStackConfigSchema.parse({}),
})
