import * as kplus from 'cdk8s-plus-31'
import { type Construct, type Node } from 'constructs'

export interface PodDisruptionBudgetProps {
	readonly selectors: kplus.k8s.PodDisruptionBudgetSpec['selector']
	readonly minAvailable?: string | number
	readonly maxUnavailable?: string | number
}

export class PodDisruptionBudget {
	readonly node: Node
	readonly pdb: kplus.k8s.KubePodDisruptionBudget

	constructor(
		readonly scope: Construct,
		readonly id: string,
		readonly props: PodDisruptionBudgetProps,
	) {
		this.node = scope.node
		const minAvailable = this.parseAvailable(props.minAvailable)
		const maxUnavailable = this.parseAvailable(props.maxUnavailable)
		this.pdb = new kplus.k8s.KubePodDisruptionBudget(scope, id + '-pdb', {
			metadata: {
				name: id + 'pdb',
			},
			spec: {
				...(minAvailable ? { minAvailable } : {}),
				...(maxUnavailable ? { maxUnavailable } : {}),
				selector: props.selectors,
			},
		})
	}

	protected parseAvailable(
		value?: number | string,
	): kplus.k8s.IntOrString | undefined {
		switch (typeof value) {
			case 'string':
				return kplus.k8s.IntOrString.fromString(value)
			case 'number':
				return kplus.k8s.IntOrString.fromNumber(value)
			default:
				return undefined
		}
	}
}
