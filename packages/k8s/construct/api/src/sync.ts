import {
	ContainerImage,
	type ContainerImageProps,
} from '@crisiscleanup/k8s.construct.component'
import { Cron, type CronOptions, Duration } from 'cdk8s'
import * as kplus from 'cdk8s-plus-27'
import { RestartPolicy } from 'cdk8s-plus-27'
import { Construct } from 'constructs'

export interface DatabaseSyncTargetConfig {
	readonly bastionHost: string
	readonly bastionKey: string
	readonly databaseDsn: string
	readonly dev: boolean
}

export interface DatabaseSyncProps
	extends Partial<Omit<kplus.CronJobProps, 'schedule'>> {
	readonly image: ContainerImageProps
	readonly schedule: CronOptions
	readonly target: DatabaseSyncTargetConfig
	readonly sourceDsn?: string | null
}

export class DatabaseSync extends Construct {
	readonly syncCronJob: kplus.CronJob

	constructor(scope: Construct, id: string, props: DatabaseSyncProps) {
		super(scope, id)

		const configVolume = kplus.Volume.fromEmptyDir(
			this,
			'config-volume',
			'config',
			{
				medium: kplus.EmptyDirMedium.MEMORY,
			},
		)

		const syncArgs = [
			'manage.py',
			'pgsync_db',
			'--config-path=/config/pg.yaml',
			`--target-bastion=${props.target.bastionHost}`,
			`--target-bastion-key=${props.target.bastionKey}`,
			`--target-dsn=${props.target.databaseDsn}`,
		]
		if (props.target.dev) {
			syncArgs.push('--dev')
		}
		if (props.sourceDsn) {
			syncArgs.push(`--source-dsn=${props.sourceDsn}`)
		}

		this.syncCronJob = new kplus.CronJob(this, id + '-job', {
			schedule: Cron.schedule(props.schedule),
			ttlAfterFinished: Duration.hours(2),
			restartPolicy: RestartPolicy.NEVER,
			backoffLimit: 2,
		})
		this.syncCronJob.addContainer({
			name: 'sync',
			...ContainerImage.fromProps(props.image).containerProps,
			command: ['python'],
			args: syncArgs,
			volumeMounts: [{ path: '/config', volume: configVolume }],
		})
		this.syncCronJob.addVolume(configVolume)
	}
}
