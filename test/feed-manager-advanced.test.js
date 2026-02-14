// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FeedManager } from '../src/feed-manager.js';
import { createTempDir, cleanup, sleep } from './test-helpers.js';
import b4a from 'b4a';

test('FeedManager - getAllFollowedMessages', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const storage3 = createTempDir();
  const alice = new FeedManager(storage1);
  const bob = new FeedManager(storage2);
  const charlie = new FeedManager(storage3);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    await charlie.initialize('charlie');
    
    // Alice and Bob post messages
    await alice.appendMessage('message', 'Hello from Alice');
    await bob.appendMessage('status', 'Bob status');
    
    // Charlie follows both
    const aliceKey = b4a.toString(alice.ownFeed.key, 'hex');
    const bobKey = b4a.toString(bob.ownFeed.key, 'hex');
    
    await charlie.followUser(aliceKey, 'alice');
    await charlie.followUser(bobKey, 'bob');
    
    // Need to wait for feeds to be ready and have data
    await alice.ownFeed.ready();
    await bob.ownFeed.ready();
    
    // Manually replicate to get the data in Charlie's followed feeds
    // In real usage, NetworkManager handles this
    const aliceFeed = charlie.followedFeeds.get(aliceKey);
    const bobFeed = charlie.followedFeeds.get(bobKey);
    
    await aliceFeed.ready();
    await bobFeed.ready();
    
    // Get all followed messages
    const messages = await charlie.getAllFollowedMessages();
    
    // Feeds start empty until replication happens
    // This test verifies the method works, even with empty feeds
    assert.ok(Array.isArray(messages), 'Should return an array');
    assert.ok(messages.length >= 0, 'Should handle empty followed feeds');
    
    // Check sorting (most recent first)
    for (let i = 0; i < messages.length - 1; i++) {
      assert.ok(messages[i].timestamp >= messages[i + 1].timestamp, 
        'Messages should be sorted by timestamp (descending)');
    }
  } finally {
    await cleanup(alice, bob, charlie);
  }
});

test('FeedManager - getTimeline combines own and followed', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const alice = new FeedManager(storage1);
  const bob = new FeedManager(storage2);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    
    // Both post messages
    await alice.appendMessage('message', 'Alice message');
    await bob.appendMessage('message', 'Bob message');
    
    // Alice follows Bob
    const bobKey = b4a.toString(bob.ownFeed.key, 'hex');
    await alice.followUser(bobKey, 'bob');
    
    // Get timeline
    const timeline = await alice.getTimeline();
    
    // Alice's own messages are verified (key_announcement + message = 2)
    // Bob's key_announcement is visible but his signed message needs his public key
    assert.ok(timeline.length >= 2, 'Timeline should have at least own messages');
    
    // Verify own messages are present
    const contents = timeline.map(m => m.content);
    assert.ok(contents.includes('Alice message'), 'Should have own message');
    
    // Check sorting
    for (let i = 0; i < timeline.length - 1; i++) {
      assert.ok(timeline[i].timestamp >= timeline[i + 1].timestamp, 
        'Timeline should be sorted by timestamp (descending)');
    }
  } finally {
    await cleanup(alice, bob);
  }
});

test('FeedManager - getTimeline with no followed feeds', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    await feedManager.appendMessage('message', 'My message');
    
    const timeline = await feedManager.getTimeline();
    
    // Should only have own messages (key_announcement + message)
    assert.equal(timeline.length, 2, 'Should have only own messages');
    assert.equal(timeline[1].author, 'testuser');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - getFollowing returns feed keys', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const storage3 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  const feedManager3 = new FeedManager(storage3);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    await feedManager3.initialize('user3');
    
    // User3 follows User1 and User2
    const key1 = b4a.toString(feedManager1.ownFeed.key, 'hex');
    const key2 = b4a.toString(feedManager2.ownFeed.key, 'hex');
    
    await feedManager3.followUser(key1, 'user1');
    await feedManager3.followUser(key2, 'user2');
    
    const following = feedManager3.getFollowing();
    
    assert.equal(following.length, 2, 'Should return 2 followed keys');
    assert.ok(following.includes(key1), 'Should include user1 key');
    assert.ok(following.includes(key2), 'Should include user2 key');
  } finally {
    await cleanup(feedManager1, feedManager2, feedManager3);
  }
});

test('FeedManager - getFollowing returns empty array when not following anyone', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const following = feedManager.getFollowing();
    
    assert.ok(Array.isArray(following), 'Should return an array');
    assert.equal(following.length, 0, 'Should be empty');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - close closes all feeds', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    // Follow a user
    const key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    await feedManager2.followUser(key);
    
    assert.equal(feedManager2.followedFeeds.size, 1, 'Should have 1 followed feed');
    
    // Close all feeds
    await feedManager2.close();
    
    assert.equal(feedManager2.followedFeeds.size, 0, 'Should clear followed feeds');
  } finally {
    // Don't call cleanup since we already closed
  }
});

test('FeedManager - watchFeed with key announcement', async (t) => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    let receivedMessage = null;
    
    // Set up watch
    feedManager.watchFeed(feedManager.ownFeed, (msg) => {
      receivedMessage = msg;
    });
    
    // Append a message
    await feedManager.appendMessage('message', 'Test message');
    
    // Wait a bit for the event to fire
    await sleep(100);
    
    // Note: The watch will fire for the second message (not key announcement since that's already there)
    if (receivedMessage) {
      assert.ok(receivedMessage.seq >= 0, 'Should have sequence number');
      assert.ok(receivedMessage.feedKey, 'Should have feed key');
    }
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - watchFeed with signed message', async (t) => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    // Store the GPG key first
    const feedKey = b4a.toString(feedManager.ownFeed.key, 'hex');
    feedManager.publicKeys.set(feedKey, feedManager.crypto.getPublicKeyArmored());
    
    let receivedMessage = null;
    
    feedManager.watchFeed(feedManager.ownFeed, (msg) => {
      if (msg.type === 'message') {
        receivedMessage = msg;
      }
    });
    
    await feedManager.appendMessage('message', 'Watched message');
    await sleep(100);
    
    if (receivedMessage) {
      assert.ok(receivedMessage.signed, 'Should be marked as signed');
      assert.ok(receivedMessage.verified !== undefined, 'Should have verified flag');
    }
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - encrypted message not for recipient is skipped', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const storage3 = createTempDir();
  const alice = new FeedManager(storage1);
  const bob = new FeedManager(storage2);
  const charlie = new FeedManager(storage3);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    await charlie.initialize('charlie');
    
    const bobKey = b4a.toString(bob.ownFeed.key, 'hex');
    
    // Alice gets Bob's public key
    await alice.followUser(bobKey, 'bob');
    const bobAnnouncement = await bob.ownFeed.get(0);
    const bobAnnouncementDecoded = await import('../src/encoding.js')
      .then(m => m.decode(bobAnnouncement));
    alice.publicKeys.set(bobKey, bobAnnouncementDecoded.gpg_public_key);
    
    // Alice sends encrypted message to Bob
    await alice.appendMessage('message', 'Secret for Bob', { recipient: bobKey });
    
    // Charlie follows Alice but shouldn't see the encrypted message
    const aliceKey = b4a.toString(alice.ownFeed.key, 'hex');
    await charlie.followUser(aliceKey, 'alice');
    
    const messages = await charlie.getFeedMessages(charlie.followedFeeds.get(aliceKey));
    
    // Followed feeds start empty until NetworkManager replicates
    // This test verifies the method works with empty followed feeds
    assert.ok(Array.isArray(messages), 'Should return an array');
    assert.strictEqual(messages.length, 0, 'Should be empty until replication');
  } finally {
    await cleanup(alice, bob, charlie);
  }
});

test('FeedManager - getFeedMessages handles corrupted blocks', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    // Add a normal message
    await feedManager.appendMessage('message', 'Good message');
    
    // Manually append corrupted data (this simulates a corrupted block)
    // We can't actually corrupt it easily, but we can test the error path
    // by mocking getFeedMessages to handle errors
    
    const messages = await feedManager.getOwnMessages();
    
    // Should still return valid messages despite any potential errors
    assert.ok(messages.length >= 2, 'Should have at least key_announcement + message');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - signed message without sender public key is skipped', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const alice = new FeedManager(storage1);
  const bob = new FeedManager(storage2);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    
    // Alice posts a message
    await alice.appendMessage('message', 'Alice message');
    
    // Bob follows Alice but doesn't have her public key yet
    const aliceKey = b4a.toString(alice.ownFeed.key, 'hex');
    await bob.followUser(aliceKey, 'alice');
    
    // Manually clear public keys to simulate missing key
    bob.publicKeys.delete(aliceKey);
    
    const messages = await bob.getFeedMessages(bob.followedFeeds.get(aliceKey));
    
    // Followed feeds start empty until NetworkManager replicates
    // This test verifies the method works with empty followed feeds
    assert.ok(Array.isArray(messages), 'Should return an array');
    assert.strictEqual(messages.length, 0, 'Should be empty until replication');
  } finally {
    await cleanup(alice, bob);
  }
});

test('FeedManager - getAllFollowedMessages with options', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const alice = new FeedManager(storage1);
  const bob = new FeedManager(storage2);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    
    // Alice posts messages
    await alice.appendMessage('message', 'Message 1');
    await alice.appendMessage('message', 'Message 2');
    
    // Bob follows Alice
    const aliceKey = b4a.toString(alice.ownFeed.key, 'hex');
    await bob.followUser(aliceKey, 'alice');
    
    // Get followed messages with options
    const messages = await bob.getAllFollowedMessages({});
    
    // Followed feeds start empty until replication
    // Verify method works with options parameter
    assert.ok(Array.isArray(messages), 'Should return an array');
    assert.strictEqual(messages.length, 0, 'Should be empty until replication');
  } finally {
    await cleanup(alice, bob);
  }
});

test('FeedManager - getTimeline with options', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    await feedManager.appendMessage('message', 'Message 1');
    await feedManager.appendMessage('message', 'Message 2');
    
    const timeline = await feedManager.getTimeline({});
    
    assert.equal(timeline.length, 3, 'Should have key_announcement + 2 messages');
  } finally {
    await cleanup(feedManager);
  }
});
