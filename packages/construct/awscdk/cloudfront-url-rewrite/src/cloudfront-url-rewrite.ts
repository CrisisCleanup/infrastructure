import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { Construct } from 'constructs'
import {
	HandlerLambdaCloudFrontFunction,
	type HandlerLambdaCloudFrontFunctionProps,
} from './handler.cfn-function.ts'

/**
 * Represents the properties required to configure URL rewriting for CloudFront.
 */
export interface CloudFrontUrlRewriteProps {
	/**
	 * CloudFront distribution to which the URL rewrite will be applied.
	 */
	readonly distribution: cloudfront.Distribution
	/**
	 * Optional origin to use for the behavior.
	 * @default - {@link cloudfront.IOrigin} with {@link fromHostname}
	 */
	readonly origin?: cloudfront.IOrigin
	/**
	 * Optional path for the behavior.
	 * @default - '/*'
	 */
	readonly behaviorPath?: string
	/**
	 * The hostname to rewrite from.
	 */
	readonly fromHostname: string
	/**
	 * The hostname to rewrite to.
	 */
	readonly toHostname: string
	/**
	 * The redirect URI match pattern used for substitution.
	 */
	readonly redirectUriPattern: string
	/**
	 * Target URI pattern for substitution.
	 */
	readonly targetUriPattern: string
	/**
	 * Optional props for the function.
	 */
	readonly functionProps?: Partial<HandlerLambdaCloudFrontFunctionProps>
}

export class CloudFrontUrlRewrite extends Construct {
	readonly distribution: cloudfront.Distribution
	readonly origin: cloudfront.IOrigin

	constructor(scope: Construct, id: string, props: CloudFrontUrlRewriteProps) {
		super(scope, id)
		this.distribution = props.distribution

		const handler = new HandlerLambdaCloudFrontFunction(this, 'Handler', {
			...(props.functionProps ?? {}),
			fromHostname: props.fromHostname,
			redirectUriPattern: props.redirectUriPattern,
			targetUriPattern: props.targetUriPattern,
			toHostname: props.toHostname,
		})

		this.origin = props.origin ?? new origins.HttpOrigin(props.fromHostname)
		this.distribution.addBehavior(props.behaviorPath ?? '/*', this.origin, {
			functionAssociations: [
				{
					function: handler,
					eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
				},
			],
		})
	}
}
