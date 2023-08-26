import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import { Construct } from 'constructs'

export interface DelegatorZoneProps {
	readonly zoneName: string
	readonly delegateAccountId: string
	readonly roleName: string
}

export interface DelegatedHostedZoneProps {
	readonly parentAccountId: string
	readonly parentDomain: string
	readonly subdomain: string
	readonly delegationRoleName: string
}

interface DelegatorProps
	extends Omit<
		DelegatedHostedZoneProps,
		'delegationRoleName' | 'parentAccountId' | 'parentDomain'
	> {}

export interface IDelegator {
	delegate(
		scope: Construct,
		id: string,
		options: DelegatorProps,
	): route53.IPublicHostedZone
}

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

	delegate(scope: Construct, id: string, options: DelegatorProps) {
		const props: DelegatedHostedZoneProps = {
			parentDomain: this.parentZone.zoneName,
			parentAccountId: this.account,
			delegationRoleName: this.delegationRole.roleName,
			...options,
		}
		return new DelegatedHostedZone(scope, id, props).subZone
	}
}

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
