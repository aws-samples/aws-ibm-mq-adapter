/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { StackProps, Stack, aws_iam, RemovalPolicy, PhysicalName, aws_kms, aws_s3, aws_sns_subscriptions, aws_sns, aws_sqs } from 'aws-cdk-lib';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { createKMSInstance } from './utils';

export interface SNSIntegrationProps extends StackProps {
  stage: string;
  environment: string;
}

export class SNSIntegrationStack extends Stack {
  public topic: aws_sns.Topic;

  public topicStorage: aws_s3.Bucket;

  public kmsKey: aws_kms.Key;

  public queue: Queue | undefined;

  constructor(scope: Construct, id: string, props: SNSIntegrationProps) {
    super(scope, id, props);

    this.kmsKey = createKMSInstance(scope, `KMS-${props.stage}-${props.environment}`, props).kmsKey;

    const removalPolicy = props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.topicStorage = new aws_s3.Bucket(this, 'mqSNSPayloadStorage', {
      versioned: true,
      encryption: aws_s3.BucketEncryption.KMS,
      encryptionKey: this.kmsKey,
      publicReadAccess: false,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
    });

    // Encryption not enabled, metadata only
    this.topic = new aws_sns.Topic(this, 'mqSNSTarget');

    this.setupConsumerGrants(props);

    // For production, consumer should provide SQS
    // Only for Integration Tests purposes
    if (props.stage === 'dev' || props.stage === 'int') {
      this.queue = new aws_sqs.Queue(this, 'SQSsubscribedtoSNS', {
        queueName: PhysicalName.GENERATE_IF_NEEDED,
        encryption: aws_sqs.QueueEncryption.KMS,
        encryptionMasterKey: this.kmsKey,
      });
      this.topic.addSubscription(new aws_sns_subscriptions.SqsSubscription(this.queue));
    }
  }

  private setupConsumerGrants(props: SNSIntegrationProps) {
    const { environments } = this.node.tryGetContext('stages')[props.stage];

    const allowedPrincipalsConfig = environments[props.environment].allowedPrincipals;

    const allowedPrincipals: aws_iam.ArnPrincipal[] = allowedPrincipalsConfig.map((principal: string) => new aws_iam.ArnPrincipal(principal));

    allowedPrincipals.forEach((principal: aws_iam.ArnPrincipal) => this.grantReadfromS3(principal));
    allowedPrincipals.forEach((principal: aws_iam.ArnPrincipal) => this.grantSubscribe(principal));
  }

  private grantReadfromS3(grantee: aws_iam.ArnPrincipal) {
    this.topicStorage.grantRead(grantee);
    this.kmsKey.grantDecrypt(grantee);
  }

  private grantSubscribe(grantee: aws_iam.ArnPrincipal) {
    this.topic.addToResourcePolicy(new aws_iam.PolicyStatement({
      sid: `AllowToSubscribe -${grantee.toString()}`,
      effect: aws_iam.Effect.ALLOW,
      principals: [grantee],
      actions: [
        'sns:Subscribe',
      ],
      resources: [this.topic.topicArn],
    }));
  }

  grantPublish(grantee: aws_iam.ArnPrincipal) {
    this.kmsKey.addToResourcePolicy(new aws_iam.PolicyStatement({
      sid: `AllowToEncrypt -${grantee.toString()}`,
      effect: aws_iam.Effect.ALLOW,
      principals: [grantee],
      actions: [
        'aws_kms.:Encrypt',
        'aws_kms.:GenerateDataKey*',
      ],
      resources: ['*'],
    }));

    this.topicStorage.addToResourcePolicy(new aws_iam.PolicyStatement({
      sid: `AllowToUpload-${grantee.toString()}`,
      effect: aws_iam.Effect.ALLOW,

      principals: [grantee],
      actions: [
        's3:PutObjct',
        's3:PutObjctACL',
      ],
      resources: [
        this.topicStorage.bucketArn,
        this.topicStorage.arnForObjects('*'),
      ],
      conditions: {
        StringEquals: {
          's3:x-amz-server-side-encryption': 'aws:aws_kms.',
          's3:x-amz-server-side-encryption-aws-aws_kms.-key-id': this.kmsKey.keyArn,
        },
      },
    }));

    this.topic.addToResourcePolicy(new aws_iam.PolicyStatement({
      sid: `AllowToPublish-${grantee.toString()}`,

      effect: aws_iam.Effect.ALLOW,
      principals: [grantee],
      actions: [
        'sns:Publish',
      ],
      resources: [this.topic.topicArn],
    }));
  }
}
