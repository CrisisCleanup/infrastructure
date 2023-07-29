import type {ApiStackConfig} from './types'

declare module '@crisiscleanup/config' {
  export interface CrisisCleanupConfig {
    apiStack: ApiStackConfig
  }
}
