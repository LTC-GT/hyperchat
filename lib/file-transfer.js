/**
 * File transfer over Hypercore.
 *
 * Strategy:
 *   1. Sender creates a new Hypercore in their Corestore.
 *   2. File bytes are split into 64 KiB blocks and appended to the core.
 *   3. A `file` message is appended to the Autobase with the core key + metadata.
 *   4. Recipients replicate the core via Corestore and download blocks on demand.
 *
 * This means files persist and can be fetched by peers who join later (offline delivery).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import b4a from 'b4a'

const require = createRequire(import.meta.url)

const BLOCK_SIZE = 64 * 1024 // 64 KiB per Hypercore block

/**
 * Send (share) a file into a room.
 *
 * @param {string}  filePath  – absolute path to the file
 * @param {import('corestore')} store – the room's Corestore
 * @param {import('./room.js').Room} room – the Room instance
 * @param {object}  identity  – sender identity
 * @returns {Promise<object>} the file message that was appended
 */
export async function sendFile (filePath, store, room, identity, opts = {}) {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  const filename = path.basename(resolved)
  const size = stat.size

  // Create a dedicated Hypercore for this file
  const core = store.get({ name: `file-${Date.now()}-${filename}`, valueEncoding: 'binary' })
  await core.ready()

  // Read & append in blocks
  const fd = fs.openSync(resolved, 'r')
  const buf = Buffer.allocUnsafe(BLOCK_SIZE)
  let bytesRead = 0
  try {
    while (bytesRead < size) {
      const n = fs.readSync(fd, buf, 0, BLOCK_SIZE, bytesRead)
      if (n === 0) break
      await core.append(buf.subarray(0, n))
      bytesRead += n
    }
  } finally {
    fs.closeSync(fd)
  }

  // Append a file message to the room
  const { fileMsg } = await import('./messages.js')
  const msg = fileMsg(filename, size, guessMime(filename), core.key, identity, opts.channelId || null)
  if (opts.threadRootId) msg.threadRootId = String(opts.threadRootId)
  if (opts.dmKey) msg.dmKey = String(opts.dmKey)
  if (opts.dmParticipants && Array.isArray(opts.dmParticipants)) {
    msg.dmParticipants = opts.dmParticipants.map((v) => String(v)).filter(Boolean)
  }
  await room.append(msg)

  return msg
}

/**
 * Download a file from a room.
 *
 * @param {object}  fileMessage – the file message from the room view
 * @param {import('corestore')} store – the room's Corestore
 * @param {string}  destDir     – directory to save the file into
 * @returns {Promise<string>} path to the saved file
 */
export async function recvFile (fileMessage, store, destDir) {
  const key = b4a.from(fileMessage.coreKey, 'hex')
  const core = store.get(key)
  await core.ready()

  // Wait until we have at least some data
  if (core.length === 0) {
    await core.update({ wait: true })
  }

  const dest = path.join(destDir, fileMessage.filename)
  const ws = fs.createWriteStream(dest)

  for (let i = 0; i < core.length; i++) {
    const block = await core.get(i)
    ws.write(block)
  }

  ws.end()
  await new Promise((resolve, reject) => {
    ws.on('finish', resolve)
    ws.on('error', reject)
  })

  return dest
}

// ─── Helpers ───

const MIME_MAP = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip'
}

function guessMime (filename) {
  const ext = path.extname(filename).toLowerCase()
  return MIME_MAP[ext] || 'application/octet-stream'
}
