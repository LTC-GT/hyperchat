/**
 * Message types and encoding for quibble rooms.
 *
 * Every Autobase entry is a JSON object with a `type` field.
 * Types:
 *   text      – plain text chat message
 *   file      – file metadata (the actual bytes live in a separate Hypercore)
 *   voice     – voice signaling / metadata
 *   system    – join, leave, add-writer, name-change, etc.
 *   reaction  – emoji reaction on a prior message
 *
 * All messages carry:
 *   type, timestamp, sender (hex pubkey), senderName, senderAvatar,
 *   senderStatus, id (unique msg id)
 */

import { createRequire } from 'node:module'
import b4a from 'b4a'

const require = createRequire(import.meta.url)
const crypto = require('hypercore-crypto')

function resolveSenderStatus (identity: Identity) {
  const status = String(identity?.status || 'online')
  return ['online', 'idle', 'dnd', 'invisible', 'offline'].includes(status) ? status : 'online'
}

/**
 * Generate a unique message ID (16 random bytes, hex).
 */
export function msgId () {
  return b4a.toString(crypto.randomBytes(16), 'hex')
}

export const ROOM_ICON_EMOJIS = ['😀', '😎', '🚀', '🎯', '🎮', '🧠', '🛸', '🐳', '🦄', '🌈', '⚡', '🔥', '🫧', '🍀', '🐙', '🦊', '🌙', '⭐']

export function randomRoomIconEmoji () {
  return ROOM_ICON_EMOJIS[Math.floor(Math.random() * ROOM_ICON_EMOJIS.length)]
}

// ─── Message constructors ───

export function textMsg (text: string, identity: Identity): TextMessage {
  return {
    type: 'text',
    id: msgId(),
    text,
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}

export function systemMsg (action: string, data: Record<string, unknown>, identity: Identity): SystemMessage {
  return {
    type: 'system',
    id: msgId(),
    action, // 'join' | 'leave' | 'add-writer' | 'name-change'
    data, // action-specific payload
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}

export function fileMsg (filename: string, size: number, mimeType: string, coreKey: Buffer, identity: Identity, channelId: string | null = null): FileMessage {
  return {
    type: 'file',
    id: msgId(),
    filename,
    size,
    mimeType: mimeType || 'application/octet-stream',
    coreKey: b4a.toString(coreKey, 'hex'), // Hypercore key holding the file blocks
    channelId,
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}

export function reactionMsg (targetId: string, emoji: string, identity: Identity): ReactionMessage {
  return {
    type: 'reaction',
    id: msgId(),
    targetId,
    emoji,
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}

export function voiceMsg (action: string, sessionId: string, identity: Identity): VoiceMessage {
  return {
    type: 'voice',
    id: msgId(),
    action, // 'offer' | 'answer' | 'end'
    sessionId,
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}

export function videoMsg (action: string, sessionId: string, identity: Identity): VideoMessage {
  return {
    type: 'video',
    id: msgId(),
    action,
    sessionId,
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}

// ─── Autobase addWriter message (handled specially in apply) ───

export function addWriterMsg (writerKey: Buffer | string, identity: Identity): SystemMessage {
  return {
    type: 'system',
    id: msgId(),
    action: 'add-writer',
    data: { key: typeof writerKey === 'string' ? writerKey : b4a.toString(writerKey, 'hex') },
    sender: b4a.toString(identity.publicKey, 'hex'),
    senderName: identity.name,
    senderAvatar: identity.avatar || null,
    senderStatus: resolveSenderStatus(identity),
    timestamp: Date.now()
  }
}
