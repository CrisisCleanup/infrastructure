/// <reference path="../src/config.d.ts" />
import util from 'node:util'
import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type ResourceContext } from '@aws-quickstart/eks-blueprints'
import chartDefaults from '@crisiscleanup/charts.crisiscleanup/crisiscleanup.config'
import {
	type CrisisCleanupConfig,
	getConfigDefaults,
} from '@crisiscleanup/config'
import { App, aws_secretsmanager } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks'
import { type IConstruct } from 'constructs'
import { test, expect, vi, beforeAll, afterAll } from 'vitest'
// @ts-ignore
import stackDefaults from '../crisiscleanup.config'
import { CrisisCleanupAddOn } from '../src/addons'
import {
	buildClusterBuilder,
	getCoreAddons,
	getDefaultAddons,
	ResourceNames,
} from '../src/cluster'
util.inspect.defaultOptions.depth = 6
util.inspect.defaultOptions.colors = true

beforeAll(() => {
	vi.stubEnv('CDK_DEFAULT_ACCOUNT', '1234567890')
	vi.stubEnv('CDK_DEFAULT_REGION', 'us-east-1')
})

afterAll(() => {
	vi.unstubAllEnvs()
})

test('Snapshot', async () => {
	// @ts-ignore
	const config: CrisisCleanupConfig = getConfigDefaults({
		...stackDefaults,
		...chartDefaults,
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
	const cluster = buildClusterBuilder(config.apiStack!.eks.k8s.version).build()
	const stack = await blueprints.EksBlueprint.builder()
		.version(KubernetesVersion.of(config.apiStack!.eks.k8s.version))
		.resourceProvider(
			ResourceNames.EBS_KEY,
			new blueprints.CreateKmsKeyProvider('test-ebs-key'),
		)
		.addOns(
			...getDefaultAddons(config.apiStack!.eks),
			...getCoreAddons(config.apiStack!.eks),
		)
		.clusterProvider(cluster)
		.resourceProvider('db-secret', {
			provide(context: ResourceContext): IConstruct {
				return new aws_secretsmanager.Secret(context.scope, 'test-secret', {
					secretName: 'test-secret',
				})
			},
		})
		.addOns(
			new CrisisCleanupAddOn({
				config,
				databaseResourceName: '',
				databaseSecretResourceName: 'db-secret',
				secretsProvider: new blueprints.LookupSecretsManagerSecretByName(
					'test-name',
				),
			}),
		)
		.buildAsync(app, 'test-stack')

	const template = Template.fromStack(stack)
	expect(template.toJSON()).toMatchSnapshot()
})
