import fs from 'node:fs/promises'
import util from 'node:util'
// eslint-disable-next-line import/no-extraneous-dependencies
import {
	configValuesSchema,
	configMetaSchema,
	Environment,
} from '@crisiscleanup/config'
// eslint-disable-next-line import/no-extraneous-dependencies
import { z } from 'zod'
// eslint-disable-next-line import/no-extraneous-dependencies
import { zodToJsonSchema } from 'zod-to-json-schema'
import { chartConfigSchema } from '@crisiscleanup/charts.crisiscleanup'
import { apiStackConfigSchema } from '@crisiscleanup/stacks.api'

const mergedValuesSchema = configValuesSchema
	.merge(z.object({ apiStack: apiStackConfigSchema, chart: chartConfigSchema }))
	.passthrough()

const mergedEnvSchema = z.record(Environment, mergedValuesSchema)

const mergedMetaSchema = configMetaSchema
	.extend({
		$env: mergedEnvSchema,
	})
	.partial()

const mergedSchema = mergedValuesSchema
	.merge(mergedMetaSchema)
	.passthrough()
	.deepPartial()

const jsonSchema = zodToJsonSchema(mergedSchema, {
	name: 'CrisisCleanupConfig',
	pipeStrategy: 'all',
	strictUnions: true,
	definitions: {
		ApiConfig: configValuesSchema,
		ApiStackConfig: apiStackConfigSchema,
		ChartConfig: chartConfigSchema,
	},
})

console.log(util.inspect(jsonSchema, false, null, true))
await fs.writeFile(
	'config.schema.json',
	JSON.stringify(jsonSchema, undefined, 2),
)
