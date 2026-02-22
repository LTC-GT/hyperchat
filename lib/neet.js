/**
 * Neet – core P2P node.
 *
 * Wires together:
 *   • Corestore  – persistence & replication of all Hypercores
 *   • Hyperswarm – peer discovery  (topics = room discoveryKeys)
 *   • Room       – Autobase-backed multi-writer rooms
 *   • Voice      – Protomux real-time audio channels
 *
 * A single Neet instance manages one identity and multiple rooms.
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'

import { Room, parseLink, createLink } from './room.js'

const require = createRequire(import.meta.url)

export class Neet extends EventEmitter {
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

    // Replicate Corestore over every Hyperswarm connection
    this.swarm.on('connection', (socket, info) => {
      this.store.replicate(socket)
      const pkHex = b4a.toString(info.publicKey, 'hex')
      if (!this._peersByKey.has(pkHex)) this._peersByKey.set(pkHex, new Set())
      this._peersByKey.get(pkHex).add(socket)
      socket.on('close', () => {
        const s = this._peersByKey.get(pkHex)
        if (s) { s.delete(socket); if (s.size === 0) this._peersByKey.delete(pkHex) }
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

    this.emit('room', room)
    return room
  }

  /**
   * Join an existing room by key buffer or pear://neet/... link.
   * @param {Buffer|string} keyOrLink
   * @returns {Promise<Room>}
   */
  async joinRoom (keyOrLink, opts = {}) {
    let key
    if (typeof keyOrLink === 'string' && keyOrLink.startsWith('pear://neet/')) {
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

    // Let the peer that added us know we're online – request writership
    // (The room host must call room.addWriter on our base.local.key for
    //  us to become a writer. In our apply handler, the add-writer
    //  system message takes care of this.)

    this.emit('room', room)
    return room
  }

  /**
   * Leave a room and stop replicating it.
   */
  async leaveRoom (keyOrLink) {
    let keyHex
    if (typeof keyOrLink === 'string' && keyOrLink.startsWith('pear://neet/')) {
      keyHex = b4a.toString(parseLink(keyOrLink), 'hex')
    } else if (typeof keyOrLink === 'string') {
      keyHex = keyOrLink
    } else {
      keyHex = b4a.toString(keyOrLink, 'hex')
    }

    const room = this.rooms.get(keyHex)
    if (!room) return
    this.rooms.delete(keyHex)
    await this.swarm.leave(room.discoveryKey)
    await room.close()
  }

  // ─── Utilities ───

  /** All active swarm connections */
  get connections () {
    return this.swarm.connections
  }

  /** Render a room key as a pear://neet/... link */
  link (room) {
    return createLink(room.key)
  }

  // ─── Shutdown ───

  async destroy () {
    for (const room of this.rooms.values()) {
      await room.close()
    }
    this.rooms.clear()
    await this.swarm.destroy()
    await this.store.close()
    this.emit('destroy')
  }
}
