/**
 * Voice call helpers for Quibble.
 *
 * All real-time audio now flows over native WebRTC (RTCPeerConnection).
 * Signaling (SDP offers/answers, ICE candidates) is relayed through
 * the existing Autobase channel — no separate signaling server needed.
 *
 * TURN servers are included by default so calls work across different
 * networks (symmetric NAT, firewalls, carrier-grade NAT, etc.).
 *
 * ┌─────────┐     Autobase signaling (SDP/ICE)    ┌─────────┐
 * │  Peer A │ ──── Hyperswarm replication ─────────│  Peer B │
 * │ Browser │                                      │ Browser │
 * │   ↕     │ ←──── WebRTC P2P media ─────→       │   ↕     │
 * │  RTC    │   (DTLS/SRTP encrypted)              │  RTC    │
 * └─────────┘                                      └─────────┘
 *
 * Call lifecycle announcements (start/join/end) go through Autobase
 * so all room members see call activity in the feed.
 */

/**
 * Build the ICE server list used by RTCPeerConnection on the client.
 * Defaults include both STUN *and* TURN so P2P calls work across
 * different networks (symmetric NAT, firewalls, mobile data, etc.).
 *
 * @param {Array|null} custom
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

export const VOICE_PROTOCOL = 'quibble-voice-webrtc'
