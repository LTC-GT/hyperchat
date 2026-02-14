import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FeedManager } from '../src/feed-manager.js';
import { NetworkManager } from '../src/network-manager.js';
import { createTempDir, waitFor, sleep, cleanup } from './test-helpers.js';
import b4a from 'b4a';

/**
 * Integration tests for P2P functionality
 * These tests simulate real-world multi-user scenarios
 */

test('Integration - Two users connect and replicate', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  let networkManager1, networkManager2;
  
  try {
    // Initialize both users
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    
    // Alice posts a message
    await feedManager1.appendMessage('message', 'Hello from Alice!');
    
    // Start network managers
    networkManager1 = new NetworkManager(feedManager1);
    networkManager2 = new NetworkManager(feedManager2);
    
    await networkManager1.start();
    await networkManager2.start();
    
    // Bob follows Alice
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    await networkManager2.followAndReplicate(aliceKey);
    
    // Wait for replication (can take a few seconds)
    await waitFor(async () => {
      const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
      return aliceFeed && aliceFeed.length > 0;
    }, 10000);
    
    // Verify Bob received Alice's message
    const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
    assert.ok(aliceFeed, 'Bob should have Alice\'s feed');
    assert.equal(aliceFeed.length, 1, 'Alice\'s feed should have 1 message');
    
    const messages = await feedManager2.getFeedMessages(aliceFeed);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Hello from Alice!');
    assert.equal(messages[0].author, 'alice');
    
    console.log('✓ Two users connected and replicated successfully');
  } finally {
    await cleanup(feedManager1, feedManager2, networkManager1, networkManager2);
  }
});

test('Integration - Real-time message propagation', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  let networkManager1, networkManager2;
  
  try {
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    
    networkManager1 = new NetworkManager(feedManager1);
    networkManager2 = new NetworkManager(feedManager2);
    
    await networkManager1.start();
    await networkManager2.start();
    
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    await networkManager2.followAndReplicate(aliceKey);
    
    // Wait for initial connection
    await sleep(2000);
    
    // Alice posts a message AFTER Bob is already connected
    await feedManager1.appendMessage('message', 'Real-time message!');
    
    // Wait for real-time replication
    await waitFor(async () => {
      const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
      return aliceFeed && aliceFeed.length > 0;
    }, 10000);
    
    const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
    const messages = await feedManager2.getFeedMessages(aliceFeed);
    
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Real-time message!');
    
    console.log('✓ Real-time message propagation works');
  } finally {
    await cleanup(feedManager1, feedManager2, networkManager1, networkManager2);
  }
});

test('Integration - Three-way feed replication', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const storage3 = createTempDir();
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  const feedManager3 = new FeedManager(storage3);
  
  let networkManager1, networkManager2, networkManager3;
  
  try {
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    await feedManager3.initialize('charlie');
    
    // Each user posts a message
    await feedManager1.appendMessage('message', 'Hello from Alice');
    await feedManager2.appendMessage('status', 'Bob is here');
    await feedManager3.appendMessage('microblog', 'Charlie says hi');
    
    networkManager1 = new NetworkManager(feedManager1);
    networkManager2 = new NetworkManager(feedManager2);
    networkManager3 = new NetworkManager(feedManager3);
    
    await networkManager1.start();
    await networkManager2.start();
    await networkManager3.start();
    
    // Charlie follows both Alice and Bob
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    const bobKey = b4a.toString(feedManager2.ownFeed.key, 'hex');
    
    await networkManager3.followAndReplicate(aliceKey);
    await networkManager3.followAndReplicate(bobKey);
    
    // Wait for replication
    await waitFor(async () => {
      const aliceFeed = feedManager3.followedFeeds.get(aliceKey);
      const bobFeed = feedManager3.followedFeeds.get(bobKey);
      return aliceFeed && aliceFeed.length > 0 && 
             bobFeed && bobFeed.length > 0;
    }, 15000);
    
    // Verify Charlie has messages from both
    const timeline = await feedManager3.getTimeline();
    
    // Charlie's own message + Alice's + Bob's = 3 total
    assert.equal(timeline.length, 3, 'Timeline should have 3 messages');
    
    const contents = timeline.map(m => m.content);
    assert.ok(contents.includes('Hello from Alice'));
    assert.ok(contents.includes('Bob is here'));
    assert.ok(contents.includes('Charlie says hi'));
    
    console.log('✓ Three-way feed replication works');
  } finally {
    await cleanup(
      feedManager1, feedManager2, feedManager3,
      networkManager1, networkManager2, networkManager3
    );
  }
});

test('Integration - Message types preservation', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  let networkManager1, networkManager2;
  
  try {
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    
    // Alice posts different message types
    await feedManager1.appendMessage('message', 'A chat message');
    await feedManager1.appendMessage('status', 'A status update');
    await feedManager1.appendMessage('microblog', 'A microblog post');
    
    networkManager1 = new NetworkManager(feedManager1);
    networkManager2 = new NetworkManager(feedManager2);
    
    await networkManager1.start();
    await networkManager2.start();
    
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    await networkManager2.followAndReplicate(aliceKey);
    
    await waitFor(async () => {
      const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
      return aliceFeed && aliceFeed.length === 3;
    }, 10000);
    
    const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
    const messages = await feedManager2.getFeedMessages(aliceFeed);
    
    assert.equal(messages.length, 3);
    assert.equal(messages[0].type, 'message');
    assert.equal(messages[1].type, 'status');
    assert.equal(messages[2].type, 'microblog');
    
    console.log('✓ Message types preserved during replication');
  } finally {
    await cleanup(feedManager1, feedManager2, networkManager1, networkManager2);
  }
});

test('Integration - Offline then online sync', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  let networkManager1, networkManager2;
  
  try {
    await feedManager1.initialize('alice');
    await feedManager2.initialize('bob');
    
    // Alice posts messages while offline (no network manager)
    await feedManager1.appendMessage('message', 'Offline message 1');
    await feedManager1.appendMessage('message', 'Offline message 2');
    
    assert.equal(feedManager1.ownFeed.length, 2);
    
    // Now start network and connect
    networkManager1 = new NetworkManager(feedManager1);
    networkManager2 = new NetworkManager(feedManager2);
    
    await networkManager1.start();
    await networkManager2.start();
    
    const aliceKey = b4a.toString(feedManager1.ownFeed.key, 'hex');
    await networkManager2.followAndReplicate(aliceKey);
    
    // Wait for sync of offline messages
    await waitFor(async () => {
      const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
      return aliceFeed && aliceFeed.length === 2;
    }, 10000);
    
    const aliceFeed = feedManager2.followedFeeds.get(aliceKey);
    const messages = await feedManager2.getFeedMessages(aliceFeed);
    
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, 'Offline message 1');
    assert.equal(messages[1].content, 'Offline message 2');
    
    console.log('✓ Offline messages synced when coming online');
  } finally {
    await cleanup(feedManager1, feedManager2, networkManager1, networkManager2);
  }
});

console.log('\nRunning integration tests...\n');
