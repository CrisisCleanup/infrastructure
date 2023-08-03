import { objectMap, objectPick } from '@antfu/utils'
import { destr } from 'destr'
import flatten from 'flat'
import type {
	Exact,
	Get,
	ScreamingSnakeCase,
	Split,
	Stringified,
} from 'type-fest'

/**
 * Create a union of flattened keys from an object.
 */
export type FlattenKeys<
	T,
	P extends string | number | symbol = '',
	Delimiter extends string = '.',
> = T extends object
	? {
			[K in keyof T]-?: `${P extends string | number ? P : never}${P extends ''
				? ''
				: Delimiter}${string & K}` extends infer E
				? T[K] extends readonly any[] | null
					? E
					: FlattenKeys<
							T[K],
							E extends string | number | symbol ? E : never,
							Delimiter
					  >
				: never
	  }[keyof T]
	: P

/**
 * Flatten an object into a single depth with the given delimiter.
 * @example
 * ```ts
 * type Foo = {
 * 	bar: {
 * 		baz: string
 * 		qux: number
 * 	},
 * 	quux: boolean
 * 	}
 * type FlatFoo = FlattenObject<Foo, '_'>
 * // {
 * // 	'bar_baz': string
 * // 	'bar_qux': number
 * // 	'quux': boolean
 * // }
 * ```
 */
export type FlattenObject<T, Delimiter extends string = ''> = T extends object
	? {
			[FlatKey in Extract<FlattenKeys<T, '', Delimiter>, string>]: Get<
				T,
				Split<FlatKey, Delimiter>
			>
	  }
	: never

export type ScreamingSnakeCaseProperties<T> = T extends object
	? { [Key in keyof T as ScreamingSnakeCase<Key>]: T[Key] }
	: never

type FlatOptions = Parameters<typeof flatten>[1]
type UnFlatOptions = Parameters<typeof flatten.unflatten>[1]

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

/**
 * Key-value transformer for {@link mapFlatten}.
 */
export interface MapFlattenTransformer {
	(key: string, value: string | string[]): [string, string | string[]]
}

/**
 * Apply a key-value transformer to a flattened object.
 * @param obj input object.
 * @param transform key-value transformer.
 * @param options options for {@link flatten}.
 */
export const mapFlatten = <ObjT>(
	obj: ObjT,
	transform: MapFlattenTransformer,
	options?: FlatOptions,
) => {
	const result: Record<string, unknown> = {}
	const flatObj: Record<string, string | string[]> = flatten(obj, {
		safe: true,
		...(options ?? {}),
	})
	for (const key in flatObj) {
		const [newKey, newValue] = transform(key, flatObj[key])
		result[newKey] = newValue
	}
	return result
}

interface FlattenToScreamingSnakeCaseOptions {
	nestedDelimiter: string
}

/**
 * Flatten an object into a single level object using 'SCREAMING_SNAKE_CASE'.
 * @param key input key.
 * @param nestedDelimiter delimiter for nested keys.
 */
const toScreamingSnakeCase = (key: string, nestedDelimiter: string = '__') =>
	key
		.replaceAll(/([A-Z])+/g, '_$1')
		.toUpperCase()
		.replace(/\./g, nestedDelimiter ?? '__')

/**
 * Flatten a nested object into a single level object using 'SCREAMING_SNAKE_CASE'.
 *
 * @param obj input object.
 * @param options output options.
 *
 * @example
 * ```ts
 * const obj = {
 *  ccu: {
 *  	django: {
 *  		allowedHosts: '*',
 *  		csrfCookieSecure: false,
 *  	},
 *  },
 *  sentry: {
 *  	traceExcludeUrls: ['one', 'two', 'three'],
 *  	},
 *  }
 *  const result = convertToScreamingSnakeCase(obj, { nestedDelimiter: '__' })
 *  console.log(result)
 *  // {
 *  //   CCU__DJANGO__ALLOWED_HOSTS: '*',
 *  //   CCU__DJANGO__CSRF_COOKIE_SECURE: false,
 *  //   SENTRY__TRACE_EXCLUDE_URLS: 'one,two,three',
 *  // }
 *  ```
 *
 */
export const flattenToScreamingSnakeCase = <
	ObjT,
	OptionsT extends Exact<FlattenToScreamingSnakeCaseOptions, OptionsT> = {
		nestedDelimiter: '__'
	},
>(
	obj: ObjT,
	options?: OptionsT,
): ScreamingSnakeCaseProperties<
	FlattenObject<ObjT, OptionsT['nestedDelimiter']>
> => {
	const valueTransformer = (value: unknown) =>
		Array.isArray(value) ? (value as string[]).join(',') : (value as string)

	const result = mapFlatten(obj, (key, value) => [
		toScreamingSnakeCase(key, options?.nestedDelimiter),
		valueTransformer(value),
	])

	return result as ScreamingSnakeCaseProperties<
		FlattenObject<ObjT, OptionsT['nestedDelimiter']>
	>
}

/**
 * Pick a deep subset of an object filtered by key paths of another object.
 * @param input Object to pick from.
 * @param subsetFilter Object to use as filter.
 * @param options Flatten options.
 *
 * @example
 * ```ts
 * // input (values will always come from input)
 * const input = {
 *  randomValue: 'random',
 *  django: {
 *    allowedHosts: '*',
 *    csrfCookieSecure: false,
 *  },
 *  sentry: {
 *   traceExcludeUrls: ['one', 'two', 'three'],
 *  },
 * }
 * // filter only django values (only keys are looked at).
 * const subsetFilter = {
 *  django: {
 *    allowedHosts: true,
 *    csrfCookieSecure: true,
 *  },
 * }
 * const result = pickSubsetDeep(input, subsetFilter)
 * console.log(result)
 * // {
 * //   django: {
 * //     allowedHosts: '*',
 * //     csrfCookieSecure: false,
 * //   },
 * // }
 * ```
 */
export const pickSubsetDeep = <T extends object, Filter extends object>(
	input: T,
	subsetFilter: Filter,
	options?: {
		inputFlatOptions?: FlatOptions
		filterFlatOptions?: FlatOptions
		unflatOptions?: UnFlatOptions
	},
): Extract<T, Filter> => {
	const flatInput: Record<string, unknown> = flatten(
		input,
		options?.inputFlatOptions ?? { safe: true },
	)
	const flatFilter = Object.keys(
		flatten(subsetFilter, options?.filterFlatOptions ?? { safe: true }),
	)
	const results = flatten.unflatten(
		objectPick(flatInput, flatFilter, true),
		options?.unflatOptions,
	)
	return results as Extract<T, Filter>
}

/**
 * Stringify all values of an object.
 * @param object input object.
 */
export const stringifyObjectValues = <T extends Record<string, unknown>>(
	object: T,
): Stringified<T> => {
	return objectMap<string, unknown, string, string>(object, (key, value) => [
		key,
		Array.isArray(value) ? value.join(',') : String(value),
	]) as Stringified<T>
}
