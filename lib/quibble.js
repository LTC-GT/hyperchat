/**
 * Quibble – core P2P node.
 *
 * Wires together:
 *   • Corestore  – persistence & replication of all Hypercores
 *   • Hyperswarm – peer discovery  (topics = room discoveryKeys)
 *   • Room       – Autobase-backed multi-writer rooms
 *   • Voice      – Protomux real-time audio channels
 *
 * A single Quibble instance manages one identity and multiple rooms.
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

import { Room, parseLink, createLink } from './room.js'

const require = createRequire(import.meta.url)
const Protomux = require('protomux')
const c = require('compact-encoding')

const ROOM_SYNC_PROTOCOL = 'quibble-room-sync'
const ROOM_SYNC_ID = b4a.from('room-writer-sync-v1')
const HEX_KEY_RE = /^[a-f0-9]{64}$/i

export class Quibble extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}  opts.storage   – path to Corestore storage directory
   * @param {object}  opts.identity  – { publicKey, secretKey, name }
   * @param {object}  [opts.swarmOpts] – extra Hyperswarm options (e.g. bootstrap)
   */
  constructor (opts) {
    super()
    this.identity = opts.identity
    this.store = new Corestore(opts.storage)
    this.swarm = new Hyperswarm(opts.swarmOpts)
    this.rooms = new Map() // roomKeyHex -> Room
    this._peersByKey = new Map() // remotePubKeyHex -> Set<socket>
    this._sockets = new Set()
    this._writerSyncBySocket = new Map() // socket -> protomux channel
    this._writerGrantCache = new Map() // roomKeyHex -> Set<writerKeyHex>

    // Replicate Corestore over every Hyperswarm connection
    this.swarm.on('connection', (socket, info) => {
      this.store.replicate(socket)
      const pkHex = b4a.toString(info.publicKey, 'hex')
      this._sockets.add(socket)
      if (!this._peersByKey.has(pkHex)) this._peersByKey.set(pkHex, new Set())
      this._peersByKey.get(pkHex).add(socket)
      this._attachWriterSync(socket)
      this._announceAllRoomsToSocket(socket)
      socket.on('close', () => {
        const s = this._peersByKey.get(pkHex)
        if (s) { s.delete(socket); if (s.size === 0) this._peersByKey.delete(pkHex) }
        this._sockets.delete(socket)
        const channel = this._writerSyncBySocket.get(socket)
        if (channel) {
          try { channel.close() } catch {}
          this._writerSyncBySocket.delete(socket)
        }
      })
      this.emit('connection', socket, info)
    })
  }

  async ready () {
    await this.store.ready()
    return this
  }

  // ─── Room management ───

  /**
   * Create a brand-new room (we are the first member + indexer).
   * @returns {Promise<Room>}
   */
  async createRoom (opts = {}) {
    const namespace = opts.namespace || `room-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const room = new Room(this.store, {
      key: null,
      identity: this.identity,
      encryptionKey: opts.encryptionKey || null,
      namespace
    })
    await room.ready()

    const keyHex = b4a.toString(room.key, 'hex')
    this.rooms.set(keyHex, room)

    // Join Hyperswarm with the room's discovery key so peers can find us
    this.swarm.join(room.discoveryKey, { server: true, client: true })
    this._announceRoomToPeers(room)

    this.emit('room', room)
    return room
  }

  /**
  * Join an existing room by key buffer or pear://quibble/... link.
   * @param {Buffer|string} keyOrLink
   * @returns {Promise<Room>}
   */
  async joinRoom (keyOrLink, opts = {}) {
    let key
    if (typeof keyOrLink === 'string' && keyOrLink.startsWith('pear://quibble/')) {
      key = parseLink(keyOrLink)
    } else if (typeof keyOrLink === 'string') {
      key = b4a.from(keyOrLink, 'hex')
    } else {
      key = keyOrLink
    }

    const keyHex = b4a.toString(key, 'hex')
    if (this.rooms.has(keyHex)) return this.rooms.get(keyHex)

    const room = new Room(this.store, {
      key,
      identity: this.identity,
      encryptionKey: opts.encryptionKey || null,
      namespace: opts.namespace || `room-${keyHex}`
    })
    await room.ready()

    this.rooms.set(keyHex, room)
    this.swarm.join(room.discoveryKey, { server: true, client: true })
    this._announceRoomToPeers(room)

    this.emit('room', room)
    return room
  }

  /**
   * Leave a room and stop replicating it.
   */
  async leaveRoom (keyOrLink) {
    let keyHex
    if (typeof keyOrLink === 'string' && keyOrLink.startsWith('pear://quibble/')) {
      keyHex = b4a.toString(parseLink(keyOrLink), 'hex')
    } else if (typeof keyOrLink === 'string') {
      keyHex = keyOrLink
    } else {
      keyHex = b4a.toString(keyOrLink, 'hex')
    }

    const room = this.rooms.get(keyHex)
    if (!room) return
    this.rooms.delete(keyHex)
    this._writerGrantCache.delete(keyHex)
    await this.swarm.leave(room.discoveryKey)
    await room.close()
  }

  _attachWriterSync (socket) {
    if (this._writerSyncBySocket.has(socket)) return

    const mux = Protomux.from(socket)
    const channel = mux.createChannel({
      protocol: ROOM_SYNC_PROTOCOL,
      id: ROOM_SYNC_ID,
      messages: [
        {
          encoding: c.buffer,
          onmessage: (buf) => {
            this._onWriterSyncMessage(buf)
          }
        }
      ]
    })

    channel.open()
    this._writerSyncBySocket.set(socket, channel)
  }

  _announceAllRoomsToSocket (socket) {
    for (const room of this.rooms.values()) {
      this._announceRoomToSocket(room, socket)
    }
  }

  _announceRoomToPeers (room) {
    for (const socket of this._sockets) {
      this._announceRoomToSocket(room, socket)
    }
  }

  _announceRoomToSocket (room, socket) {
    const channel = this._writerSyncBySocket.get(socket)
    if (!channel || !room?.key || !room?.base?.local?.key) return

    const payload = {
      type: 'room-local-writer',
      roomKey: b4a.toString(room.key, 'hex'),
      writerKey: b4a.toString(room.base.local.key, 'hex')
    }

    try {
      channel.messages[0].send(b4a.from(JSON.stringify(payload)))
    } catch {}
  }

  _onWriterSyncMessage (buf) {
    let payload = null
    try {
      payload = JSON.parse(b4a.toString(buf))
    } catch {
      return
    }

    if (payload?.type !== 'room-local-writer') return

    const roomKey = String(payload.roomKey || '').trim().toLowerCase()
    const writerKey = String(payload.writerKey || '').trim().toLowerCase()
    if (!HEX_KEY_RE.test(roomKey) || !HEX_KEY_RE.test(writerKey)) return

    const room = this.rooms.get(roomKey)
    if (!room || !room.writable || !room.base?.local?.key) return

    const localWriterKey = b4a.toString(room.base.local.key, 'hex')
    if (writerKey === localWriterKey) return

    if (!this._writerGrantCache.has(roomKey)) this._writerGrantCache.set(roomKey, new Set())
    const granted = this._writerGrantCache.get(roomKey)
    if (granted.has(writerKey)) return

    this._grantWriter(room, roomKey, writerKey, granted)
  }

  async _grantWriter (room, roomKey, writerKey, granted) {
    try {
      await room.addWriter(b4a.from(writerKey, 'hex'))
      granted.add(writerKey)
      this.emit('writer-granted', { roomKey, writerKey })
    } catch {}
  }

  // ─── Utilities ───

  /** All active swarm connections */
  get connections () {
    return this.swarm.connections
  }

  /** Render a room key as a pear://quibble/... link */
  link (room) {
    return createLink(room.key)
  }

  // ─── Shutdown ───

  async destroy () {
    for (const channel of this._writerSyncBySocket.values()) {
      try { channel.close() } catch {}
    }
    this._writerSyncBySocket.clear()
    this._sockets.clear()
    this._writerGrantCache.clear()

    for (const room of this.rooms.values()) {
      await room.close()
    }
    this.rooms.clear()
    await this.swarm.destroy()
    await this.store.close()
    this.emit('destroy')
  }
}
