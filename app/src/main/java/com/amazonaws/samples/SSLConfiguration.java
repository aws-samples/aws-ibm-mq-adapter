/* Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: Apache-2.0 */

package com.amazonaws.samples;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;

import org.springframework.core.io.FileSystemResource;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import java.io.InputStream;
import java.security.KeyStore;

public class SSLConfiguration {

  private String keystore = null;
  private String keystorePassword = "";
  private String truststore = null;
  private String keystoreType = "JKS";
  private String truststorePassword = "";
  private String protocols = "TLSv1.2";
  private KeyManager[] keyManagers;
  private TrustManager[] trustManagers;
  private String cipherSuite = "TLS_RSA_WITH_AES_128_CBC_SHA256";

  public String getCipherSuite() {
    return cipherSuite;
  }

  public void setCipherSuite(String cipherSuite) {
    this.cipherSuite = cipherSuite;
  }

  private SSLSocketFactory SSLSocketFactory = null;

  

  public String getKeystore() {
    return keystore;
  }

  public void setKeystore(String keystore) {
    this.keystore = keystore;
  }

  public String getTruststore() {
    return truststore;
  }

  public void setProtocols(String protocols) {
    this.protocols = protocols;
  }

  public void setTruststore(String truststore) {
    this.truststore = truststore;
  }

  public void setKeystoreType(String keystoreType) {
    this.keystoreType = keystoreType;
  }

  public String getTruststorePassword() {
    return truststorePassword;
  }

  public void setTruststorePassword(String truststorePassword) {
    this.truststorePassword = truststorePassword;
  }

  public String getKeystorePassword() {
    return keystorePassword;
  }

  public void setKeystorePassword(String keystorePassword) {
    this.keystorePassword = keystorePassword;
  }

  public SSLSocketFactory getSSLSocketFactory() throws Exception {
    SSLContext context = SSLContext.getInstance(this.protocols);

    if (SSLSocketFactory == null) {
      this.keyManagers = this.loadKeyManager(keystore, keystorePassword);
      this.trustManagers = this.loadTrustManager(truststore, truststorePassword);

      context.init(keyManagers, trustManagers, null);
      SSLSocketFactory = context.getSocketFactory();
    }

    return SSLSocketFactory;
  }

  private KeyStore loadKeyStore(String resourcePath, String password) throws Exception {

    final KeyStore keyStore = KeyStore.getInstance(this.keystoreType);

    FileSystemResource file = new FileSystemResource(resourcePath);

    try (InputStream inputStream = file.getInputStream()) {
      keyStore.load(inputStream, password == null ? null : password.toCharArray());
    }

    return keyStore;
  }

  public KeyManager[] loadKeyManager(String resourcePath, String password) throws Exception {

    final KeyStore keyStore = loadKeyStore(resourcePath, password);
    KeyManagerFactory keyManagerFactory = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    keyManagerFactory.init(keyStore, password == null ? null : password.toCharArray());
    return keyManagerFactory.getKeyManagers();
  }

  public TrustManager[] loadTrustManager(String resourcePath, String password) throws Exception {

    TrustManagerFactory trustManagerFactory = TrustManagerFactory
        .getInstance(TrustManagerFactory.getDefaultAlgorithm());
    trustManagerFactory.init(loadKeyStore(resourcePath, password));
    return trustManagerFactory.getTrustManagers();
  }

  public void setSSLSocketFactory(SSLSocketFactory sSLSocketFactory) {
    SSLSocketFactory = sSLSocketFactory;
  }
}