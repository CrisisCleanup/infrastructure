import { objectPick } from '@antfu/utils'
import { destr } from 'destr'
import flatten from 'flat'

interface TransformedEnv {
	[key: string]: string | boolean | string[] | TransformedEnv
}

/**
 * Transform environment variables into a nested object.
 * Expects '__' to delimit nested keys and '_' to delimit camelCase keys.
 * Expects 'True' and 'False' to be transformed into booleans.
 * Expects comma-separated values to be transformed into arrays.
 *
 * @param envVars input environment variables.
 *
 * @example
 * ```ts
 * const envVars = {
 *  	CCU__DJANGO__ALLOWED_HOSTS: '*',
 *  	CCU__DJANGO__CSRF_COOKIE_SECURE: 'False',
 *  	SENTRY__TRACE_EXCLUDE_URLS: 'one,two,three'
 * }
 * const result = transformEnvVars(envVars)
 * console.log(result)
 * // {
 * //   ccu: {
 * //     django: {
 * //       allowedHosts: '*',
 * //       csrfCookieSecure: false,
 * //     },
 * //   },
 * //   sentry: {
 * //     traceExcludeUrls: ['one', 'two', 'three'],
 * //   },
 * // }
 * ```
 *
 */
export const transformEnvVars = (envVars: {
	[key: string]: string | undefined
}): TransformedEnv =>
	Object.keys(envVars).reduce((result: TransformedEnv, key: string) => {
		const parts = key.toLowerCase().split('__')
		const value = parseValue(envVars[key] ?? '')

		parts.reduce((current: TransformedEnv, part: string, i: number) => {
			const partKeyParts = part.split('_')
			const partKey =
				partKeyParts[0] +
				partKeyParts
					.slice(1)
					.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
					.join('')
			if (i === parts.length - 1) {
				current[partKey] = value
			} else {
				current[partKey] = current[partKey] || {}
			}

			return current[partKey] as TransformedEnv
		}, result)

		return result
	}, {})

/**
 * Handle parsing of values for {@link transformEnvVars}
 * @param value input raw value.
 * @private
 */
function parseValue(value: string): string | boolean | string[] {
	if (value.includes(',')) {
		return value.split(',')
	}

	return destr(value)
}
