export interface KubeConfig {
	readonly version: string
}

export interface EKSConfig {
	readonly defaultSecretsEncryption: boolean
	readonly k8s: KubeConfig
	readonly coreDnsVersion: string
	readonly kubeProxyVersion: string
	readonly vpcCniVersion: string
}

export interface DatabaseConfig {
	engineVersion: string
	ioOptimized: boolean
}

export interface ApiStackConfig {
	eks: EKSConfig
	database: DatabaseConfig
	isolateDatabase: boolean
	codeStarConnectionArn: string
}
