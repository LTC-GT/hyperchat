// SPDX-License-Identifier: LGPL-3.0-or-later
// Copyright (C) 2026 Hyperchat Contributors

import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';

/**
 * NetworkManager handles P2P connectivity and feed replication
 */
export class NetworkManager {
  constructor(feedManager, onPeerConnected = null) {
    this.feedManager = feedManager;
    this.swarm = null;
    this.connections = new Set();
    this.onPeerConnected = onPeerConnected;
  }

  /**
   * Start the swarm and begin announcing/looking up feeds
   */
  async start() {
    this.swarm = new Hyperswarm();
    
    // Handle new connections
    this.swarm.on('connection', (connection, info) => {
      this.connections.add(connection);
      
      // Replicate own feed
      if (this.feedManager.ownFeed) {
        this.feedManager.ownFeed.replicate(connection);
      }
      
      // Replicate all followed feeds
      for (const feed of this.feedManager.followedFeeds.values()) {
        feed.replicate(connection);
      }
      
      // Notify about peer connection
      if (this.onPeerConnected) {
        this.onPeerConnected(connection, info);
      }
      
      connection.on('close', () => {
        console.log('\n🔌 Peer disconnected');
        this.connections.delete(connection);
      });
      
      connection.on('error', (err) => {
        console.error('Connection error:', err.message);
      });
    });

    // Announce our own feed
    if (this.feedManager.ownFeed) {
      const discovery = this.swarm.join(this.feedManager.ownFeed.discoveryKey, {
        server: true,
        client: true
      });
      await discovery.flushed();
      console.log('Announcing own feed to the network...');
    }

    // Join swarms for followed feeds
    for (const feed of this.feedManager.followedFeeds.values()) {
      await this.joinFeed(feed);
    }
  }

  /**
   * Join swarm for a specific feed (for replication)
   */
  async joinFeed(feed) {
    const discovery = this.swarm.join(feed.discoveryKey, {
      server: false,
      client: true
    });
    await discovery.flushed();
    console.log('Looking for peers for feed:', b4a.toString(feed.key, 'hex').slice(0, 16) + '...');
  }

  /**
   * When following a new user, join their swarm and replicate
   */
  async followAndReplicate(publicKeyHex, username = null) {
    const feed = await this.feedManager.followUser(publicKeyHex, username);
    
    if (this.swarm) {
      await this.joinFeed(feed);
      
      // Replicate with existing connections
      for (const connection of this.connections) {
        feed.replicate(connection);
      }
    }
    
    return feed;
  }

  /**
   * Get network statistics
   */
  getStats() {
    return {
      peers: this.connections.size,
      ownFeedLength: this.feedManager.ownFeed?.length || 0,
      followedFeeds: this.feedManager.followedFeeds.size
    };
  }

  /**
   * Stop the swarm
   */
  async stop() {
    if (this.swarm) {
      await this.swarm.destroy();
      this.connections.clear();
      console.log('Network stopped');
    }
  }
}
