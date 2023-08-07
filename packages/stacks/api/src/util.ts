import type * as blueprints from '@aws-quickstart/eks-blueprints'
import { type IAnyProducer, type IResolveContext, Stack } from 'aws-cdk-lib'
import type { IConstruct } from 'constructs'

/**
 * Create a producer with cluster info.
 * @param fn resolver to execute on provide with cluster info and context.
 */
export function lazyClusterInfo<T>(
	fn: (clusterInfo: blueprints.ClusterInfo, context: IResolveContext) => T,
): IAnyProducer {
	let value: T | undefined = undefined
	return {
		produce(context: IResolveContext): T {
			if (value) return value
			const stack = Stack.of(context.scope) as blueprints.stacks.EksBlueprint
			value = fn(stack.getClusterInfo(), context)
			return value
		},
	}
}

export function getRequiredResource<T extends IConstruct = IConstruct>(
	resourceContext: blueprints.ResourceContext,
	name: string,
): T {
	const resource = resourceContext.get<T>(name)
	if (!resource) {
		throw new Error('Missing required resource: ' + name)
	}
	return resource
}
