// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import Hypercore from 'hypercore';
import b4a from 'b4a';
import { encode, decode } from './encoding.js';
import { CryptoManager } from './crypto-manager.js';

/**
 * FeedManager handles the user's own feed and followed feeds
 */
export class FeedManager {
  constructor(storage = './storage') {
    this.storage = storage;
    this.ownFeed = null;
    this.followedFeeds = new Map(); // feedKey -> feed
    this.usernames = new Map(); // feedKey -> username
    this.publicKeys = new Map(); // feedKey -> GPG public key (armored)
    this.crypto = null;
    this.username = null;
  }

  /**
   * Initialize or load the user's own feed
   */
  async initialize(username, privateKeyPath = null, publicKeyPath = null) {
    this.username = username;
    
    // Initialize crypto manager with GPG keys
    this.crypto = new CryptoManager(this.storage);
    await this.crypto.initialize(username, privateKeyPath, publicKeyPath);
    
    // Create or load user's own feed
    this.ownFeed = new Hypercore(`${this.storage}/${username}/feed`);
    await this.ownFeed.ready();
    
    // Post public key announcement if this is a new feed
    if (this.ownFeed.length === 0) {
      await this.announcePublicKey();
    }
    
    return this.ownFeed.key;
  }

  /**
   * Announce GPG public key to the network
   */
  async announcePublicKey() {
    const announcement = {
      type: 'key_announcement',
      gpg_public_key: this.crypto.getPublicKeyArmored(),
      fingerprint: this.crypto.getFingerprint(),
      timestamp: Date.now(),
      author: this.username
    };
    
    const encoded = encode(announcement);
    await this.ownFeed.append(encoded);
  }

  /**
   * Append a message to the user's own feed
   */
  async appendMessage(type, content, metadata = {}) {
    if (!this.ownFeed) {
      throw new Error('Feed not initialized');
    }

    // Validate microblog length
    if (type === 'microblog' && content.length > 280) {
      throw new Error('Microblog posts must be 280 characters or less');
    }

    let message = {
      type,
      content,
      timestamp: Date.now(),
      author: this.username,
      gpg_fingerprint: this.crypto.getFingerprint(),
      ...metadata
    };

    // If there's a recipient, encrypt the message
    if (metadata.recipient) {
      const recipientPubKey = this.publicKeys.get(metadata.recipient);
      if (!recipientPubKey) {
        throw new Error('Recipient public key not found. They may not have announced their key yet.');
      }
      
      const encryptedContent = await this.crypto.encryptMessage(
        { type, content, timestamp: message.timestamp, author: this.username },
        recipientPubKey
      );
      
      message = {
        type: 'encrypted',
        encrypted_content: encryptedContent,
        recipient: metadata.recipient,
        timestamp: Date.now(),
        author: this.username,
        gpg_fingerprint: this.crypto.getFingerprint()
      };
    } else {
      // Sign public messages
      const signed = await this.crypto.signMessage(message);
      message = {
        type: 'signed',
        signed_content: signed,
        timestamp: Date.now(),
        author: this.username,
        gpg_fingerprint: this.crypto.getFingerprint()
      };
    }

    const encoded = encode(message);
    await this.ownFeed.append(encoded);
    
    return message;
  }

  /**
   * Follow a user by their public key
   */
  async followUser(publicKeyHex, username = null) {
    // Validate feed key format (must be 64 hex chars = 32 bytes)
    if (!publicKeyHex || typeof publicKeyHex !== 'string') {
      throw new Error('Feed key must be a hex string');
    }
    
    const cleanHex = publicKeyHex.replace(/\s+/g, '').toLowerCase();
    
    if (cleanHex.length !== 64) {
      throw new Error(
        `Invalid feed key length. Expected 64 hex characters (32 bytes), got ${cleanHex.length}.\n` +
        `Feed keys look like: dcba522ef06b93ccec0fc5d9e84189038475b8f94018ef92010756e329482faa\n` +
        `GPG fingerprints are different and cannot be used to follow users.\n` +
        `Use /mykey in the other user's client to get their feed key.`
      );
    }
    
    if (!/^[0-9a-f]+$/.test(cleanHex)) {
      throw new Error('Feed key must contain only hexadecimal characters (0-9, a-f)');
    }
    
    if (this.followedFeeds.has(cleanHex)) {
      // Update username if provided
      if (username) {
        this.usernames.set(cleanHex, username);
        console.log(`Updated username to "${username}" for ${cleanHex.slice(0, 16)}...`);
      } else {
        console.log('Already following this user');
      }
      return this.followedFeeds.get(cleanHex);
    }

    const publicKey = b4a.from(cleanHex, 'hex');
    const feed = new Hypercore(`${this.storage}/follows/${cleanHex}`, publicKey);
    
    await feed.ready();
    this.followedFeeds.set(cleanHex, feed);
    
    // Store username if provided
    if (username) {
      this.usernames.set(cleanHex, username);
      console.log(`Now following: "${username}" (${cleanHex.slice(0, 16)}...)`);
    } else {
      console.log(`Now following: ${cleanHex.slice(0, 16)}...`);
    }
    
    return feed;
  }

  /**
   * Get username for a public key
   */
  getUsernameForKey(publicKeyHex) {
    return this.usernames.get(publicKeyHex) || publicKeyHex.slice(0, 8);
  }

  /**
   * Get public key for a username
   */
  getKeyForUsername(username) {
    for (const [key, name] of this.usernames.entries()) {
      if (name === username) {
        return key;
      }
    }
    return null;
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(publicKeyHex) {
    const feed = this.followedFeeds.get(publicKeyHex);
    if (feed) {
      await feed.close();
      this.followedFeeds.delete(publicKeyHex);
      console.log(`Unfollowed: ${publicKeyHex.slice(0, 16)}...`);
    }
  }

  /**
   * Get all messages from a feed (with decryption/verification)
   */
  async getFeedMessages(feed, options = {}) {
    const { start = 0, limit = 100 } = options;
    const messages = [];
    
    const end = Math.min(start + limit, feed.length);
    const feedKeyHex = b4a.toString(feed.key, 'hex');
    
    for (let i = start; i < end; i++) {
      try {
        const block = await feed.get(i);
        let message = decode(block);
        
        // Handle different message types
        if (message.type === 'key_announcement') {
          // Store the GPG public key
          this.publicKeys.set(feedKeyHex, message.gpg_public_key);
          messages.push({
            seq: i,
            feedKey: feedKeyHex,
            ...message
          });
        } else if (message.type === 'encrypted') {
          // Try to decrypt if it's for us
          const myFeedKeyHex = b4a.toString(this.ownFeed.key, 'hex');
          const senderPubKey = this.publicKeys.get(feedKeyHex);
          
          // Check if this message is for us
          if (message.recipient === myFeedKeyHex || !message.recipient) {
            // This is for us, try to decrypt
            if (senderPubKey) {
              try {
                const { message: decrypted, verified } = await this.crypto.decryptMessage(
                  message.encrypted_content,
                  senderPubKey
                );
                messages.push({
                  seq: i,
                  feedKey: feedKeyHex,
                  ...decrypted,
                  encrypted: true,
                  verified,
                  _originalType: 'encrypted'
                });
              } catch (err) {
                console.error(`Failed to decrypt message ${i}:`, err.message);
              }
            }
          }
          // If message is not for us, we skip it (don't add to messages array)
        } else if (message.type === 'signed') {
          // Verify signature
          const senderPubKey = this.publicKeys.get(feedKeyHex);
          if (senderPubKey) {
            try {
              const { message: verified, verified: isVerified } = await this.crypto.verifyMessage(
                message.signed_content,
                senderPubKey
              );
              messages.push({
                seq: i,
                feedKey: feedKeyHex,
                ...verified,
                signed: true,
                verified: isVerified,
                _originalType: 'signed'
              });
            } catch (err) {
              console.error(`Failed to verify message ${i}:`, err.message);
            }
          }
        } else {
          // Legacy unencrypted message
          messages.push({
            seq: i,
            feedKey: feedKeyHex,
            ...message
          });
        }
      } catch (err) {
        console.error(`Error reading block ${i}:`, err.message);
      }
    }
    
    return messages;
  }

  /**
   * Get all messages from own feed
   */
  async getOwnMessages(options) {
    return this.getFeedMessages(this.ownFeed, options);
  }

  /**
   * Get all messages from all followed feeds
   */
  async getAllFollowedMessages(options = {}) {
    const allMessages = [];
    
    for (const [key, feed] of this.followedFeeds) {
      const messages = await this.getFeedMessages(feed, options);
      allMessages.push(...messages);
    }
    
    // Sort by timestamp (most recent first)
    return allMessages.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get combined timeline (own + followed)
   */
  async getTimeline(options = {}) {
    const ownMessages = await this.getOwnMessages(options);
    const followedMessages = await this.getAllFollowedMessages(options);
    
    const combined = [...ownMessages, ...followedMessages];
    return combined.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Watch for new messages on a feed (with decryption/verification)
   */
  watchFeed(feed, callback) {
    feed.on('append', async () => {
      const lastIndex = feed.length - 1;
      const feedKeyHex = b4a.toString(feed.key, 'hex');
      
      try {
        const block = await feed.get(lastIndex);
        let message = decode(block);
        
        // Handle different message types
        if (message.type === 'key_announcement') {
          // Store the GPG public key
          this.publicKeys.set(feedKeyHex, message.gpg_public_key);
          callback({
            seq: lastIndex,
            feedKey: feedKeyHex,
            ...message
          });
        } else if (message.type === 'encrypted') {
          // Try to decrypt if it's for us
          const senderPubKey = this.publicKeys.get(feedKeyHex);
          
          if (message.recipient === feedKeyHex || !message.recipient) {
            // This is for us, try to decrypt
            if (senderPubKey) {
              try {
                const { message: decrypted, verified } = await this.crypto.decryptMessage(
                  message.encrypted_content,
                  senderPubKey
                );
                callback({
                  seq: lastIndex,
                  feedKey: feedKeyHex,
                  ...decrypted,
                  encrypted: true,
                  verified,
                  _originalType: 'encrypted'
                });
              } catch (err) {
                console.error(`Failed to decrypt message:`, err.message);
              }
            }
          }
        } else if (message.type === 'signed') {
          // Verify signature
          const senderPubKey = this.publicKeys.get(feedKeyHex);
          if (senderPubKey) {
            try {
              const { message: verified, verified: isVerified } = await this.crypto.verifyMessage(
                message.signed_content,
                senderPubKey
              );
              callback({
                seq: lastIndex,
                feedKey: feedKeyHex,
                ...verified,
                signed: true,
                verified: isVerified,
                _originalType: 'signed'
              });
            } catch (err) {
              console.error(`Failed to verify message:`, err.message);
            }
          }
        } else {
          // Legacy unencrypted message
          callback({
            seq: lastIndex,
            feedKey: feedKeyHex,
            ...message
          });
        }
      } catch (err) {
        console.error('Error processing new message:', err.message);
      }
    });
  }

  /**
   * Get list of followed users
   */
  getFollowing() {
    return Array.from(this.followedFeeds.keys());
  }

  /**
   * Close all feeds
   */
  async close() {
    if (this.ownFeed) {
      await this.ownFeed.close();
    }
    
    for (const feed of this.followedFeeds.values()) {
      await feed.close();
    }
    
    this.followedFeeds.clear();
  }
}
