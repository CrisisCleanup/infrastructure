import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { describe, expect, test } from 'vitest'
import { MaintenanceSite } from '../src/maintenance-site'

describe('MaintenanceSite', () => {
	test('renders expected template', async () => {
		const sourcePath = path.join(os.tmpdir(), 'maintenance-test')
		const tempDir = await fs.mkdtemp(sourcePath)
		const app = new App()
		const stack = new MaintenanceSite(app, 'test-maintenance-site', {
			source: tempDir,
		})
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})

	test('renders expected template with different domain name', async () => {
		const sourcePath = path.join(os.tmpdir(), 'maintenance-test')
		const tempDir = await fs.mkdtemp(sourcePath)
		const app = new App()
		const stack = new MaintenanceSite(app, 'test-maintenance-site', {
			source: tempDir,
			domainName: 'crisiscleanup.io.au',
		})
		const template = Template.fromStack(stack)
		const jsonTemplate = template.toJSON()
		const strTemplate = JSON.stringify(jsonTemplate)
		expect(strTemplate.includes('crisiscleanup.org')).not.toBeTruthy()
		expect(strTemplate.includes('maintenance.crisiscleanup.io.au')).toBeTruthy()
		expect(jsonTemplate).toMatchSnapshot()
	})
})
