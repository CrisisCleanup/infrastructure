import type * as blueprints from '@aws-quickstart/eks-blueprints'
import { type ResourceContext } from '@aws-quickstart/eks-blueprints'
import * as kms from 'aws-cdk-lib/aws-kms'

export interface KeyProviderProps {
	name: string
}

export class KeyProvider implements blueprints.ResourceProvider<kms.Key> {
	readonly props: KeyProviderProps

	constructor(props: KeyProviderProps) {
		this.props = props
	}

	provide(context: ResourceContext): kms.Key {
		const id = context.scope.node.id
		return new kms.Key(context.scope, id + '-' + this.props.name, {
			description: `${this.props.name}`,
			alias: this.props.name,
		})
	}
}
