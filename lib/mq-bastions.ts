/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { StackProps, Stack, CfnOutput } from 'aws-cdk-lib';
import { Vpc, BastionHostLinux } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface BastionProps extends StackProps {
  stage: string;
}

export class BastionStack extends Stack {
  constructor(scope: Construct, id: string, props: BastionProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, 'default-vpc', { vpcId: this.node.tryGetContext('stages')[props.stage].defaultVpcId });

    const bastion = new BastionHostLinux(this, 'mqBastion', { vpc, requireImdsv2: true });

    // Support for running integration tests and SSM tunneling
    bastion.instance.addUserData(
      'sudo yum install gcc python-pip socat -y',
    );

    bastion.role.node.findChild('DefaultPolicy').node.addMetadata('cfn-nag', 'F4:Wildcard used for SSM');
    bastion.role.node.findChild('DefaultPolicy').node.addMetadata('cfn-nag', 'W12:Wildcard used for SSM');

    const output = new CfnOutput(this, 'bastion', { exportName: 'bastionId', value: bastion.instanceId });
  }
}
