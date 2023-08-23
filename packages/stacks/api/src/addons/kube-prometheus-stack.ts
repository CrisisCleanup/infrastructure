import {
	type ClusterInfo,
	HelmAddOn,
	type HelmAddOnProps,
	type HelmAddOnUserProps,
} from '@aws-quickstart/eks-blueprints'
import { createNamespace } from '@aws-quickstart/eks-blueprints/dist/utils'
import type { Construct } from 'constructs'
import defu from 'defu'

export interface KubePrometheusStackAddOnProps extends HelmAddOnUserProps {
	createNamespace?: boolean
}

const defaultProps: HelmAddOnProps & KubePrometheusStackAddOnProps = {
	name: 'kube-prometheus-stack',
	namespace: 'monitoring',
	repository: 'https://prometheus-community.github.io/helm-charts',
	chart: 'kube-prometheus-stack',
	values: {},
	version: '48.3.3',
	release: 'kube-prometheus-stack',
	createNamespace: true,
}

export class KubePrometheusStackAddOn extends HelmAddOn {
	readonly options: KubePrometheusStackAddOnProps

	constructor(props?: KubePrometheusStackAddOnProps) {
		super({ ...defaultProps, ...props })
		this.options = this.props as KubePrometheusStackAddOnProps
	}

	deploy(clusterInfo: ClusterInfo): Promise<Construct> {
		const cluster = clusterInfo.cluster
		const values = defu(this.options.values ?? {}, {
			prometheusOperator: {
				admissionWebhooks: {
					certManager: {
						enabled: true,
					},
				},
			},
		})
		const chart = this.addHelmChart(clusterInfo, values)
		if (this.options.createNamespace) {
			const namespace = createNamespace(this.options.namespace!, cluster)
			chart.node.addDependency(namespace)
		}
		return Promise.resolve(chart)
	}
}
