/**
 * Video call helpers for Quibble.
 *
 * All real-time media now flows over PeerJS (WebRTC) — no Protomux needed.
 * This module only exports Autobase message helpers so the room feed can
 * record call-start / call-join / call-end events.
 *
 * Actual WebRTC negotiation, ICE, DTLS encryption and media streaming are
 * handled entirely by the PeerJS client library in the browser.  Peer IDs
 * are derived from each user's Hypercore/Pear public key so the identity
 * layer stays consistent across chat and calls.
 *
 * TURN servers are included by default so calls work across different
 * networks (symmetric NAT, firewalls, carrier-grade NAT, etc.).
 */

import b4a from 'b4a'

/**
 * Derive a deterministic PeerJS-compatible ID from a Hypercore public key.
 *
 * @param {Buffer|string} publicKey – 32-byte Hypercore public key (Buffer or hex)
 * @returns {string} e.g. 'qb-af03e1…'
 */
export function derivePeerJsId (publicKey) {
  const hex = Buffer.isBuffer(publicKey) ? b4a.toString(publicKey, 'hex') : String(publicKey)
  return 'qb-' + hex.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48)
}

/**
 * Build the ICE server list used by PeerJS on the client.
 * Defaults include both STUN *and* TURN so P2P calls work across
 * different networks (symmetric NAT, firewalls, mobile data, etc.).
 *
 * @param {Array|null} custom – optional list from QUIBBLE_ICE_SERVERS_JSON
 * @returns {Array}
 */
export function buildIceServers (custom) {
  if (Array.isArray(custom) && custom.length > 0) return custom
  return [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
    { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' }
  ]
}

export const VIDEO_PROTOCOL = 'quibble-video-peerjs'
