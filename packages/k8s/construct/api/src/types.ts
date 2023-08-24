import {
	type ApiAppConfig,
	type ApiAppSecrets,
	type FlattenObject,
	type ScreamingSnakeCaseProperties,
} from '@crisiscleanup/config'
import { type DeploymentProps } from '@crisiscleanup/k8s.construct.component'
import type * as kplus from 'cdk8s-plus-27'

export interface ApiConfigProps {
	config: ScreamingSnakeCaseProperties<FlattenObject<ApiAppConfig, '_'>>
	secrets?: ScreamingSnakeCaseProperties<FlattenObject<ApiAppSecrets, '_'>>
}

export interface ApiProps extends DeploymentProps {
	config?: IApiConfig
}

export interface CeleryProps extends ApiProps {
	queues: string[]
	name?: string
	concurrency?: number
	args?: string[]
}

export interface ApiWSGIProps extends ApiProps {
	workers?: number
	threads?: number
}

export interface ApiASGIProps extends ApiProps {
	workers?: number
}

export interface IHttpProbable {
	httpProbePath: string
}

export interface IApiConfig {
	configMap: kplus.ConfigMap
	configSecret?: kplus.Secret
	readonly env: kplus.Env
}

export interface ApiConstructConfig {
	wsgi: Omit<ApiWSGIProps, 'config'>
	asgi: Omit<ApiASGIProps, 'config'>
	celery: Record<string, Omit<CeleryProps, 'config'>>
	celeryBeat: Omit<ApiProps, 'config'>
	adminWebsocket: Omit<ApiProps, 'config'>
}
