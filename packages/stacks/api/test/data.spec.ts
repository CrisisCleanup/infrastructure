import { App, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { beforeEach, describe, expect, test } from 'vitest'
import { databaseConfigSchema, DataStack, type DatabaseProps } from '../src'

interface TestContext {
	app: App
	vpc: Vpc
}

describe('DataStack', () => {
	beforeEach<TestContext>((ctx) => {
		ctx.app = new App()
		const vpcStack = new Stack(ctx.app, 'test-vpc')
		ctx.vpc = new Vpc(vpcStack, 'test-vpc')
	})

	test<TestContext>('renders expected template with defaults', (ctx) => {
		const dataProps = databaseConfigSchema.parse({
			snapshotIdentifier: 'test-identifier',
		})
		const stack = new DataStack(
			ctx.app,
			'test-database',
			{
				vpc: ctx.vpc,
				clusterProps: dataProps,
			},
			{ env: undefined },
		)
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})

	test<TestContext>('renders expected template with multiple replicas', (ctx) => {
		const props: Partial<DatabaseProps> = {
			numReplicas: 3,
			numReplicasScaledWithWriter: 1,
		}
		const dataProps = databaseConfigSchema.parse({
			snapshotIdentifier: 'test-identifier',
			...props,
		})
		const stack = new DataStack(
			ctx.app,
			'test-database-replicas',
			{
				vpc: ctx.vpc,
				clusterProps: dataProps,
			},
			{ env: undefined },
		)
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})

	test<TestContext>('renders expected template with performance insights', (ctx) => {
		const props: Partial<DatabaseProps> = {
			numReplicas: 3,
			numReplicasScaledWithWriter: 1,
			performanceInsights: true,
			performanceInsightsRetention: 14,
		}
		const dataProps = databaseConfigSchema.parse({
			snapshotIdentifier: 'test-identifier',
			...props,
		})
		const stack = new DataStack(
			ctx.app,
			'test-database-with-insights',
			{
				vpc: ctx.vpc,
				clusterProps: dataProps,
			},
			{ env: undefined },
		)
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})
})
