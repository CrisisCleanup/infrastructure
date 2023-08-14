import type { CrisisCleanupChartConfig } from './schema'

 declare module '@crisiscleanup/config' {
	 export interface CrisisCleanupConfigInput {
		 chart?: CrisisCleanupChartConfig
	 }
 	export interface CrisisCleanupConfig {
 		chart?: CrisisCleanupChartConfig
 	}
 }
