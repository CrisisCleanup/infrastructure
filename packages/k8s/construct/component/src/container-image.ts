import type * as kplus from 'cdk8s-plus-27'

export interface ContainerImageProps {
	readonly repository: string
	readonly tag: string
	readonly pullPolicy?: kplus.ImagePullPolicy | string
}

export interface IContainerImage {
	imageFqn: string
	containerProps: Pick<kplus.ContainerProps, 'image' | 'imagePullPolicy'>
}

export class ContainerImage implements IContainerImage {
	static fromProps(props: ContainerImageProps): ContainerImage {
		if (props instanceof ContainerImage) return props
		return new ContainerImage(
			props.repository,
			props.tag,
			props.pullPolicy as kplus.ImagePullPolicy,
		)
	}

	protected constructor(
		public readonly repository: string,
		public readonly tag: string,
		public readonly pullPolicy?: kplus.ImagePullPolicy,
	) {}

	get imageFqn(): string {
		return `${this.repository}:${this.tag}`
	}

	get containerProps(): Pick<
		kplus.ContainerProps,
		'image' | 'imagePullPolicy'
	> {
		return { image: this.imageFqn, imagePullPolicy: this.pullPolicy }
	}
}
