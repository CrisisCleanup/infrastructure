import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import { Construct } from 'constructs'

export interface DelegatorZoneProps {
	/**
	 * Zone name to delegate.
	 */
	readonly zoneName: string
	/**
	 * Account to delegate to.
	 */
	readonly delegateAccountId: string
	/**
	 * Role name to use for delegation.
	 */
	readonly roleName: string
}

export interface DelegatedHostedZoneProps {
	/**
	 * The parent/hosting account to act as delegator.
	 */
	readonly parentAccountId: string
	/**
	 * Parent domain name to delegate.
	 */
	readonly parentDomain: string
	/**
	 * Subdomain to delegate.
	 */
	readonly subdomain: string
	/**
	 * Name to use for delegation role.
	 */
	readonly delegationRoleName: string
}

interface DelegatorProps
	extends Omit<
		DelegatedHostedZoneProps,
		'delegationRoleName' | 'parentAccountId' | 'parentDomain'
	> {}

/**
 * Behavior for a stack that delegates a subdomain to another account.
 */
export interface IDelegator {
	delegate(
		scope: Construct,
		id: string,
		options: DelegatorProps,
	): route53.IPublicHostedZone
}

/**
 * Delegate a subdomain to another account.
 */
export class DelegatorZoneStack extends cdk.Stack implements IDelegator {
	readonly parentZone: route53.IPublicHostedZone
	readonly delegationRole: iam.IRole

	constructor(
		scope: Construct,
		id: string,
		props: DelegatorZoneProps,
		stackProps?: cdk.StackProps,
	) {
		super(scope, id, stackProps)

		const zoneLookup = route53.PublicHostedZone.fromLookup(
			this,
			id + '-zone-lookup',
			{
				domainName: props.zoneName,
				privateZone: false,
			},
		)

		this.parentZone = route53.PublicHostedZone.fromPublicHostedZoneAttributes(
			this,
			id + '-zone',
			{
				zoneName: zoneLookup.zoneName,
				hostedZoneId: zoneLookup.hostedZoneId,
			},
		)

		this.delegationRole = new iam.Role(this, id + '-cross-account-role', {
			roleName: props.roleName,
			assumedBy: new iam.AccountPrincipal(props.delegateAccountId),
		})

		this.parentZone.grantDelegation(this.delegationRole)
	}

	/**
	 * Delegate a subdomain to another account.
	 * @param scope The parent scope
	 * @param id The construct id
	 * @param options The delegation options
	 */
	delegate(scope: Construct, id: string, options: DelegatorProps) {
		const props: DelegatedHostedZoneProps = {
			parentDomain: this.parentZone.zoneName,
			parentAccountId: this.account,
			delegationRoleName: this.delegationRole.roleName,
			...options,
		}
		const delegated = new DelegatedHostedZone(scope, id, props)
		delegated.node.addDependency(this)
		return delegated.subZone
	}
}

/**
 * A delegated hosted zone.
 */
export class DelegatedHostedZone extends Construct {
	readonly subZone: route53.PublicHostedZone

	constructor(scope: Construct, id: string, props: DelegatedHostedZoneProps) {
		super(scope, id)

		this.subZone = new route53.PublicHostedZone(
			this,
			props.subdomain + '-sub-zone',
			{
				zoneName: props.subdomain,
			},
		)

		const delegationRoleArn = cdk.Stack.of(scope).formatArn({
			region: '',
			service: 'iam',
			account: props.parentAccountId,
			resource: 'role',
			resourceName: props.delegationRoleName,
		})

		const delegationRole = iam.Role.fromRoleArn(
			this,
			props.subdomain + '-DelegationRole',
			delegationRoleArn,
		)

		new route53.CrossAccountZoneDelegationRecord(
			this,
			props.subdomain + '-delegate',
			{
				delegatedZone: this.subZone,
				parentHostedZoneName: props.parentDomain,
				delegationRole,
			},
		)
	}
}
