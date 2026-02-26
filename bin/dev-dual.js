#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const root = process.cwd()
const baseDir = join(root, '.quibble-dev')

// Each instance needs 2 ports: HTTP and PeerServer (HTTP + 1).
// Space them 2 apart so they never collide.
const instances = [
  {
    name: 'client-a',
    port: '3003',
    identityDir: join(baseDir, 'client-a', 'identity'),
    storageDir: join(baseDir, 'client-a', 'storage-ui')
  },
  {
    name: 'client-b',
    port: '3005',
    identityDir: join(baseDir, 'client-b', 'identity'),
    storageDir: join(baseDir, 'client-b', 'storage-ui')
  }
]

for (const instance of instances) {
  mkdirSync(instance.identityDir, { recursive: true })
  mkdirSync(instance.storageDir, { recursive: true })
}

const children = []
let shuttingDown = false

function shutdown (signal = 'SIGTERM') {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    try {
      child.kill(signal)
    } catch {}
  }

  setTimeout(() => process.exit(0), 120)
}

for (const instance of instances) {
  const env = {
    ...process.env,
    PORT: instance.port,
    HOST: '127.0.0.1',
    QUIBBLE_IDENTITY_DIR: instance.identityDir,
    QUIBBLE_UI_STORAGE: instance.storageDir
  }

  const child = spawn(process.execPath, ['ui/server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${instance.name}] ${chunk}`)
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${instance.name}] ${chunk}`)
  })

  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${String(code)}`
    process.stdout.write(`[${instance.name}] exited (${reason})\n`)
    if (!shuttingDown && code !== 0) {
      shutdown('SIGTERM')
      process.exitCode = Number.isInteger(code) ? code : 1
    }
  })

  children.push(child)
}

process.stdout.write('Dual Quibble dev instances are running:\n')
process.stdout.write('  - client-a: http://127.0.0.1:3003 (PeerServer: 3004)\n')
process.stdout.write('  - client-b: http://127.0.0.1:3005 (PeerServer: 3006)\n')
process.stdout.write('Use separate browser profiles/incognito windows to avoid shared browser session state.\n')

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
