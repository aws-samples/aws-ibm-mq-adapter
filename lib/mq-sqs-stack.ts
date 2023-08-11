/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { aws_iam, aws_kms, aws_s3, aws_sqs, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { createKMSInstance } from './utils';

export interface SQSIntegrationProps extends StackProps {
  stage: string;
  environment: string;
  integrationConsumer: boolean;
}

export class SQSIntegrationStack extends Stack {
  public queueStorage: aws_s3.Bucket;

  public kmsKey: aws_kms.Key;

  public queue: aws_sqs.Queue;

  constructor(scope: Construct, id: string, props: SQSIntegrationProps) {
    super(scope, id, props);

    this.kmsKey = createKMSInstance(scope, `KMS-${props.stage}-${props.environment}`, props).kmsKey;

    const removalPolicy = props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.queueStorage = new aws_s3.Bucket(this, 'mqSQSPayloadStorage', {
      versioned: true,
      encryption: aws_s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      publicReadAccess: false,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
    });

    this.queue = new aws_sqs.Queue(this, 'mqPublishSQS', {
      encryption: aws_sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.kmsKey,
    });

    this.setupConsumerGrants(props);
  }

  private setupConsumerGrants(props: SQSIntegrationProps) {
    const { environments } = this.node.tryGetContext('stages')[props.stage];

    const allowedPrincipalsConfig = environments[props.environment].allowedPrincipals;

    const allowedPrincipals: aws_iam.ArnPrincipal[] = allowedPrincipalsConfig.map((principal: string) => new aws_iam.ArnPrincipal(principal));

    allowedPrincipals.map((principal: aws_iam.ArnPrincipal) => this.grantIntegrationAccess(props, principal));
  }

  private grantIntegrationAccess(props: SQSIntegrationProps, grantee: aws_iam.ArnPrincipal) {
    if (props.integrationConsumer) {
      this.queue.grantSendMessages(grantee);

      this.queueStorage.addToResourcePolicy(new aws_iam.PolicyStatement({
        sid: `AllowToACL-${grantee.toString()}`,
        effect: aws_iam.Effect.ALLOW,

        principals: [grantee],
        actions: [
          's3:PutObjectACL',
        ],
        resources: [
          this.queueStorage.arnForObjects('*'),
        ],
      }));

      this.queueStorage.addToResourcePolicy(new aws_iam.PolicyStatement({
        sid: `AllowToUpload-${grantee.toString()}`,
        effect: aws_iam.Effect.ALLOW,

        principals: [grantee],
        actions: [
          's3:PutObject',
        ],
        resources: [
          this.queueStorage.arnForObjects('*'),
        ],
      }));
    } else {
      this.queue.grantConsumeMessages(grantee);
    }
    this.queueStorage.grantRead(grantee);
    this.kmsKey.addToResourcePolicy(new aws_iam.PolicyStatement(
      {
        sid: `AllowKMS-${grantee.toString()}`,
        effect: aws_iam.Effect.ALLOW,
        principals: [grantee],
        actions: [
          'kms:Decrypt',
          'kms:DescribeKey',
          'kms:GenerateDataKey',
        ],
        resources: ['*'],
      },
    ));
  }
}
