import fs from 'node:fs'
import * as path from 'path'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import { type Construct } from 'constructs'

/**
 * Props for HandlerLambdaCloudFrontFunction
 */
export interface HandlerLambdaCloudFrontFunctionProps
	extends Omit<cloudfront.FunctionProps, 'code'> {
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
}

/**
 * An AWS CloudFront function which executes src/handler.lambda.ts.
 */
export class HandlerLambdaCloudFrontFunction extends cloudfront.Function {
	constructor(
		scope: Construct,
		id: string,
		props: HandlerLambdaCloudFrontFunctionProps,
	) {
		const filePath = path.join(__dirname, '../dist/handler.function.mjs')
		const content = fs
			.readFileSync(filePath, 'utf8')
			.replace('<FROM_HOSTNAME>', props.fromHostname)
			.replace('<TO_HOSTNAME>', props.toHostname)
			.replace('<REDIRECT_URI_PATTERN>', props.redirectUriPattern)
			.replace('<TARGET_URI_PATTERN>', props.targetUriPattern)
		super(scope, id, {
			comment: 'src/handler.lambda.ts',
			...props,
			code: cloudfront.FunctionCode.fromInline(content),
		})
	}
}
