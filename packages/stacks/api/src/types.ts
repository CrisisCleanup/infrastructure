export interface KubeConfig {
	readonly version: string
}

export interface EKSConfig {
	readonly defaultSecretsEncryption: boolean
	readonly k8s: KubeConfig
	readonly coreDnsVersion: string
	readonly kubeProxyVersion: string
	readonly vpcCniVersion: string
	readonly ebsCsiVersion: string
	readonly platformArns: string[]
}

export interface DatabaseConfig {
	readonly username?: string
	readonly engineVersion: string
	readonly ioOptimized: boolean
	readonly minAcu: number
	readonly maxAcu: number
	readonly isolated?: boolean
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
