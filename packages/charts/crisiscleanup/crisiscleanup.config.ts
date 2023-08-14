import { defineConfig } from '@crisiscleanup/config'
import { chartConfigSchema } from './src/schema'

export default defineConfig({
	chart: chartConfigSchema.parse({}),
})
