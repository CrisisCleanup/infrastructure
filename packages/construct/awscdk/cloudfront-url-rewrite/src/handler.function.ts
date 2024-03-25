import type { CloudFrontFunctionsEvent } from 'aws-lambda'

const FROM_HOSTNAME = '<FROM_HOSTNAME>'
const REDIRECT_URI_PATTERN = new RegExp('<REDIRECT_URI_PATTERN>', 'g')
const TO_HOSTNAME = '<TO_HOSTNAME>'
const TARGET_URI_PATTERN = '<TARGET_URI_PATTERN>'

// eslint-disable-next-line @typescript-eslint/require-await,@typescript-eslint/no-unused-vars
export async function handler(event: CloudFrontFunctionsEvent) {
	const { request } = event
	const { headers, uri } = request

	const host = headers.host?.value
	if (!host || host !== FROM_HOSTNAME) {
		return request
	}

	const newUri = uri.replace(REDIRECT_URI_PATTERN, TARGET_URI_PATTERN)
	const newUrl = `https://${TO_HOSTNAME}${newUri}`
	return {
		statusCode: 301,
		statusDescription: 'Moved Permanently',
		headers: {
			location: { value: newUrl },
		},
	}
}
