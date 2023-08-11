/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { Stack, aws_s3, aws_kms, aws_iam, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createKMSInstance, IntegrationProps } from './utils';

export class S3IntegrationStack extends Stack {
  public bucket: aws_s3.Bucket;

  public kmsKey: aws_kms.Key;

  constructor(scope: Construct, id: string, props: IntegrationProps) {
    super(scope, id, props);

    const removalPolicy = props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    this.kmsKey = createKMSInstance(scope, `KMS-${props.stage}-${props.environment}`, props).kmsKey;
    this.bucket = new aws_s3.Bucket(this, 'mqS3DeadLetter', {
      versioned: true,
      encryption: aws_s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      publicReadAccess: false,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
    });

    this.setupConsumerGrants(props);
  }

  private setupConsumerGrants(props: IntegrationProps) {
    const { environments } = this.node.tryGetContext('stages')[props.stage];

    const allowedPrincipalsConfig = environments[props.environment].allowedPrincipals;

    const allowedPrincipals: aws_iam.ArnPrincipal[] = allowedPrincipalsConfig.map((principal: string) => new aws_iam.ArnPrincipal(principal));

    allowedPrincipals.map((principal: aws_iam.ArnPrincipal) => this.grantRead(principal));
    // TODO: Should we suscribe SQS queues to topics?
  }

  private grantRead(grantee: aws_iam.ArnPrincipal) {
    this.bucket.grantRead(grantee);
    this.kmsKey.grantDecrypt(grantee);
  }
}
