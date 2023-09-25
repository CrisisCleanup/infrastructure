import { exec } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'url'
import { objectKeys, objectMap, objectPick } from '@antfu/utils'
import {
	createDefineConfig,
	type DefineConfig,
	loadConfig,
	type LoadConfigOptions,
	type ResolvedConfig,
} from 'c12'
import createDebug from 'debug'
import defu from 'defu'
import type { Exact } from 'type-fest'
import {
	configSchema,
	configValuesSchema,
	type CrisisCleanupConfig,
	type CrisisCleanupConfigInput,
	type CrisisCleanupConfigLayerMeta,
	type CrisisCleanupConfigMeta,
	type EnvConfig,
} from './schema'
import { pickSubsetDeep, transformEnvVars } from './transform'

const debug = createDebug('@crisiscleanup:config')

export const baseConfig: CrisisCleanupConfig = configValuesSchema.parse({
	ccuStage: 'local',
})

const getGitRoot = (): Promise<string> =>
	new Promise((resolve, reject) => {
		exec('git rev-parse --show-toplevel', (error, stdout, stderr) => {
			if (error) {
				reject(error)
			} else if (stderr) {
				reject(new Error(stderr))
			} else {
				resolve(stdout.trim())
			}
		})
	})

const getPnpmRoot = (): Promise<string> =>
	new Promise((resolve, reject) =>
		exec('pnpm -w exec pwd', (error, stdout, stderr) => {
			if (error) reject(error)
			if (stderr) reject(new Error(stderr))
			resolve(stdout.trim())
		}),
	)

const getGithubToken = (): Promise<string> =>
	new Promise((resolve, reject) =>
		exec('gh auth token', (error, stdout, stderr) => {
			if (error) reject(error)
			if (stderr) reject(new Error(stderr))
			resolve(stdout.trim())
		}),
	)

export const loadEnvOverrides = (): CrisisCleanupConfig => {
	const env = Object.assign({}, process.env)
	const mappedEnv = transformEnvVars(env) as unknown as CrisisCleanupConfig
	return pickSubsetDeep(mappedEnv, getConfigDefaults())
}

/**
 * Resolve root and attempt to load any metadata from it.
 */
const resolveRoot = async () => {
	let cwd: string
	try {
		cwd = await getGitRoot()
	} catch {
		cwd = await getPnpmRoot().catch(() => {
			console.warn(
				'Failed to resolve both git and pnpm roots, falling back to cwd:',
				process.cwd(),
			)
			return process.cwd()
		})
	}

	const rootConfig = pathToFileURL(
		path.join(cwd, 'crisiscleanup.config.ts'),
	).toString()

	try {
		// attempt to populate metadata
		await import(rootConfig)
		console.log('successfully loaded metadata: ', rootConfig)
	} catch (e) {
		console.warn(`Failed to populate metadata from cwd (${rootConfig}):`, e)
	}

	return cwd
}

export interface GetConfigOptions {
	/**
	 * Load and override config values from environment variables.
	 * @default true
	 */
	useEnvOverrides: boolean
	/**
	 * Throw error if config fails to resolve.
	 * @default true
	 */
	strict: boolean
	/**
	 * Attempt to decrypt secret values.
	 */
	decrypt?: boolean
}

type LoadedConfig<
	OptionsT extends GetConfigOptions,
	ResolvedT extends ResolvedConfig,
> = OptionsT['strict'] extends true
	? Omit<ResolvedT, 'config'> & { config: Exclude<ResolvedT['config'], null> }
	: ResolvedT

type ResolvedCrisisCleanupConfig = ResolvedConfig<
	CrisisCleanupConfig,
	CrisisCleanupConfigLayerMeta
>

export const getConfig = async <
	T extends Exact<GetConfigOptions, T> = {
		useEnvOverrides: true
		strict: true
		decrypt?: true
	},
>(
	options?: T,
	loadOptions?: Partial<
		LoadConfigOptions<CrisisCleanupConfig, CrisisCleanupConfigLayerMeta>
	>,
): Promise<LoadedConfig<T, ResolvedCrisisCleanupConfig>> => {
	const cwd = await resolveRoot()

	const useEnvOverrides = options?.useEnvOverrides ?? true
	const envOverrides = loadEnvOverrides()

	const overridesConfig: Partial<
		LoadConfigOptions<
			CrisisCleanupConfig & CrisisCleanupConfigMeta,
			CrisisCleanupConfigLayerMeta
		>
	> = useEnvOverrides ? { overrides: envOverrides } : {}
	debug('using overrides from env: %O', overridesConfig)

	const previousEnv = process.env

	if (typeof process.env.GIGET_AUTH !== 'string') {
		try {
			process.env.GIGET_AUTH = await getGithubToken()
			console.log('resolved github auth from gh-cli')
		} catch (err) {
			console.warn(err)
			console.warn(
				'GIGET_AUTH not set in environment and token resolution from gh-cli failed.',
			)
			throw new Error(
				'Resolving config will likely fail; please set GIGET_AUTH to a github auth token in your environment.',
			)
		}
	}

	if (options?.decrypt ?? true) {
		process.env.CCU_CONFIGS_DECRYPT = process.env.CCU_CONFIGS_DECRYPT ?? 'true'
	}

	const cfg = await loadConfig<
		CrisisCleanupConfig,
		CrisisCleanupConfigLayerMeta
	>({
		name: 'crisiscleanup',
		defaults: getConfigDefaults(),
		envName: process.env.CCU_STAGE ?? 'local',
		cwd,
		extend: { extendKey: '$extends' },
		...overridesConfig,
		...loadOptions,
	})
	process.env = previousEnv
	debug('resolved config: %O', cfg)

	if (!cfg.config && (options?.strict ?? true)) {
		throw new Error(
			'Failed to resolve config and getConfig was called with strict=true',
		)
	}

	if (cfg.config) {
		const $env = cfg.config.$env
		cfg.config.$env = objectMap($env as Required<EnvConfig>, (key, value) => [
			key,
			getConfigDefaults(
				useEnvOverrides
					? (defu(
							{ ...envOverrides, ccuStage: key },
							value,
					  ) as CrisisCleanupConfig)
					: ({ ...value, ccuStage: key } as CrisisCleanupConfig),
			),
		]) as EnvConfig
	}

	cfg.config = await configSchema.parseAsync(cfg.config)

	return cfg as LoadedConfig<T, typeof cfg>
}

const ConfigDefaults = Symbol.for('@crisiscleanup:config:defaults')

/**
 * Retrieve current default values from metadata.
 */
const getDefaultsMeta = (): Array<CrisisCleanupConfig> =>
	(Reflect.getOwnMetadata(ConfigDefaults, baseConfig) ??
		[]) as Array<CrisisCleanupConfig>

/**
 * Retrieve and merge all defaults.
 */
export const getConfigDefaults = (
	source?: CrisisCleanupConfig,
): CrisisCleanupConfig => {
	if (source) {
		return defu(
			Object.assign({}, source),
			Object.assign({}, baseConfig),
			...getDefaultsMeta(),
		)
	}
	return defu(baseConfig, ...getDefaultsMeta())
}

/**
 * Append new defaults definition to defaults metadata.
 * @param defaults new entry.
 */
const addConfigDefaults = (
	defaults: CrisisCleanupConfigInput,
): CrisisCleanupConfigInput => {
	const current = getDefaultsMeta()
	Reflect.defineMetadata(ConfigDefaults, [...current, defaults], baseConfig)
	return defaults
}

type DefineCCUConfig = DefineConfig<
	CrisisCleanupConfigInput,
	CrisisCleanupConfigLayerMeta
>

/**
 * Wrapper for {@link defineConfig} that updates defaults meta from provided values.
 * @param target - defineConfig function.
 */
function defineConfigWrapper<T extends DefineCCUConfig>(target: T) {
	return (...args: Parameters<T>): ReturnType<T> => {
		const result = target.apply(target, args)
		// filter out any meta keys
		const config = objectPick(
			result,
			objectKeys(result).filter((k) => !k.startsWith('$')),
		)
		addConfigDefaults(config)
		return result as ReturnType<T>
	}
}

export const defineConfig = defineConfigWrapper(
	createDefineConfig<CrisisCleanupConfigInput, CrisisCleanupConfigLayerMeta>(),
) as DefineCCUConfig
