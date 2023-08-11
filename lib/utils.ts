/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// eslint-disable-next-line import/no-cycle
import { KMSStack } from './mq-kms-stack';

export interface MQConfigEnvironments {
  IBM_HOSTNAME : string;
  IBMMQ_QUEUE_MANAGER : string;
  IBMMQ_CHANNEL : string;
  IBMMQ_TRUSTSTORE_ARN : string;
  IBMMQ_TRUSTSTORE_PASSWORD_ARN : string;
  IBMMQ_KEYSTORE_ARN : string;
  IBMMQ_KEYSTORE_PASSWORD_ARN : string;
  S3_DEADLETTER : string;
  KMS_KEY_ARN : string;
  AMAZONMQ_REQUEST_ROUTE_ENABLED? : string;
  AMAZONMQ_RESPONSE_ROUTE_ENABLED? : string;
  AMAZONMQ_BROKER_URL : string;
  AMAZONMQ_USERNAME : string;
  AMAZONMQ_CONSUMER_USERNAME: string;
  IBMMQ_REQUEST_QUEUE? : string;
  AMAZONMQ_REQUEST_QUEUE? : string;
  IBMMQ_RESPONSE_QUEUE? : string;
  AMAZONMQ_RESPONSE_QUEUE? : string;
  KINESIS_ROUTE_ENABLED : string;
  KINESIS_STREAM_ARN? : string;
  SNS_REQUEST_ROUTE_ENABLED? : string;
  SNS_TARGET_ARN? : string;
  SNS_PAYLOAD? : string;
  SQS_REQUEST_ROUTE_ENABLED? : string;
  SQS_REQUEST_QUEUE_ARN? : string;
  SQS_REQUEST_PAYLOAD? : string;
  SQS_RESPONSE_ROUTE_ENABLED? : string;
  SQS_RESPONSE_QUEUE_ARN? : string;
  SQS_RESPONSE_PAYLOAD? : string;
}


export interface IntegrationProps extends StackProps {
  stage: string;
  environment: string;
}

// eslint-disable-next-line max-len
export function createKMSInstance(scope: Construct, id: string, props: IntegrationProps): KMSStack {
  return KMSStack.getInstance(scope, id, props);
}
