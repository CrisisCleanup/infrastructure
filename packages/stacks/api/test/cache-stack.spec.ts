import { App, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { beforeEach, describe, expect, test } from 'vitest'
import { cacheConfigSchema } from '../src'
import { CacheStack } from '../src/stacks'

interface TestContext {
	app: App
	vpc: Vpc
}

describe('CacheStack', () => {
	beforeEach<TestContext>((ctx) => {
		ctx.app = new App()
		const vpcStack = new Stack(ctx.app, 'test-vpc')
		ctx.vpc = new Vpc(vpcStack, 'test-vpc')
	})

	test<TestContext>('renders expected template with defaults', (ctx) => {
		const cacheProps = cacheConfigSchema.parse({
			enabled: true,
		})
		const stack = new CacheStack(ctx.app, 'test-cache', {
			vpc: ctx.vpc,
			...cacheProps,
		})
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})

	test<TestContext>('renders expected template with cluster mode', (ctx) => {
		const cacheProps = cacheConfigSchema.parse({
			enabled: true,
			clusterMode: true,
			replicas: 3,
			memoryAutoscalingTarget: 60,
		})
		const stack = new CacheStack(ctx.app, 'test-cache', {
			vpc: ctx.vpc,
			...cacheProps,
		})
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})
})
