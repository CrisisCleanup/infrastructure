import { z } from 'zod'

export const kubeConfigSchema = z.object({
	version: z.string().default('1.27').describe('Kubernetes version.'),
})

export const eksAddonSchema = z.object({
	coreDnsVersion: z
		.string()
		.default('v1.10.1-eksbuild.2')
		.describe('CoreDNS version.'),
	kubeProxyVersion: z
		.string()
		.default('v1.27.3-eksbuild.2')
		.describe('Kube-proxy version.'),
	vpcCniVersion: z
		.string()
		.default('v1.13.3-eksbuild.1')
		.describe('VPC CNI driver version.'),
	ebsCsiVersion: z
		.string()
		.default('v1.21.0-eksbuild.1')
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
})

export interface EKSConfig extends z.infer<typeof eksConfigSchema> {}

export const databaseConfigSchema = z.object({
	username: z.string().optional(),
	databaseName: z.string().optional().nullable().default(null),
	snapshotIdentifier: z
		.string()
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
		.default('cache.m7g.large'),
	engineVersion: z.string().describe('Redis Engine Version').default('7.0'),
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

export const apiStackConfigSchema = z.object({
	eks: eksConfigSchema.default({}).describe('EKS configuration.'),
	database: databaseConfigSchema.default({ snapshotIdentifier: '' }),
	network: networkConfigSchema.default({}),
	cache: cacheConfigSchema.default({}),
	codeStarConnectionArn: z.string().optional(),
	kubecostToken: z.string().optional(),
})

export interface ApiStackConfig extends z.infer<typeof apiStackConfigSchema> {}
