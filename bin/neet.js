#!/usr/bin/env node

/**
 * neet – P2P CLI chat.
 *
 * Usage:
 *   neet create                     – create a new room, print invite link
 *   neet join <link>                – join a room by pear://neet/... link
 *   neet id                         – show your identity
 *   neet name <name>                – set display name
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
import chalk from 'chalk'

import { loadIdentity, setName } from '../lib/identity.js'
import { Neet } from '../lib/neet.js'
import { textMsg, systemMsg } from '../lib/messages.js'
import { sendFile, recvFile } from '../lib/file-transfer.js'

const args = process.argv.slice(2)
const cmd = args[0]

if (!cmd || cmd === '--help' || cmd === '-h') {
  console.log(`
${chalk.bold('neet')} – P2P CLI chat

  ${chalk.cyan('neet create')}              Create a new room
  ${chalk.cyan('neet join <link>')}         Join by pear://neet/... link or hex key
  ${chalk.cyan('neet id')}                  Show your identity
  ${chalk.cyan('neet name <name>')}         Set your display name
`)
  process.exit(0)
}

// ── Identity commands ───

if (cmd === 'id') {
  const id = loadIdentity()
  console.log(`${chalk.bold('Name:')}  ${id.name}`)
  console.log(`${chalk.bold('Key:')}   ${b4a.toString(id.publicKey, 'hex')}`)
  process.exit(0)
}

if (cmd === 'name') {
  const name = args.slice(1).join(' ')
  if (!name) { console.error('Usage: neet name <display name>'); process.exit(1) }
  loadIdentity() // ensure identity exists
  setName(name)
  console.log(`Display name set to ${chalk.green(name)}`)
  process.exit(0)
}

// ── Room commands ───

const identity = loadIdentity()
const storageDir = path.join(identity.dir, 'storage')

const neet = new Neet({ storage: storageDir, identity })
await neet.ready()

let room

if (cmd === 'create') {
  room = await neet.createRoom()
  console.log(chalk.green.bold('\n✦ Room created'))
  console.log(`  ${chalk.bold('Link:')} ${room.inviteLink}`)
  console.log(`  ${chalk.dim('Share this link with others so they can join.\n')}`)
} else if (cmd === 'join') {
  const target = args[1]
  if (!target) { console.error('Usage: neet join <link|hexKey>'); process.exit(1) }
  console.log(chalk.yellow('Joining room…'))
  room = await neet.joinRoom(target)
  console.log(chalk.green.bold('✦ Joined room'))
  console.log(`  ${chalk.bold('Link:')} ${room.inviteLink}\n`)
} else {
  console.error(`Unknown command: ${cmd}`)
  process.exit(1)
}

// ── Connection logging ───

neet.swarm.on('connection', (_socket, info) => {
  const short = b4a.toString(info.publicKey, 'hex').slice(0, 12)
  console.log(chalk.dim(`  ↔ peer connected: ${short}…`))
})

// ── Watch for new messages ───

const stopWatch = room.watch((msg) => {
  renderMessage(msg)
})

// ── Interactive prompt ───

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.setPrompt(chalk.cyan('> '))
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
    console.error(chalk.red(`Error: ${err.message}`))
  }

  rl.prompt()
})

rl.on('close', async () => {
  stopWatch()
  await neet.destroy()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log(chalk.dim('\nShutting down…'))
  stopWatch()
  await neet.destroy()
  process.exit(0)
})

// ── Command handler ───

async function handleCommand (input) {
  const parts = input.slice(1).split(/\s+/)
  const cmd = parts[0]

  switch (cmd) {
    case 'send': {
      const filePath = parts.slice(1).join(' ')
      if (!filePath) { console.log('Usage: /send <path>'); return }
      console.log(chalk.dim(`Sharing ${filePath}…`))
      const msg = await sendFile(filePath, neet.store, room, identity)
      console.log(chalk.green(`✓ Shared: ${msg.filename} (${fmtSize(msg.size)})`))
      break
    }

    case 'download': {
      const msgId = parts[1]
      const destDir = parts[2] || os.homedir()
      if (!msgId) { console.log('Usage: /download <msgId> [destDir]'); return }
      const msgs = await room.history(200)
      const fileMsg = msgs.find(m => m.type === 'file' && m.id === msgId)
      if (!fileMsg) { console.log('File message not found'); return }
      console.log(chalk.dim(`Downloading ${fileMsg.filename}…`))
      const dest = await recvFile(fileMsg, neet.store, destDir)
      console.log(chalk.green(`✓ Saved to ${dest}`))
      break
    }

    case 'history': {
      const n = parseInt(parts[1]) || 30
      const msgs = await room.history(n)
      if (msgs.length === 0) { console.log(chalk.dim('(no messages yet)')); return }
      for (const m of msgs) renderMessage(m)
      break
    }

    case 'peers': {
      const n = neet.connections.size
      console.log(`${chalk.bold('Peers:')} ${n}`)
      for (const conn of neet.connections) {
        const pk = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16) : '???'
        console.log(`  • ${pk}…`)
      }
      break
    }

    case 'add-writer': {
      const hexKey = parts[1]
      if (!hexKey) { console.log('Usage: /add-writer <hexKey>'); return }
      await room.addWriter(b4a.from(hexKey, 'hex'))
      console.log(chalk.green(`✓ Writer added`))
      break
    }

    case 'info': {
      console.log(`  ${chalk.bold('Link:')}    ${room.inviteLink}`)
      console.log(`  ${chalk.bold('Key:')}     ${b4a.toString(room.key, 'hex')}`)
      console.log(`  ${chalk.bold('Writer:')} ${room.writable}`)
      console.log(`  ${chalk.bold('Indexer:')} ${room.isIndexer}`)
      console.log(`  ${chalk.bold('View:')}    ${room.base.view?.length || 0} messages`)
      break
    }

    case 'quit':
    case 'exit':
      stopWatch()
      await neet.destroy()
      process.exit(0)

    default:
      console.log(chalk.dim(`Unknown command: /${cmd}`))
  }
}

// ── Rendering ───

function renderMessage (msg) {
  const time = new Date(msg.timestamp).toLocaleTimeString()
  const who = msg.senderName || msg.sender?.slice(0, 8) || '???'

  switch (msg.type) {
    case 'text':
      console.log(`${chalk.dim(time)} ${chalk.bold.blue(who)}: ${msg.text}`)
      break
    case 'file':
      console.log(`${chalk.dim(time)} ${chalk.bold.blue(who)} shared ${chalk.underline(msg.filename)} (${fmtSize(msg.size)}) ${chalk.dim(`id:${msg.id.slice(0, 8)}`)}`)
      break
    case 'system':
      console.log(`${chalk.dim(time)} ${chalk.yellow('⚙')} ${who} ${msg.action}${msg.data ? ': ' + JSON.stringify(msg.data) : ''}`)
      break
    case 'reaction':
      console.log(`${chalk.dim(time)} ${who} reacted ${msg.emoji} to ${msg.targetId?.slice(0, 8)}`)
      break
    case 'voice':
      console.log(`${chalk.dim(time)} ${chalk.magenta('🎤')} ${who} voice ${msg.action}`)
      break
    default:
      console.log(`${chalk.dim(time)} ${chalk.dim(JSON.stringify(msg))}`)
  }
}

function fmtSize (bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
