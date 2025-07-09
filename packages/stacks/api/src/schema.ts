import { z } from 'zod'
import { ScaleSetContainer } from './addons'

export const kubeConfigSchema = z.object({
	version: z.string().default('1.30').describe('Kubernetes version.'),
})

export const eksAddonSchema = z.object({
	coreDnsVersion: z
		.string()
		.default('v1.11.4-eksbuild.14')
		.describe('CoreDNS version.'),
	kubeProxyVersion: z
		.string()
		.default('v1.30.13-eksbuild.2')
		.describe('Kube-proxy version.'),
	vpcCniVersion: z
		.string()
		.default('v1.19.6-eksbuild.1')
		.describe('VPC CNI driver version.'),
	ebsCsiVersion: z
		.string()
		.default('v1.45.0-eksbuild.2')
		.describe('EBS CSI driver version.'),
})

export interface EKSAddonConfig extends z.infer<typeof eksAddonSchema> {}

export const eksConfigSchema = eksAddonSchema.extend({
	defaultSecretsEncryption: z
		.boolean()
		.default(true)
		.describe('Enable default secrets encryption for k8s secrets.'),
	k8s: kubeConfigSchema.default({}),
	platformArns: z
		.array(z.string())
		.describe('ARNs to add to platform team.')
		.default([]),
	instanceTypes: z
		.array(z.string())
		.nullable()
		.default(null)
		.describe('List of instance families for karpenter to provision.'),
})

export interface EKSConfig extends z.infer<typeof eksConfigSchema> {}

export const databaseConfigSchema = z.object({
	username: z.string().optional(),
	databaseName: z.string().optional().nullable().default(null),
	snapshotIdentifier: z
		.string()
		.nullable()
		.default(null)
		.describe('Snapshot identifier to restore from.'),
	engineVersion: z
		.string()
		.default('15.3')
		.describe('Aurora Compatible Postgres version.'),
	ioOptimized: z
		.boolean()
		.default(false)
		.describe('Enable Aurora IO optimized storage.'),
	minAcu: z.number().default(0.5).describe('Minimum Aurora capacity unit.'),
	maxAcu: z.number().default(1.5).describe('Maximum Aurora capacity unit.'),
	isolated: z
		.boolean()
		.optional()
		.describe('Place database in an isolated subnet.'),
	numReplicas: z.number().default(0).describe('Number of read replicas.'),
	numReplicasScaledWithWriter: z
		.number()
		.default(0)
		.describe('Number of read replicas scaled with writer.'),
	performanceInsights: z
		.boolean()
		.default(false)
		.describe('Enable performance insights.'),
	performanceInsightsRetention: z
		.number()
		.default(7)
		.describe('Number of days to retain performance insights.'),
	cloudwatchLogsRetentionDays: z.number().optional().default(30),
	deletionProtection: z.boolean().default(false),
	backupRetentionDays: z.number().default(1),
	bastionAllowList: z.array(z.string()).default([]),
})

export interface DatabaseConfig extends z.infer<typeof databaseConfigSchema> {}

export const networkConfigSchema = z.object({
	maxAzs: z.number().default(2).describe('Maximum availability zones.'),
	natGateways: z.number().default(1).describe('Number of NAT gateways.'),
	cidr: z.string().optional().describe('CIDR for VPC.'),
	createIsolatedSubnet: z
		.boolean()
		.default(false)
		.describe('Create isolated /28 subnet.'),
})

export interface NetworkConfig extends z.infer<typeof networkConfigSchema> {}

export const cacheConfigSchema = z.object({
	enabled: z
		.boolean()
		.describe('Whether to create managed elasticache instance.')
		.default(false),
	nodeType: z
		.string()
		.describe('ElastiCache Node Type')
		.default('cache.r7g.xlarge'),
	engineVersion: z.string().describe('Redis Engine Version').default('7.1'),
	nodes: z.number().describe('Number of nodes to create.').default(1),
	replicas: z.number().describe('Number of replicas to create.').default(1),
	clusterMode: z
		.boolean()
		.describe('Enable redis cluster mode.')
		.default(false),
	memoryAutoscalingTarget: z
		.number()
		.min(10)
		.max(100)
		.optional()
		.nullable()
		.describe('Configure autoscaling target for cluster.')
		.default(null),
})

export interface CacheConfig extends z.infer<typeof cacheConfigSchema> {}

const arcImagesEnum = z.nativeEnum(ScaleSetContainer)

export const arcConfigSchema = z.object({
	github: z
		.object({
			appId: z.string(),
			appInstallationId: z.string(),
			appPrivateKey: z.string(),
		})
		.describe('Github App Credentials')
		.default({
			appId: '',
			appInstallationId: '',
			appPrivateKey: '',
		}),
	minRunners: z
		.number()
		.nullable()
		.default(null)
		.describe('Minimum allowed runners'),
	maxRunners: z
		.number()
		.nullable()
		.default(null)
		.describe('Maximum allowed runners'),
	images: z
		.record(arcImagesEnum, z.string())
		.describe('Images to use.')
		.default({
			[arcImagesEnum.enum.RUNNER]: 'summerwind/actions-runner:ubuntu-20.04',
			[arcImagesEnum.enum.INIT_DIND]: 'ghcr.io/actions/actions-runner:2.308.0',
			[arcImagesEnum.enum.DIND]: 'docker:dind',
		}),
})

export const dnsConfigSchema = z.object({
	zoneName: z.string().default('crisiscleanup.io'),
	subDomain: z.string().default('dev.crisiscleanup.io'),
})

export const apiStackConfigSchema = z.object({
	eks: eksConfigSchema.default({}).describe('EKS configuration.'),
	database: databaseConfigSchema.default({ snapshotIdentifier: '' }),
	network: networkConfigSchema.default({}),
	cache: cacheConfigSchema.default({}),
	arc: arcConfigSchema.default({}),
	codeStarConnectionArn: z.string().optional(),
	kubecostToken: z.string().optional(),
	dns: dnsConfigSchema.default({}),
})

export interface ApiStackConfig extends z.infer<typeof apiStackConfigSchema> {}
