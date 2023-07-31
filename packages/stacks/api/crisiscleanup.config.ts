/// <reference path="src/config.d.ts" />

import { defineConfig } from '@crisiscleanup/config'

export default defineConfig({
	$meta: { name: 'crisiscleanup' },
	apiStack: {
		codeStarConnectionArn: '',
		isolateDatabase: false,
		eks: {
			platformArns: [],
			defaultSecretsEncryption: true,
			coreDnsVersion: 'v1.10.1-eksbuild.2',
			kubeProxyVersion: 'v1.27.3-eksbuild.2',
			vpcCniVersion: 'v1.13.3-eksbuild.1',
			k8s: {
				version: '1.27',
			},
		},
		database: {
			engineVersion: '15.3',
			ioOptimized: false,
		},
	},
})
