import { expect, it, describe, vi } from 'vitest'
import {
	getConfigDefaults,
	baseConfig,
	defineConfig,
	loadEnvOverrides,
} from '../src/index'

describe('getConfig', () => {
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
})
