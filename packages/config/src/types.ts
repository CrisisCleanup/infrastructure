interface Celery {
	alwaysEager: boolean
}

interface Django {
	accountAllowRegistration: string
	adminUrl: string
	allowedHosts: string
	csrfCookieSecure: boolean
	secureSslRedirect: boolean
	sessionCookieSecure: boolean
	emailBackend: string
	settingsModule: string
}

interface ElasticSearch {
	host: string
}

interface NewRelic {
	configFile: string
}

interface CCU {
	newrelicDisable: boolean
	webUrl: string
	apiUrl: string
	forceDocker: boolean
}

interface Sentry {
	traceExcludeUrls: string[]
}

interface Postgres {
	dbname: string
	host: string
	password: string
	user: string
	port: string | number
}

interface Redis {
	host: string
}

interface Saml {
	awsRole: string
	awsProvider: string
}

interface Connect {
	instanceId: string
}

interface AWS {
	dynamoStage: string
	accessKeyId: string
	secretAccessKey: string
	defaultRegion: string
}

interface Phone {
	checkTimezone: boolean
}

interface Jwt {
	publicKey: string
	privateKey: string
}

interface Cloudfront {
	publicKey: string
	privateKey: string
}

interface DjangoMandrill {
	apiKey: string
}

interface Zendesk {
	apiKey: string
}

interface ConnectFirst {
	password: string
}

export interface Config {
	celery: Celery
	django: Django
	elasticSearch: ElasticSearch
	newRelic: NewRelic
	ccu: CCU
	sentry: Sentry
	redis: Redis
	saml: Saml
	connect: Connect
	phone: Phone
}

export interface Secrets {
	postgres: Postgres
	jwt: Jwt
	djangoMandrill: DjangoMandrill
	zendesk: Zendesk
	connectFirst: ConnectFirst
	aws: AWS
	cloudfront: Cloudfront
}

export interface CrisisCleanupConfig {
	config: Config
	secrets?: Secrets
}
