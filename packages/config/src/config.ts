import { exec } from 'child_process'
import {
	loadConfig,
	createDefineConfig,
	type LoadConfigOptions,
	type ResolvedConfig,
	ConfigLayerMeta,
} from 'c12'
import createDebug from 'debug'
import { type Exact } from 'type-fest'
import { pickSubsetDeep, transformEnvVars } from './transform.ts'
import type {
	ApiAppConfig,
	ApiAppSecrets,
	ApiConfig,
	CrisisCleanupConfig,
	CrisisCleanupConfigInput,
	CrisisCleanupConfigMeta,
} from './types'

const debug = createDebug('@crisiscleanup:config')

const baseAppConfig: ApiAppConfig = {
	celery: {
		alwaysEager: false,
	},
	django: {
		accountAllowRegistration: 'True',
		adminUrl: '^ccadmin/',
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
		instanceId: '87fbcad4-9f58-4153-84e8-d5b7202693e8',
	},
	elasticSearch: {
		host: 'https://search-crisiscleanup-weyohcdj6uiduuj65scqkmxxjy.us-east-1.es.amazonaws.com/',
	},
	newRelic: {
		configFile: '/app/newrelic.ini',
	},
	phone: {
		checkTimezone: false,
	},
	redis: {
		host: '172.17.0.1',
	},
	saml: {
		awsProvider: 'arn:aws:iam::182237011124:role/CCUDevConnectRole',
		awsRole: 'arn:aws:iam::182237011124:saml-provider/ccuDev',
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
	djangoMandrill: {
		apiKey: '',
	},
	postgres: {
		host: '172.17.0.1',
		password: 'crisiscleanup_dev',
		dbname: 'crisiscleanup_dev',
		port: 5432,
		user: 'crisiscleanup_dev',
	},
	zendesk: {
		apiKey: '',
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

export const loadEnvOverrides = (): CrisisCleanupConfig => {
	const env = Object.assign({}, process.env)
	const mappedEnv = transformEnvVars(env) as unknown as CrisisCleanupConfig
	return pickSubsetDeep(mappedEnv, baseConfig)
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
}

type LoadedConfig<
	OptionsT extends GetConfigOptions,
	ResolvedT extends ResolvedConfig,
> = OptionsT['strict'] extends true
	? Omit<ResolvedT, 'config'> & { config: Exclude<ResolvedT['config'], null> }
	: ResolvedT

type ResolvedCrisisCleanupConfig = ResolvedConfig<
	CrisisCleanupConfig,
	CrisisCleanupConfigMeta
>

export const getConfig = async <
	T extends Exact<GetConfigOptions, T> = {
		useEnvOverrides: true
		strict: true
	},
>(
	options?: T,
): Promise<LoadedConfig<T, ResolvedCrisisCleanupConfig>> => {
	const overridesConfig: Partial<
		LoadConfigOptions<CrisisCleanupConfig, CrisisCleanupConfigMeta>
	> = options?.useEnvOverrides ?? true ? { overrides: loadEnvOverrides() } : {}
	debug('using overrides from env: %O', overridesConfig)

	const cfg = await loadConfig<CrisisCleanupConfig, CrisisCleanupConfigMeta>({
		name: 'crisiscleanup',
		defaultConfig: baseConfig,
		envName: 'CCU_STAGE',
		cwd: await getGitRoot(),
		...overridesConfig,
	})
	debug('resolved config: %O', cfg)

	if (!cfg.config && (options.strict ?? true)) {
		throw new Error(
			'Failed to resolve config and getConfig was called with strict=true',
		)
	}

	return cfg as LoadedConfig<T, typeof cfg>
}

export const defineConfig = createDefineConfig<
	CrisisCleanupConfigInput,
	CrisisCleanupConfigMeta
>()
