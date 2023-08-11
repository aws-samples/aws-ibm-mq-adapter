/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import * as fs from 'fs';
import { StackProps, Stack, aws_secretsmanager, aws_kms, RemovalPolicy, aws_route53, Fn, CfnResource, Duration, CfnOutput, aws_elasticloadbalancingv2, aws_amazonmq, aws_s3, aws_iam, aws_certificatemanager } from 'aws-cdk-lib';
import { Vpc, SecurityGroup, SubnetType, VpcEndpointService, Peer, Port } from 'aws-cdk-lib/aws-ec2';
import { ListenerCertificate, Protocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { IpTarget } from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

export interface AmazonMQIntegrationProps extends StackProps {
  vpcId?: string;
  stage: string;
}

export class AmazonMQIntegrationStack extends Stack {
  public endpoint: string;

  public username: string;

  public password: aws_secretsmanager.Secret;

  private consumerPasswords: aws_secretsmanager.Secret[];

  public consumerKey: aws_kms.Key;

  constructor(scope: Construct, id: string, props: AmazonMQIntegrationProps) {
    super(scope, id, props);

    const { defaultVpcId, hostedZone } = this.node.tryGetContext('stages')[props.stage];

    const vpc = Vpc.fromLookup(this, 'default-vpc', { vpcId: defaultVpcId });

    const removalPolicy = props.stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const publicHostedZone = aws_route53.HostedZone.fromLookup(this, 'publicRoute53Zone', {
      domainName: hostedZone,
      privateZone: true,
    });

    const privateHostedZone = aws_route53.HostedZone.fromLookup(this, 'privateRoute53Zone', {
      domainName: hostedZone,
      privateZone: true,
    });

    const acmMQ = new aws_certificatemanager.Certificate(this, 'Certificate', {
      domainName: `amazonmq.${publicHostedZone.zoneName}`,
      validation: aws_certificatemanager.CertificateValidation.fromDns(publicHostedZone),
    });

    const amazonMQSecurityGroup = new SecurityGroup(this, 'mqSecurityGroup', {
      vpc,
      description: 'security group attached to AmazonMQ Cluster',
      securityGroupName: 'amazon-mq-security-group',
    });

    this.username = 'camel';
    this.password = new aws_secretsmanager.Secret(this, 'camelMQPassword', { secretName: 'amazonMQPassword', generateSecretString: { passwordLength: 16, excludeCharacters: '"@/\\=:,' } });
    this.consumerPasswords = [];
    const stack = this.stackName.toLowerCase();

    const keyAlias = `mqadapter/${stack}/ConsumerSecretsManagerKey`;

    this.consumerKey = new aws_kms.Key(this, 'ConsumerSecretsManagerKey', {
      enableKeyRotation: true,
      description: 'Key that can be modified for cross account secrets sharing',
      alias: keyAlias,
      removalPolicy,
    });

    const userPool: any[] = this.setupConsumerPasswords(props);

    const hostInstance = props.stage === 'prod' ? 'mq.m5.large' : 'mq.t2.micro';

    // TODO: Scale for PROD
    const amazonMQ = new aws_amazonmq.CfnBroker(this, 'mqBroker', {
      brokerName: 'AmazonMQ',
      deploymentMode: 'ACTIVE_STANDBY_MULTI_AZ',
      publiclyAccessible: false,
      autoMinorVersionUpgrade: false,
      engineType: 'ACTIVEMQ',
      encryptionOptions: { useAwsOwnedKey: true },
      hostInstanceType: hostInstance,
      securityGroups: [amazonMQSecurityGroup.securityGroupId],
      logs: { general: true, audit: true },
      subnetIds: vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
      engineVersion: '5.15.6',
      users: [{
        consoleAccess: true,
        groups: ['admin'],
        username: 'camel',
        password: this.password.secretValue.toString(),
      }, ...userPool],
    });


    const contents = fs.readFileSync(`${__dirname}/conf/${props.stage}.xml`, { encoding: 'base64' });

    const MQconfiguration = new aws_amazonmq.CfnConfiguration(this, 'config', {
      name: `activemq-config-${props.stage}`,
      data: contents,
      engineType: 'ACTIVEMQ',
      engineVersion: '5.15.6',
    });

    const association = new aws_amazonmq.CfnConfigurationAssociation(this, 'activeMQAssociation', {
      broker: amazonMQ.ref,
      configuration: { id: MQconfiguration.ref, revision: this.resolve(Fn.getAtt(MQconfiguration.logicalId, 'Revision').toString()) },
    });

    association.addDependency(MQconfiguration);

    amazonMQ.addDependency(amazonMQSecurityGroup.node.defaultChild as CfnResource);
    amazonMQ.addDependency(this.password.node.defaultChild as CfnResource);
    for (const consumerPassword of this.consumerPasswords) {
      amazonMQ.addDependency(consumerPassword.node.defaultChild as CfnResource);
    }

    const loadBalancer = new aws_elasticloadbalancingv2.NetworkLoadBalancer(this, 'mqNetworkLoadBalancer', {
      vpc,
      internetFacing: false,

    });

    const logging = new aws_s3.Bucket(this, `MQ-logs-${props.stage}`, {
      versioned: true,
      encryption: aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      lifecycleRules: [{
        expiration: Duration.days(365),
        transitions: [{
          storageClass: aws_s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(30),
        }, {
          storageClass: aws_s3.StorageClass.GLACIER,
          transitionAfter: Duration.days(90),
        }],
      }],
    });

    loadBalancer.logAccessLogs(logging);

    const mqttListener = loadBalancer.addListener('mqttListener', {
      port: 8883,
      protocol: Protocol.TLS,
      certificates: [ListenerCertificate.fromArn(acmMQ.certificateArn)],
    });

    const aqmpListener = loadBalancer.addListener('aqmpListener', {
      port: 5671,
      protocol: Protocol.TLS,
      certificates: [ListenerCertificate.fromArn(acmMQ.certificateArn)],
    });

    const owListener = loadBalancer.addListener('openWireListener', {
      port: 61617,
      protocol: Protocol.TLS,
      certificates: [ListenerCertificate.fromArn(acmMQ.certificateArn)],
    });

    const stompListener = loadBalancer.addListener('stompListener', {
      port: 61614,
      protocol: Protocol.TLS,
      certificates: [ListenerCertificate.fromArn(acmMQ.certificateArn)],
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const privateRecord = new aws_route53.ARecord(this, 'privateDNS', {
      zone: privateHostedZone,
      recordName: `amazonmq.${privateHostedZone.zoneName}`,
      target: aws_route53.RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
    });

    aqmpListener.addTargets('aqmpTarget', {
      port: 5671,
      targets: [new IpTarget(Fn.select(0, amazonMQ.attrIpAddresses)), new IpTarget(Fn.select(1, amazonMQ.attrIpAddresses))],
      healthCheck: {
        protocol: Protocol.TCP,
      },
    });

    mqttListener.addTargets('mqttTarget', {
      port: 8883,
      targets: [new IpTarget(Fn.select(0, amazonMQ.attrIpAddresses)), new IpTarget(Fn.select(1, amazonMQ.attrIpAddresses))],
      healthCheck: {
        protocol: Protocol.TCP,
      },
    });

    stompListener.addTargets('stompTarget', {
      port: 61614,
      targets: [new IpTarget(Fn.select(0, amazonMQ.attrIpAddresses)), new IpTarget(Fn.select(1, amazonMQ.attrIpAddresses))],
      healthCheck: {
        protocol: Protocol.TCP,
      },
    });

    owListener.addTargets('owTarget', {
      port: 61617,
      targets: [new IpTarget(Fn.select(0, amazonMQ.attrIpAddresses)), new IpTarget(Fn.select(1, amazonMQ.attrIpAddresses))],
      healthCheck: {
        protocol: Protocol.TCP,
      },
    });


    // VPC Endpoint Service: Domain verification doesn't support Cloudformation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const vpcEndpointService = new VpcEndpointService(this, 'mqEndpointService', {
      vpcEndpointServiceLoadBalancers: [loadBalancer],
      allowedPrincipals: this.getAllAllowedPrincipals(props),
      acceptanceRequired: false,
    });

    // allow reverse tunnel through bastion for Web Console
    // amazonMQSecurityGroup.addIngressRule(bastionSG, Port.tcp(8163));
    // temporarily allow Web Console until bastion module refactor
    amazonMQSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(8162));
    amazonMQSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(8883));
    // allow Stomp, MQTT and AMQP to all (exposed via Private Link)
    amazonMQSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(61614));
    amazonMQSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(5671));
    amazonMQSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(61617));

    // TODO: Camel should use NLB to support failover
    // this.endpoint = Fn.select(0, Token.asList(Fn.getAtt(amazonMQ.logicalId, 'OpenWireEndpoints')));
    this.endpoint = privateRecord.domainName;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const output = new CfnOutput(this, 'endpoint', { exportName: 'amazonMQEndpoint', value: this.endpoint });
  }

  private getAllAllowedPrincipals(props: AmazonMQIntegrationProps): aws_iam.ArnPrincipal[] {
    const { environments } = this.node.tryGetContext('stages')[props.stage];

    let allPrincipals: string[] = [];
    // eslint-disable-next-line guard-for-in
    for (const conf in environments) {
      allPrincipals = [...allPrincipals, ...environments[conf].allowedPrincipals];
    }
    allPrincipals = Array.from(new Set(allPrincipals));

    return allPrincipals.map((principal: string) => new aws_iam.ArnPrincipal(principal));
  }

  private setupConsumerPasswords(props: AmazonMQIntegrationProps): any[] {
    const { environments } = this.node.tryGetContext('stages')[props.stage];
    const uniqueConsumers: Set<String> = new Set();

    const userPool: any[] = [];

    // eslint-disable-next-line guard-for-in
    for (const conf in environments) {
      const user = environments[conf].envs.AMAZONMQ_CONSUMER_USERNAME;
      if (user !== undefined && !uniqueConsumers.has(user) && !uniqueConsumers.has(user)) {
        uniqueConsumers.add(user);

        // eslint-disable-next-line max-len
        const allowedPrincipals: aws_iam.ArnPrincipal[] = environments[conf].allowedPrincipals.map((principal: string) => new aws_iam.ArnPrincipal(principal));

        const consumerPassword = new aws_secretsmanager.Secret(this, `consumerMQPassword${user}`, {
          secretName: `amazonMQConsumerPassword-${user}`,
          generateSecretString: { passwordLength: 16, excludeCharacters: '"@/\\=:,' },
          encryptionKey: this.consumerKey,
        });

        consumerPassword.addToResourcePolicy(new aws_iam.PolicyStatement({
          effect: aws_iam.Effect.ALLOW,
          // Enter production role
          principals: allowedPrincipals,
          actions: ['secretsmanager:GetSecretValue'],
          resources: ['*'],
          conditions: {
            'ForAnyValue:StringEquals': {
              'secretsmanager:VersionStage': 'AWSCURRENT',
            },
          },
        }));

        this.consumerKey.addToResourcePolicy(new aws_iam.PolicyStatement({
          effect: aws_iam.Effect.ALLOW,
          principals: allowedPrincipals,
          actions: ['kms:Decrypt', 'kms:DescribeKey'],
          resources: ['*'],
          conditions: {
            StringEquals: {
              'kms:ViaService': `aws_secretsmanager.${this.region}.amazonaws.com`,
            },
          },
        }));

        userPool.push({
          consoleAccess: false,
          groups: ['consumer'],
          username: user,
          password: consumerPassword.secretValue.toString(),
        });

        this.consumerPasswords.push(consumerPassword);
      }
    }

    return userPool;
  }
}
