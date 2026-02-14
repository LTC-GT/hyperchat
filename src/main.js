// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import { FeedManager } from './feed-manager.js';
import { NetworkManager } from './network-manager.js';
import readline from 'readline';
import { stdin as input, stdout as output } from 'process';

/**
 * Hyperchat - Main Application
 */
class Hyperchat {
  constructor() {
    this.feedManager = null;
    this.networkManager = null;
    this.username = null;
    this.rl = null;
    this.isRunning = false;
  }

  /**
   * Initialize the application
   */
  async initialize(username, privateKeyPath = null, publicKeyPath = null) {
    this.username = username;
    console.log(`\n🚀 Initializing Hyperchat for user: ${username}\n`);
    
    // Initialize feed manager with GPG support
    this.feedManager = new FeedManager('./storage');
    await this.feedManager.initialize(username, privateKeyPath, publicKeyPath);
    
    // Initialize network manager with peer connection callback
    this.networkManager = new NetworkManager(this.feedManager, (connection, info) => {
      this.handlePeerConnection(connection, info);
    });
    await this.networkManager.start();
    
    // Watch for new messages on own feed
    this.feedManager.watchFeed(this.feedManager.ownFeed, (message) => {
      if (this.isRunning) {
        if (message.type !== 'key_announcement') {
          const encStatus = message.encrypted ? '🔒 Encrypted' : message.signed ? '✔️ Signed' : '';
          console.log(`\n📝 You posted: ${message.content} ${encStatus}`);
          this.showPrompt();
        }
      }
    });
    
    // Show server live message
    const feedKey = Buffer.from(this.feedManager.ownFeed.key).toString('hex');
    const gpgFingerprint = this.feedManager.crypto.getFingerprint();
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ YOUR SERVER IS NOW LIVE');
    console.log(`\n🔑 GPG Fingerprint (Share this as your ID):`);
    console.log(`   ${gpgFingerprint}`);
    console.log(`\n📡 Feed Discovery Key:`);
    console.log(`   ${feedKey}`);
    console.log('\n🔒 End-to-End Encryption: ENABLED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📨 INCOMING MESSAGES:');
    console.log('   (Encrypted messages from followed users will appear here...)\n');
    
    this.isRunning = true;
  }

  /**
   * Handle peer connection
   */
  handlePeerConnection(connection, info) {
    if (!this.isRunning) return;
    
    // Note: info.publicKey is the peer's connection identity, not the feed key
    // We'll identify users when we receive messages from their feeds
    const peerCount = this.networkManager.getStats().peers;
    console.log(`\n🔗 New peer connected (${peerCount} total peers)`);
    this.showPrompt();
  }

  /**
   * Start the interactive CLI
   */
  startCLI() {
    this.rl = readline.createInterface({ input, output });
    
    this.showHelp();
    this.showPrompt();
    
    this.rl.on('line', async (line) => {
      const trimmed = line.trim();
      
      if (!trimmed) {
        this.showPrompt();
        return;
      }
      
      await this.handleCommand(trimmed);
      this.showPrompt();
    });
    
    this.rl.on('close', async () => {
      await this.shutdown();
    });
  }

  /**
   * Handle user commands
   */
  async handleCommand(input) {
    const [command, ...args] = input.split(' ');
    const cmd = command.toLowerCase();
    
    try {
      switch (cmd) {
        case '/help':
        case '/h':
          this.showHelp();
          break;
          
        case '/message':
        case '/m':
          // Check if this is a direct message: /message username "content"
          if (args.length >= 2) {
            const possibleUsername = args[0];
            const recipientKey = this.feedManager.getKeyForUsername(possibleUsername);
            
            if (recipientKey) {
              // Direct message to user
              const messageContent = args.slice(1).join(' ').replace(/^"|"$/g, '');
              await this.sendDirectMessage(recipientKey, messageContent);
            } else {
              // Regular broadcast message
              await this.sendMessage('message', args.join(' '));
            }
          } else {
            await this.sendMessage('message', args.join(' '));
          }
          break;
          
        case '/status':
        case '/s':
          await this.sendMessage('status', args.join(' '));
          break;
          
        case '/blog':
        case '/b':
          await this.sendMessage('microblog', args.join(' '));
          break;
          
        case '/follow':
        case '/f':
          if (args[0]) {
            const username = args[1] || null;
            await this.followUser(args[0], username);
          } else {
            console.log('Usage: /follow <feed-key> [username]');
            console.log('\nExample: /follow dcba522ef06b93ccec0fc5d9e841890... bob');
            console.log('\nNote: Use the feed discovery key (64 hex chars), not the GPG fingerprint.');
            console.log('      The other user can share their key with: /mykey');
          }
          break;
          
        case '/unfollow':
        case '/uf':
          if (args[0]) {
            await this.feedManager.unfollowUser(args[0]);
          } else {
            console.log('Usage: /unfollow <public-key>');
          }
          break;
          
        case '/following':
        case '/list':
          this.showFollowing();
          break;
          
        case '/timeline':
        case '/t':
          await this.showTimeline(parseInt(args[0]) || 20);
          break;
          
        case '/mykey':
        case '/key':
          this.showMyKey();
          break;
          
        case '/exportkey':
          if (args[0]) {
            this.exportKeys(args[0]);
          } else {
            console.log('Usage: /exportkey <directory>');
          }
          break;
          
        case '/mygpg':
          this.showGPGKey();
          break;
          
        case '/stats':
          this.showStats();
          break;
          
        case '/quit':
        case '/q':
        case '/exit':
          this.rl.close();
          break;
          
        default:
          // Default to sending a message
          if (input.startsWith('/')) {
            console.log(`Unknown command: ${command}. Type /help for available commands.`);
          } else {
            await this.sendMessage('message', input);
          }
      }
    } catch (err) {
      console.error('Error:', err.message);
    }
  }

  /**
   * Send a message
   */
  async sendMessage(type, content) {
    if (!content) {
      console.log('Message cannot be empty');
      return;
    }
    
    const typeEmoji = {
      message: '💬',
      status: '📢',
      microblog: '✍️'
    };
    
    await this.feedManager.appendMessage(type, content);
    console.log(`${typeEmoji[type]} ${type} posted!`);
  }

  /**
   * Send a direct message
   */
  async sendDirectMessage(recipientKey, content) {
    if (!content) {
      console.log('Message cannot be empty');
      return;
    }
    
    const recipientUsername = this.feedManager.getUsernameForKey(recipientKey);
    await this.feedManager.appendMessage('message', content, { recipient: recipientKey });
    console.log(`� Encrypted direct message sent to ${recipientUsername}!`);
  }

  /**
   * Show user's GPG key
   */
  showGPGKey() {
    const fingerprint = this.feedManager.crypto.getFingerprint();
    const publicKey = this.feedManager.crypto.getPublicKeyArmored();
    
    console.log('\n🔑 Your GPG Public Key:');
    console.log('Fingerprint:', fingerprint);
    console.log('\nPublic Key (share this with others):');
    console.log(publicKey);
    console.log();
  }

  /**
   * Export GPG keys to directory
   */
  exportKeys(directory) {
    try {
      const { join } = require('path');
      this.feedManager.crypto.exportPublicKey(join(directory, 'hyperchat-public.asc'));
      this.feedManager.crypto.exportPrivateKey(join(directory, 'hyperchat-private.asc'));
      console.log(`\n✅ Keys exported to ${directory}/`);
      console.log('⚠️  Keep your private key secure!\n');
    } catch (err) {
      console.error('Failed to export keys:', err.message);
    }
  }

  /**
   * Follow a user
   */
  async followUser(publicKeyHex, username = null) {
    const feed = await this.networkManager.followAndReplicate(publicKeyHex, username);
    
    // Watch for new messages from this feed (if not already watching)
    const existingListeners = feed.listenerCount('append');
    if (existingListeners > 0) {
      // Already watching this feed
      return;
    }
    
    this.feedManager.watchFeed(feed, (message) => {
      if (this.isRunning) {
        // Skip key announcements
        if (message.type === 'key_announcement') {
          console.log(`\n🔑 Received GPG public key from ${message.author}`);
          this.showPrompt();
          return;
        }
        
        // Check if this is a direct message for us
        const myFeedKey = Buffer.from(this.feedManager.ownFeed.key).toString('hex');
        if (message.recipient && message.recipient !== myFeedKey) {
          // This direct message is not for us, ignore it
          return;
        }
        
        const typeEmoji = {
          message: '💬',
          status: '📢',
          microblog: '✍️'
        };
        const emoji = typeEmoji[message.type] || '📝';
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        const senderName = message.author || this.feedManager.getUsernameForKey(publicKeyHex);
        
        // Show encryption/verification status
        let securityStatus = '';
        if (message.encrypted) {
          securityStatus = message.verified ? '🔒✔️' : '🔒⚠️';
        } else if (message.signed) {
          securityStatus = message.verified ? '✔️' : '⚠️';
        }
        
        console.log(`\n📨 INCOMING MESSAGE [${timestamp}] ${securityStatus}:`);
        console.log(`   ${emoji} From: ${senderName}`);
        if (message.recipient) {
          console.log(`   Type: 🔒 Direct Message (Encrypted)`);
        } else if (message.signed) {
          console.log(`   Type: ✔️ Signed Public Message`);
        }
        if (message.verified === false) {
          console.log(`   ⚠️  WARNING: Signature verification failed!`);
        }
        console.log(`   Content: ${message.content}`);
        this.showPrompt();
      }
    });
  }

  /**
   * Show following list
   */
  showFollowing() {
    const following = this.feedManager.getFollowing();
    
    if (following.length === 0) {
      console.log('Not following anyone yet. Use /follow <public-key> [username] to follow someone.');
      return;
    }
    
    console.log('\n📋 Following:');
    following.forEach((key, index) => {
      const username = this.feedManager.getUsernameForKey(key);
      console.log(`  ${index + 1}. ${username} - ${key.slice(0, 16)}...${key.slice(-8)}`);
    });
    console.log();
  }

  /**
   * Show timeline
   */
  async showTimeline(limit = 20) {
    const messages = await this.feedManager.getTimeline({ limit });
    
    if (messages.length === 0) {
      console.log('No messages yet. Start posting or follow someone!');
      return;
    }
    
    console.log(`\n📰 Timeline (${messages.length} messages):\n`);
    
    messages.forEach((msg) => {
      const date = new Date(msg.timestamp).toLocaleString();
      const typeEmoji = {
        message: '💬',
        status: '📢',
        microblog: '✍️'
      };
      const emoji = typeEmoji[msg.type] || '📝';
      const author = msg.author || msg.feedKey.slice(0, 8);
      
      console.log(`${emoji} [${date}] ${author}: ${msg.content}`);
    });
    console.log();
  }

  /**
   * Show user's public key
   */
  showMyKey() {
    const key = Buffer.from(this.feedManager.ownFeed.key).toString('hex');
    console.log('\n🔑 Your Public Key (share this with others to let them follow you):');
    console.log(key);
    console.log();
  }

  /**
   * Show network statistics
   */
  showStats() {
    const stats = this.networkManager.getStats();
    console.log('\n📊 Network Statistics:');
    console.log(`  Connected peers: ${stats.peers}`);
    console.log(`  Your messages: ${stats.ownFeedLength}`);
    console.log(`  Following: ${stats.followedFeeds} users`);
    console.log();
  }

  /**
   * Show help
   */
  showHelp() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  HYPERCHAT - P2P Encrypted Chat with GPG');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Commands:');
    console.log('  /message <text>         Send a signed public message');
    console.log('  /message <user> <text>  Send encrypted direct message to user');
    console.log('  /status <text>          Post a status update (signed)');
    console.log('  /blog <text>            Post a microblog (signed, max 280 chars)');
    console.log('  /follow <key> [user]    Follow a user by feed key (with optional username)');
    console.log('  /unfollow <key>         Unfollow a user');
    console.log('  /following              List users you follow');
    console.log('  /timeline [n]           Show timeline (default: 20 messages)');
    console.log('  /mykey                  Show your feed discovery key');
    console.log('  /mygpg                  Show your GPG public key');
    console.log('  /exportkey <dir>        Export your GPG keys to directory');
    console.log('  /stats                  Show network statistics');
    console.log('  /help                   Show this help');
    console.log('  /quit                   Exit Hyperchat\n');
    console.log('🔒 Security: All direct messages are end-to-end encrypted with GPG');
    console.log('✔️  All messages are cryptographically signed\n');
  }

  /**
   * Show prompt
   */
  showPrompt() {
    if (this.rl && !this.rl.closed) {
      this.rl.prompt(true);
    }
  }

  /**
   * Shutdown the application
   */
  async shutdown() {
    console.log('\n\n👋 Shutting down Hyperchat...');
    this.isRunning = false;
    
    if (this.networkManager) {
      await this.networkManager.stop();
    }
    
    if (this.feedManager) {
      await this.feedManager.close();
    }
    
    console.log('Goodbye!\n');
    process.exit(0);
  }
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let username = process.env.USER || 'anonymous';
  let privateKeyPath = null;
  let publicKeyPath = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--private-key' || args[i] === '-priv') {
      privateKeyPath = args[++i];
    } else if (args[i] === '--public-key' || args[i] === '-pub') {
      publicKeyPath = args[++i];
    } else if (!args[i].startsWith('-')) {
      username = args[i];
    }
  }
  
  // Show usage if incomplete key pair
  if ((privateKeyPath && !publicKeyPath) || (!privateKeyPath && publicKeyPath)) {
    console.error('Error: You must provide both --private-key and --public-key');
    console.log('\\nUsage:');
    console.log('  npm start <username>');
    console.log('  npm start <username> --private-key <path> --public-key <path>');
    console.log('\\nExample:');
    console.log('  npm start alice --private-key ./keys/private.asc --public-key ./keys/public.asc');
    process.exit(1);
  }
  
  const app = new Hyperchat();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await app.shutdown();
  });
  
  process.on('SIGTERM', async () => {
    await app.shutdown();
  });
  
  try {
    await app.initialize(username, privateKeyPath, publicKeyPath);
    app.startCLI();
  } catch (err) {
    console.error('Fatal error:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
