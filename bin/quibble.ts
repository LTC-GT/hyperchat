#!/usr/bin/env node

/**
 * Quibble – P2P CLI chat.
 *
 * Usage:
 *   quibble create                  – create a new room, print invite link
 *   quibble join <link>             – join a room by pear://quibble/... link
 *   quibble id                      – show your identity
 *   quibble name <name>             – set display name
 *
 * Inside a room you get an interactive prompt:
 *   /send <path>                    – share a file
 *   /download <msgId> [dir]         – download a shared file
 *   /history [n]                    – show last n messages
 *   /peers                          – list connected peers
 *   /add-writer <hexKey>            – add a writer (for manual bootstrapping)
 *   /info                           – room info (key, link, indexer status)
 *   /quit                           – leave the room
 *   anything else                   – send as text message
 */

import { createRequire } from 'node:module'
import readline from 'node:readline'
import path from 'node:path'
import os from 'node:os'
import b4a from 'b4a'

import { loadIdentity, setName } from '../lib/identity.js'
import { Quibble } from '../lib/quibble.js'
import { textMsg, systemMsg } from '../lib/messages.js'
import { sendFile, recvFile } from '../lib/file-transfer.js'
import type { Room } from '../lib/room.js'

const args = process.argv.slice(2)
const cmd = args[0]

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`
** Quibble ** – P2P CLI chat

  quibble create             Create a new room
  quibble join <link>        Join by pear://quibble/... link or hex key
  quibble id                 Show your identity
  quibble name <name>        Set your display name
`)
  process.exit(0)
}

// ── Identity commands ───

if (cmd === 'id') {
  const id = await loadIdentity()
  console.log(`Name:  ${id.name}`)
  console.log(`Key:   ${b4a.toString(id.publicKey, 'hex')}`)
  process.exit(0)
}

if (cmd === 'name') {
  const name = args.slice(1).join(' ')
  if (!name) { console.error('Usage: quibble name <display name>'); process.exit(1) }
  await loadIdentity() // ensure identity exists
  await setName(name)
  console.log(`[✓] Display name set to ${name}`)
  process.exit(0)
}

// ── Room commands ───

const identity = await loadIdentity()
const storageDir = path.join(identity.dir!, 'storage')

const quibble = new Quibble({ storage: storageDir, identity })
await quibble.ready()

let room: Room

if (cmd === 'create') {
  room = await quibble.createRoom()
  console.log('\n[✓] Room created')
  console.log(`  Link: ${room.inviteLink}`)
  console.log('  Share this link with others so they can join.\n')
} else if (cmd === 'join') {
  const target = args[1]
  if (!target) { console.error('Usage: quibble join <link|hexKey>'); process.exit(1) }
  console.log('[⚠] Joining room…')
  room = (await quibble.joinRoom(target))!
  console.log('[✓] Joined room')
  console.log(`  Link: ${room.inviteLink}\n`)
} else {
  console.error(`Unknown command: ${cmd}`)
  process.exit(1)
}

// ── Connection logging ───

quibble.swarm.on('connection', (_socket, info) => {
  const short = b4a.toString(info.publicKey, 'hex').slice(0, 12)
  console.log(`  ↔ peer connected: ${short}…`)
})

// ── Watch for new messages ───

const stopWatch = room.watch((msg) => {
  renderMessage(msg)
})

// ── Interactive prompt ───

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.setPrompt('> ')
rl.prompt()

rl.on('line', async (line) => {
  const input = line.trim()
  if (!input) { rl.prompt(); return }

  try {
    if (input.startsWith('/')) {
      await handleCommand(input)
    } else {
      // Send text
      const msg = textMsg(input, identity)
      await room.append(msg)
    }
  } catch (err) {
    console.error(`[✗] Error: ${(err as Error).message}`)
  }

  rl.prompt()
})

rl.on('close', async () => {
  stopWatch()
  await quibble.destroy()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('\nShutting down…')
  stopWatch()
  await quibble.destroy()
  process.exit(0)
})

// ── Command handler ───

async function handleCommand (input: string) {
  const parts = input.slice(1).split(/\s+/)
  const cmd = parts[0]

  switch (cmd) {
    case 'send': {
      const filePath = parts.slice(1).join(' ')
      if (!filePath) { console.log('Usage: /send <path>'); return }
      console.log(`Sharing ${filePath}…`)
      const msg = await sendFile(filePath, quibble.store, room, identity)
      console.log(`[✓] Shared: ${msg.filename} (${fmtSize(msg.size)})`)
      break
    }

    case 'download': {
      const msgId = parts[1]
      const destDir = parts[2] || os.homedir()
      if (!msgId) { console.log('Usage: /download <msgId> [destDir]'); return }
      const msgs = await room.history(200)
      const fileMsg = msgs.find(m => m.type === 'file' && m.id === msgId)
      if (!fileMsg) { console.log('File message not found'); return }
      console.log(`Downloading ${fileMsg.filename}…`)
      const dest = await recvFile(fileMsg, quibble.store, destDir)
      console.log(`[✓] Saved to ${dest}`)
      break
    }

    case 'history': {
      const n = parseInt(parts[1]) || 30
      const msgs = await room.history(n)
      if (msgs.length === 0) { console.log('(no messages yet)'); return }
      for (const m of msgs) renderMessage(m)
      break
    }

    case 'peers': {
      const n = quibble.connections.size
      console.log(`Peers: ${n}`)
      for (const conn of quibble.connections) {
        const pk = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16) : '???'
        console.log(`  • ${pk}…`)
      }
      break
    }

    case 'add-writer': {
      const hexKey = parts[1]
      if (!hexKey) { console.log('Usage: /add-writer <hexKey>'); return }
      await room.addWriter(b4a.from(hexKey, 'hex'))
      console.log('[✓] Writer added')
      break
    }

    case 'info': {
      console.log(`  Link:    ${room.inviteLink}`)
      console.log(`  Key:     ${b4a.toString(room.key!, 'hex')}`)
      console.log(`  Writer:  ${room.writable}`)
      console.log(`  Indexer: ${room.isIndexer}`)
      console.log(`  View:    ${room.base!.view?.length || 0} messages`)
      break
    }

    case 'quit':
    case 'exit':
      stopWatch()
      await quibble.destroy()
      process.exit(0)

    default:
      console.log(`Unknown command: /${cmd}`)
  }
}

// ── Rendering ───

function renderMessage (msg: RoomMessage) {
  const time = new Date(msg.timestamp).toLocaleTimeString()
  const who = msg.senderName || msg.sender?.slice(0, 8) || '???'

  switch (msg.type) {
    case 'text':
      console.log(`[${time}] ${who}: ${msg.text}`)
      break
    case 'file':
      console.log(`[${time}] ${who} shared ${msg.filename} (${fmtSize(msg.size)}) id:${msg.id.slice(0, 8)}`)
      break
    case 'system':
      console.log(`[${time}] [⚙] ${who} ${msg.action}${msg.data ? ': ' + JSON.stringify(msg.data) : ''}`)
      break
    case 'reaction':
      console.log(`[${time}] ${who} reacted ${msg.emoji} to ${msg.targetId?.slice(0, 8)}`)
      break
    case 'voice':
      console.log(`[${time}] [mic] ${who} voice ${msg.action}`)
      break
    default:
      console.log(`[${time}] ${JSON.stringify(msg)}`)
  }
}

function fmtSize (bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
