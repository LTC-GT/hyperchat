// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import * as openpgp from 'openpgp';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * CryptoManager handles GPG key operations, encryption, and signing
 */
export class CryptoManager {
  constructor(storage = './storage') {
    this.storage = storage;
    this.privateKey = null;
    this.publicKey = null;
    this.publicKeyArmored = null;
    this.privateKeyArmored = null;
    this.username = null;
  }

  /**
   * Initialize with existing GPG key or generate new one
   */
  async initialize(username, privateKeyPath = null, publicKeyPath = null) {
    this.username = username;
    const keyDir = join(this.storage, username);

    // Try to import from provided paths
    if (privateKeyPath && publicKeyPath) {
      await this.importKeys(privateKeyPath, publicKeyPath);
      return;
    }

    // Try to load existing keys from storage
    const storedPrivPath = join(keyDir, 'private.asc');
    const storedPubPath = join(keyDir, 'public.asc');

    if (existsSync(storedPrivPath) && existsSync(storedPubPath)) {
      console.log('Loading existing GPG keys...');
      this.privateKeyArmored = readFileSync(storedPrivPath, 'utf-8');
      this.publicKeyArmored = readFileSync(storedPubPath, 'utf-8');
      
      this.privateKey = await openpgp.readPrivateKey({ armoredKey: this.privateKeyArmored });
      this.publicKey = await openpgp.readKey({ armoredKey: this.publicKeyArmored });
      
      console.log('✓ GPG keys loaded');
      return;
    }

    // Generate new 4096-bit RSA keys
    console.log('Generating new 4096-bit RSA GPG key pair (this may take a moment)...');
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'rsa',
      rsaBits: 4096,
      userIDs: [{ name: username, email: `${username}@hyperchat.local` }],
      format: 'armored'
    });

    this.privateKeyArmored = privateKey;
    this.publicKeyArmored = publicKey;
    
    this.privateKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
    this.publicKey = await openpgp.readKey({ armoredKey: publicKey });

    // Save keys to storage
    if (!existsSync(keyDir)) {
      await import('fs').then(fs => fs.promises.mkdir(keyDir, { recursive: true }));
    }
    
    writeFileSync(storedPrivPath, privateKey);
    writeFileSync(storedPubPath, publicKey);
    
    console.log('✓ GPG keys generated and saved');
  }

  /**
   * Import existing GPG keys from files
   */
  async importKeys(privateKeyPath, publicKeyPath) {
    console.log('Importing GPG keys...');
    
    this.privateKeyArmored = readFileSync(privateKeyPath, 'utf-8');
    this.publicKeyArmored = readFileSync(publicKeyPath, 'utf-8');
    
    this.privateKey = await openpgp.readPrivateKey({ armoredKey: this.privateKeyArmored });
    this.publicKey = await openpgp.readKey({ armoredKey: this.publicKeyArmored });
    
    console.log('✓ GPG keys imported successfully');
  }

  /**
   * Get fingerprint (used as user ID)
   */
  getFingerprint() {
    if (!this.publicKey) return null;
    return this.publicKey.getFingerprint().toUpperCase();
  }

  /**
   * Get public key in armored format for sharing
   */
  getPublicKeyArmored() {
    return this.publicKeyArmored;
  }

  /**
   * Encrypt message for recipient
   */
  async encryptMessage(message, recipientPublicKeyArmored) {
    try {
      const recipientPublicKey = await openpgp.readKey({ armoredKey: recipientPublicKeyArmored });
      
      const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: JSON.stringify(message) }),
        encryptionKeys: recipientPublicKey,
        signingKeys: this.privateKey
      });
      
      return encrypted;
    } catch (err) {
      throw new Error(`Encryption failed: ${err.message}`);
    }
  }

  /**
   * Decrypt and verify message
   */
  async decryptMessage(encryptedMessage, senderPublicKeyArmored) {
    try {
      const senderPublicKey = await openpgp.readKey({ armoredKey: senderPublicKeyArmored });
      
      const message = await openpgp.readMessage({ armoredMessage: encryptedMessage });
      
      const { data: decrypted, signatures } = await openpgp.decrypt({
        message,
        decryptionKeys: this.privateKey,
        verificationKeys: senderPublicKey
      });
      
      // Verify signature
      try {
        await signatures[0].verified;
        return {
          message: JSON.parse(decrypted),
          verified: true
        };
      } catch (e) {
        return {
          message: JSON.parse(decrypted),
          verified: false
        };
      }
    } catch (err) {
      throw new Error(`Decryption failed: ${err.message}`);
    }
  }

  /**
   * Sign a message (without encryption)
   */
  async signMessage(message) {
    const signed = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: JSON.stringify(message) }),
      signingKeys: this.privateKey
    });
    
    return signed;
  }

  /**
   * Verify a signed message
   */
  async verifyMessage(signedMessage, senderPublicKeyArmored) {
    const senderPublicKey = await openpgp.readKey({ armoredKey: senderPublicKeyArmored });
    
    const message = await openpgp.readCleartextMessage({ cleartextMessage: signedMessage });
    
    const { data, signatures } = await openpgp.verify({
      message,
      verificationKeys: senderPublicKey
    });
    
    try {
      await signatures[0].verified;
      return {
        message: JSON.parse(data),
        verified: true
      };
    } catch (e) {
      return {
        message: JSON.parse(data),
        verified: false
      };
    }
  }

  /**
   * Export public key to file
   */
  exportPublicKey(filepath) {
    writeFileSync(filepath, this.publicKeyArmored);
    console.log(`Public key exported to: ${filepath}`);
  }

  /**
   * Export private key to file (use with caution!)
   */
  exportPrivateKey(filepath) {
    writeFileSync(filepath, this.privateKeyArmored);
    console.log(`⚠️  Private key exported to: ${filepath}`);
    console.log('⚠️  Keep this file secure and never share it!');
  }
}
