import type {ApiStackConfig, ApiStackConfigInput} from './schema'

declare module '@crisiscleanup/config' {
  export interface CrisisCleanupConfigInput {
    apiStack?: ApiStackConfig
  }
  export interface CrisisCleanupConfig {
    apiStack?: ApiStackConfig
  }
}
