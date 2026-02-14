// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { NetworkManager } from '../src/network-manager.js';
import { FeedManager } from '../src/feed-manager.js';
import { createTempDir, cleanup } from './test-helpers.js';
import b4a from 'b4a';

test('NetworkManager - constructor initializes correctly', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const networkManager = new NetworkManager(feedManager);
    
    assert.ok(networkManager.feedManager, 'Should have feedManager');
    assert.equal(networkManager.swarm, null, 'Swarm should be null before start');
    assert.ok(networkManager.connections instanceof Set, 'Should have connections Set');
    assert.equal(networkManager.connections.size, 0, 'Should start with no connections');
  } finally {
    await cleanup(feedManager);
  }
});

test('NetworkManager - constructor with callback', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const callback = (conn, info) => {};
    const networkManager = new NetworkManager(feedManager, callback);
    
    assert.equal(networkManager.onPeerConnected, callback, 'Should store callback');
  } finally {
    await cleanup(feedManager);
  }
});

test('NetworkManager - getStats before starting', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    const networkManager = new NetworkManager(feedManager);
    
    const stats = networkManager.getStats();
    
    assert.equal(stats.peers, 0, 'Should have 0 peers');
    assert.equal(stats.ownFeedLength, 1, 'Should have 1 message (key announcement)');
    assert.equal(stats.followedFeeds, 0, 'Should have 0 followed feeds');
  } finally {
    await cleanup(feedManager);
  }
});

test('NetworkManager - getStats with followed feeds', async () => {
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
    
    const networkManager = new NetworkManager(feedManager2);
    const stats = networkManager.getStats();
    
    assert.equal(stats.peers, 0, 'Should have 0 peers before starting');
    assert.equal(stats.followedFeeds, 1, 'Should have 1 followed feed');
    assert.ok(stats.ownFeedLength > 0, 'Should have messages in own feed');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('NetworkManager - stop before starting', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    const networkManager = new NetworkManager(feedManager);
    
    // Should not throw when stopping before starting
    await networkManager.stop();
    
    assert.equal(networkManager.swarm, null, 'Swarm should remain null');
  } finally {
    await cleanup(feedManager);
  }
});

test('NetworkManager - start and stop', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  let networkManager;
  
  try {
    await feedManager.initialize('testuser');
    networkManager = new NetworkManager(feedManager);
    
    await networkManager.start();
    
    assert.ok(networkManager.swarm, 'Swarm should be created');
    
    await networkManager.stop();
    
    assert.equal(networkManager.connections.size, 0, 'Connections should be cleared');
  } finally {
    if (networkManager) {
      await networkManager.stop();
    }
    await cleanup(feedManager);
  }
});

test('NetworkManager - start announces own feed', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  let networkManager;
  
  try {
    await feedManager.initialize('testuser');
    
    // Add a test message
    await feedManager.appendMessage('message', 'Test message');
    
    networkManager = new NetworkManager(feedManager);
    await networkManager.start();
    
    const stats = networkManager.getStats();
    assert.equal(stats.ownFeedLength, 2, 'Should have 2 messages (key announcement + message)');
    
    await networkManager.stop();
  } finally {
    if (networkManager) {
      await networkManager.stop();
    }
    await cleanup(feedManager);
  }
});

test('NetworkManager - followAndReplicate without swarm', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const networkManager = new NetworkManager(feedManager2);
    const key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    
    // Should work even without swarm started
    const feed = await networkManager.followAndReplicate(key, 'User1');
    
    assert.ok(feed, 'Should return feed');
    assert.equal(feedManager2.followedFeeds.size, 1, 'Should have 1 followed feed');
    assert.equal(feedManager2.getUsernameForKey(key), 'User1', 'Should set username');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('NetworkManager - getStats with no own feed', () => {
  const feedManager = {
    ownFeed: null,
    followedFeeds: new Map()
  };
  
  const networkManager = new NetworkManager(feedManager);
  const stats = networkManager.getStats();
  
  assert.equal(stats.ownFeedLength, 0, 'Should return 0 when no own feed');
  assert.equal(stats.peers, 0);
  assert.equal(stats.followedFeeds, 0);
});
