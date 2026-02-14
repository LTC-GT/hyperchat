// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CryptoManager } from '../src/crypto-manager.js';
import { createTempDir, cleanup } from './test-helpers.js';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

test('CryptoManager - load existing keys from storage', async () => {
  const storage = createTempDir();
  const crypto1 = new CryptoManager(storage);
  
  try {
    // Generate keys first
    await crypto1.initialize('testuser');
    const fingerprint1 = crypto1.getFingerprint();
    
    // Create new instance and load existing keys
    const crypto2 = new CryptoManager(storage);
    await crypto2.initialize('testuser');
    const fingerprint2 = crypto2.getFingerprint();
    
    // Should load same keys
    assert.equal(fingerprint1, fingerprint2, 'Fingerprints should match');
    assert.ok(crypto2.privateKey, 'Should have private key');
    assert.ok(crypto2.publicKey, 'Should have public key');
  } finally {
    await cleanup();
  }
});

test('CryptoManager - import keys from external files', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const crypto1 = new CryptoManager(storage1);
  
  try {
    // Generate keys
    await crypto1.initialize('user1');
    const fingerprint1 = crypto1.getFingerprint();
    
    // Use storage1 directory for export (it already exists)
    const privPath = join(storage1, 'exported-private.asc');
    const pubPath = join(storage1, 'exported-public.asc');
    
    crypto1.exportPrivateKey(privPath);
    crypto1.exportPublicKey(pubPath);
    
    assert.ok(existsSync(privPath), 'Private key should be exported');
    assert.ok(existsSync(pubPath), 'Public key should be exported');
    
    // Import keys in new instance
    const crypto2 = new CryptoManager(storage2);
    await crypto2.initialize('user2', privPath, pubPath);
    
    const fingerprint2 = crypto2.getFingerprint();
    assert.equal(fingerprint1, fingerprint2, 'Imported keys should match original');
  } finally {
    await cleanup();
  }
});

test('CryptoManager - encryption error with invalid key', async () => {
  const storage = createTempDir();
  const crypto = new CryptoManager(storage);
  
  try {
    await crypto.initialize('testuser');
    
    const message = { type: 'message', content: 'test' };
    const invalidKey = 'not-a-valid-armored-key';
    
    await assert.rejects(
      async () => await crypto.encryptMessage(message, invalidKey),
      /Encryption failed/,
      'Should throw encryption error'
    );
  } finally {
    await cleanup();
  }
});

test('CryptoManager - decryption error with invalid message', async () => {
  const storage = createTempDir();
  const crypto = new CryptoManager(storage);
  
  try {
    await crypto.initialize('testuser');
    
    const invalidEncrypted = 'not-a-valid-encrypted-message';
    const fakeKey = crypto.getPublicKeyArmored();
    
    await assert.rejects(
      async () => await crypto.decryptMessage(invalidEncrypted, fakeKey),
      /Decryption failed/,
      'Should throw decryption error'
    );
  } finally {
    await cleanup();
  }
});

test('CryptoManager - verify signature failure', async () => {
  const storage = createTempDir();
  const crypto1 = new CryptoManager(storage);
  const crypto2 = new CryptoManager(storage);
  
  try {
    await crypto1.initialize('user1');
    await crypto2.initialize('user2');
    
    const message = { type: 'status', content: 'test message' };
    const signed = await crypto1.signMessage(message);
    
    // Tamper with the signed message
    const tamperedSigned = signed.replace('test message', 'tampered message');
    
    const result = await crypto2.verifyMessage(tamperedSigned, crypto1.getPublicKeyArmored());
    
    // Verification should fail for tampered message
    assert.equal(result.verified, false, 'Tampered message should not verify');
  } finally {
    await cleanup();
  }
});

test('CryptoManager - getFingerprint returns null when not initialized', () => {
  const crypto = new CryptoManager('./test-storage');
  const fingerprint = crypto.getFingerprint();
  assert.equal(fingerprint, null, 'Should return null when no keys loaded');
});

test('CryptoManager - roundtrip encrypt/decrypt with signature verification', async () => {
  const storage = createTempDir();
  const alice = new CryptoManager(storage);
  const bob = new CryptoManager(storage);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    
    const originalMessage = {
      type: 'direct_message',
      content: 'Secret information!',
      timestamp: Date.now()
    };
    
    // Alice encrypts for Bob
    const encrypted = await alice.encryptMessage(originalMessage, bob.getPublicKeyArmored());
    
    // Bob decrypts from Alice
    const { message: decrypted, verified } = await bob.decryptMessage(
      encrypted,
      alice.getPublicKeyArmored()
    );
    
    assert.equal(decrypted.content, originalMessage.content);
    assert.equal(decrypted.type, originalMessage.type);
    assert.equal(verified, true, 'Signature should be verified');
  } finally {
    await cleanup();
  }
});

test('CryptoManager - sign and verify message roundtrip', async () => {
  const storage = createTempDir();
  const sender = new CryptoManager(storage);
  const receiver = new CryptoManager(storage);
  
  try {
    await sender.initialize('sender');
    await receiver.initialize('receiver');
    
    const message = {
      type: 'announcement',
      content: 'Public announcement',
      timestamp: Date.now()
    };
    
    const signed = await sender.signMessage(message);
    assert.ok(signed, 'Should return signed message');
    assert.ok(signed.length > 0, 'Signed message should not be empty');
    
    const { message: verified, verified: isValid } = await receiver.verifyMessage(
      signed,
      sender.getPublicKeyArmored()
    );
    
    assert.equal(verified.content, message.content);
    assert.equal(isValid, true, 'Signature should be valid');
  } finally {
    await cleanup();
  }
});

test('CryptoManager - export public key saves to file', async () => {
  const storage = createTempDir();
  const crypto = new CryptoManager(storage);
  
  try {
    await crypto.initialize('testuser');
    
    const exportPath = join(storage, 'exported-public.asc');
    crypto.exportPublicKey(exportPath);
    
    assert.ok(existsSync(exportPath), 'Public key file should exist');
  } finally {
    await cleanup();
  }
});

test('CryptoManager - export private key saves to file', async () => {
  const storage = createTempDir();
  const crypto = new CryptoManager(storage);
  
  try {
    await crypto.initialize('testuser');
    
    const exportPath = join(storage, 'exported-private.asc');
    crypto.exportPrivateKey(exportPath);
    
    assert.ok(existsSync(exportPath), 'Private key file should exist');
  } finally {
    await cleanup();
  }
});
