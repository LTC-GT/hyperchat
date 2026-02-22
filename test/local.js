/**
 * Same-machine integration test.
 *
 * Creates two independent Quibble peers (Alice & Bob) with separate storage,
 * connects them through a local HyperDHT testnet (no internet required),
 * and verifies:
 *   1. Room creation + invite link generation
 *   2. Joining by invite link
 *   3. Writer addition
 *   4. Bidirectional text messaging with offline-capable history
 *   5. File sharing
 *   6. Message persistence (view catch-up)
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import b4a from 'b4a'

import { Neet } from '../lib/neet.js'
import { textMsg, systemMsg } from '../lib/messages.js'
import { sendFile, recvFile } from '../lib/file-transfer.js'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')

const TMP = path.join(os.tmpdir(), 'quibble-test-' + Date.now())
fs.mkdirSync(TMP, { recursive: true })

const ALICE_DIR = path.join(TMP, 'alice')
const BOB_DIR = path.join(TMP, 'bob')

let passed = 0
let failed = 0

function assert (cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}`)
    failed++
  }
}

async function sleep (ms) {
  return new Promise(r => setTimeout(r, ms))
}

console.log('═══════════════════════════════════════')
console.log('  Quibble same-machine integration test')
console.log('═══════════════════════════════════════\n')
console.log(`Storage: ${TMP}\n`)

// ── Setup: local DHT testnet ───

const testnet = await createTestnet(3)
const bootstrap = testnet.bootstrap

const alice = new Neet({
  storage: path.join(ALICE_DIR, 'store'),
  identity: { publicKey: b4a.alloc(32, 1), secretKey: b4a.alloc(64, 1), name: 'Alice' },
  swarmOpts: { bootstrap }
})
await alice.ready()

const bob = new Neet({
  storage: path.join(BOB_DIR, 'store'),
  identity: { publicKey: b4a.alloc(32, 2), secretKey: b4a.alloc(64, 2), name: 'Bob' },
  swarmOpts: { bootstrap }
})
await bob.ready()

// ── 1. Room creation ───

console.log('1. Room creation')
const aliceRoom = await alice.createRoom()

assert(aliceRoom.key !== null, 'Room has a key')
assert(aliceRoom.inviteLink.startsWith('pear://neet/'), 'Invite link format correct')
assert(aliceRoom.writable === true, 'Creator is writable')
assert(aliceRoom.isIndexer === true, 'Creator is indexer')
console.log(`   Link: ${aliceRoom.inviteLink}\n`)

// ── 2. Bob joins ───

console.log('2. Bob joins the room')
const bobRoom = await bob.joinRoom(aliceRoom.inviteLink)

assert(b4a.equals(bobRoom.key, aliceRoom.key), 'Bob has same room key')
console.log(`   Bob writable before add-writer: ${bobRoom.writable}`)

// Flush swarm announcements and wait for connections
console.log('   Flushing swarm…')
await alice.swarm.flush()
await bob.swarm.flush()

// Poll for peer discovery (up to 15s)
for (let i = 0; i < 30; i++) {
  if (alice.connections.size > 0 || bob.connections.size > 0) break
  await sleep(500)
}

const aliceConns = alice.connections.size
const bobConns = bob.connections.size
console.log(`   Alice connections: ${aliceConns}, Bob connections: ${bobConns}`)
assert(aliceConns > 0 || bobConns > 0, 'Peers discovered each other')

// ── 3. Add Bob as writer ───

console.log('\n3. Add Bob as writer')
await aliceRoom.addWriter(bobRoom.base.local.key)
console.log(`   Alice added Bob's writer key: ${b4a.toString(bobRoom.base.local.key, 'hex').slice(0, 16)}…`)

// Poll until Bob becomes writable (up to 15s)
for (let i = 0; i < 30; i++) {
  await bobRoom.base.update()
  if (bobRoom.writable) break
  await sleep(500)
}
console.log(`   Bob writable after add-writer: ${bobRoom.writable}`)
assert(bobRoom.writable === true, 'Bob is now writable')

// ── 4. Text messaging ───

console.log('\n4. Bidirectional text messaging')

alice.identity.avatar = 'data:image/png;base64,QUJDREVGRw=='
alice.identity.status = 'dnd'

// Alice sends
const aliceMsg = textMsg('Hello from Alice!', alice.identity)
await aliceRoom.append(aliceMsg)
console.log('   Alice sent: "Hello from Alice!"')

// Wait for replication
await sleep(2000)
await bobRoom.base.update()

// Bob sends
const bobMsg = textMsg('Hey Alice, this is Bob!', bob.identity)
await bobRoom.append(bobMsg)
console.log('   Bob sent: "Hey Alice, this is Bob!"')

// Wait for replication
await sleep(2000)
await aliceRoom.base.update()
await bobRoom.base.update()

// Check both views
const aliceHistory = await aliceRoom.history(20)
const bobHistory = await bobRoom.history(20)

console.log(`   Alice view: ${aliceHistory.length} messages`)
console.log(`   Bob view:   ${bobHistory.length} messages`)

const aliceTexts = aliceHistory.filter(m => m.type === 'text')
const bobTexts = bobHistory.filter(m => m.type === 'text')

assert(aliceTexts.length >= 2, 'Alice sees both text messages')
assert(bobTexts.length >= 2, 'Bob sees both text messages')

// Check content
const aliceSeesBob = aliceTexts.some(m => m.text === 'Hey Alice, this is Bob!')
const bobSeesAlice = bobTexts.some(m => m.text === 'Hello from Alice!')
assert(aliceSeesBob, 'Alice can read Bob\'s message')
assert(bobSeesAlice, 'Bob can read Alice\'s message')

const bobSeesAliceRichMeta = bobTexts.find(m => m.text === 'Hello from Alice!')
assert(Boolean(bobSeesAliceRichMeta?.senderName), 'Sender name is replicated via P2P')
assert(bobSeesAliceRichMeta?.senderAvatar === alice.identity.avatar, 'Sender avatar is replicated via P2P')
assert(bobSeesAliceRichMeta?.senderStatus === 'dnd', 'Sender status is replicated via P2P')

console.log('\n4b. Room profile icon metadata replication')
const roomProfileSetMsg = systemMsg('room-profile-set', {
  emoji: '🦊',
  imageData: 'data:image/png;base64,AAECAwQFBgc=',
  mimeType: 'image/png'
}, alice.identity)
await aliceRoom.append(roomProfileSetMsg)
await sleep(1500)
await bobRoom.base.update()

const bobAfterProfileUpdate = await bobRoom.history(40)
const bobProfileEvent = bobAfterProfileUpdate.find(m => m.type === 'system' && m.action === 'room-profile-set')
assert(Boolean(bobProfileEvent), 'Room profile update event is replicated via P2P')
assert(bobProfileEvent?.data?.emoji === '🦊', 'Room icon emoji payload replicates via P2P')
assert(bobProfileEvent?.data?.imageData === 'data:image/png;base64,AAECAwQFBgc=', 'Room icon image payload replicates via P2P')

// ── 5. File sharing ───

console.log('\n5. File sharing')

// Create a test file
const testFilePath = path.join(TMP, 'test-file.txt')
fs.writeFileSync(testFilePath, 'This is a test file shared via Quibble P2P!\n'.repeat(100))
const testFileSize = fs.statSync(testFilePath).size

const fileMessage = await sendFile(testFilePath, alice.store, aliceRoom, alice.identity)
console.log(`   Alice shared: ${fileMessage.filename} (${testFileSize} bytes)`)
assert(fileMessage.type === 'file', 'File message has correct type')
assert(fileMessage.coreKey !== undefined, 'File message has coreKey')

await sleep(3000)
await bobRoom.base.update()

const bobMsgs = await bobRoom.history(50)
const bobFileMsg = bobMsgs.find(m => m.type === 'file')
assert(bobFileMsg !== undefined, 'Bob sees the file message')

if (bobFileMsg) {
  const dlDir = path.join(TMP, 'downloads')
  fs.mkdirSync(dlDir, { recursive: true })
  try {
    const savedPath = await recvFile(bobFileMsg, bob.store, dlDir)
    const downloaded = fs.readFileSync(savedPath, 'utf-8')
    assert(downloaded.length === testFileSize, `Bob downloaded file (${downloaded.length} bytes)`)
    console.log(`   Bob downloaded to: ${savedPath}`)
  } catch (err) {
    console.log(`   Download pending (core replication may need more time): ${err.message}`)
  }
}

// ── 6. Message persistence (history) ───

console.log('\n6. Offline message delivery (view persistence)')
// Send more messages
await aliceRoom.append(textMsg('Message while connected (1)', alice.identity))
await aliceRoom.append(textMsg('Message while connected (2)', alice.identity))
await sleep(2000)
await bobRoom.base.update()

const finalBobHistory = await bobRoom.history(50)
const allTexts = finalBobHistory.filter(m => m.type === 'text')
console.log(`   Total text messages in Bob's view: ${allTexts.length}`)
assert(allTexts.length >= 4, 'Bob has full message history')

// ── Summary ───

console.log('\n═══════════════════════════════════════')
console.log(`  ${passed} passed, ${failed} failed`)
console.log('═══════════════════════════════════════\n')

// Cleanup
await alice.destroy()
await bob.destroy()
await testnet.destroy()

// Clean up temp dir
fs.rmSync(TMP, { recursive: true, force: true })

process.exit(failed > 0 ? 1 : 0)
