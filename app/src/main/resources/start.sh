#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

export PATH=~/.local/bin:$PATH

echo "Retrieving certificates"

# If not set, running locally
if [ -z $AWS_EXECUTION_ENV ]; then
  echo "Mock download truststore / keystore passwords"
  export "KEYSTORE_PASSWORD"=password
  export "TRUSTSTORE_PASSWORD"=trustpassword
  export "IBM_HOSTNAME"=localhost
  export "PROFILE"=dev
  sleep 20
fi

aws secretsmanager get-secret-value --region $AWS_REGION --secret-id $IBMMQ_TRUSTSTORE_ARN --query 'SecretBinary' --output text | base64 -d > client_keystore/server-chain.jks && echo "Trust Store downloaded" || echo "Error downloading Trust Store"
aws secretsmanager get-secret-value --region $AWS_REGION --secret-id $IBMMQ_KEYSTORE_ARN --query 'SecretBinary' --output text | base64 -d > client_keystore/client.jks && echo "Key Store downloaded" || echo "Error downloading Key Store"
echo "Running Apache Cammel"
java -jar /usr/app/app.jar
