import { getConfig } from '@crisiscleanup/config'
import { App } from 'aws-cdk-lib'
import { MaintenanceSite } from './maintenance-site'

const { config } = await getConfig({ strict: true, useEnvOverrides: true })

const app = new App()

const source = process.env.MAINTENANCE_SITE_SOURCE
if (!source) throw new Error('MAINTENANCE_SITE_SOURCE is required')

new MaintenanceSite(
	app,
	'maintenance-site',
	{
		source,
	},
	{
		env: config.cdkEnvironment,
	},
)

app.synth()
