/**
 * Voice protocol architecture for neet.
 *
 * Real-time voice does NOT flow through Autobase (too slow / not designed for
 * streaming). Instead we multiplex a dedicated Protomux channel per voice call
 * directly between peers.
 *
 * ┌─────────┐                          ┌─────────┐
 * │  Peer A │──── Hyperswarm conn ─────│  Peer B │
 * │         │                          │         │
 * │ Protomux│  protocol: "neet-voice"  │ Protomux│
 * │  ├ msg0 │  →  signal (offer/ans)   │  ├ msg0 │
 * │  ├ msg1 │  ←→ audio frames (opus)  │  ├ msg1 │
 * │  └ msg2 │  ←→ control (mute/end)   │  └ msg2 │
 * └─────────┘                          └─────────┘
 *
 * Signaling flow:
 *   1. Caller appends a `voice { action:'offer', sessionId }` message to Autobase
 *      so all room members see it (persistent record).
 *   2. Callee sees offer, opens a Protomux "neet-voice" channel on the direct
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
import b4a from 'b4a'

const require = createRequire(import.meta.url)
const Protomux = require('protomux')
const c = require('compact-encoding')

const VOICE_PROTOCOL = 'neet-voice'

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
    this._open(socket)
  }

  _open (socket) {
    const mux = Protomux.from(socket)

    this.channel = mux.createChannel({
      protocol: VOICE_PROTOCOL,
      id: b4a.from(this.sessionId, 'hex'),
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
      onclose: () => this.emit('close')
    })

    this.channel.open()
  }

  sendSignal (data) {
    if (!this.channel) return
    this.channel.messages[0].send(b4a.from(JSON.stringify(data)))
  }

  sendAudio (buf) {
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

export { VoiceChannel, VOICE_PROTOCOL }
