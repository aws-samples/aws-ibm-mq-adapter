/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

package com.amazonaws.samples;

import org.apache.camel.spring.Main;

public class Bootstrap {

    public static void main(String... args) throws Exception {

        Main main = new Main();
        System.setProperty("com.ibm.mq.cfg.useIBMCipherMappings", "false");
        main.setApplicationContextUri("camel-context.xml");
        main.run(args);
    }
}