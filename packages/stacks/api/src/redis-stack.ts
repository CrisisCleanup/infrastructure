import * as blueprints from '@aws-quickstart/eks-blueprints'
import { type Construct } from 'constructs'
import defu from 'defu'

export interface RedisStackAddOnProps extends blueprints.HelmAddOnProps {}

const redisStackDefaults: RedisStackAddOnProps = {
	name: 'redis-stack',
	version: '0.3.10',
	chart: 'redis-stack',
	namespace: 'redis',
	release: 'redis-stack',
	repository: 'https://redis-stack.github.io/helm-redis-stack/',
}

export class RedisStackAddOn extends blueprints.HelmAddOn {
	readonly props: RedisStackAddOnProps

	constructor(props: Partial<RedisStackAddOnProps>) {
		const withDefaults = defu(props, redisStackDefaults) as RedisStackAddOnProps
		super(withDefaults)
		this.props = withDefaults
	}

	deploy(clusterInfo: blueprints.ClusterInfo): void | Promise<Construct> {
		return Promise.resolve(
			this.addHelmChart(clusterInfo, this.props.values, true),
		)
	}
}
