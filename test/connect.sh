#!/bin/bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

tunnel_endpoint() {
  ENDPOINT=$1
  PORT=$2

  COMMAND_ID=$(aws ssm send-command --targets "Key=instanceids,Values=$BASTION_ID" --document-name "AWS-RunShellScript" --comment "SOCAT IBM" --parameters "commands=\"sudo socat TCP-LISTEN:$PORT,su=nobody,fork TCP:$ENDPOINT:$PORT\"" --output text --query "Command.CommandId")

  aws ssm list-command-invocations \
    --command-id "$COMMAND_ID" \
    --details \
    --query "CommandInvocations[].CommandPlugins[].{Status:Status,Output:Output}"

  aws ssm start-session --target $BASTION_ID \
                        --document-name AWS-StartPortForwardingSession \
                        --parameters "{\"portNumber\":[\"$PORT\"],\"localPortNumber\":[\"$PORT\"]}" &

}

if [[ -z $BASTION_ID ]]; then
  echo "Please set BASTION_ID environment variable, e.g: the EC2 instance id of the Bastion Host"
  exit
fi

if [[ -z $IBM_ENDPOINT && -z $AMAZONMQ_ENDPOINT ]]; then
  echo "Please set IBM_ENDPOINT and/or AMAZONMQ_ENDPOINT environment variables"
fi

if [[ ! -z $IBM_ENDPOINT ]]; then
  PORTS=( 9443 1414 )
  for PORT in "${PORTS[@]}"
  do
    tunnel_endpoint $IBM_ENDPOINT $PORT
  done
  
fi 

if [[ ! -z $AMAZONMQ_ENDPOINT ]]; then
  PORTS=( 8162 61617 )
  for PORT in "${PORTS[@]}"
  do
    tunnel_endpoint $AMAZONMQ_ENDPOINT $PORT
  done
fi