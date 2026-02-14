#!/usr/bin/env node

/**
 * Simple test runner for CI/CD
 * Runs tests and provides clear output
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('╔════════════════════════════════════════════════╗');
console.log('║     Hyperchat CI/CD Test Runner              ║');
console.log('╚════════════════════════════════════════════════╝\n');

let failed = false;

async function runCommand(command, args, description) {
  console.log(`\n📋 ${description}`);
  console.log(`   Command: ${command} ${args.join(' ')}\n`);
  
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${description} - PASSED\n`);
        resolve();
      } else {
        console.log(`\n❌ ${description} - FAILED (exit code: ${code})\n`);
        failed = true;
        reject(new Error(`${description} failed`));
      }
    });
    
    proc.on('error', (err) => {
      console.error(`\n❌ ${description} - ERROR:`, err.message, '\n');
      failed = true;
      reject(err);
    });
  });
}

async function main() {
  const startTime = Date.now();
  
  try {
    // Run setup
    await runCommand('node', ['test/setup.js'], 'Cleanup test data');
    
    // Run encoding tests
    await runCommand('node', ['--test', 'test/encoding.test.js'], 'Encoding tests');
    
    // Run feed manager tests  
    await runCommand('node', ['--test', 'test/feed-manager.test.js'], 'Feed Manager tests');
    
    // Run crypto manager tests
    await runCommand('node', ['--test', 'test/crypto-manager.test.js'], 'Crypto Manager tests');
    
    // Run extended feed manager tests
    await runCommand('node', ['--test', 'test/feed-manager-extended.test.js'], 'Feed Manager Extended tests');
    
    // Run advanced feed manager tests
    await runCommand('node', ['--test', 'test/feed-manager-advanced.test.js'], 'Feed Manager Advanced tests');
    
    // Run network manager tests
    await runCommand('node', ['--test', 'test/network-manager.test.js'], 'Network Manager tests');
    
    // Run P2P integration tests (real network connectivity)
    console.log('\n⚠️  P2P integration tests may take 30-60 seconds...\n');
    await runCommand('node', ['--test', 'test/p2p-integration.test.js'], 'P2P Integration tests');
    
    // Run integration tests (with timeout)
    console.log('\n⚠️  Full integration tests may take 30-60 seconds...\n');
    await runCommand('node', ['test/integration.test.js'], 'Full Integration tests');
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║              ALL TESTS PASSED ✅               ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    console.log(`   Duration: ${duration}s\n`);
    console.log('Test Coverage:');
    console.log('  ✓ Encoding/decoding');
    console.log('  ✓ Feed initialization with GPG');
    console.log('  ✓ Message signing and encryption');
    console.log('  ✓ Signature verification');
    console.log('  ✓ Follow/unfollow');
    console.log('  ✓ Feed key validation');
    console.log('  ✓ Timeline aggregation');
    console.log('  ✓ Crypto key import/export');
    console.log('  ✓ Error handling paths');
    console.log('  ✓ Encrypted direct messages');
    console.log('  ✓ Edge case validation');
    console.log('  ✓ P2P networking via Hyperswarm');
    console.log('  ✓ Real peer connections through DHT');
    console.log('  ✓ Multi-peer message replication');
    console.log('  ✓ Encrypted direct messages over P2P');
    console.log('  ✓ GPG key exchange');
    console.log('  ✓ Real-time sync');
    console.log('  ✓ Offline sync\n');
    
    process.exit(0);
  } catch (err) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║              TESTS FAILED ❌                   ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    console.log(`   Duration: ${duration}s`);
    console.log(`   Error: ${err.message}\n`);
    
    process.exit(1);
  }
}

main();
