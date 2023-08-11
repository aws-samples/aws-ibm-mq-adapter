/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import path from 'path';
import { StackProps, aws_ecs, Stack, aws_iam, aws_ec2, RemovalPolicy, Aws, Duration, aws_secretsmanager, aws_cloudwatch, aws_lambda, aws_sqs } from 'aws-cdk-lib';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { LogGroup, RetentionDays, MetricFilter, FilterPattern } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { MQConfigEnvironments } from './utils';

export interface MQAdapterProps extends StackProps {
  secrets?: { [key: string]: aws_ecs.Secret };
  envs: MQConfigEnvironments;
  stage: string;
  environment: string;
}

export class MqAdapterStack extends Stack {
  public service: aws_ecs.FargateService;

  public brokerRole: aws_iam.Role;

  constructor(scope: Construct, id: string, props: MQAdapterProps) {
    super(scope, id, props);

    const stack = this.stackName.toLowerCase();

    const { defaultVpcId, environments } = this.node.tryGetContext('stages')[props.stage];

    const vpc = aws_ec2.Vpc.fromLookup(this, 'default-vpc', { vpcId: defaultVpcId });

    const fargateCluster = new aws_ecs.Cluster(this, 'mqAdapterCluster', {
      vpc,
      containerInsights: true,
    });

    const removalPolicy = props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const appasset = new DockerImageAsset(this, 'mqAdapterApacheCammel', {
      directory: `${__dirname}/../app`,
    });

    const trustStore = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterTrustStore', props.envs.IBMMQ_TRUSTSTORE_ARN);
    const trustStorePass = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterTrustStorePass', props.envs.IBMMQ_TRUSTSTORE_PASSWORD_ARN);

    const keyStore = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterKeyStore', props.envs.IBMMQ_KEYSTORE_ARN);
    const keyStorePass = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterKeyStorePass', props.envs.IBMMQ_KEYSTORE_PASSWORD_ARN);

    this.brokerRole = new aws_iam.Role(this, 'mqBrokerTaskExecutionRole', {
      assumedBy: new aws_iam.CompositePrincipal(
        new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      ),
    });

    this.brokerRole.addToPolicy(new aws_iam.PolicyStatement({
      actions: ['ec2:CreateNetworkInterface', 'ec2:DeleteNetworkInterface', 'ec2:DescribeNetworkInterfaces'],
      effect: aws_iam.Effect.ALLOW,
      resources: ['*'],
    }));

    const mqBrokerTaskDefinition = new aws_ecs.FargateTaskDefinition(this, 'mqBrokerTaskDefinition', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: this.brokerRole,
      taskRole: this.brokerRole,
    });

    const logGroup = new LogGroup(this, 'LogGroup', {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy,
    });

    const metricNamespace = 'MQAdapter';
    const metricName = `${stack}-failed-delivery`;

    const metricFailedDelivery = new MetricFilter(this, 'MetricFilter', {
      filterPattern: FilterPattern.allTerms('FailedDelivery', 'ERROR'),
      metricNamespace,
      metricName,
      metricValue: '1',
      logGroup,
    });

    const alarmFailedDelivery = new aws_cloudwatch.Alarm(this, 'Alarm', {
      alarmDescription: `${stack} Failed to deliver a message`,
      metric: new aws_cloudwatch.Metric({
        metricName,
        namespace: metricNamespace,
        statistic: aws_cloudwatch.Statistic.MAXIMUM,
      }),
      threshold: 1,
      comparisonOperator: aws_cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: aws_cloudwatch.TreatMissingData.IGNORE,
    });

    const logLevel = props.stage === 'prod' ? 'INFO' : 'DEBUG';

    const springProfile : string[] = [];

    if (props.envs.AMAZONMQ_REQUEST_ROUTE_ENABLED === 'true') {
      springProfile.push('MQProducer');
    }
    if (props.envs.AMAZONMQ_RESPONSE_ROUTE_ENABLED === 'true') {
      springProfile.push('MQConsumer');
    }
    if (props.envs.SNS_REQUEST_ROUTE_ENABLED === 'true') {
      springProfile.push('SNSProducer');
    }
    if (props.envs.SQS_REQUEST_ROUTE_ENABLED === 'true') {
      springProfile.push('SQSProducer');
    }
    if (props.envs.SQS_RESPONSE_ROUTE_ENABLED === 'true') {
      springProfile.push('SQSConsumer');
    }

    const envs = {
      // Use broker-dev.properties
      PROFILE: props.stage,
      ...props.envs as unknown as { [key: string]: string },
      LOG_LEVEL: logLevel,
      SPRING_PROFILES_ACTIVE: springProfile.toString(),
    };

    const secrets = {
      TRUSTSTORE_PASSWORD: aws_ecs.Secret.fromSecretsManager(trustStorePass),
      KEYSTORE_PASSWORD: aws_ecs.Secret.fromSecretsManager(keyStorePass),
      ...props.secrets,
    };

    mqBrokerTaskDefinition.addContainer('mqAdapterContainer', {
      image: aws_ecs.ContainerImage.fromEcrRepository(appasset.repository, appasset.assetHash),
      logging: aws_ecs.LogDriver.awsLogs({
        logGroup,
        streamPrefix: 'mqAdapter',
      }),
      environment: {
        AWS_REGION: Aws.REGION,
        ...envs,
      },
      secrets,
    });

    this.service = new aws_ecs.FargateService(this, 'mqBrokerService', {
      cluster: fargateCluster,
      taskDefinition: mqBrokerTaskDefinition,
      assignPublicIp: false,
      desiredCount: 1,
    });

    const scaling = this.service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 10 });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    const scalingSteps = [{ upper: 0, change: -1 }, { lower: 100, change: +1 }, { lower: 500, change: +5 }];

    if (springProfile.includes('SQSConsumer')) {
      const responseQueue = aws_sqs.Queue.fromQueueArn(this, 'response-queue', props.envs.SQS_RESPONSE_QUEUE_ARN!);
      scaling.scaleOnMetric('QueueMessagesVisibleScaling', {
        metric: responseQueue.metricApproximateNumberOfMessagesVisible(),
        scalingSteps,
      });
    }
    if (springProfile.includes('MQConsumer') || springProfile.includes('MQProducer')) {
      scaling.scaleOnMetric('QueueMessagesVisibleScaling', {
        metric: new aws_cloudwatch.Metric({
          metricName: 'QueueSize',
          label: 'Queue Size',
          namespace: 'AWS/AmazonMQ',
          dimensionsMap: {
            Broker: 'AmazonMQ-1',
            Queue: props.envs.AMAZONMQ_RESPONSE_QUEUE!,
          },
          unit: aws_cloudwatch.Unit.COUNT,
          period: Duration.minutes(1),
          statistic: 'avg',
        }),
        scalingSteps,
      });

    }

    trustStore.grantRead(this.brokerRole);
    keyStore.grantRead(this.brokerRole);

    this.brokerRole.addToPolicy(new aws_iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:PutObjectAcl'],
      effect: aws_iam.Effect.ALLOW,
      resources: [`arn:aws:s3:::${props.envs.S3_DEADLETTER}/*`],
    }));

    this.brokerRole.addToPolicy(new aws_iam.PolicyStatement({
      sid: 'AllowMQBrokerToEncrypt',
      actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
      effect: aws_iam.Effect.ALLOW,
      resources: [props.envs.KMS_KEY_ARN],
    }));

    this.brokerRole.addToPolicy(new aws_iam.PolicyStatement({
      actions: ['sqs:ListQueues', 'sns:ListTopics'],
      effect: aws_iam.Effect.ALLOW,
      resources: ['*'],
    }));

    this.grantBrokerPermissions(props.envs.SNS_REQUEST_ROUTE_ENABLED, ['sns:Publish'], props.envs.SNS_TARGET_ARN, props.envs.SNS_PAYLOAD);
    this.grantBrokerPermissions(props.envs.SQS_REQUEST_ROUTE_ENABLED, ['sqs:SendMessage'], props.envs.SQS_REQUEST_QUEUE_ARN, props.envs.SQS_REQUEST_PAYLOAD);
    this.grantBrokerPermissions(props.envs.SQS_RESPONSE_ROUTE_ENABLED, ['sqs:ReceiveMessage', 'sqs:SendMessage', 'sqs:DeleteMessage'], props.envs.SQS_RESPONSE_QUEUE_ARN, props.envs.SQS_RESPONSE_PAYLOAD);
  }

  grantBrokerPermissions(
    featureFlag: string | undefined,
    servicePermission: string[],
    serviceARN: string | undefined,
    servicePayloadARN: string | undefined,
  ) {
    if (featureFlag === 'true') {
      if (serviceARN && servicePayloadARN) {
        this.brokerRole.addToPolicy(new aws_iam.PolicyStatement({
          actions: servicePermission,
          effect: aws_iam.Effect.ALLOW,
          resources: [serviceARN],
        }));

        this.brokerRole.addToPolicy(new aws_iam.PolicyStatement({
          actions: ['s3:PutObject', 's3:PutObjectAcl', 's3:GetObject', 's3:GetObjectACL', 's3:DeleteObject'],
          effect: aws_iam.Effect.ALLOW,
          resources: [`arn:aws:s3:::${servicePayloadARN}/*`],
        }));
      } else {
        console.error(`${servicePermission} not granted. Feature flag is enabled but service ARN or service payload ARN are not set correctly`);
      }
    }
  }
}
