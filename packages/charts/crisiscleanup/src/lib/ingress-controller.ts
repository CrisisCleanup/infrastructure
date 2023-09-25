import { Include } from 'cdk8s'
import { Construct } from 'constructs'

export interface IngressControllerProps {
	className: string
	annotations?: Record<string, string>
}

export abstract class IngressController {
	abstract createController(props: IngressControllerProps): void
}

export class NginxIngressController
	extends Construct
	implements IngressController
{
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	createController(_props: IngressControllerProps) {
		new Include(this, 'controller', {
			url: 'https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml',
		})
	}
}
