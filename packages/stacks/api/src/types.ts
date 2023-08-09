export interface KubeConfig {
	readonly version: string
}

export interface EKSAddonConfig {
	readonly coreDnsVersion: string
	readonly kubeProxyVersion: string
	readonly vpcCniVersion: string
	readonly ebsCsiVersion: string
}

export interface EKSConfig extends EKSAddonConfig {
	readonly defaultSecretsEncryption: boolean
	readonly k8s: KubeConfig
	readonly platformArns: string[]
}

export interface DatabaseConfig {
	readonly username?: string
	readonly databaseName?: string
	readonly snapshotIdentifier: string
	readonly engineVersion: string
	readonly ioOptimized: boolean
	readonly minAcu: number
	readonly maxAcu: number
	readonly isolated?: boolean
	readonly numReplicas: number
	readonly numReplicasScaledWithWriter: number
	readonly performanceInsights: boolean
	readonly cloudwatchLogsRetentionDays?: number
	readonly deletionProtection: boolean
	readonly backupRetentionDays: number
}

export interface NetworkConfig {
	readonly maxAzs?: number
	readonly natGateways?: number
	readonly cidr?: string
	readonly createIsolatedSubnet?: boolean
}

export interface ApiStackConfig {
	readonly eks: EKSConfig
	readonly database: DatabaseConfig
	readonly network: NetworkConfig
	readonly codeStarConnectionArn: string
	readonly kubecostToken: string
}
