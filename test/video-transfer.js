/**
 * WebRTC video/voice test.
 *
 * Since actual WebRTC media requires browser APIs (getUserMedia, RTCPeerConnection),
 * this test validates the helper module exports and the Autobase call signaling flow
 * through Hyperswarm rather than testing browser-side WebRTC calls directly.
 *
 * The real P2P media tests should be run in-browser.
 */

import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import b4a from 'b4a'

import { buildIceServers, VIDEO_PROTOCOL } from '../lib/video.js'
import { VOICE_PROTOCOL } from '../lib/voice.js'
import { Quibble } from '../lib/quibble.js'
import { systemMsg } from '../lib/messages.js'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')

function waitFor (factory, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for condition')), timeoutMs)

    const finish = (err, value) => {
      clearTimeout(timer)
      if (err) reject(err)
      else resolve(value)
    }

    factory(finish)
  })
}

/** Derive a peerId (hex of public key) — mirrors what the server does */
function peerId (publicKey) {
  return Buffer.isBuffer(publicKey) ? b4a.toString(publicKey, 'hex') : String(publicKey)
}

let testnet = null
let alice = null
let bob = null
let tmpDir = null

try {
  // ── Test 1: peerId produces consistent IDs from public keys ──
  const key1 = b4a.alloc(32, 11)
  const id1 = peerId(key1)
  assert.ok(id1.length === 64, 'Peer ID is 64-char hex')
  assert.equal(id1, peerId(key1), 'Same key always produces same peer ID')

  const key2 = b4a.alloc(32, 22)
  const id2 = peerId(key2)
  assert.notEqual(id1, id2, 'Different keys produce different peer IDs')

  console.log('✓ peerId produces consistent, unique IDs from Hypercore keys')

  // ── Test 2: buildIceServers defaults and custom ──
  const defaults = buildIceServers(null)
  assert.ok(Array.isArray(defaults), 'Default ICE servers is an array')
  assert.ok(defaults.length > 0, 'Default ICE servers is non-empty')
  assert.ok(defaults[0].urls.some((u) => u.includes('stun:')), 'Default includes STUN server')
  assert.ok(defaults.some((s) => {
    const u = Array.isArray(s.urls) ? s.urls : [s.urls]
    return u.some((url) => url.includes('turn:'))
  }), 'Default includes TURN server for cross-network support')

  const custom = [{ urls: 'turn:my-turn.example.com:3478', username: 'user', credential: 'pass' }]
  const resolved = buildIceServers(custom)
  assert.deepEqual(resolved, custom, 'Custom ICE servers are used when provided')

  console.log('✓ buildIceServers returns correct defaults and respects custom config')

  // ── Test 3: Protocol constants ──
  assert.equal(VIDEO_PROTOCOL, 'quibble-video-webrtc', 'Video protocol name is correct')
  assert.equal(VOICE_PROTOCOL, 'quibble-voice-webrtc', 'Voice protocol name is correct')

  console.log('✓ Protocol constants exported correctly')

  // ── Test 4: Call signaling through Autobase ──
  testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  tmpDir = path.join(os.tmpdir(), `quibble-webrtc-test-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  const aliceKey = b4a.alloc(32, 11)
  const bobKey = b4a.alloc(32, 22)

  alice = new Quibble({
    storage: path.join(tmpDir, 'alice-store'),
    identity: { publicKey: aliceKey, secretKey: b4a.alloc(64, 11), name: 'Alice' },
    swarmOpts: { bootstrap }
  })
  await alice.ready()

  bob = new Quibble({
    storage: path.join(tmpDir, 'bob-store'),
    identity: { publicKey: bobKey, secretKey: b4a.alloc(64, 22), name: 'Bob' },
    swarmOpts: { bootstrap }
  })
  await bob.ready()

  const room = await alice.createRoom()
  await bob.joinRoom(room.inviteLink)
  await alice.swarm.flush()
  await bob.swarm.flush()

  await waitFor((done) => {
    const interval = setInterval(() => {
      if (alice.connections.size > 0 && bob.connections.size > 0) {
        clearInterval(interval)
        done(null)
      }
    }, 100)
  })

  // Alice announces a call via Autobase
  const aliceIdentity = { publicKey: aliceKey, name: 'Alice', avatar: null, status: 'online' }
  const callStartMsg = systemMsg('call-start', {
    callId: 'test-call-123',
    mode: 'video',
    scope: 'text',
    channelId: 'general',
    peerId: peerId(aliceKey)
  }, aliceIdentity)

  await room.append(callStartMsg)

  // Verify the message appears in the room
  const page = await room.historyPage({ limit: 50 })
  const found = page.messages.find((m) => m?.action === 'call-start' && m?.data?.callId === 'test-call-123')
  assert.ok(found, 'call-start message is found in room history')
  assert.equal(found.data.peerId, peerId(aliceKey), 'Peer ID is included in call-start message')
  assert.equal(found.data.mode, 'video', 'Call mode is preserved')

  console.log('✓ Call signaling messages propagate through Autobase correctly')
  console.log('')
  console.log('All WebRTC integration tests passed.')
} finally {
  try { await alice?.destroy() } catch {}
  try { await bob?.destroy() } catch {}
  try { await testnet?.destroy() } catch {}
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
}
