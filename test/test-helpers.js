import { FeedManager } from '../src/feed-manager.js';
import { NetworkManager } from '../src/network-manager.js';
import { randomBytes } from 'crypto';

/**
 * Test utilities for Hyperchat
 */

/**
 * Create a temporary test directory name
 */
export function createTempDir(prefix = 'test') {
  return `./test-storage/${prefix}-${randomBytes(8).toString('hex')}`;
}

/**
 * Create a test feed manager
 */
export async function createTestFeedManager(username, storage) {
  const feedManager = new FeedManager(storage || createTempDir());
  await feedManager.initialize(username);
  return feedManager;
}

/**
 * Create a test network manager
 */
export async function createTestNetworkManager(feedManager) {
  const networkManager = new NetworkManager(feedManager);
  await networkManager.start();
  return networkManager;
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(condition, timeout = 5000, interval = 100) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await sleep(interval);
  }
  
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Cleanup test instances
 */
export async function cleanup(...instances) {
  for (const instance of instances) {
    try {
      if (instance.feedManager) {
        await instance.feedManager.close();
      }
      if (instance.networkManager) {
        await instance.networkManager.stop();
      }
      if (instance.close) {
        await instance.close();
      }
      if (instance.stop) {
        await instance.stop();
      }
    } catch (err) {
      console.warn('Cleanup warning:', err.message);
    }
  }
}

/**
 * Assert helper
 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Assert equal
 */
export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected}, got ${actual}`
    );
  }
}

/**
 * Assert throws
 */
export async function assertThrows(fn, message) {
  try {
    await fn();
    throw new Error(message || 'Expected function to throw');
  } catch (err) {
    if (err.message.includes('Expected function to throw')) {
      throw err;
    }
    // Expected error
  }
}
