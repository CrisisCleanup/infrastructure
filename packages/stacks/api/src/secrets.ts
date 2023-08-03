import type * as blueprints from '@aws-quickstart/eks-blueprints'
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type * as ssm from 'aws-cdk-lib/aws-ssm'
import { SopsSecret } from 'cdk-sops-secrets'

export interface SopsSecretProviderProps {
	readonly sopsFilePath: string
	readonly secretName: string
}

export class SopsSecretProvider implements blueprints.SecretProvider {
	constructor(readonly props: SopsSecretProviderProps) {}

	provide(
		clusterInfo: blueprints.ClusterInfo,
	): secretsmanager.ISecret | ssm.IStringParameter {
		const stack = clusterInfo.cluster.stack
		return new SopsSecret(stack, this.props.secretName, {
			sopsFilePath: this.props.sopsFilePath,
			secretName: this.props.secretName,
		})
	}
}
