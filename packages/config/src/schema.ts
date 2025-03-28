import { z } from 'zod'

const stringArray = z
	.string()
	.transform((arg) => arg.split(','))
	.pipe(z.array(z.string()))
	.or(z.array(z.string()))

const celerySchema = z.object({
	alwaysEager: z
		.boolean()
		.default(false)
		.describe('Run celery tasks synchronously'),
})

const djangoSchema = z.object({
	accountAllowRegistration: z.coerce.boolean().default(true),
	allowedHosts: stringArray.default(['*']).describe('Django ALLOWED_HOSTS'),
	csrfCookieSecure: z.coerce
		.boolean()
		.default(true)
		.describe('Secure CSRF cookie'),
	corsOriginWhitelist: z
		.array(z.string())
		.describe('CORS allowed origins.')
		.default([
			'https://local.crisiscleanup.io',
			'https://app.local.crisiscleanup.io',
		]),
	csrfTrustedOrigins: z
		.array(z.string())
		.describe('CSRF trusted origins.')
		.default([
			'https://local.crisiscleanup.io',
			'https://app.local.crisiscleanup.io',
		]),
	secureSslRedirect: z.coerce.boolean().default(false),
	sessionCookieSecure: z.coerce.boolean().default(true),
	emailBackend: z
		.string()
		.default('django.core.mail.backends.dummy.EmailBackend')
		.describe('Django EMAIL_BACKEND python import path.'),
	settingsModule: z
		.string()
		.default('config.settings.local')
		.describe('Django settings module'),
})

const djangoMandrillSchema = z.object({
	apiKey: z.string(),
})

const elasticSearchSchema = z.object({
	host: z.string().default(''),
})

const newRelicSchema = z.object({
	configFile: z
		.string()
		.default('/app/newrelic.ini')
		.describe('Path to newrelic.ini file'),
	environment: z.lazy(() => Environment).optional(),
})

const ccuSchema = z.object({
	newrelicDisable: z
		.boolean()
		.default(true)
		.describe('Disable new relic integration.'),
	webUrl: z.string().url().default('https://local.crisiscleanup.io'),
	apiUrl: z.string().url().default('https://api.local.crisiscleanup.io'),
	forceDocker: z
		.boolean()
		.default(true)
		.describe('Force assumption of running in docker.'),
})

const sentrySchema = z.object({
	traceExcludeUrls: stringArray
		.default([
			'/',
			'/health',
			'/health/',
			'/ws/health',
			'/ws/health/',
			'/version',
			'/version/',
			'/{var}health/',
			'/{var}version/',
		])
		.describe('Sentry trace names to exclude.'),
})

const postgresSchema = z.object({
	dbname: z.string(),
	host: z.string(),
	password: z.string(),
	user: z.string(),
	port: z.coerce.string(),
	hostReplica: z.string().optional(),
})

const redisSchema = z.object({
	host: z.string(),
	hostReplicas: stringArray.default([]),
})

const samlSchema = z.object({
	awsRole: z.string(),
	awsProvider: z.string(),
})

const connectSchema = z.object({
	instanceId: z.string().default(''),
})

const awsSchema = z.object({
	dynamoStage: z.string(),
	accessKeyId: z.string(),
	secretAccessKey: z.string(),
	defaultRegion: z.string(),
})

const phoneSchema = z.object({
	checkTimezone: z
		.boolean()
		.default(true)
		.describe('Enable phone system timezone guardrails.'),
})

const keySchema = z.object({
	publicKey: z.string(),
	privateKey: z.string(),
})

const jwtSchema = keySchema

const cloudfrontSchema = keySchema

const ipStackSchema = z.object({
	apiKey: z.string().optional(),
})

const zendeskSchema = z.object({
	apiKey: z.string(),
})

const stripeSchema = z.object({
	apiKey: z.string(),
})

const connectFirstSchema = z.object({
	password: z.string().default(''),
})

const langchainSchema = z.object({
	tracingV2: z.boolean().default(false),
	endpoint: z.string().default('https://api.smith.langchain.com'),
	project: z.string().default('crisiscleanup-3-api'),
})

const ragSchema = z.object({
	chatModel: z.string().default('gpt-4o'),
	documentEmbedModel: z.string().default('text-embedding-3-large'),
	queryEmbedModel: z.string().default('text-embedding-3-small'),
})

const langchainSecretsSchema = z.object({
	apiKey: z.string().default('').optional(),
})

const slackWebhookSchema = z.object({
	webhookUrl: z.string().optional(),
})

const slackNotificationSecretsSchema = z.object({
	chat: slackWebhookSchema.default({}),
	default: slackWebhookSchema.default({}),
})

const notificationsSecretsSchema = z.object({
	slack: slackNotificationSecretsSchema.default({}),
})

const apiAppConfigSchema = z.object({
	celery: celerySchema.default({}),
	django: djangoSchema.default({}),
	elasticSearch: elasticSearchSchema.default({}),
	newRelic: newRelicSchema.default({}),
	ccu: ccuSchema.default({}),
	sentry: sentrySchema.default({}),
	connect: connectSchema.default({}),
	phone: phoneSchema.default({}),
	langchain: langchainSchema.default({}),
	rag: ragSchema.default({}),
})
export interface ApiAppConfig extends z.infer<typeof apiAppConfigSchema> {}

export const cdkEnvironmentSchema = z.object({
	account: z.coerce
		.string()
		.default(() => (process.env.CDK_DEFAULT_ACCOUNT as string) ?? '123456789'),
	region: z
		.string()
		.default(() => (process.env.CDK_DEFAULT_REGION as string) ?? 'us-east-1'),
})

export interface CdkEnvironment extends z.infer<typeof cdkEnvironmentSchema> {}

const djangoSecretsSchema = z.object({
	adminUrl: z.string().default('^admin/'),
	secretKey: z.string().default('local_good_key'),
	mandrill: djangoMandrillSchema.default({ apiKey: '' }),
})

const apiAppSecretsSchema = z
	.object({
		postgres: postgresSchema
			.partial({
				host: true,
				password: true,
				port: true,
				user: true,
				hostReplica: true,
			})
			.default({ dbname: 'crisiscleanup_local', port: '5432' }),
		redis: redisSchema.default({ host: '172.17.0.1' }),
		jwt: jwtSchema,
		zendesk: zendeskSchema,
		connectFirst: connectFirstSchema,
		aws: awsSchema,
		stripe: stripeSchema,
		cloudfront: cloudfrontSchema,
		saml: samlSchema.default({
			awsProvider: '',
			awsRole: '',
		}),
		django: djangoSecretsSchema.default({}),
		langchain: langchainSecretsSchema.default({}),
		ipstack: ipStackSchema.default({}),
		notifications: notificationsSecretsSchema.default({}),
	})
	.passthrough()

export interface ApiAppSecrets extends z.infer<typeof apiAppSecretsSchema> {}

const apiConfigSchema = z.object({
	config: apiAppConfigSchema.default({}),
	secrets: apiAppSecretsSchema.passthrough().partial().default({}),
})

export interface ApiConfig extends z.infer<typeof apiConfigSchema> {}

export const Environment = z.enum([
	'local',
	'development',
	'staging',
	'production',
	'production-au',
	'test',
])
export type Stage = z.infer<typeof Environment>

const pipelineSchema = z.object({
	repositories: z
		.array(z.string())
		.default(['infrastructure'])
		.describe('Repositories allow to authenticate via OIDC.'),
	assetsBucketName: z
		.string()
		.default('crisiscleanup-pipeline-assets')
		.describe('Name of S3 bucket used to store pipeline assets.'),
	appRegistryTag: z.string().default('').describe('AWS myApplications tag.'),
})

export const configValuesSchema = z
	.object({
		api: apiConfigSchema.default({}),
		cdkEnvironment: cdkEnvironmentSchema.default({}),
		ccuStage: Environment,
		pipeline: pipelineSchema.default({}),
	})
	.passthrough()
const envConfigSchema = z.record(Environment, configValuesSchema)

export const configMetaSchema = z
	.object({
		$extends: z.array(z.string()),
		$env: envConfigSchema,
	})
	.partial({ $extends: true, $env: true })

export const configSchema = configValuesSchema
	.merge(configMetaSchema)
	.passthrough()

const configLayerMetaSource = z.object({
	name: z.string(),
	configPath: z.string().optional(),
	secretPath: z.string().optional(),
})

export const configLayerMeta = z
	.object({
		name: z.string(),
		repo: z.string(),
		sources: z.array(configLayerMetaSource),
	})
	.partial()
	.passthrough()

export const configSchemaInput = configSchema.deepPartial().pipe(configSchema)

export interface CrisisCleanupConfig extends z.infer<typeof configSchema> {}

export type EnvConfig = {
	[key in Stage]: CrisisCleanupConfig
}

export interface CrisisCleanupConfigInput
	extends z.input<typeof configSchemaInput> {}

export interface CrisisCleanupConfigMeta
	extends z.infer<typeof configMetaSchema> {}

export interface CrisisCleanupConfigLayerMeta
	extends z.infer<typeof configLayerMeta> {}
