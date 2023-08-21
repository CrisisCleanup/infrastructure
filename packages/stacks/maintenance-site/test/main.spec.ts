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
})
