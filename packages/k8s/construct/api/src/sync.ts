import {
	ContainerImage,
	type ContainerImageProps,
} from '@crisiscleanup/k8s.construct.component'
import { Cron, type CronOptions, Duration, Size } from 'cdk8s'
import * as kplus from 'cdk8s-plus-30'
import { RestartPolicy } from 'cdk8s-plus-30'
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

		const { image, target, sourceDsn, schedule, ...rest } = props

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
			'--config-path=/tmp/pg.yaml',
			`--target-bastion=${target.bastionHost}`,
			`--target-bastion-key=${target.bastionKey}`,
			`--target-dsn=${target.databaseDsn}`,
		]
		if (target.dev) {
			syncArgs.push('--dev')
		}
		if (sourceDsn) {
			syncArgs.push(`--source-dsn=${props.sourceDsn}`)
		}

		this.syncCronJob = new kplus.CronJob(this, id + '-job', {
			schedule: Cron.schedule(schedule),
			ttlAfterFinished: Duration.hours(2),
			restartPolicy: RestartPolicy.NEVER,
			backoffLimit: 2,
			...rest,
		})
		this.syncCronJob.addContainer({
			name: 'sync',
			...ContainerImage.fromProps(image).containerProps,
			command: ['python'],
			args: syncArgs,
			volumeMounts: [{ path: '/tmp', volume: configVolume }],
			resources: {
				cpu: {
					request: kplus.Cpu.units(2),
				},
				memory: {
					request: Size.gibibytes(1),
					limit: Size.gibibytes(2),
				},
			},
		})
		this.syncCronJob.addVolume(configVolume)
	}
}
