import type { ConfigLayerMeta } from 'c12'
import { type PartialDeep } from 'type-fest'

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
	mandrill: DjangoMandrill
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
	hostReplicas: string[]
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

export interface ApiAppConfig {
	celery: Celery
	django: Django
	elasticSearch: ElasticSearch
	newRelic: NewRelic
	ccu: CCU
	sentry: Sentry
	connect: Connect
	phone: Phone
}

export interface ApiAppSecrets {
	postgres: Postgres
	redis: Redis
	jwt: Jwt
	zendesk: Zendesk
	connectFirst: ConnectFirst
	aws: AWS
	cloudfront: Cloudfront
	saml: Saml
}

export interface ApiConfig {
	config: ApiAppConfig
	secrets?: ApiAppSecrets
}

export interface CdkEnvironment {
	account: string
	region: string
}

export type Stage = 'local' | 'development' | 'staging' | 'production'

export interface CrisisCleanupConfig {
	api: ApiConfig
	cdkEnvironment: CdkEnvironment
	ccuStage: Stage
}

export interface CrisisCleanupConfigInput
	extends PartialDeep<CrisisCleanupConfig, { recurseIntoArrays: true }> {}

export interface CrisisCleanupConfigMeta extends ConfigLayerMeta {
	name: 'crisiscleanup'
}
