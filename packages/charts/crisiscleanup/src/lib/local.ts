import { Chart, type ChartProps, Helm, Include, JsonPatch } from 'cdk8s'
import { type Construct } from 'constructs'
import {
	NginxIngressController,
	type IngressController,
} from './ingress-controller'

export class LocalChart extends Chart {
	readonly ingressController: IngressController
	readonly headlamp: Helm

	constructor(scope: Construct, id: string, props?: ChartProps) {
		super(scope, id, props)

		// setup nginx ingress controller
		this.ingressController = new NginxIngressController(
			this,
			'ingress-controller',
		)
		this.ingressController.createController({ className: 'nginx' })

		// secrets csi
		new Helm(this, 'secrets-csi', {
			chart: 'secrets-store-csi-driver',
			namespace: 'kube-system',
			repo: 'https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts',
			releaseName: 'csi-secrets-store',
		})
		// secrets csi aws provider
		new Include(this, 'secrets-store-driver-provider-aws', {
			url: 'https://raw.githubusercontent.com/aws/secrets-store-csi-driver-provider-aws/main/deployment/aws-provider-installer.yaml',
		})

		// headlamp
		this.headlamp = new Helm(this, 'headlamp', {
			namespace: 'kube-system',
			releaseName: 'headlamp',
			chart: 'headlamp',
			repo: 'https://headlamp-k8s.github.io/headlamp/',
			helmFlags: ['--namespace=kube-system'],
		})
		this.headlamp.apiObjects.forEach((obj) => {
			obj.addJsonPatch(JsonPatch.add('/metadata/namespace', 'kube-system'))
		})

		// metrics-server
		new Helm(this, 'metrics-server', {
			chart: 'metrics-server',
			repo: 'https://kubernetes-sigs.github.io/metrics-server/',
			releaseName: 'metrics-server',
			namespace: 'kube-system',
			values: {
				args: [
					'--kubelet-insecure-tls',
					'--kubelet-preferred-address-types=InternalIP',
				],
			},
		})
	}
}
