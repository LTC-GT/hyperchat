/**
 * Voice protocol architecture for quibble.
 *
 * Real-time voice does NOT flow through Autobase (too slow / not designed for
 * streaming). Instead we multiplex a dedicated Protomux channel per voice call
 * directly between peers.
 *
 * ┌─────────┐                          ┌─────────┐
 * │  Peer A │──── Hyperswarm conn ─────│  Peer B │
 * │         │                          │         │
 * │ Protomux│  protocol: "quibble-voice"  │ Protomux│
 * │  ├ msg0 │  →  signal (offer/ans)   │  ├ msg0 │
 * │  ├ msg1 │  ←→ audio frames (opus)  │  ├ msg1 │
 * │  └ msg2 │  ←→ control (mute/end)   │  └ msg2 │
 * └─────────┘                          └─────────┘
 *
 * Signaling flow:
 *   1. Caller appends a `voice { action:'offer', sessionId }` message to Autobase
 *      so all room members see it (persistent record).
 *   2. Callee sees offer, opens a Protomux "quibble-voice" channel on the direct
 *      Hyperswarm connection to the caller.
 *   3. Both sides exchange framed Opus packets on msg1.
 *   4. Either side can send 'end' on msg2 to tear down.
 *
 * Audio capture / playback is platform-specific:
 *   • Desktop / Bare: use `bare-audio` or spawn ffmpeg/sox subprocess.
 *   • Node.js CLI (this project): spawn `sox -d -t raw -r 48000 -c 1 -e signed -b 16 -`
 *     for mic capture, pipe output for playback.
 *   • Future GUI: use Web Audio API / MediaStream.
 *
 * This file exports helpers for setting up the Protomux voice channel
 * and framing audio packets. Actual capture/playback is left to the CLI layer.
 */

import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import b4a from 'b4a'

const require = createRequire(import.meta.url)
const Protomux = require('protomux')
const c = require('compact-encoding')

const VOICE_PROTOCOL = 'quibble-voice'

/**
 * Attach voice capability to a Hyperswarm connection.
 *
 * Returns a VoiceChannel that emits:
 *   'signal'    – { type, sessionId, data } signaling messages
 *   'audio'     – Buffer of raw audio frame
 *   'control'   – { action } control messages (mute, unmute, end)
 *   'close'     – channel closed
 *
 * @param {import('stream').Duplex} socket – Hyperswarm connection
 * @param {string} sessionId – voice session identifier
 * @returns {VoiceChannel}
 */
export function attachVoice (socket, sessionId) {
  return new VoiceChannel(socket, sessionId)
}

class VoiceChannel extends EventEmitter {
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
      protocol: VOICE_PROTOCOL,
      id: toChannelId(this.sessionId),
      messages: [
        // msg[0] – signaling (JSON)
        {
          encoding: c.buffer,
          onmessage: (buf) => {
            try {
              this.emit('signal', JSON.parse(b4a.toString(buf)))
            } catch {}
          }
        },
        // msg[1] – raw audio frames
        {
          encoding: c.buffer,
          onmessage: (buf) => {
            this.emit('audio', buf)
          }
        },
        // msg[2] – control
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

  sendAudio (buf) {
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

export { VoiceChannel, VOICE_PROTOCOL }
