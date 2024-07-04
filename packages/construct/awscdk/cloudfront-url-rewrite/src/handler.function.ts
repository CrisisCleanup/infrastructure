/* eslint-disable no-var */
import type { CloudFrontFunctionsEvent } from 'aws-lambda'

var FROM_HOSTNAME = '<FROM_HOSTNAME>'
var REDIRECT_URI_PATTERN = new RegExp('<REDIRECT_URI_PATTERN>', 'g')
var TO_HOSTNAME = '<TO_HOSTNAME>'
var TARGET_URI_PATTERN = '<TARGET_URI_PATTERN>'

/**
 * cloudfront-js supports a limited subset of javascript/ecma features.
 */
// eslint-disable-next-line @typescript-eslint/require-await,@typescript-eslint/no-unused-vars
function handler(event: CloudFrontFunctionsEvent) {
	var request = event.request
	var headers = request.headers
	var uri = request.uri

	var hostParams = headers.host
	var host = ''
	if (hostParams && hostParams.value) {
		host = hostParams.value
	}

	if (!host || host !== FROM_HOSTNAME) {
		return request
	}

	var newUri = uri.replace(REDIRECT_URI_PATTERN, TARGET_URI_PATTERN)
	var newUrl = `https://${TO_HOSTNAME}${newUri}`
	return {
		statusCode: 301,
		statusDescription: 'Moved Permanently',
		headers: {
			location: { value: newUrl },
		},
	}
}

export default handler
