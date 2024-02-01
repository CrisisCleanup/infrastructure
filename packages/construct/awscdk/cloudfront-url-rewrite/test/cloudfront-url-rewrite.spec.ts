import { App, Stack } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { describe, expect, it } from 'vitest'
import { CloudFrontUrlRewrite } from '../src/cloudfront-url-rewrite'

describe('CloudFrontUrlRewrite', () => {
	it('should create a CloudFront distribution with the correct behavior', () => {
		const app = new App()
		const stack = new Stack(app, 'TestStack')
		const distribution = new cloudfront.Distribution(stack, 'MyDistribution', {
			defaultBehavior: {
				origin: new origins.HttpOrigin('example.com'),
			},
		})

		new CloudFrontUrlRewrite(stack, 'MyUrlRewrite', {
			distribution,
			fromHostname: 'original.example.com',
			toHostname: 'new.example.com',
			redirectUriPattern: '^/oldpath/(.*)',
			targetUriPattern: '/newpath/$1',
		})

		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})
})
