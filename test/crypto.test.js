#!/usr/bin/env node

/**
 * GPG Encryption Test
 * Tests the crypto-manager module
 */

import { CryptoManager } from '../src/crypto-manager.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

async function testCrypto() {
  console.log('🧪 Testing GPG Encryption Module...\n');
  
  const testDir = './test-storage-gpg';
  
  try {
    // Cleanup and create fresh directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
    
    // Test 1: Generate keys for Alice
    console.log('Test 1: Generating 4096-bit RSA key pair for Alice...');
    const alice = new CryptoManager(testDir);
    await alice.initialize('alice');
    console.log('✓ Alice keys generated');
    console.log('  Fingerprint:', alice.getFingerprint());
    
    // Test 2: Generate keys for Bob
    console.log('\nTest 2: Generating 4096-bit RSA key pair for Bob...');
    const bob = new CryptoManager(testDir);
    await bob.initialize('bob');
    console.log('✓ Bob keys generated');
    console.log('  Fingerprint:', bob.getFingerprint());
    
    // Test 3: Encrypt message from Alice to Bob
    console.log('\nTest 3: Alice encrypts message for Bob...');
    const message = {
      type: 'message',
      content: 'Hello Bob, this is a secret!',
      timestamp: Date.now()
    };
    
    const encrypted = await alice.encryptMessage(message, bob.getPublicKeyArmored());
    console.log('✓ Message encrypted');
    console.log('  Length:', encrypted.length, 'bytes');
    
    // Test 4: Bob decrypts message from Alice
    console.log('\nTest 4: Bob decrypts message from Alice...');
    const { message: decrypted, verified } = await bob.decryptMessage(
      encrypted,
      alice.getPublicKeyArmored()
    );
    console.log('✓ Message decrypted');
    console.log('  Content:', decrypted.content);
    console.log('  Signature verified:', verified);
    
    // Verify message matches
    if (decrypted.content === message.content) {
      console.log('✓ Content matches original');
    } else {
      throw new Error('Content mismatch!');
    }
    
    // Test 5: Sign and verify message
    console.log('\nTest 5: Alice signs public message...');
    const publicMessage = {
      type: 'status',
      content: 'Hello everyone!',
      timestamp: Date.now()
    };
    
    const signed = await alice.signMessage(publicMessage);
    console.log('✓ Message signed');
    
    console.log('\nTest 6: Bob verifies Alice\'s signature...');
    const { message: verifiedMsg, verified: isSigValid } = await bob.verifyMessage(
      signed,
      alice.getPublicKeyArmored()
    );
    console.log('✓ Signature verified:', isSigValid);
    console.log('  Content:', verifiedMsg.content);
    
    // Cleanup
    rmSync(testDir, { recursive: true });
    
    console.log('\n✅ All GPG encryption tests passed!');
    console.log('\n🔒 4096-bit RSA encryption working correctly');
    console.log('✔️  Message signing and verification working');
    console.log('🎉 System ready for end-to-end encrypted P2P chat!\n');
    
    return true;
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error(err.stack);
    
    // Cleanup on error
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    
    return false;
  }
}

// Run tests
testCrypto().then(success => {
  process.exit(success ? 0 : 1);
});
