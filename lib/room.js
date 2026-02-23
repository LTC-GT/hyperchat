/**
 * Room – an Autobase-backed multi-writer chat room.
 *
 * Architecture:
 *   • Each room is an Autobase with one linearized view core.
 *   • Every participant is a writer + indexer so any peer can produce the view.
 *   • Messages are JSON objects appended to the writer's local core.
 *   • The `apply` handler routes messages: add-writer requests mutate the
 *     Autobase membership, everything else is appended to the view.
 *   • Corestore replication carries all cores over Hyperswarm connections.
 *
 * Invite link format:
 *   pear://quibble/<z32(base.key)>
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import b4a from 'b4a'
import z32 from 'z32'

const require = createRequire(import.meta.url)
const Autobase = require('autobase')
const sodium = require('sodium-universal')

// ─── Constants ───

const QUIBBLE_PREFIX = 'pear://quibble/'
const INVITE_KEY_BYTES = 32
const INVITE_EXTRA_BYTES = 96

// ─── Autobase handlers ───

function open (store) {
  return store.get('view', { valueEncoding: 'json' })
}

async function apply (nodes, view, host) {
  for (const node of nodes) {
    const msg = node.value
    if (!msg || !msg.type) {
      // Null ack nodes or malformed – skip
      continue
    }

    if (msg.type === 'system' && msg.action === 'add-writer' && msg.data?.key) {
      try {
        await host.addWriter(b4a.from(msg.data.key, 'hex'), { indexer: true })
      } catch {
        // Already a writer or invalid key – ignore
      }
      // Still append so the event shows in history
    }

    await view.append(msg)
  }
}

// ─── Room class ───

export class Room extends EventEmitter {
  /**
   * @param {import('corestore')} store – Corestore instance (caller manages lifecycle)
   * @param {object} opts
   * @param {Buffer|null}  opts.key        – Autobase bootstrap key (null = create new room)
   * @param {Buffer|null}  opts.encryptionKey – Optional room-level encryption key
   * @param {object}       opts.identity   – { publicKey, secretKey, name }
   */
  constructor (store, opts = {}) {
    super()
    this.store = store
    this.identity = opts.identity
    this.encryptionKey = opts.encryptionKey || null
    this._bootstrapKey = opts.key || null
    this._namespace = opts.namespace || null
    this.base = null
    this._messageKey = null
    this._viewLen = 0
    this._pollInterval = null
    this._watchers = new Set()
  }

  // ─── Lifecycle ───

  async ready () {
    const baseOpts = { open, apply, valueEncoding: 'json', ackInterval: 1000 }

    if (this.encryptionKey) {
      baseOpts.encryptionKey = this.encryptionKey
    }

    const baseStore = (this._namespace && typeof this.store.namespace === 'function')
      ? this.store.namespace(this._namespace)
      : this.store.session()

    this.base = new Autobase(baseStore, this._bootstrapKey, baseOpts)
    await this.base.ready()
    this._messageKey = deriveMessageKey(this.base.key)

    this._viewLen = this.base.view ? this.base.view.length : 0

    // If we created the room, add ourselves as the first writer+indexer
    // (creator is the bootstrap).
    if (!this._bootstrapKey) {
      // We are the creator – already an indexer by default
    }

    this.emit('ready', {
      key: this.base.key,
      discoveryKey: this.base.discoveryKey,
      link: this.inviteLink
    })

    return this
  }

  get key () { return this.base?.key }
  get discoveryKey () { return this.base?.discoveryKey }
  get writable () { return this.base?.writable }
  get isIndexer () { return this.base?.isIndexer }

  get inviteLink () {
    if (!this.base?.key) return null
    return createLink(this.base.key)
  }

  // ─── Messaging ───

  async append (msg) {
    if (!this.base) throw new Error('Room not ready')
    const payload = shouldEncryptMessage(msg)
      ? encryptMessage(msg, this._messageKey)
      : msg

    await this.base.append(payload)
    this.emit('append', msg)
  }

  /**
   * Fetch the last `n` messages from the view.
   */
  async history (n = 50) {
    const { messages } = await this.historyPage({ limit: n })
    return messages
  }

  /**
   * Fetch a page of messages with sequence metadata.
   * `beforeSeq` is an exclusive upper bound over view indices.
   */
  async historyPage ({ limit = 100, beforeSeq = null } = {}) {
    if (!this.base?.view) return { messages: [], total: 0, nextBeforeSeq: null }

    await this.base.update()
    const total = this.base.view.length
    const end = Number.isInteger(beforeSeq)
      ? Math.max(0, Math.min(beforeSeq, total))
      : total
    const start = Math.max(0, end - Math.max(1, Number(limit) || 100))

    const messages = []
    for (let seq = start; seq < end; seq++) {
      const node = await this.base.view.get(seq)
      const decoded = decodeMessage(node, this._messageKey)
      if (decoded) messages.push({ ...decoded, _seq: seq })
    }

    const nextBeforeSeq = start > 0 ? start : null
    return { messages, total, nextBeforeSeq }
  }

  /**
   * Stream new messages as they arrive.  Returns a cleanup function.
   */
  watch (cb) {
    this._watchers.add(cb)
    this._ensureWatchPump()

    return () => {
      this._watchers.delete(cb)
      if (this._watchers.size === 0 && this._pollInterval) {
        clearInterval(this._pollInterval)
        this._pollInterval = null
      }
    }
  }

  _ensureWatchPump () {
    if (this._pollInterval) return

    const poll = async () => {
      try {
        await this.base.update()
      } catch {
        return
      }

      if (!this.base?.view) return
      const len = this.base.view.length
      if (len <= this._viewLen) return

      const start = this._viewLen
      this._viewLen = len

      for (let seq = start; seq < len; seq++) {
        let decoded = null
        try {
          const msg = await this.base.view.get(seq)
          decoded = decodeMessage(msg, this._messageKey)
        } catch {
          decoded = null
        }
        if (!decoded) continue

        for (const watcher of this._watchers) {
          try {
            watcher(decoded, seq)
          } catch {}
        }
      }
    }

    this._pollInterval = setInterval(poll, 500)
    poll()
  }

  // ─── Writer management ───

  /**
   * Add a remote peer as a writer+indexer.
   * We append an add-writer system message which will be processed by `apply`.
   */
  async addWriter (writerKey) {
    const { addWriterMsg } = await import('./messages.js')
    const msg = addWriterMsg(writerKey, this.identity)
    await this.append(msg)
  }

  // ─── Replication (called by Quibble on each swarm connection) ───

  replicate (socket) {
    this.store.replicate(socket)
  }

  // ─── Cleanup ───

  async close () {
    if (this._pollInterval) clearInterval(this._pollInterval)
    this._watchers.clear()
    if (this.base) await this.base.close()
    this.emit('close')
  }
}

// ─── Helpers ───

/**
 * Parse a pear://quibble/... link into a room key buffer.
 */
export function parseLink (link) {
  if (!link.startsWith(QUIBBLE_PREFIX)) {
    throw new Error(`Invalid quibble link (expected ${QUIBBLE_PREFIX}…)`)
  }
  const payload = z32.decode(link.slice(QUIBBLE_PREFIX.length))
  if (payload.length < INVITE_KEY_BYTES) {
    throw new Error('Invalid quibble invite payload')
  }
  if (payload.length === INVITE_KEY_BYTES) return payload
  return payload.subarray(0, INVITE_KEY_BYTES)
}

/**
 * Create a quibble invite link from a key buffer.
 */
export function createLink (key) {
  const payload = b4a.concat([key, deriveInvitePadding(key)])
  return QUIBBLE_PREFIX + z32.encode(payload)
}

function deriveInvitePadding (key) {
  const out = b4a.alloc(INVITE_EXTRA_BYTES)
  const seed = b4a.concat([b4a.from('quibble-invite-v2'), key])

  for (let i = 0; i < INVITE_EXTRA_BYTES / INVITE_KEY_BYTES; i++) {
    const block = b4a.alloc(INVITE_KEY_BYTES)
    const input = b4a.concat([seed, b4a.from([i])])
    sodium.crypto_generichash(block, input)
    block.copy(out, i * INVITE_KEY_BYTES)
  }

  return out
}

function shouldEncryptMessage (msg) {
  return !(msg?.type === 'system' && msg?.action === 'add-writer')
}

function deriveMessageKey (roomKey) {
  const key = b4a.allocUnsafe(sodium.crypto_secretbox_KEYBYTES)
  const ctx = b4a.from('quibble-room-msg-v1')
  const material = b4a.concat([ctx, roomKey])
  sodium.crypto_generichash(key, material)
  return key
}

function encryptMessage (msg, key) {
  const nonce = b4a.allocUnsafe(sodium.crypto_secretbox_NONCEBYTES)
  sodium.randombytes_buf(nonce)

  const plain = b4a.from(JSON.stringify(msg))
  const cipher = b4a.allocUnsafe(plain.length + sodium.crypto_secretbox_MACBYTES)
  sodium.crypto_secretbox_easy(cipher, plain, nonce, key)

  return {
    type: 'encrypted',
    enc: 'xsalsa20poly1305',
    nonce: b4a.toString(nonce, 'hex'),
    ciphertext: b4a.toString(cipher, 'hex')
  }
}

function decodeMessage (node, key) {
  if (!node) return null
  if (node.type !== 'encrypted') return node

  try {
    const nonce = b4a.from(node.nonce, 'hex')
    const cipher = b4a.from(node.ciphertext, 'hex')
    const out = b4a.allocUnsafe(Math.max(0, cipher.length - sodium.crypto_secretbox_MACBYTES))
    const ok = sodium.crypto_secretbox_open_easy(out, cipher, nonce, key)
    if (!ok) return null
    return JSON.parse(b4a.toString(out))
  } catch {
    return null
  }
}
