#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# Source: https://developer.ibm.com/messaging/learn-mq/mq-tutorials/secure-mq-tls/

# Clean up 

# Local server store
mkdir -p keystore client_keystore

TARGET_KEYSTORE_PASS=${TARGET_KEYSTORE_PASS:-password}
TARGET_TRUSTSTORE_PASS=${TARGET_TRUSTSTORE_PASS:-trustpassword}

echo "Pushing secrets Client secrets to AWS"
if [ "$1" == "generate_secrets" ];then

  mkdir -p test/client_keystore test/keystore client_keystore
  mkdir -p test/keystore

  rm -rf keystore/* client_keystore/*  client_keystore/* test/keystore/*  test/keystore/client_keystore/*

  # Create a private key and certificate in PEM format, for the server to use
  openssl req -newkey rsa:2048 -nodes -passout pass:${TARGET_KEYSTORE_PASS} -keyout test/keystore/key.key -x509 -days 365 -out test/keystore/key.crt -subj "/C=DE/ST=Germany/O=Company/CN=Server Demo"

  # Create a private key and certificate in PEM format, for the client to use
  openssl req -newkey rsa:2048 -nodes -passout pass:${TARGET_KEYSTORE_PASS} -keyout test/client_keystore/key.key -x509 -days 365 -out test/client_keystore/key.crt -subj "/C=DE/ST=Germany/O=Company/CN=Client Demo"

  # Add the client certificate to a key store in JKS format, for Java clients to use when connecting
  openssl pkcs12 -export -in test/client_keystore/key.crt -inkey test/client_keystore/key.key -certfile test/client_keystore/key.crt -out test/client_keystore/clientKeyStore.p12 -passout pass:${TARGET_KEYSTORE_PASS}

  keytool -importkeystore -srckeystore test/client_keystore/clientKeyStore.p12 -srcstoretype pkcs12 -deststoretype JKS -noprompt -storepass ${TARGET_KEYSTORE_PASS} -srcstorepass ${TARGET_KEYSTORE_PASS} -destkeystore client_keystore/client.jks

  # Add the server certificate to a trust store in JKS format, for Java clients to trust when connecting
  keytool -keystore client_keystore/server-chain.jks -storetype jks -storepass ${TARGET_TRUSTSTORE_PASS} -importcert -file test/keystore/key.crt -alias server-certificate -noprompt

  # Copy to add to server
  cp test/client_keystore/key.crt test/keystore/client.crt
elif [ "$1" == "update_secrets" ]; then
  if [ "$2" == "broker" ]; then
    echo "Updating Broker secrets"
    INTEGRATION_NAME="$3"
    aws secretsmanager update-secret --secret-id "mqAdapterTrustStore-$INTEGRATION_NAME" --secret-binary fileb://client_keystore/server-chain.jks
    aws secretsmanager update-secret --secret-id "mqAdapterTrustStorePass-$INTEGRATION_NAME"   --secret-string "${TARGET_TRUSTSTORE_PASS}"
    aws secretsmanager update-secret --secret-id "mqAdapterKeyStore-$INTEGRATION_NAME"   --secret-binary fileb://client_keystore/client.jks
    aws secretsmanager update-secret --secret-id "mqAdapterKeyStorePass-$INTEGRATION_NAME"   --secret-string "${TARGET_KEYSTORE_PASS}"
  elif [ "$2" == "mock" ]; then
  echo "Pushing IBM MQ secrets"
  aws secretsmanager update-secret --secret-id mqAdapterIbmMockPublicCert  --secret-string file://test/keystore/key.crt
  aws secretsmanager update-secret --secret-id mqAdapterIbmMockPrivateCert   --secret-string file://test/keystore/key.key
  aws secretsmanager update-secret --secret-id mqAdapterIbmMockClientPublicCert   --secret-string file://test/keystore/client.crt
  else
    echo "Unknown service, use broker or mock"
    exit 1
  fi
elif [ "$1" == "create_secrets" ]; then 
  if [ "$2" == "broker" ]; then
    INTEGRATION_NAME=$3
    echo "Creating Broker secrets"
    aws secretsmanager create-secret --name "mqAdapterTrustStore-$INTEGRATION_NAME" --secret-binary fileb://client_keystore/server-chain.jks
    aws secretsmanager create-secret --name "mqAdapterTrustStorePass-$INTEGRATION_NAME"   --secret-string "${TARGET_TRUSTSTORE_PASS}"
    aws secretsmanager create-secret --name "mqAdapterKeyStore-$INTEGRATION_NAME"   --secret-binary fileb://client_keystore/client.jks
    aws secretsmanager create-secret --name "mqAdapterKeyStorePass-$INTEGRATION_NAME"   --secret-string "${TARGET_KEYSTORE_PASS}"
  elif [ "$2" == "mock" ]; then
  echo "Creating IBM MQ secrets"
  aws secretsmanager create-secret --name mqAdapterIbmMockPublicCert  --secret-string file://test/keystore/key.crt
  aws secretsmanager create-secret --name mqAdapterIbmMockPrivateCert   --secret-string file://test/keystore/key.key
  aws secretsmanager create-secret --name mqAdapterIbmMockClientPublicCert   --secret-string file://test/keystore/client.crt
  else
    echo "Unknown service, use broker or mock"
    exit 1
  fi
elif ["$1" == "run_locally" ]; then
# Start build
docker-compose build

# Start docker compose
docker-compose up -d 
fi;



