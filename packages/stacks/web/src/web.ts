import {
	StaticWebsite,
	StaticWebsiteOrigin,
} from '@aws-prototyping-sdk/static-website'
import { Duration, Stack, type StackProps } from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets'
import type { Construct } from 'constructs'

export interface CrisisCleanupWebProps {
	/**
	 * Path to site source files.
	 */
	readonly source: string
	/**
	 * Hosted zone domain name.
	 */
	readonly domainName: string
	/**
	 * App FQDN.
	 */
	readonly fqdn: string
	/**
	 * Utilize PRICE_CLASS_ALL for CloudFront distribution.
	 */
	readonly globalPriceClass?: boolean
}

/**
 * Maintenance site for crisiscleanup.org
 */
export class CrisisCleanupWeb extends Stack {
	readonly zone?: route53.IHostedZone
	readonly certificate?: acm.ICertificate
	readonly website: StaticWebsite

	constructor(
		scope: Construct,
		id: string,
		props: CrisisCleanupWebProps,
		stackProps?: StackProps,
	) {
		super(scope, id, stackProps)

		if (stackProps?.env) {
			this.zone = route53.HostedZone.fromLookup(this, id + '-hosted-zone', {
				domainName: props.domainName,
				privateZone: false,
			})

			this.certificate = new acm.Certificate(this, id + '-certificate', {
				domainName: props.domainName,
				validation: acm.CertificateValidation.fromDns(this.zone),
			})
		}

		this.website = new StaticWebsite(this, id + '-ccu-web-static-site', {
			websiteContentPath: props.source,
			distributionProps: {
				defaultBehavior: {
					// no-op class; `StaticWebsite` maps this later.
					origin: new StaticWebsiteOrigin(),
				},
				comment: 'CrisisCleanup Site',
				certificate: this.certificate,
				priceClass: props.globalPriceClass
					? cloudfront.PriceClass.PRICE_CLASS_ALL
					: cloudfront.PriceClass.PRICE_CLASS_100,
				domainNames: [props.fqdn],
			},
		})

		if (this.zone) {
			new route53.ARecord(this, id + '-alias-record', {
				zone: this.zone,
				comment: 'CCU Web',
				target: route53.RecordTarget.fromAlias(
					new route53Targets.CloudFrontTarget(
						this.website.cloudFrontDistribution,
					),
				),
				ttl: Duration.seconds(300),
				recordName: props.fqdn,
			})
		}
	}
}
