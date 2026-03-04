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

export const VOICE_PROTOCOL = 'quibble-voice-webrtc'
