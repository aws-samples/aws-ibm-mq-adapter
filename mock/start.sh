#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

echo "Retrieving certificates"

mkdir -p /etc/mqm/pki/keys/mykey/ /etc/mqm/pki/trust/0/
aws secretsmanager get-secret-value --secret-id mqAdapterIbmMockPublicCert --query 'SecretString' --output text > /etc/mqm/pki/keys/mykey/key.crt &&  echo "IbmMockPublicCert downloaded" || echo "Error downloading IbmMockPublicCert"
aws secretsmanager get-secret-value --secret-id mqAdapterIbmMockPrivateCert --query 'SecretString' --output text > /etc/mqm/pki/keys/mykey/key.key &&  echo "ibmMockPrivateCert downloaded" || echo "Error downloading ibmMockPrivateCert" 
aws secretsmanager get-secret-value --secret-id mqAdapterIbmMockClientPublicCert --query 'SecretString' --output text > /etc/mqm/pki/trust/0/key.crt && echo "ibmMockPrivateCert downloaded" || echo "Error downloading ibmMockPrivateCert" 

export MQ_ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id mqAdapterIbmMockAdminPassword --query 'SecretString' --output text)

chmod 644 /etc/mqm/pki/keys/mykey/key.crt
chmod 644 /etc/mqm/pki/keys/mykey/key.key
chmod 644 /etc/mqm/pki/trust/0/key.crt

runmqdevserver