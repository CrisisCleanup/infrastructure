import { GitHubStage, type GitHubStageProps } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { MaintenanceSite } from './maintenance-site.ts'

export interface MaintenanceStageProps extends GitHubStageProps {
	/**
	 * Domain name to use.
	 * @default crisiscleanup.org
	 */
	readonly domainName?: string
	/**
	 * Informative name of stage/stack.
	 * @default maintenance-site
	 */
	readonly name?: string
	/**
	 * Informative description of stage/stack.
	 * @default Maintenance Site
	 */
	readonly description?: string
}

export class MaintenanceStage extends GitHubStage {
	constructor(scope: Construct, id: string, props: MaintenanceStageProps) {
		const {
			domainName,
			name = 'maintenance-site',
			description = 'Maintenance Site',
			...restProps
		} = props
		super(scope, id, restProps)
		const source = process.env.MAINTENANCE_SITE_SOURCE
		if (!source) throw new Error('MAINTENANCE_SITE_SOURCE is required')
		new MaintenanceSite(
			this,
			name,
			{
				source: source,
				domainName: domainName,
			},
			{
				env: props.env,
				description: description,
				stackName: name,
			},
		)
	}
}
