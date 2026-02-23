import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import b4a from 'b4a'

const require = createRequire(import.meta.url)
const Protomux = require('protomux')
const c = require('compact-encoding')

const VIDEO_PROTOCOL = 'quibble-video'

export function attachVideo (socket, sessionId) {
  return new VideoChannel(socket, sessionId)
}

class VideoChannel extends EventEmitter {
  constructor (socket, sessionId) {
    super()
    this.sessionId = sessionId
    this.socket = socket
    this.channel = null
    this._closed = false
    this._ending = false
    this._open(socket)
  }

  _open (socket) {
    const mux = Protomux.from(socket)

    this.channel = mux.createChannel({
      protocol: VIDEO_PROTOCOL,
      id: toChannelId(this.sessionId),
      messages: [
        {
          encoding: c.buffer,
          onmessage: (buf) => {
            try {
              this.emit('signal', JSON.parse(b4a.toString(buf)))
            } catch {}
          }
        },
        {
          encoding: c.buffer,
          onmessage: (buf) => {
            this.emit('frame', buf)
          }
        },
        {
          encoding: c.buffer,
          onmessage: (buf) => {
            try {
              this.emit('control', JSON.parse(b4a.toString(buf)))
            } catch {}
          }
        }
      ],
      onopen: () => this.emit('open'),
      onclose: () => {
        this._closed = true
        this.emit('close')
      }
    })

    this.channel.open()
  }

  sendSignal (data) {
    this._safeSend(0, b4a.from(JSON.stringify(data)))
  }

  sendFrame (buf) {
    this._safeSend(1, buf)
  }

  sendControl (data) {
    this._safeSend(2, b4a.from(JSON.stringify(data)))
  }

  end () {
    if (this._ending || this._closed) return
    this._ending = true
    this.sendControl({ action: 'end' })
    if (this.channel) {
      try { this.channel.close() } catch {}
    }
    this._closed = true
  }

  _safeSend (index, payload) {
    if (this._closed || !this.channel || !this.channel.messages?.[index]) return false
    try {
      this.channel.messages[index].send(payload)
      return true
    } catch {
      return false
    }
  }
}

function toChannelId (sessionId) {
  const value = String(sessionId || '').trim().toLowerCase()
  if (/^[a-f0-9]+$/.test(value) && value.length > 0 && value.length % 2 === 0) {
    return b4a.from(value, 'hex')
  }

  const digest = createHash('sha256').update(String(sessionId || ''), 'utf8').digest('hex')
  return b4a.from(digest.slice(0, 32), 'hex')
}

export { VideoChannel, VIDEO_PROTOCOL }
