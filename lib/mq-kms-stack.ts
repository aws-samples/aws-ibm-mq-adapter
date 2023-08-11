/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

import { Stack, aws_kms, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IntegrationProps } from './utils';

export class KMSStack extends Stack {
  public static getInstance(scope: Construct, id: string, props: IntegrationProps): KMSStack {
    if (KMSStack.instances === undefined) {
      this.instances = {};
    }
    if (KMSStack.instances[id] === undefined) {
      KMSStack.instances[id] = new KMSStack(scope, id, props);
    }
    return KMSStack.instances[id];
  }

  private static instances: { [id: string] : KMSStack };
  public kmsKey: aws_kms.Key;

  constructor(scope: Construct, id: string, props: IntegrationProps) {
    super(scope, id, props);

    const keyAlias = `mqadapter/${this.stackName}/KMSKey`;

    this.kmsKey = new aws_kms.Key(this, 'mqAdapterKMS', {
      enableKeyRotation: true,
      description: 'Key used for MQ Adapter',
      alias: keyAlias,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
