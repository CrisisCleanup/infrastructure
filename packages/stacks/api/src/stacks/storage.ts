import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { type Construct } from 'constructs'
import { type StorageConfig } from '../schema'

export class StorageStack extends cdk.Stack {
	constructor(
		scope: Construct,
		id: string,
		readonly props: StorageConfig,
		stackProps?: cdk.StackProps,
	) {
		super(scope, id, stackProps)

		const e2eTestReportsBucketName = 'ccu-e2e-test-reports'
		const e2eTestReportsS3 = new s3.Bucket(scope, id, {
			bucketName: e2eTestReportsBucketName,
			versioned: false,
			encryption: s3.BucketEncryption.S3_MANAGED,
			accessControl: s3.BucketAccessControl.PUBLIC_READ,
			publicReadAccess: true,
			objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
		})
	}
}
