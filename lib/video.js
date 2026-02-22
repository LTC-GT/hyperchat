import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import b4a from 'b4a'

const require = createRequire(import.meta.url)
const Protomux = require('protomux')
const c = require('compact-encoding')

const VIDEO_PROTOCOL = 'neet-video'

export function attachVideo (socket, sessionId) {
  return new VideoChannel(socket, sessionId)
}

class VideoChannel extends EventEmitter {
  constructor (socket, sessionId) {
    super()
    this.sessionId = sessionId
    this.socket = socket
    this.channel = null
    this._open(socket)
  }

  _open (socket) {
    const mux = Protomux.from(socket)

    this.channel = mux.createChannel({
      protocol: VIDEO_PROTOCOL,
      id: b4a.from(this.sessionId, 'hex'),
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
      onclose: () => this.emit('close')
    })

    this.channel.open()
  }

  sendSignal (data) {
    if (!this.channel) return
    this.channel.messages[0].send(b4a.from(JSON.stringify(data)))
  }

  sendFrame (buf) {
    if (!this.channel) return
    this.channel.messages[1].send(buf)
  }

  sendControl (data) {
    if (!this.channel) return
    this.channel.messages[2].send(b4a.from(JSON.stringify(data)))
  }

  end () {
    this.sendControl({ action: 'end' })
    if (this.channel) this.channel.close()
  }
}

export { VideoChannel, VIDEO_PROTOCOL }
