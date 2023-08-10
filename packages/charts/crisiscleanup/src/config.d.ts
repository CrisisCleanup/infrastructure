import type {CrisisCleanupChartProps} from './lib'
import { PartialDeep } from "type-fest";

 declare module '@crisiscleanup/config' {
	 export interface CrisisCleanupConfigInput {
		 chart?: PartialDeep<Omit<CrisisCleanupChartProps, 'apiAppSecrets' | 'apiAppConfig'>>
	 }
 	export interface CrisisCleanupConfig {
 		chart?: Omit<CrisisCleanupChartProps, 'apiAppSecrets' | 'apiAppConfig'>
 	}
 }
