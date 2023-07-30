/// <reference path="src/config.d.ts" />

import { defineConfig } from '@crisiscleanup/config'

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	apiStack: {
		codeStarConnectionArn: '',
		isolateDatabase: false,
		eks: {
			defaultSecretsEncryption: true,
			coreDnsVersion: 'v1.9.3-eksbuild.5',
			kubeProxyVersion: 'v1.24.15-eksbuild.1',
			vpcCniVersion: 'v1.13.3-eksbuild.1',
			k8s: {
				version: '1.24',
			},
		},
		database: {
			engineVersion: '15.3',
			ioOptimized: false,
		},
	},
})
