import type {CrisisCleanupChartProps} from './lib'

 declare module '@crisiscleanup/config' {
 	export interface CrisisCleanupConfig {
 		chart: Omit<CrisisCleanupChartProps, 'apiAppSecrets' | 'apiAppConfig'>
 	}
 }
