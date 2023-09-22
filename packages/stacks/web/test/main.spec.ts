import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { describe, expect, test } from 'vitest'
import { CrisisCleanupWeb } from '../src/web'

describe('CrisisCleanupWeb', () => {
	test('renders expected template', async () => {
		const sourcePath = path.join(os.tmpdir(), 'crisiscleanup-web-test')
		const tempDir = await fs.mkdtemp(sourcePath)
		const app = new App()
		const stack = new CrisisCleanupWeb(
			app,
			'test-crisiscleanup-site',
			{
				source: tempDir,
				fqdn: 'app.test.example.org',
				domainName: 'test.example.org',
				globalPriceClass: false,
			},
			{ env: { account: '123', region: 'us-east-1' } },
		)
		const template = Template.fromStack(stack)
		expect(template.toJSON()).toMatchSnapshot()
	})
})
