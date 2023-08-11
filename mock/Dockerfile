# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM ibmcom/mq:latest

ENV LICENSE=accept
ENV MQ_QMGR_NAME=QM1
ENV MQ_TLS_KEYSTORE=/etc/mqm/pki/keys/mykey/key.crt
ENV MQ_TLS_PASSPHRASE=password
ENV CIPHER_SUITE=TLS_RSA_WITH_AES_128_CBC_SHA256
EXPOSE 1414/tcp
EXPOSE 9443/tcp

USER 0

RUN microdnf update && \
    microdnf install unzip && \
    microdnf clean all && \
    curl https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip && \
    unzip /tmp/awscliv2.zip -d /tmp && \
    /tmp/aws/install && \
    /usr/local/bin/aws --version

ADD start.sh .
RUN chmod +x start.sh

ARG MQM_UID=888
USER $MQM_UID

ENTRYPOINT [ "sh", "./start.sh" ]