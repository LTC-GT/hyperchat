import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FeedManager } from '../src/feed-manager.js';
import { createTempDir, cleanup } from './test-helpers.js';
import b4a from 'b4a';

test('FeedManager - initialize', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    const key = await feedManager.initialize('test-user');
    
    assert.ok(key, 'Should return a public key');
    assert.ok(feedManager.ownFeed, 'Should have own feed');
    assert.equal(feedManager.username, 'test-user', 'Should set username');
    assert.equal(b4a.toString(key, 'hex'), b4a.toString(feedManager.ownFeed.key, 'hex'));
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - append message', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('test-user');
    
    const message = await feedManager.appendMessage('message', 'Hello, test!');
    
    assert.ok(message, 'Should return message');
    assert.equal(message.type, 'signed', 'Message should be wrapped in signed type');
    assert.ok(message.signed_content, 'Should have signed_content');
    assert.equal(message.author, 'test-user');
    assert.ok(message.timestamp, 'Should have timestamp');
    
    // Verify it was added to feed (1 key announcement + 1 message = 2)
    assert.equal(feedManager.ownFeed.length, 2, 'Feed should have 2 messages (key_announcement + message)');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - append multiple messages', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('test-user');
    
    await feedManager.appendMessage('message', 'Message 1');
    await feedManager.appendMessage('status', 'Status update');
    await feedManager.appendMessage('microblog', 'Short post');
    
    // 1 key_announcement + 3 messages = 4
    assert.equal(feedManager.ownFeed.length, 4, 'Feed should have 4 messages (key_announcement + 3 messages)');
    
    const messages = await feedManager.getOwnMessages();
    // All messages are returned (key_announcement + 3 signed messages)
    assert.ok(messages.length >= 3, 'Should have at least 3 messages');
    
    // Verify signed messages were processed (they have the 'signed' flag)
    const signedMessages = messages.filter(m => m.signed === true);
    assert.ok(signedMessages.length >= 3, 'Should have at least 3 signed messages');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - validate microblog length', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('test-user');
    
    const longContent = 'A'.repeat(281);
    
    await assert.rejects(
      async () => await feedManager.appendMessage('microblog', longContent),
      /280 characters/i,
      'Should reject microblogs over 280 chars'
    );
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - follow user', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const user1Key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    
    const followedFeed = await feedManager2.followUser(user1Key);
    
    assert.ok(followedFeed, 'Should return followed feed');
    assert.equal(feedManager2.followedFeeds.size, 1, 'Should have 1 followed feed');
    assert.ok(feedManager2.followedFeeds.has(user1Key), 'Should track followed user');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('FeedManager - unfollow user', async () => {
  const storage1 = createTempDir();
  const storage2 = createTempDir();
  const feedManager1 = new FeedManager(storage1);
  const feedManager2 = new FeedManager(storage2);
  
  try {
    await feedManager1.initialize('user1');
    await feedManager2.initialize('user2');
    
    const user1Key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    
    await feedManager2.followUser(user1Key);
    assert.equal(feedManager2.followedFeeds.size, 1);
    
    await feedManager2.unfollowUser(user1Key);
    assert.equal(feedManager2.followedFeeds.size, 0, 'Should have 0 followed feeds');
  } finally {
    await cleanup(feedManager1, feedManager2);
  }
});

test('FeedManager - get timeline', async () => {
  const storage = createTempDir();
  const feedManager = new FeedManager(storage);
  
  try {
    await feedManager.initialize('test-user');
    
    await feedManager.appendMessage('message', 'Message 1');
    await feedManager.appendMessage('status', 'Status 2');
    await feedManager.appendMessage('microblog', 'Blog 3');
    
    const timeline = await feedManager.getTimeline();
    
    // Timeline includes key_announcement + 3 messages = 4
    assert.ok(timeline.length >= 3, 'Timeline should have at least 3 messages');
    // Timeline should be sorted by timestamp (most recent first)
    assert.ok(timeline[0].timestamp >= timeline[timeline.length - 1].timestamp, 'Should be sorted by timestamp');
  } finally {
    await cleanup(feedManager);
  }
});

test('FeedManager - get following list', async () => {
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
    
    const user1Key = b4a.toString(feedManager1.ownFeed.key, 'hex');
    const user2Key = b4a.toString(feedManager2.ownFeed.key, 'hex');
    
    await feedManager3.followUser(user1Key);
    await feedManager3.followUser(user2Key);
    
    const following = feedManager3.getFollowing();
    
    assert.equal(following.length, 2, 'Should be following 2 users');
    assert.ok(following.includes(user1Key));
    assert.ok(following.includes(user2Key));
  } finally {
    await cleanup(feedManager1, feedManager2, feedManager3);
  }
});
