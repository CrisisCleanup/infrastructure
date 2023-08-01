import util from 'node:util'
import { getConfigDefaults } from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { test, expect, vi, beforeAll, afterAll } from 'vitest'
// @ts-ignore
import stackDefaults from '../crisiscleanup.config'
import { buildClusterBuilder, buildEKSStack } from '../src/cluster'
util.inspect.defaultOptions.depth = 6
util.inspect.defaultOptions.colors = true

beforeAll(() => {
	vi.stubEnv('CDK_DEFAULT_ACCOUNT', '1234567890')
})

afterAll(() => {
	vi.unstubAllEnvs()
})

test('Snapshot', async () => {
	// @ts-expect-error non partial
	const config = getConfigDefaults({
		...stackDefaults,
		cdkEnvironment: {
			account: '1234567890',
			region: 'us-east-1',
		},
	})
	console.log(config)
	const app = new App({
		context: {
			config,
			'giget-auth': 'fake-token',
		},
	})
	const cluster = buildClusterBuilder(config).build()
	const stack = await buildEKSStack(config)
		.clusterProvider(cluster)
		.buildAsync(app, 'test-stack')

	const template = Template.fromStack(stack)
	expect(template.toJSON()).toMatchSnapshot()
})
