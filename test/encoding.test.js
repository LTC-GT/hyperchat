import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { encode, decode } from '../src/encoding.js';

test('Encoding - encode and decode message', () => {
  const message = {
    type: 'message',
    content: 'Hello, world!',
    timestamp: Date.now(),
    author: 'test-user'
  };

  const encoded = encode(message);
  assert.ok(encoded instanceof Buffer, 'Encoded should be a Buffer');

  const decoded = decode(encoded);
  assert.deepEqual(decoded, message, 'Decoded should match original');
});

test('Encoding - handle Unicode characters', () => {
  const message = {
    type: 'message',
    content: '你好世界 🌍 Привет мир',
    timestamp: Date.now(),
    author: 'test-user'
  };

  const encoded = encode(message);
  const decoded = decode(encoded);
  
  assert.equal(decoded.content, message.content, 'Unicode content should be preserved');
});

test('Encoding - handle empty content', () => {
  const message = {
    type: 'status',
    content: '',
    timestamp: Date.now(),
    author: 'test-user'
  };

  const encoded = encode(message);
  const decoded = decode(encoded);
  
  assert.equal(decoded.content, '', 'Empty content should be preserved');
});

test('Encoding - handle large messages', () => {
  const largeContent = 'A'.repeat(10000);
  const message = {
    type: 'message',
    content: largeContent,
    timestamp: Date.now(),
    author: 'test-user'
  };

  const encoded = encode(message);
  const decoded = decode(encoded);
  
  assert.equal(decoded.content.length, 10000, 'Large content should be preserved');
});

test('Encoding - handle special characters', () => {
  const message = {
    type: 'message',
    content: 'Special: \n\t\r"\'\\',
    timestamp: Date.now(),
    author: 'test-user'
  };

  const encoded = encode(message);
  const decoded = decode(encoded);
  
  assert.equal(decoded.content, message.content, 'Special characters should be preserved');
});
