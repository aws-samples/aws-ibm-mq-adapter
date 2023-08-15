/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { StackProps, Stack, aws_secretsmanager, aws_iam, aws_ecs_patterns, CfnOutput, aws_ecs } from 'aws-cdk-lib';
import { Peer, Port, Vpc } from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface MQAdapterProps extends StackProps {
  stage: string;
}

export class IBMMQMockStack extends Stack {
  public endpoint: string;

  constructor(scope: Construct, id: string, props: MQAdapterProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'default-vpc', { vpcId: this.node.tryGetContext('stages')[props.stage].defaultVpcId });

    this.endpoint = this.node.tryGetContext('endpoint');

    const fargateCluster = new aws_ecs.Cluster(this, 'ibmMQFargateCluster', { vpc });
    let ibmmq = null;

    const mqAdapterIbmMockPublicCertARN = this.node.tryGetContext('stages')[props.stage].mock.IBM_MOCK_PUBLIC_CERT_ARN;
    const mqAdapterIbmMockPrivateCertARN = this.node.tryGetContext('stages')[props.stage].mock.IBM_MOCK_PRIVATE_CERT_ARN;
    const mqAdapterIbmMockClientPublicCertARN = this.node.tryGetContext('stages')[props.stage].mock.IBM_MOCK_CLIENT_PUBLIC_CERT_ARN;

    const ibmMockPublicCert = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterIbmMockPublicCert', mqAdapterIbmMockPublicCertARN);
    const ibmMockPrivateCert = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterIbmMockPrivateCert', mqAdapterIbmMockPrivateCertARN);
    const ibmMockClientPublicCert = aws_secretsmanager.Secret.fromSecretCompleteArn(this, 'mqAdapterIbmMockClientPublicCert', mqAdapterIbmMockClientPublicCertARN);

    const ibmMockAdminPassword = new Secret(this, 'ibmMQAdminSecret', {
      secretName: 'mqAdapterIbmMockAdminPassword',
      generateSecretString: {
        passwordLength: 8,
        excludePunctuation: true,
      },
    });

    const ibmmqmock = new DockerImageAsset(this, 'mqAdapterIBMMock', {
      directory: `${__dirname}/../mock`,
    });

    const ibmMqImage = aws_ecs.ContainerImage.fromEcrRepository(ibmmqmock.repository,
      ibmmqmock.assetHash);

    const mqMockRole = new aws_iam.Role(this, 'mqMockRole', {
      assumedBy: new aws_iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    ibmMockPublicCert.grantRead(mqMockRole);
    ibmMockPrivateCert.grantRead(mqMockRole);
    ibmMockClientPublicCert.grantRead(mqMockRole);
    ibmMockAdminPassword.grantRead(mqMockRole);

    ibmmq = new aws_ecs_patterns.NetworkMultipleTargetGroupsFargateService(this, 'mqAdapterIBMFargateMock', {
      cluster: fargateCluster,
      cpu: 2048, // Default is 256
      desiredCount: 1,
      taskImageOptions: {
        image: ibmMqImage,
        containerName: 'ibmMq',
        containerPorts: [1414, 9443],
        executionRole: mqMockRole,
        taskRole: mqMockRole,
      },
      targetGroups: [
        {
          containerPort: 1414,
          listener: 'mq',
        },
        {
          containerPort: 9443,
          listener: 'web',
        },
      ],
      loadBalancers: [{
        name: 'mqLoadBalancer',
        publicLoadBalancer: false,
        listeners: [
          {
            name: 'mq',
            port: 1414,
          },
          {
            name: 'web',
            port: 9443,
          },
        ],
      }],
      memoryLimitMiB: 4096, // Default is 512
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const output = new CfnOutput(this, 'endpoint', { exportName: 'ibmMQendpoint', value: ibmmq.loadBalancer.loadBalancerDnsName });

    // open to VPC CIDR - health checks fail otherwise
    // allow from anywhere to support Session Manager socat
    ibmmq.service.connections.allowFrom(Peer.ipv4('0.0.0.0/0'), Port.tcp(1414), 'allow MQ Adapter');
    ibmmq.service.connections.allowFrom(Peer.ipv4('0.0.0.0/0'), Port.tcp(9443), 'allow web UI');
  }
}
