/**
 * Common labels.
 * @see https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/
 */
export const Label = {
	/**
	 * The name of the application.
	 */
	NAME: 'app.kubernetes.io/name',
	/**
	 * The name of the higher level application this is a part of.
	 */
	PART_OF: 'app.kubernetes.io/part-of',
	/**
	 * Current version of the application.
	 */
	VERSION: 'app.kubernetes.io/version',
	/**
	 * Unique name identifying the instance of an application.
	 */
	INSTANCE: 'app.kubernetes.io/instance',
	/**
	 * The tool being used to manage the operation of an application.
	 */
	MANAGED_BY: 'app.kubernetes.io/managed-by',
	/**
	 * The component within the architecture.
	 */
	COMPONENT: 'app.kubernetes.io/component',
} as const

export type Label = (typeof Label)[keyof typeof Label]
