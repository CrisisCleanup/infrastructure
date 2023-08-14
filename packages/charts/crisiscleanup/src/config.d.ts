import type {CrisisCleanupChartConfig} from './lib'
import { PartialDeep } from "type-fest";

 declare module '@crisiscleanup/config' {
	 export interface CrisisCleanupConfigInput {
		 chart?: PartialDeep<CrisisCleanupChartConfig>
	 }
 	export interface CrisisCleanupConfig {
 		chart?: CrisisCleanupChartConfig
 	}
 }
