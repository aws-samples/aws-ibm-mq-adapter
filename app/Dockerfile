# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

FROM maven:3.5-jdk-8 AS build  
ADD pom.xml /usr/src/app/
WORKDIR /usr/src/app
RUN mvn clean package -Dmaven.main.skip -Dmaven.test.skip && rm -r target

ADD src /usr/src/app/src
RUN mvn package -Dmaven.test.skip

FROM openjdk:8-jdk-alpine

RUN apk add --update \
    python \ 
    py-pip


RUN addgroup -g 1000 -S appuser && adduser -u 1000 -S appuser -G appuser
RUN mkdir -p /usr/app && chown -R appuser:appuser /usr/app

USER appuser

RUN pip install awscli --upgrade --user --no-build-isolation

COPY --from=build /usr/src/app/target/mq-adapter-*.jar /usr/app/app.jar

RUN mkdir -p /usr/app/client_keystore
RUN mkdir -p /usr/app/keystore

COPY --chown=appuser:appuser  src/main/resources/start.sh /usr/app/
RUN chmod +x /usr/app/start.sh

WORKDIR /usr/app

ENTRYPOINT ["sh", "./start.sh" ]