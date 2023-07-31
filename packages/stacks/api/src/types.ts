export interface KubeConfig {
	readonly version: string
}

export interface EKSConfig {
	readonly defaultSecretsEncryption: boolean
	readonly k8s: KubeConfig
	readonly coreDnsVersion: string
	readonly kubeProxyVersion: string
	readonly vpcCniVersion: string
	readonly platformArns: string[]
}

export interface DatabaseConfig {
	readonly engineVersion: string
	readonly ioOptimized: boolean
}

export interface ApiStackConfig {
	readonly eks: EKSConfig
	readonly database: DatabaseConfig
	readonly isolateDatabase: boolean
	readonly codeStarConnectionArn: string
}
