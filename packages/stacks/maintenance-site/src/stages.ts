import { GitHubStage, type GitHubStageProps } from 'cdk-pipelines-github'
import type { Construct } from 'constructs'
import { MaintenanceSite } from './maintenance-site.ts'

export class MaintenanceStage extends GitHubStage {
	constructor(scope: Construct, id: string, props: GitHubStageProps) {
		super(scope, id, props)
		const source = process.env.MAINTENANCE_SITE_SOURCE
		if (!source) throw new Error('MAINTENANCE_SITE_SOURCE is required')
		new MaintenanceSite(
			this,
			'maintenance-site',
			{
				source: source,
			},
			{
				env: props.env,
				description: 'Maintenance Site',
				stackName: 'maintenance-site',
			},
		)
	}
}
