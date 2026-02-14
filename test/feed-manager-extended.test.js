// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FeedManager } from '../src/feed-manager.js';
import { createTempDir, cleanup } from './test-helpers.js';
import b4a from 'b4a';

test('FeedManager - appendMessage throws when feed not initialized', async () => {
  const feedManager = new FeedManager(createTempDir());
  
  try {
    await assert.rejects(
      async () => await feedManager.appendMessage('message', 'test'),
      /Feed not initialized/,
      'Should throw when feed not initialized'
    );
  } finally {
    await cleanup();
  }
});

test('FeedManager - encrypted message to recipient', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const alice = new FeedManager(storage1);
  const bob = new FeedManager(storage2);
  
  try {
    await alice.initialize('alice');
    await bob.initialize('bob');
    
    // Alice needs Bob's public key
    const bobKey = b4a.toString(bob.ownFeed.key, 'hex');
    await alice.followUser(bobKey, 'bob');
    
    // Read Bob's key announcement to get his GPG public key
    const bobAnnouncement = await bob.ownFeed.get(0);
    const bobAnnouncementDecoded = await import('../src/encoding.js')
      .then(m => m.decode(bobAnnouncement));
    
    alice.publicKeys.set(bobKey, bobAnnouncementDecoded.gpg_public_key);
    
    // Alice sends encrypted message to Bob
    const encryptedMsg = await alice.appendMessage(
      'message',
      'Secret for Bob',
      { recipient: bobKey }
    );
    
    assert.equal(encryptedMsg.type, 'encrypted', 'Message should be encrypted type');
    assert.ok(encryptedMsg.encrypted_content, 'Should have encrypted content');
    assert.equal(encryptedMsg.recipient, bobKey, 'Should specify recipient');
  } finally {
    await cleanup(alice, bob);
  }
});

test('FeedManager - encrypted message without recipient key fails', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const nonExistentKey = 'a'.repeat(64);
    
    await assert.rejects(
      async () => await feedManager.appendMessage(
        'message',
        'Secret',
        { recipient: nonExistentKey }
      ),
      /Recipient public key not found/,
      'Should throw when recipient key not found'
    );
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - followUser validates non-string input', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    await assert.rejects(
      async () => await feedManager.followUser(null),
      /Feed key must be a hex string/,
      'Should reject null key'
    );
    
    await assert.rejects(
      async () => await feedManager.followUser(undefined),
      /Feed key must be a hex string/,
      'Should reject undefined key'
    );
    
    await assert.rejects(
      async () => await feedManager.followUser(123),
      /Feed key must be a hex string/,
      'Should reject number key'
    );
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - followUser validates hex characters', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const invalidHex = 'g'.repeat(64); // 'g' is not a hex character
    
    await assert.rejects(
      async () => await feedManager.followUser(invalidHex),
      /hexadecimal characters/,
      'Should reject non-hex characters'
    );
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - followUser handles whitespace in key', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    const keyWithSpaces = key.slice(0, 32) + '  \n  ' + key.slice(32);
    
    // Should clean whitespace and work
    const feed = await feedManager2.followUser(keyWithSpaces, 'user1');
    assert.ok(feed, 'Should handle whitespace in key');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('FeedManager - followUser updates username when already following', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    
    // Follow without username
    await feedManager2.followUser(key);
    assert.ok(feedManager2.followedFeeds.has(key), 'Should be following');
    
    // Follow again with username
    await feedManager2.followUser(key, 'Alice');
    assert.equal(feedManager2.usernames.get(key), 'Alice', 'Should update username');
    
    // Verify getUsernameForKey returns updated name
    assert.equal(feedManager2.getUsernameForKey(key), 'Alice');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('FeedManager - followUser handles already following without username', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    
    // Follow first time
    await feedManager2.followUser(key, 'User1');
    
    // Follow again without username
    const feed = await feedManager2.followUser(key);
    assert.ok(feed, 'Should return feed');
    assert.equal(feedManager2.usernames.get(key), 'User1', 'Username should remain unchanged');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('FeedManager - getUsernameForKey returns truncated key if no username', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const fakeKey = 'abcd1234'.repeat(8); // 64 char hex
    const username = feedManager.getUsernameForKey(fakeKey);
    
    assert.equal(username, 'abcd1234', 'Should return first 8 chars when no username set');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - getKeyForUsername finds correct key', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    await feedManager2.followUser(key, 'Alice');
    
    const foundKey = feedManager2.getKeyForUsername('Alice');
    assert.equal(foundKey, key, 'Should find key by username');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('FeedManager - getKeyForUsername returns null for unknown username', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    const key = feedManager.getKeyForUsername('NonExistentUser');
    assert.equal(key, null, 'Should return null for unknown username');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - followUser with GPG fingerprint fails with helpful error', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    // GPG fingerprint is 40 hex chars, not 64
    const gpgFingerprint = feedManager.crypto.getFingerprint();
    
    await assert.rejects(
      async () => await feedManager.followUser(gpgFingerprint),
      /Invalid feed key length.*64 hex characters.*GPG fingerprints/s,
      'Should provide helpful error mentioning GPG fingerprints'
    );
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - announces public key on initialization', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('testuser');
    
    // First message should be key announcement
    assert.equal(feedManager.ownFeed.length, 1, 'Should have one message after init');
    
    const firstMsg = await feedManager.ownFeed.get(0);
    const decoded = await import('../src/encoding.js').then(m => m.decode(firstMsg));
    
    assert.equal(decoded.type, 'key_announcement', 'First message should be key announcement');
    assert.ok(decoded.gpg_public_key, 'Should contain GPG public key');
    assert.ok(decoded.fingerprint, 'Should contain fingerprint');
  } finally {
    await cleanup(feedManager);
  }
});
