import { StaticWebsite, StaticWebsiteOrigin } from '@aws/pdk/static-website'
import { Duration, Stack, type StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets'
import type { Construct } from 'constructs'

export interface MaintenanceSiteProps {
	/**
	 * Path to site source files.
	 */
	readonly source: string
	/**
	 * Domain name to use.
	 * @default crisiscleanup.org
	 */
	readonly domainName?: string
}

/**
 * Maintenance site for crisiscleanup.org
 */
export class MaintenanceSite extends Stack {
	readonly zone?: route53.IHostedZone
	readonly certificate?: acm.ICertificate
	readonly website: StaticWebsite
	readonly domainName: string

	constructor(
		scope: Construct,
		id: string,
		props: MaintenanceSiteProps,
		stackProps?: StackProps,
	) {
		const { crossRegionReferences = true, ...restStackProps } = stackProps ?? {}
		super(scope, id, {
			...restStackProps,
			crossRegionReferences,
		})
		this.domainName = props.domainName ?? 'crisiscleanup.org'
		const cnameRecord = `maintenance.${this.domainName}`

		// Cloudfront requires ACM certificates to be in us-east-1 (ACM isn't global like cloudfront is).
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		let certStack: Stack = this
		if (this.region !== 'us-east-1') {
			certStack = new Stack(scope, id + '-zone-stack', {
				description: `Zone Stack for maintenance site`,
				crossRegionReferences: true,
				env: { account: this.account, region: 'us-east-1' },
			})
		}

		if (stackProps?.env) {
			this.zone = route53.HostedZone.fromLookup(this, id + '-hosted-zone', {
				domainName: this.domainName,
			})

			this.certificate = new acm.Certificate(certStack, id + '-certificate', {
				domainName: this.domainName,
				validation: acm.CertificateValidation.fromDns(this.zone),
				subjectAlternativeNames: [
					cnameRecord,
					`*.${this.domainName}`,
					this.domainName,
				],
			})
		}

		this.website = new StaticWebsite(this, id + '-static-site', {
			webAclProps: { disable: true },
			websiteContentPath: props.source,
			distributionProps: {
				defaultBehavior: {
					// no-op class; `StaticWebsite` maps this later.
					origin: new StaticWebsiteOrigin(),
				},
				comment: 'Maintenance Site',
				certificate: this.certificate,
				priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
				domainNames: [cnameRecord],
			},
		})

		if (this.zone) {
			new route53.ARecord(this, id + '-alias-record', {
				zone: this.zone,
				comment: 'Maintenance Site',
				target: route53.RecordTarget.fromAlias(
					new route53Targets.CloudFrontTarget(
						this.website.cloudFrontDistribution,
					),
				),
				ttl: Duration.seconds(300),
				recordName: cnameRecord,
			})
		}
	}
}
