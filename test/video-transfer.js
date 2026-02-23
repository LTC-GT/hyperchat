import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import b4a from 'b4a'

import { attachVideo } from '../lib/video.js'
import { Quibble } from '../lib/quibble.js'

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

function waitForEvent (emitter, event, timeoutMs = 10000) {
  return waitFor((done) => {
    const onEvent = (...args) => {
      cleanup()
      done(null, args)
    }

    const onError = (err) => {
      cleanup()
      done(err instanceof Error ? err : new Error(String(err)))
    }

    const cleanup = () => {
      emitter.off(event, onEvent)
      emitter.off('error', onError)
    }

    emitter.on(event, onEvent)
    emitter.on('error', onError)
  }, timeoutMs)
}

let testnet = null
let alice = null
let bob = null
let tmpDir = null

try {
  testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  tmpDir = path.join(os.tmpdir(), `quibble-video-test-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  alice = new Quibble({
    storage: path.join(tmpDir, 'alice-store'),
    identity: { publicKey: b4a.alloc(32, 11), secretKey: b4a.alloc(64, 11), name: 'Alice' },
    swarmOpts: { bootstrap }
  })
  await alice.ready()

  bob = new Quibble({
    storage: path.join(tmpDir, 'bob-store'),
    identity: { publicKey: b4a.alloc(32, 22), secretKey: b4a.alloc(64, 22), name: 'Bob' },
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

  const socketA = [...alice.connections][0]
  const socketB = [...bob.connections][0]
  assert.ok(socketA, 'peer A has an active hyperswarm socket')
  assert.ok(socketB, 'peer B has an active hyperswarm socket')

  const sessionId = 'room-video-session/non-hex'
  const channelA = attachVideo(socketA, sessionId)
  const channelB = attachVideo(socketB, sessionId)

  channelA.sendSignal({ type: 'offer', sdp: 'fake-offer' })
  const [signal] = await waitForEvent(channelB, 'signal')
  assert.equal(signal.type, 'offer', 'video signaling message is transferred over hyperswarm link')

  const frameOut = b4a.from('frame-payload')
  channelB.sendFrame(frameOut)
  const [frameIn] = await waitForEvent(channelA, 'frame')
  assert.ok(b4a.equals(frameOut, frameIn), 'binary video frame is transferred over hyperswarm link')

  const remoteControl = waitForEvent(channelB, 'control')
  channelA.end()
  const [control] = await remoteControl
  assert.equal(control?.action, 'end', 'end control message is propagated to remote peer')

  assert.doesNotThrow(() => channelA.sendFrame(b4a.from('ignored-after-end')), 'sendFrame after end is safely ignored')

  console.log('✓ video channel transfer over hyperswarm works')
} finally {
  try { await alice?.destroy() } catch {}
  try { await bob?.destroy() } catch {}
  try { await testnet?.destroy() } catch {}
  try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
}
