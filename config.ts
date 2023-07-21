// eslint-disable-next-line import/no-extraneous-dependencies
import { defineConfig, baseApiConfig } from '@crisiscleanup/config'

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	api: baseApiConfig,
	cdkEnvironment: {
		region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
		account: String(process.env.CDK_DEFAULT_ACCOUNT!),
	},
})
