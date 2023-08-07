import * as blueprints from '@aws-quickstart/eks-blueprints'
import {
	type CrisisCleanupConfigLayerMetaSources,
	getConfig,
	type Stage as ConfigStage,
} from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import { KubernetesVersion } from 'aws-cdk-lib/aws-eks'
import * as iam from 'aws-cdk-lib/aws-iam'
import { RedisStackAddOn } from './addons'
import { buildClusterBuilder, getCoreAddons } from './cluster'
import { Pipeline } from './pipeline'
import { SopsSecretProvider } from './secrets'

const { config, cwd, layers } = await getConfig({
	strict: true,
	useEnvOverrides: true,
})
const configsLayer = layers!.find(
	(layer) => layer.meta?.repo === 'configs' && 'sources' in layer.meta,
)
// @ts-ignore
const configsSources: Record<ConfigStage, CrisisCleanupConfigLayerMetaSources> =
	Object.fromEntries(
		configsLayer!.meta!.sources!.map((source) => [source.name, source]),
	)

blueprints.HelmAddOn.validateHelmVersions = true

const app = new App({
	context: {
		config,
		// seems to be failing due to patches?
		'cdk-pipelines-github:diffProtection': 'false',
	},
})

const clusterBuilder = buildClusterBuilder(config.apiStack.eks.k8s.version)
const stack = blueprints.EksBlueprint.builder()
	.version(KubernetesVersion.of(config.apiStack.eks.k8s.version))
	.useDefaultSecretEncryption(config.apiStack.eks.defaultSecretsEncryption)
	.addOns(...getCoreAddons(config.apiStack.eks))

const withRedisStack = stack.clone().addOns(new RedisStackAddOn())

const devSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-development-api',
	sopsFilePath: configsSources.development.secretsPath,
})

const stagingSecretsProvider = new SopsSecretProvider({
	secretName: 'crisiscleanup-staging-api',
	sopsFilePath: configsSources.staging.secretsPath,
})

const pipeline = Pipeline.builder({
	id: 'crisiscleanup',
	connectionArn: config.apiStack.codeStarConnectionArn,
	rootDir: cwd,
})
	.target({
		name: 'development',
		stackBuilder: withRedisStack,
		clusterBuilder,
		environment: config.$env.development.cdkEnvironment,
		platformTeam: new blueprints.PlatformTeam({
			name: 'platform',
			users: config.$env.development.apiStack.eks.platformArns.map(
				(arn) => new iam.ArnPrincipal(arn),
			),
		}),
		githubEnvironment: {
			name: 'development',
			url: 'https://app.dev.crisiscleanup.io',
		},
		config: config.$env.development,
		secretsProvider: devSecretsProvider,
	})
	.target({
		name: 'staging',
		stackBuilder: withRedisStack,
		clusterBuilder,
		environment: config.$env.staging.cdkEnvironment,
		platformTeam: new blueprints.PlatformTeam({
			name: 'platform',
			users: config.$env.staging.apiStack.eks.platformArns.map(
				(arn) => new iam.ArnPrincipal(arn),
			),
		}),
		githubEnvironment: {
			name: 'staging',
			url: 'https://app.staging.crisiscleanup.io',
		},
		config: config.$env.staging,
		secretsProvider: stagingSecretsProvider,
	})
	.build(app, {
		env: {
			account: String(config.cdkEnvironment.account),
			region: config.cdkEnvironment.region,
		},
		crossRegionReferences: true,
	})

await pipeline.waitForAsyncTasks()
app.synth({ validateOnSynthesis: true })

export default pipeline
