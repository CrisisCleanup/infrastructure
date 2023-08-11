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
	databaseName: z.string().optional(),
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
	cloudwatchLogsRetentionDays: z.number().optional().default(30),
	deletionProtection: z.boolean().default(false),
	backupRetentionDays: z.number().default(1),
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

export const storageConfigSchema = z.object({})

export interface StorageConfig extends z.infer<typeof storageConfigSchema> {}

export const apiStackConfigSchema = z.object({
	eks: eksConfigSchema.default({}).describe('EKS configuration.'),
	database: databaseConfigSchema.default({ snapshotIdentifier: '' }),
	network: networkConfigSchema.default({}),
	codeStarConnectionArn: z.string().optional(),
	kubecostToken: z.string().optional(),
})

export interface ApiStackConfig extends z.infer<typeof apiStackConfigSchema> {}
