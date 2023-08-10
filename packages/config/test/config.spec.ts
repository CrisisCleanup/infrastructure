import os from 'node:os'
import { expect, it, describe, vi, beforeEach } from 'vitest'
import {
	getConfigDefaults,
	baseConfig,
	defineConfig,
	loadEnvOverrides,
	getConfig,
	flattenToScreamingSnakeCase,
} from '../src/index'

describe('getConfig', () => {
	beforeEach(() => {
		Reflect.deleteMetadata(
			Symbol.for('@crisiscleanup:config:defaults'),
			baseConfig,
		)
	})

	it('returns expected defaults', () => {
		expect(getConfigDefaults()).toStrictEqual(baseConfig)
	})

	it('merges additional definitions', () => {
		defineConfig({
			// @ts-expect-error in practice would have types merged
			otherKey: {
				value: 'would also have types merged usually',
			},
		})
		expect(getConfigDefaults()).toMatchObject(baseConfig)
		expect(getConfigDefaults()).not.toStrictEqual(baseConfig)
		expect(getConfigDefaults()).toMatchObject({
			otherKey: {
				value: 'would also have types merged usually',
			},
		})
	})

	it('allows override of additional definitions', () => {
		vi.stubEnv('SOME__KEY_TO', 'override')
		defineConfig({
			// @ts-expect-error in practice would have types merged
			some: { keyTo: 'original' },
		})
		expect(loadEnvOverrides()).toMatchObject({
			some: { keyTo: 'override' },
		})
		vi.unstubAllEnvs()
	})

	it('applies env overrides to environment configs', async () => {
		const envForOverride = flattenToScreamingSnakeCase(getConfigDefaults())
		Object.keys(envForOverride)
			.filter((key) => key in process.env)
			.forEach((key) => vi.stubEnv(key, ''))
		vi.stubEnv('CCU_STAGE', 'development')
		vi.stubEnv('CCU_CONFIGS_DECRYPT', 'false')
		defineConfig({
			api: { config: { ccu: { apiUrl: 'https://some.url.com' } } },
			$meta: { name: 'crisiscleanup' },
			$development: {
				ccuStage: 'development',
				api: { config: { ccu: { apiUrl: 'https://some.dev.url.com' } } },
			},
		})
		vi.stubEnv('API__CONFIG__CCU__API_URL', 'https://some.override.url.com')
		const cfg = await getConfig(
			{
				strict: true,
				useEnvOverrides: true,
			},
			{
				cwd: os.tmpdir(),
				defaultConfig: {
					$env: {
						// @ts-ignore
						development: {
							ccuStage: 'development',
							// @ts-ignore
							api: { config: { ccu: { apiUrl: 'https://some.dev.url.com' } } },
						},
					},
				},
			},
		)
		expect(cfg.config).toMatchObject({
			api: { config: { ccu: { apiUrl: 'https://some.override.url.com' } } },
		})
		expect(cfg.config.$env).toMatchObject({
			development: {
				api: { config: { ccu: { apiUrl: 'https://some.override.url.com' } } },
			},
		})
		vi.unstubAllEnvs()
	})
})
