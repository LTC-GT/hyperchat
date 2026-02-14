import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FeedManager } from '../src/feed-manager.js';
import { NetworkManager } from '../src/network-manager.js';
import { createTempDir, cleanup, waitFor } from './test-helpers.js';
import b4a from 'b4a';

/**
 * Real P2P Integration Tests
 * These tests verify actual network connectivity through Hyperswarm/DAT
 */

test('P2P Integration - Two clients connect and exchange messages', async (t) => {
  const storage1 = createTempDir('p2p-alice');
  const storage2 = createTempDir('p2p-bob');
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  let peerConnected1 = false;
  let peerConnected2 = false;
  
  const networkManager1 = new NetworkManager(feedManager1, () => {
    peerConnected1 = true;
  });
  
  const networkManager2 = new NetworkManager(feedManager2, () => {
    peerConnected2 = true;
  });
  
  try {
    // Initialize both clients
    console.log('\n🧪 Test: Two clients connecting via Hyperswarm...\n');
    
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    
    // Start network managers
    await networkManager1.start();
    await networkManager2.start();
    
    // Get Alice's feed key
    const aliceFeedKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    
    console.log(`Alice feed key: ${aliceFeedKey.slice(0, 16)}...`);
    console.log(`Bob feed key: ${b4a.toString(feedManager2.ownFeed.key, 'hex').slice(0, 16)}...`);
    
    // Bob follows Alice
    console.log('\n📡 Bob following Alice...');
    await networkManager2.followAndReplicate(aliceFeedKey, 'alice');
    
    // Wait for peer connection (real network connection through DHT)
    console.log('⏳ Waiting for peers to connect through Hyperswarm...');
    await waitFor(() => peerConnected1 && peerConnected2, 15000);
    
    assert.ok(peerConnected1, 'Alice should have at least one peer connection');
    assert.ok(peerConnected2, 'Bob should have at least one peer connection');
    
    console.log('✅ Peers connected through Hyperswarm!');
    
    // Alice posts a message
    console.log('\n📝 Alice posting a message...');
    await feedManager1.appendMessage('message', 'Hello from Alice!');
    
    // Wait for message to replicate to Bob
    console.log('⏳ Waiting for message replication...');
    await waitFor(async () => {
      const bobFollowedFeed = feedManager2.followedFeeds.get(aliceFeedKey);
      return bobFollowedFeed && bobFollowedFeed.length >= 2; // key_announcement + message
    }, 10000);
    
    // Verify Bob received the message
    const bobFollowedFeed = feedManager2.followedFeeds.get(aliceFeedKey);
    assert.ok(bobFollowedFeed, 'Bob should have Alice\'s feed');
    assert.ok(bobFollowedFeed.length >= 2, 'Bob should have received Alice\'s messages');
    
    // Read messages from Alice's feed
    const messages = await feedManager2.getFeedMessages(bobFollowedFeed);
    const signedMessages = messages.filter(m => m.signed);
    
    assert.ok(signedMessages.length >= 1, 'Bob should have at least one signed message from Alice');
    
    console.log('✅ Message replicated successfully!');
    console.log(`   Content: "${signedMessages[0].content}"`);
    console.log(`   Verified: ${signedMessages[0].verified}`);
    
    // Verify signature was checked
    assert.equal(signedMessages[0].verified, true, 'Signature should be verified');
    
    console.log('\n🎉 P2P integration test passed!');
    
  } finally {
    await networkManager1.stop();
    await networkManager2.stop();
    await cleanup(feedManager1, feedManager2);
  }
});

test('P2P Integration - Three-way network mesh', async (t) => {
  const storage1 = createTempDir('p2p-alice-mesh');
  const storage2 = createTempDir('p2p-bob-mesh');
  const storage3 = createTempDir('p2p-charlie-mesh');
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  const feedManager3 = new FeedManager(storage3);
  
  const networkManager1 = new NetworkManager(feedManager1);
  const networkManager2 = new NetworkManager(feedManager2);
  const networkManager3 = new NetworkManager(feedManager3);
  
  try {
    console.log('\n🧪 Test: Three-way network mesh...\n');
    
    // Initialize all clients
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    await feedManager3.initialize('charlie');
    
    // Start all network managers
    await networkManager1.start();
    await networkManager2.start();
    await networkManager3.start();
    
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    const bobKey = b4a.toString(feedManager2.ownFeed.key, 'hex');
    
    console.log('📡 Setting up follows:');
    console.log('   Charlie follows Alice and Bob...');
    
    // Charlie follows both Alice and Bob
    await networkManager3.followAndReplicate(aliceKey, 'alice');
    await networkManager3.followAndReplicate(bobKey, 'bob');
    
    // Wait for feeds to sync
    console.log('⏳ Waiting for feed synchronization...');
    await waitFor(async () => {
      const aliceFeed = feedManager3.followedFeeds.get(aliceKey);
      const bobFeed = feedManager3.followedFeeds.get(bobKey);
      return aliceFeed && bobFeed && aliceFeed.length >= 1 && bobFeed.length >= 1;
    }, 15000);
    
    // Alice posts
    console.log('\n📝 Alice posting...');
    await feedManager1.appendMessage('status', 'Alice here!');
    
    // Bob posts
    console.log('📝 Bob posting...');
    await feedManager2.appendMessage('status', 'Bob here!');
    
    // Wait for replication
    console.log('⏳ Waiting for messages to replicate...');
    await waitFor(async () => {
      const aliceFeed = feedManager3.followedFeeds.get(aliceKey);
      const bobFeed = feedManager3.followedFeeds.get(bobKey);
      return aliceFeed && bobFeed && 
             aliceFeed.length >= 2 && bobFeed.length >= 2;
    }, 10000);
    
    // Charlie reads messages from both
    const aliceMessages = await feedManager3.getFeedMessages(
      feedManager3.followedFeeds.get(aliceKey)
    );
    const bobMessages = await feedManager3.getFeedMessages(
      feedManager3.followedFeeds.get(bobKey)
    );
    
    const aliceSigned = aliceMessages.filter(m => m.signed);
    const bobSigned = bobMessages.filter(m => m.signed);
    
    assert.ok(aliceSigned.length >= 1, 'Charlie should have messages from Alice');
    assert.ok(bobSigned.length >= 1, 'Charlie should have messages from Bob');
    
    console.log('✅ Charlie received messages from both Alice and Bob!');
    console.log(`   Alice: "${aliceSigned[0].content}"`);
    console.log(`   Bob: "${bobSigned[0].content}"`);
    
    console.log('\n🎉 Three-way mesh test passed!');
    
  } finally {
    await networkManager1.stop();
    await networkManager2.stop();
    await networkManager3.stop();
    await cleanup(feedManager1, feedManager2, feedManager3);
  }
});

test('P2P Integration - Encrypted direct messages over network', async (t) => {
  const storage1 = createTempDir('p2p-alice-encrypted');
  const storage2 = createTempDir('p2p-bob-encrypted');
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  const networkManager1 = new NetworkManager(feedManager1);
  const networkManager2 = new NetworkManager(feedManager2);
  
  try {
    console.log('\n🧪 Test: Encrypted direct messages over P2P network...\n');
    
    // Initialize both clients
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    
    // Start networks
    await networkManager1.start();
    await networkManager2.start();
    
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    const bobKey = b4a.toString(feedManager2.ownFeed.key, 'hex');
    
    console.log('📡 Setting up mutual follows...');
    
    // They follow each other
    await networkManager1.followAndReplicate(bobKey, 'bob');
    await networkManager2.followAndReplicate(aliceKey, 'alice');
    
    // Wait for key announcements to sync
    console.log('⏳ Waiting for GPG key exchange...');
    await waitFor(async () => {
      const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
      const bobFeed = feedManager1.followedFeeds.get(bobKey);
      
      // Check if feeds are ready and have at least the key announcement
      const aliceFeedReady = aliceFeed && aliceFeed.length >= 1;
      const bobFeedReady = bobFeed && bobFeed.length >= 1;
      
      // Try to load messages to trigger key extraction
      if (aliceFeedReady && !feedManager2.publicKeys.has(aliceKey)) {
        await feedManager2.getFeedMessages(aliceFeed);
      }
      if (bobFeedReady && !feedManager1.publicKeys.has(bobKey)) {
        await feedManager1.getFeedMessages(bobFeed);
      }
      
      const keysExchanged = feedManager1.publicKeys.has(bobKey) && 
                           feedManager2.publicKeys.has(aliceKey);
      
      if (keysExchanged) {
        console.log('✅ GPG keys exchanged!');
      }
      
      return keysExchanged;
    }, 30000); // Increased timeout for key exchange
    
    // Alice sends encrypted message to Bob
    console.log('\n🔒 Alice sending encrypted message to Bob...');
    await feedManager1.appendMessage('message', 'Secret message for Bob!', {
      recipient: bobKey
    });
    
    // Wait for message replication
    console.log('⏳ Waiting for encrypted message to replicate...');
    await waitFor(async () => {
      const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
      if (aliceFeed && aliceFeed.length >= 2) {
        console.log(`   Alice's feed has ${aliceFeed.length} messages`);
        return true;
      }
      return false;
    }, 15000);
    
    // Bob reads and decrypts
    const messages = await feedManager2.getFeedMessages(
      feedManager2.followedFeeds.get(aliceKey)
    );
    
    console.log(`\n📨 Bob received ${messages.length} messages from Alice:`);
    messages.forEach((msg, i) => {
      console.log(`   ${i + 1}. Type: ${msg.type}, Encrypted: ${msg.encrypted}, Content: ${msg.content?.slice(0, 50)}...`);
    });
    
    const encryptedMessages = messages.filter(m => m.encrypted);
    
    assert.ok(encryptedMessages.length >= 1, 'Bob should have received encrypted message');
    assert.equal(encryptedMessages[0].content, 'Secret message for Bob!', 'Message should be decrypted');
    assert.equal(encryptedMessages[0].verified, true, 'Signature should be verified');
    
    console.log('✅ Encrypted message delivered and decrypted!');
    console.log(`   Content: "${encryptedMessages[0].content}"`);
    console.log(`   Encrypted: ${encryptedMessages[0].encrypted}`);
    console.log(`   Verified: ${encryptedMessages[0].verified}`);
    
    console.log('\n🎉 Encrypted P2P messaging test passed!');
    
  } finally {
    await networkManager1.stop();
    await networkManager2.stop();
    await cleanup(feedManager1, feedManager2);
  }
});

test('P2P Integration - Feed key validation', async (t) => {
  const storage = createTempDir('p2p-validation');
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('test-user');
    
    // Test invalid feed key lengths
    await assert.rejects(
      async () => await feedManager.followUser('96DBE2E45D46CBF8843E8307A30FA00174CFDB0E'),
      /Invalid feed key length/,
      'Should reject GPG fingerprint (40 chars)'
    );
    
    await assert.rejects(
      async () => await feedManager.followUser('short'),
      /Invalid feed key length/,
      'Should reject short keys'
    );
    
    await assert.rejects(
      async () => await feedManager.followUser(''),
      /Feed key must be a hex string|Invalid feed key length/,
      'Should reject empty keys'
    );
    
    // Test invalid characters
    await assert.rejects(
      async () => await feedManager.followUser('g'.repeat(64)),
      /hexadecimal characters/,
      'Should reject non-hex characters'
    );
    
    console.log('✅ Feed key validation working correctly');
    
  } finally {
    await cleanup(feedManager);
  }
});
