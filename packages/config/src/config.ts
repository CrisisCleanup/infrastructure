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
import { pickSubsetDeep, transformEnvVars } from './transform'
import type {
	ApiAppConfig,
	ApiAppSecrets,
	ApiConfig,
	CrisisCleanupConfig,
	CrisisCleanupConfigInput,
	CrisisCleanupConfigLayerMeta,
	CrisisCleanupConfigMeta,
} from './types'

const debug = createDebug('@crisiscleanup:config')

const baseAppConfig: ApiAppConfig = {
	celery: {
		alwaysEager: false,
	},
	django: {
		accountAllowRegistration: 'True',
		allowedHosts: '*',
		csrfCookieSecure: false,
		secureSslRedirect: false,
		sessionCookieSecure: false,
		emailBackend: 'django.core.mail.backends.dummy.EmailBackend',
		settingsModule: 'config.settings.local',
	},
	ccu: {
		forceDocker: true,
		apiUrl: 'https://api.local.crisiscleanup.io',
		webUrl: 'https://local.crisiscleanup.io',
		newrelicDisable: true,
	},
	connect: {
		instanceId: '',
	},
	elasticSearch: {
		host: '',
	},
	newRelic: {
		configFile: '/app/newrelic.ini',
	},
	phone: {
		checkTimezone: false,
	},
	sentry: {
		traceExcludeUrls: [
			'/',
			'/health',
			'/health/',
			'/ws/health',
			'/ws/health/',
			'/version',
			'/version/',
			'/{var}health/',
			'/{var}version/',
			'crisiscleanup.common.tasks.get_request_ip',
			'crisiscleanup.common.tasks.create_signal_log',
			'crisiscleanup.common.tasks.create_new_signal_events',
		],
	},
}

// Local secrets
const baseAppSecrets: ApiAppSecrets = {
	aws: {
		accessKeyId: '',
		secretAccessKey: '',
		defaultRegion: 'us-east-1',
		dynamoStage: 'local',
	},
	cloudfront: {
		privateKey: '',
		publicKey: '',
	},
	jwt: {
		privateKey: '',
		publicKey: '',
	},
	connectFirst: { password: '' },
	postgres: {
		// local
		host: '172.17.0.1',
		password: 'crisiscleanup_dev',
		dbname: 'crisiscleanup_dev',
		port: 5432,
		user: 'crisiscleanup_dev',
	},
	redis: {
		host: '172.17.0.1',
		hostReplicas: [],
	},
	zendesk: {
		apiKey: '',
	},
	saml: {
		awsProvider: '',
		awsRole: '',
	},
	django: {
		adminUrl: '^admin/',
		secretKey: 'a_very_secret_key',
		mandrill: {
			apiKey: '',
		},
	},
}

export const baseApiConfig: ApiConfig = {
	config: baseAppConfig,
	secrets: baseAppSecrets,
}

export const baseConfig: CrisisCleanupConfig = {
	ccuStage: 'local',
	cdkEnvironment: {
		region:
			process.env.CDK_DEFAULT_REGION ??
			process.env.AWS_DEFAULT_REGION ??
			'us-east-1',
		account: process.env.CDK_DEFAULT_ACCOUNT!,
	},
	api: baseApiConfig,
}

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
	decrypt: boolean
}

type LoadedConfig<
	OptionsT extends GetConfigOptions,
	ResolvedT extends ResolvedConfig,
> = OptionsT['strict'] extends true
	? Omit<ResolvedT, 'config'> & { config: Exclude<ResolvedT['config'], null> }
	: ResolvedT

type ResolvedCrisisCleanupConfig = ResolvedConfig<
	CrisisCleanupConfig & Required<CrisisCleanupConfigMeta>,
	CrisisCleanupConfigLayerMeta
>

export const getConfig = async <
	T extends Exact<GetConfigOptions, T> = {
		useEnvOverrides: true
		strict: true
		decrypt: true
	},
>(
	options?: T,
): Promise<LoadedConfig<T, ResolvedCrisisCleanupConfig>> => {
	const cwd = await resolveRoot()

	const overridesConfig: Partial<
		LoadConfigOptions<
			CrisisCleanupConfig & CrisisCleanupConfigMeta,
			CrisisCleanupConfigLayerMeta
		>
	> = options?.useEnvOverrides ?? true ? { overrides: loadEnvOverrides() } : {}
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
			console.warn(
				'Resolving config will likely fail; please set GIGET_AUTH to a github auth token in your environment.',
			)
		}
	}

	if (options?.decrypt ?? true) {
		process.env.CCU_CONFIGS_DECRYPT = 'true'
	}

	const cfg = (await loadConfig<
		CrisisCleanupConfig & CrisisCleanupConfigMeta,
		CrisisCleanupConfigLayerMeta
	>({
		name: 'crisiscleanup',
		defaults: getConfigDefaults(),
		envName: process.env.CCU_STAGE ?? 'local',
		cwd,
		extend: { extendKey: '$extends' },
		...overridesConfig,
	})) as ResolvedCrisisCleanupConfig
	process.env = previousEnv
	debug('resolved config: %O', cfg)

	if (!cfg.config && (options?.strict ?? true)) {
		throw new Error(
			'Failed to resolve config and getConfig was called with strict=true',
		)
	}

	if (cfg.config) {
		cfg.config.$env = objectMap(cfg.config.$env, (key, value) => [
			key,
			getConfigDefaults({ ...value, ccuStage: key }),
		])
	}

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
