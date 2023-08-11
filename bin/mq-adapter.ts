/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import 'source-map-support/register';
import { App, aws_ecs, Fn, Tags } from 'aws-cdk-lib';
import { MqAdapterStack } from '../lib/mq-adapter-stack';
import { AmazonMQIntegrationStack } from '../lib/mq-amazon-mq-stack';
import { BastionStack } from '../lib/mq-bastions';
import { IBMMQMockStack } from '../lib/mq-mock-stack';
import { S3IntegrationStack } from '../lib/mq-s3-dlq-stack';
import { SNSIntegrationStack } from '../lib/mq-sns-stack';
import { SQSIntegrationStack } from '../lib/mq-sqs-stack';
import { createKMSInstance, MQConfigEnvironments } from '../lib/utils';

function areIntegrationsUsingMQ(environments: any) {
  for (const conf in environments) {
    const devConfig: MQConfigEnvironments = environments[conf].envs;
    if (devConfig.AMAZONMQ_REQUEST_ROUTE_ENABLED === 'true' || devConfig.AMAZONMQ_RESPONSE_ROUTE_ENABLED === 'true') {
      return true;
    }
  }
  return false;
}

function setUpEnvironment(app: App, stage: string, env: any) {
  if (stage !== 'prod') {
    const mqMockStack = new IBMMQMockStack(app, `mqMockStack-${stage}`, { stage, env });
  }
  const bastionStack = new BastionStack(app, `mqBastionStack-${stage}`, { stage, env });

  const { environments } = app.node.tryGetContext('stages')[stage];

  const isMQNeeded = areIntegrationsUsingMQ(environments);
  let amazonMQStack: AmazonMQIntegrationStack;

  if (isMQNeeded) {
    amazonMQStack = new AmazonMQIntegrationStack(app, `amazonMQStack-${stage}`, { stage, env });
  }

  for (const conf in environments) {
    // eslint-disable-next-line import/no-dynamic-require

    const devConfig: MQConfigEnvironments = environments[conf].envs;
    const adapterSecrets: { [key: string]: aws_ecs.Secret } = {};

    const kmsStack = createKMSInstance(app, `KMS-${stage}-${conf}`, { stage, environment: conf, env });
    const s3Stack = new S3IntegrationStack(app, `S3-dlq-${stage}-${conf}`, { stage, environment: conf, env });

    if (stage !== 'prod') {
      devConfig.IBM_HOSTNAME = Fn.importValue('ibmMQendpoint');
    }

    devConfig.S3_DEADLETTER = s3Stack.bucket.bucketName;
    devConfig.KMS_KEY_ARN = kmsStack.kmsKey.keyArn;

    if (devConfig.AMAZONMQ_REQUEST_ROUTE_ENABLED === 'true' || devConfig.AMAZONMQ_RESPONSE_ROUTE_ENABLED === 'true') {
      devConfig.AMAZONMQ_BROKER_URL = `ssl://${Fn.importValue('amazonMQEndpoint')}:61617`;
      devConfig.AMAZONMQ_USERNAME = amazonMQStack!.username;
      adapterSecrets.AMAZONMQ_PASSWORD = aws_ecs.Secret.fromSecretsManager(amazonMQStack!.password);
    }

    if (devConfig.SNS_REQUEST_ROUTE_ENABLED === 'true') {
      const snsIntegrationStack = new SNSIntegrationStack(app, `snsIntegrationStack-${conf}-${stage}`, { stage, environment: conf, env });
      devConfig.SNS_TARGET_ARN = snsIntegrationStack.topic.topicArn;
      devConfig.SNS_PAYLOAD = snsIntegrationStack.topicStorage.bucketName;
    }

    if (devConfig.SQS_REQUEST_ROUTE_ENABLED === 'true') {
      // Integratration publishes messages cross account to allow consumer to scale
      if (!devConfig.SQS_REQUEST_QUEUE_ARN || !devConfig.SQS_REQUEST_PAYLOAD) {
        console.error('You must define SQS_REQUEST_QUEUE_ARN and SQS_REQUEST_PAYLOAD under cdk.json');
      }
    }

    if (devConfig.SQS_RESPONSE_ROUTE_ENABLED === 'true') {
      const sqsPublishIntegrationStack = new SQSIntegrationStack(app, `sqsPublishIntegrationStack-${conf}-${stage}`, {
        stage, environment: conf, env, integrationConsumer: true,
      });
      devConfig.SQS_RESPONSE_QUEUE_ARN = sqsPublishIntegrationStack.queue.queueArn;
      devConfig.SQS_RESPONSE_PAYLOAD = sqsPublishIntegrationStack.queueStorage.bucketName;
    }

    const mqStack = new MqAdapterStack(app, `mqAdapterStack-${conf}-${stage}`, {
      stage,
      env,
      envs: devConfig,
      secrets: adapterSecrets,
      environment: conf,
    });

    Tags.of(app).add('Project', 'mq-adapter');
    Tags.of(app).add('Integration', conf);
    Tags.of(app).add('Environment', `${stage}`);

  }

}

const app = new App();

const stages = app.node.tryGetContext('stages');

for (let stage in stages) {
  setUpEnvironment(app, stage, { account: stages[stage].accountId, region: stages[stage].region });
}