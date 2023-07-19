import { loadConfig, type ResolvedConfig } from 'c12'
import type { CrisisCleanupConfig, Config } from './types'

const baseAppConfig: Config = {
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

const baseConfig: CrisisCleanupConfig = {
	config: baseAppConfig,
}

export const getConfig = async (): Promise<
	ResolvedConfig<CrisisCleanupConfig>
> => {
	const cfg = await loadConfig<CrisisCleanupConfig>({
		defaultConfig: baseConfig,
		dotenv: true,
	})
	console.log(cfg)
	return cfg
}
