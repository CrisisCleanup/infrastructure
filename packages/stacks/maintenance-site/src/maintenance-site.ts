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

export interface MaintenanceSiteProps {
	/**
	 * Path to site source files.
	 */
	readonly source: string
}

/**
 * Maintenance site for crisiscleanup.org
 */
export class MaintenanceSite extends Stack {
	readonly zone?: route53.IHostedZone
	readonly certificate?: acm.ICertificate
	readonly website: StaticWebsite

	constructor(
		scope: Construct,
		id: string,
		props: MaintenanceSiteProps,
		stackProps?: StackProps,
	) {
		super(scope, id, stackProps)

		if (stackProps?.env) {
			this.zone = route53.HostedZone.fromLookup(this, id + '-hosted-zone', {
				domainName: 'crisiscleanup.org',
			})

			this.certificate = new acm.Certificate(this, id + '-certificate', {
				domainName: 'crisiscleanup.org',
				validation: acm.CertificateValidation.fromDns(this.zone),
				subjectAlternativeNames: ['maintenance.crisiscleanup.org'],
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
				domainNames: ['maintenance.crisiscleanup.org'],
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
				recordName: 'maintenance.crisiscleanup.org',
			})
		}
	}
}
