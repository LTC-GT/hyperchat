import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { readFileSync, existsSync, writeFileSync, statSync, unlinkSync, rmSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import b4a from 'b4a'

import { loadIdentity, setName, getSeedPhrase, importSeedPhrase } from '../lib/identity.js'
import { Quibble } from '../lib/quibble.js'
import { textMsg, systemMsg, voiceMsg, videoMsg, randomRoomIconEmoji } from '../lib/messages.js'
import { sendFile } from '../lib/file-transfer.js'
import { attachVoice } from '../lib/voice.js'
import { attachVideo } from '../lib/video.js'
import { createProfileStore } from './server-profile.js'
import {
  getRoomOwner,
  getRoomAdmins,
  isRoomAdmin,
  getRoomModerationState,
  getModerationError,
  resolveUserByUsername,
  channelIsModOnly,
  findOpenPort
} from './server-room-helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, 'public')
const DEFAULT_PORT = Number(process.env.PORT || 3000)
const LISTEN_HOST = process.env.HOST || '0.0.0.0'
const IDENTITY_DIR = process.env.QUIBBLE_IDENTITY_DIR ? String(process.env.QUIBBLE_IDENTITY_DIR) : undefined

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
}

let localResetInProgress = false

function parseIceServersFromEnv () {
  const raw = String(process.env.QUIBBLE_ICE_SERVERS_JSON || '').trim()
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null

    const clean = parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const urls = Array.isArray(entry.urls)
          ? entry.urls.map((url) => String(url || '').trim()).filter(Boolean)
          : (String(entry.urls || '').trim() ? [String(entry.urls || '').trim()] : [])
        if (urls.length === 0) return null

        const normalized = { urls }
        if (entry.username !== undefined) normalized.username = String(entry.username)
        if (entry.credential !== undefined) normalized.credential = String(entry.credential)
        return normalized
      })
      .filter(Boolean)

    return clean.length > 0 ? clean : null
  } catch {
    return null
  }
}

function getDefaultIceServers () {
  return [{
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }]
}

function resolveIceServers () {
  return parseIceServersFromEnv() || getDefaultIceServers()
}

const rtcIceServers = resolveIceServers()

function getLanUrls (port) {
  const urls = []
  const interfaces = os.networkInterfaces()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue
      if (entry.family !== 'IPv4') continue
      urls.push(`http://${entry.address}:${port}`)
    }
  }
  return [...new Set(urls)]
}

function scheduleAppShutdown ({ wipeLocal = false } = {}) {
  if (localResetInProgress) return
  localResetInProgress = true

  setTimeout(async () => {
    try {
      await quibble.destroy()
    } catch (err) {
      console.error('Failed destroying Quibble during reset:', err.message)
    }

    try { wss.close() } catch {}
    try { httpServer.close() } catch {}

    if (wipeLocal) {
      const resetPaths = new Set([identity.dir])
      if (storageDir && !storageDir.startsWith(identity.dir)) resetPaths.add(storageDir)

      for (const target of resetPaths) {
        try {
          rmSync(target, { recursive: true, force: true })
        } catch (err) {
          console.error(`Failed deleting ${target}:`, err.message)
        }
      }
    }

    setTimeout(() => process.exit(0), 120)
  }, 40)
}

function scheduleLocalReset () {
  scheduleAppShutdown({ wipeLocal: true })
}

function scheduleIdentityReload () {
  scheduleAppShutdown({ wipeLocal: false })
}

const httpServer = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')

  if (req.method === 'POST' && req.url === '/__reset-local-db') {
    scheduleLocalReset()
    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  let filePath = join(PUBLIC, req.url === '/' ? 'index.html' : req.url)

  // Security: don't escape PUBLIC
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(PUBLIC, 'index.html')
    }
    const data = readFileSync(filePath)
    const ext = extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})

// ─── P2P Node ───
const identity = await loadIdentity({ dir: IDENTITY_DIR })
const { quibble, storageDir } = await initQuibble(identity)

async function initQuibble (identity) {
  const preferredStorage = process.env.QUIBBLE_UI_STORAGE || join(identity.dir, 'storage-ui')

  const maxAttempts = 8
  const retryDelayMs = 500

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const quibble = new Quibble({ storage: preferredStorage, identity })
      await quibble.ready()
      return { quibble, storageDir: preferredStorage }
    } catch (err) {
      const message = String(err?.message || '')
      const lockBusy = message.includes('File descriptor could not be locked')
      if (!lockBusy) throw err

      if (attempt < maxAttempts) {
        console.warn(`⚠️  Corestore storage lock busy at ${preferredStorage}; retrying (${attempt}/${maxAttempts})…`)
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
        continue
      }

      throw new Error([
        `Corestore path is locked: ${preferredStorage}`,
        'Another Quibble process is likely still running.',
        'Close the other process (or wait for it to fully exit) and run pnpm dev again.',
        'To use a different persistent storage path, set QUIBBLE_UI_STORAGE=/path/to/storage pnpm dev.'
      ].join(' '))
      console.error('Failed destroying Quibble during reset:', err.message)
    }
  }

  throw new Error('Failed to initialize persistent Corestore storage.')
}

// Track watchers for cleanup
const roomWatchers = new Map() // roomKeyHex -> Set<{ ws, unsub }>
const wsVoiceSessions = new Map() // ws -> Set<sessionId>
const voiceSessions = new Map() // sessionId -> { roomKey, channels:Set, sockets:Set, wsClients:Set }
const wsVideoSessions = new Map() // ws -> Set<sessionId>
const videoSessions = new Map() // sessionId -> { roomKey, channels:Set, sockets:Set, wsClients:Set }
const activeCallsByScope = new Map() // `${roomKey}|${scope}|${channelId}|${dmKey}` -> { callId, startedBy, startedAt }

// ─── Profile persistence (avatar, name stored alongside identity) ───
const { profilePath, loadProfile, saveProfile } = createProfileStore(identity)
const roomsPath = join(identity.dir, 'rooms.json')

function normalizePresenceStatus (value) {
  const status = String(value || 'active').toLowerCase()
  if (status === 'active' || status === 'away') return status
  if (status === 'online') return 'active'
  return 'away'
}

function buildCallScopeKey (roomKey, scope, channelId, dmKey) {
  const roomPart = String(roomKey || '')
  const dmPart = dmKey ? String(dmKey) : ''
  const normalizedScope = String(scope || (dmPart ? 'dm' : 'text'))
  const normalizedChannel = dmPart ? '' : String(channelId || 'general')
  return `${roomPart}|${normalizedScope}|${normalizedChannel}|${dmPart}`
}

function setActiveCall (roomKey, scope, channelId, dmKey, payload) {
  const key = buildCallScopeKey(roomKey, scope, channelId, dmKey)
  activeCallsByScope.set(key, payload)
}

function getActiveCall (roomKey, scope, channelId, dmKey) {
  const key = buildCallScopeKey(roomKey, scope, channelId, dmKey)
  return activeCallsByScope.get(key) || null
}

function clearActiveCallByRoomCallId (roomKey, callId) {
  const roomPart = String(roomKey || '')
  const id = String(callId || '')
  if (!roomPart || !id) return

  for (const [key, value] of activeCallsByScope.entries()) {
    if (!key.startsWith(`${roomPart}|`)) continue
    if (String(value?.callId || '') !== id) continue
    activeCallsByScope.delete(key)
  }
}

function clearActiveCallsForRoom (roomKey) {
  const roomPart = String(roomKey || '')
  if (!roomPart) return

  for (const key of activeCallsByScope.keys()) {
    if (key.startsWith(`${roomPart}|`)) activeCallsByScope.delete(key)
  }
}

function loadPersistedRooms () {
  try {
    if (!existsSync(roomsPath)) return []
    const parsed = JSON.parse(readFileSync(roomsPath, 'utf-8'))
    const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : []
    return rooms
      .map((entry) => ({
        roomKey: String(entry?.roomKey || '').trim(),
        link: String(entry?.link || '').trim(),
        addedAt: Number(entry?.addedAt) || Date.now()
      }))
      .filter((entry) => entry.roomKey && entry.link)
  } catch {
    return []
  }
}

function savePersistedRooms (rooms) {
  const clean = []
  const seen = new Set()
  for (const entry of rooms) {
    const roomKey = String(entry?.roomKey || '').trim()
    const link = String(entry?.link || '').trim()
    if (!roomKey || !link) continue
    const dedupeKey = `${roomKey}:${link}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    clean.push({ roomKey, link, addedAt: Number(entry?.addedAt) || Date.now() })
  }

  writeFileSync(roomsPath, JSON.stringify({ rooms: clean }, null, 2))
}

function persistRoom (roomKey, link) {
  const key = String(roomKey || '').trim()
  const invite = String(link || '').trim()
  if (!key || !invite) return

  const rooms = loadPersistedRooms()
  const idx = rooms.findIndex((entry) => entry.roomKey === key || entry.link === invite)
  if (idx >= 0) {
    rooms[idx] = { ...rooms[idx], roomKey: key, link: invite, addedAt: rooms[idx].addedAt || Date.now() }
  } else {
    rooms.push({ roomKey: key, link: invite, addedAt: Date.now() })
  }
  savePersistedRooms(rooms)
}

function unpersistRoom (roomKey, link = null) {
  const key = String(roomKey || '').trim()
  const invite = String(link || '').trim()
  if (!key && !invite) return

  const rooms = loadPersistedRooms().filter((entry) => {
    if (key && entry.roomKey === key) return false
    if (invite && entry.link === invite) return false
    return true
  })
  savePersistedRooms(rooms)
}

async function restorePersistedRooms () {
  const persisted = loadPersistedRooms()
  if (persisted.length === 0) return

  const restored = []
  for (const entry of persisted) {
    try {
      const room = await quibble.joinRoom(entry.link)
      const roomKey = b4a.toString(room.key, 'hex')
      restored.push({ roomKey, link: room.inviteLink, addedAt: entry.addedAt || Date.now() })
    } catch (err) {
      console.warn(`Skipping persisted room ${entry.roomKey}: ${err.message}`)
    }
  }

  savePersistedRooms(restored)
}

await restorePersistedRooms()

// ─── WebSocket server ───
const wss = new WebSocketServer({ server: httpServer })
wss.on('error', (err) => {
  console.error('WebSocket server error:', err.message)
})

wss.on('connection', (ws) => {
  let profile = loadProfile()
  if (!existsSync(profilePath)) {
    profile = saveProfile(profile)
  }
  identity.name = profile.username || profile.fullName || identity.name
  identity.avatar = profile.avatar || null
  identity.status = normalizePresenceStatus(profile.presenceStatus)
  const pubKeyHex = b4a.toString(identity.publicKey, 'hex')

  ws.send(JSON.stringify({
    type: 'rtc-config',
    iceServers: rtcIceServers
  }))

  // Send identity + profile on connect
  ws.send(JSON.stringify({
    type: 'identity',
    publicKey: pubKeyHex,
    name: profile.username,
    fullName: profile.fullName,
    username: profile.username,
    avatar: profile.avatar,
    presenceStatus: identity.status,
    setupDone: profile.setupDone
  }))

  // Send existing rooms
  for (const [keyHex, room] of quibble.rooms) {
    ws.send(JSON.stringify({
      type: 'room-info',
      roomKey: keyHex,
      link: room.inviteLink,
      writable: room.writable
    }))
  }

  ws.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    try {
      switch (msg.type) {
        case 'set-profile': {
          const setupWasDone = Boolean(profile.setupDone)
          const fullName = String(msg.fullName || '').trim()
          const username = String(msg.username || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
          if (username) {
            await setName(username, identity.dir)
            identity.name = username
          }

          const updated = saveProfile({
            fullName: fullName || profile.fullName,
            username: username || profile.username,
            avatar: msg.avatar !== undefined ? msg.avatar : profile.avatar,
            presenceStatus: normalizePresenceStatus(msg.presenceStatus || profile.presenceStatus || identity.status),
            setupDone: true
          })
          profile = updated
          identity.avatar = updated.avatar || null
          identity.status = normalizePresenceStatus(updated.presenceStatus)
          ws.send(JSON.stringify({ type: 'profile-updated', ...updated }))

          if (!setupWasDone && updated.setupDone) {
            try {
              const phrase = await getSeedPhrase({ dir: identity.dir, name: identity.name || username || 'anon' })
              ws.send(JSON.stringify({
                type: 'account-seed-created',
                seedPhrase: phrase
              }))
            } catch (err) {
              console.warn('Failed sending seed phrase backup payload:', err.message)
            }
          }
          break
        }

        case 'set-presence-status': {
          const nextStatus = normalizePresenceStatus(msg.status)
          const activityAt = Number(msg.at) || Date.now()
          identity.status = nextStatus
          profile = saveProfile({ presenceStatus: nextStatus })

          ws.send(JSON.stringify({ type: 'profile-updated', ...profile }))

          for (const [roomKey, room] of quibble.rooms) {
            try {
              const presenceMsg = systemMsg('presence-set', { status: nextStatus, at: activityAt }, identity)
              await room.append(presenceMsg)
            } catch (err) {
              console.warn(`Failed broadcasting presence to room ${roomKey}:`, err.message)
            }
          }
          break
        }

        case 'create-room': {
          const room = await quibble.createRoom()
          const keyHex = b4a.toString(room.key, 'hex')
          persistRoom(keyHex, room.inviteLink)

          const emoji = String(msg.emoji || '').trim() || randomRoomIconEmoji()
          const imageData = typeof msg.imageData === 'string' && msg.imageData.startsWith('data:image/')
            ? msg.imageData.slice(0, 2_000_000)
            : null

          const roomProfileMsg = systemMsg('room-profile-set', {
            emoji,
            imageData,
            mimeType: imageData ? String(msg.mimeType || 'image/webp') : null
          }, identity)
          await room.append(roomProfileMsg)

          const ownerKey = b4a.toString(identity.publicKey, 'hex')
          const ownerMsg = systemMsg('room-owner-set', { owner: ownerKey, initial: true }, identity)
          await room.append(ownerMsg)

          const adminMsg = systemMsg('room-admin-set', {
            admins: [ownerKey]
          }, identity)
          await room.append(adminMsg)

          const defaultTextChannel = systemMsg('channel-add', {
            kind: 'text',
            id: 'general',
            name: 'general',
            modOnly: false
          }, identity)
          await room.append(defaultTextChannel)

          const defaultVoiceChannel = systemMsg('channel-add', {
            kind: 'voice',
            id: 'voice-general',
            name: 'General',
            modOnly: false
          }, identity)
          await room.append(defaultVoiceChannel)

          // Announce join
          const joinMsg = systemMsg('join', { name: identity.name }, identity)
          await room.append(joinMsg)

          ws.send(JSON.stringify({
            type: 'room-created',
            roomKey: keyHex,
            link: room.inviteLink,
            writable: room.writable
          }))

          // Start watching for messages
          startWatching(room, keyHex, ws)
          break
        }

        case 'set-room-profile': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can update server profile.' }))
            break
          }

          const emoji = String(msg.emoji || '').trim() || randomRoomIconEmoji()
          const imageData = typeof msg.imageData === 'string' && msg.imageData.startsWith('data:image/')
            ? msg.imageData.slice(0, 2_000_000)
            : null

          const profileUpdate = systemMsg('room-profile-set', {
            emoji,
            imageData,
            mimeType: imageData ? String(msg.mimeType || 'image/webp') : null
          }, identity)
          await room.append(profileUpdate)
          break
        }

        case 'set-room-name': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can update server name.' }))
            break
          }

          const name = String(msg.name || '').replace(/\s+/g, ' ').trim().slice(0, 48)
          if (!name) break

          const roomNameUpdate = systemMsg('room-name-set', { name }, identity)
          await room.append(roomNameUpdate)
          break
        }

        case 'join-room': {
          const room = await quibble.joinRoom(msg.link)
          const keyHex = b4a.toString(room.key, 'hex')
          persistRoom(keyHex, room.inviteLink)

          ws.send(JSON.stringify({
            type: 'room-joined',
            roomKey: keyHex,
            link: room.inviteLink,
            writable: room.writable
          }))

          // Announce join
          try {
            const joinMsg = systemMsg('join', { name: identity.name }, identity)
            await room.append(joinMsg)
          } catch {}

          ws.send(JSON.stringify({
            type: 'room-permission',
            roomKey: keyHex,
            writable: room.writable
          }))

          startWatching(room, keyHex, ws)
          break
        }

        case 'send-message': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const channelId = msg.channelId || 'general'
          const dmKey = msg.dmKey ? String(msg.dmKey) : null
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex, dmKey ? null : channelId)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }
          const modOnly = await channelIsModOnly(room, channelId)
          if (modOnly && !(await isRoomAdmin(room, senderHex))) {
            ws.send(JSON.stringify({ type: 'error', message: 'This channel is restricted to moderators/admins.' }))
            break
          }

          const chatMsg = textMsg(msg.text, identity)
          chatMsg.channelId = channelId
          if (msg.threadRootId) chatMsg.threadRootId = String(msg.threadRootId)
          if (msg.dmKey) chatMsg.dmKey = String(msg.dmKey)
          if (msg.dmParticipants && Array.isArray(msg.dmParticipants)) {
            chatMsg.dmParticipants = msg.dmParticipants.map((v) => String(v)).filter(Boolean)
          }
          await room.append(chatMsg)
          break
        }

        case 'edit-message': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.messageId) break

          const nextText = String(msg.text || '').trim()
          if (!nextText) break

          const target = await findMessageById(room, String(msg.messageId))
          if (!target || target.type !== 'text') {
            ws.send(JSON.stringify({ type: 'error', message: 'Message not found or not editable.' }))
            break
          }

          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const canEdit = target.sender === senderHex || await isRoomAdmin(room, senderHex)
          if (!canEdit) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only the original sender or a room admin can edit this message.' }))
            break
          }

          const editEvent = systemMsg('message-edit', {
            messageId: String(msg.messageId),
            text: nextText,
            channelId: String(target.channelId || 'general'),
            dmKey: target.dmKey ? String(target.dmKey) : null,
            threadRootId: target.threadRootId ? String(target.threadRootId) : null
          }, identity)
          await room.append(editEvent)
          break
        }

        case 'toggle-message-reaction': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.messageId) break

          const emoji = String(msg.emoji || '').trim().slice(0, 64)
          if (!emoji) break

          const target = await findMessageById(room, String(msg.messageId))
          if (!target || (target.type !== 'text' && target.type !== 'file')) {
            ws.send(JSON.stringify({ type: 'error', message: 'Message not found or not reactable.' }))
            break
          }

          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const channelId = String(target.channelId || 'general')
          const dmKey = target.dmKey ? String(target.dmKey) : null

          if (dmKey) {
            const participants = new Set((Array.isArray(target.dmParticipants) ? target.dmParticipants : [])
              .map((value) => String(value))
              .filter(Boolean))
            if (target.sender) participants.add(String(target.sender))
            if (participants.size === 0 && dmKey.includes(':')) {
              for (const key of dmKey.split(':').map((value) => String(value).trim()).filter(Boolean)) {
                participants.add(key)
              }
            }

            if (!participants.has(senderHex)) {
              ws.send(JSON.stringify({ type: 'error', message: 'Only DM participants can react in this DM.' }))
              break
            }
          } else {
            const moderationError = await getModerationError(room, senderHex, channelId)
            if (moderationError) {
              ws.send(JSON.stringify({ type: 'error', message: moderationError }))
              break
            }

            const modOnly = await channelIsModOnly(room, channelId)
            if (modOnly && !(await isRoomAdmin(room, senderHex))) {
              ws.send(JSON.stringify({ type: 'error', message: 'This channel is restricted to moderators/admins.' }))
              break
            }
          }

          const active = await getLatestUserReactionState(room, {
            messageId: String(msg.messageId),
            emoji,
            senderKey: senderHex
          })

          const reactionEvent = systemMsg('message-reaction', {
            messageId: String(msg.messageId),
            emoji,
            on: !active,
            channelId,
            dmKey,
            threadRootId: target.threadRootId ? String(target.threadRootId) : null
          }, identity)

          await room.append(reactionEvent)
          break
        }

        case 'add-channel': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.kind || !msg.name) break

          const kind = msg.kind === 'voice' ? 'voice' : 'text'
          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, requesterHex)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }
          const modOnly = Boolean(msg.modOnly)

          if (modOnly && !(await isRoomAdmin(room, requesterHex))) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only admins can create moderator-only channels.' }))
            break
          }

          const cleanName = String(msg.name).trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '').slice(0, 24)
          if (!cleanName) break

          const id = `${kind}-${cleanName.replace(/\s+/g, '-')}-${Date.now().toString(36)}`
          const channelMsg = systemMsg('channel-add', {
            kind,
            id,
            name: cleanName,
            modOnly
          }, identity)

          await room.append(channelMsg)
          break
        }

        case 'upload-file': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.fileName || !msg.dataBase64) break

          const channelId = msg.channelId || 'general'
          const dmKey = msg.dmKey ? String(msg.dmKey) : null
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex, dmKey ? null : channelId)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }
          const modOnly = await channelIsModOnly(room, channelId)
          if (modOnly && !(await isRoomAdmin(room, senderHex))) {
            ws.send(JSON.stringify({ type: 'error', message: 'This channel is restricted to moderators/admins.' }))
            break
          }

          const safeName = String(msg.fileName).replace(/[^a-zA-Z0-9._-]/g, '_')
          const tempPath = join(os.tmpdir(), `quibble-upload-${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`)
          const fileBuf = b4a.from(msg.dataBase64, 'base64')

          writeFileSync(tempPath, fileBuf)
          try {
            await sendFile(tempPath, quibble.store, room, identity, {
              channelId,
              threadRootId: msg.threadRootId ? String(msg.threadRootId) : null,
              dmKey: msg.dmKey ? String(msg.dmKey) : null,
              dmParticipants: Array.isArray(msg.dmParticipants) ? msg.dmParticipants.map((v) => String(v)).filter(Boolean) : null
            })
          } finally {
            try { unlinkSync(tempPath) } catch {}
          }
          break
        }

        case 'pin-message': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.messageId) break
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex, String(msg.channelId || 'general'))
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }

          const pinMsg = systemMsg('message-pin', {
            messageId: String(msg.messageId),
            channelId: String(msg.channelId || 'general')
          }, identity)
          await room.append(pinMsg)
          break
        }

        case 'unpin-message': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.messageId) break
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex, String(msg.channelId || 'general'))
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }

          const pinMsg = systemMsg('message-unpin', {
            messageId: String(msg.messageId),
            channelId: String(msg.channelId || 'general')
          }, identity)
          await room.append(pinMsg)
          break
        }

        case 'friend-request': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.targetKey) break
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }

          const reqMsg = systemMsg('friend-request', {
            targetKey: String(msg.targetKey),
            targetName: String(msg.targetName || ''),
            fromKey: b4a.toString(identity.publicKey, 'hex')
          }, identity)
          await room.append(reqMsg)
          break
        }

        case 'friend-accept': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.targetKey) break
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }

          const acceptMsg = systemMsg('friend-accept', {
            targetKey: String(msg.targetKey),
            fromKey: b4a.toString(identity.publicKey, 'hex')
          }, identity)
          await room.append(acceptMsg)
          break
        }

        case 'kick-user-channel': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.username || !msg.channelId) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can kick users.' }))
            break
          }

          const target = await resolveUserByUsername(room, String(msg.username))
          if (!target) {
            ws.send(JSON.stringify({ type: 'error', message: 'User not found for that username.' }))
            break
          }

          const targetChannel = String(msg.channelId)
          if (targetChannel === '__server__') {
            const roomKickMsg = systemMsg('room-kick', {
              targetKey: target.key,
              targetName: target.name
            }, identity)
            await room.append(roomKickMsg)
            break
          }

          const kickMsg = systemMsg('channel-kick', {
            channelId: targetChannel,
            targetKey: target.key,
            targetName: target.name
          }, identity)
          await room.append(kickMsg)
          break
        }

        case 'ban-user': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.username) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can ban users.' }))
            break
          }

          const target = await resolveUserByUsername(room, String(msg.username))
          if (!target) {
            ws.send(JSON.stringify({ type: 'error', message: 'User not found for that username.' }))
            break
          }

          const banMsg = systemMsg('room-ban', {
            targetKey: target.key,
            targetName: target.name
          }, identity)
          await room.append(banMsg)
          break
        }

        case 'unban-user': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.username) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can unban users.' }))
            break
          }

          const bans = await getRoomModerationState(room)
          const username = String(msg.username).trim().toLowerCase()
          const bannedEntry = [...bans.banNames.entries()].find(([, value]) => value.toLowerCase() === username)
          const kickedEntry = [...(bans.roomKickNames || new Map()).entries()].find(([, value]) => value.toLowerCase() === username)

          if (!bannedEntry && !kickedEntry) {
            ws.send(JSON.stringify({ type: 'error', message: 'No banned or server-kicked user found for that username.' }))
            break
          }

          if (bannedEntry) {
            const [targetKey, targetName] = bannedEntry
            const unbanMsg = systemMsg('room-unban', { targetKey, targetName }, identity)
            await room.append(unbanMsg)
          }

          if (kickedEntry) {
            const [targetKey, targetName] = kickedEntry
            const unkickMsg = systemMsg('room-unkick', { targetKey, targetName }, identity)
            await room.append(unkickMsg)
          }
          break
        }

        case 'download-file': {
          if (!msg.coreKey || !msg.fileName) break
          const key = b4a.from(msg.coreKey, 'hex')
          const core = quibble.store.get(key)
          await core.ready()
          if (core.length === 0) await core.update({ wait: true })

          const chunks = []
          for (let i = 0; i < core.length; i++) {
            chunks.push(await core.get(i))
          }
          const buf = b4a.concat(chunks)

          ws.send(JSON.stringify({
            type: 'file-data',
            roomKey: msg.roomKey,
            fileName: msg.fileName,
            mimeType: msg.mimeType || 'application/octet-stream',
            dataBase64: b4a.toString(buf, 'base64')
          }))
          break
        }

        case 'add-custom-emoji': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.name || !msg.imageData) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can manage custom emojis.' }))
            break
          }

          const emojiSystemMsg = systemMsg('custom-emoji-add', {
            name: String(msg.name).toLowerCase(),
            imageData: msg.imageData,
            mimeType: msg.mimeType || 'image/png'
          }, identity)
          await room.append(emojiSystemMsg)
          break
        }

        case 'remove-custom-emoji': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.name) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can manage custom emojis.' }))
            break
          }

          const emojiRemoveMsg = systemMsg('custom-emoji-remove', {
            name: String(msg.name).toLowerCase()
          }, identity)
          await room.append(emojiRemoveMsg)
          break
        }

        case 'set-room-admins': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !Array.isArray(msg.admins)) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const allowed = await isRoomAdmin(room, requesterHex)
          if (!allowed) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only room admins can update room admins.' }))
            break
          }

          const ownerHex = await getRoomOwner(room)
          const currentAdmins = await getRoomAdmins(room)
          const requesterIsOwner = ownerHex && requesterHex === ownerHex

          let cleanAdmins = [...new Set(msg.admins.map((v) => String(v).trim()).filter(Boolean))]
          if (cleanAdmins.length === 0) break

          cleanAdmins = [...new Set([...cleanAdmins, ownerHex].filter(Boolean))]

          if (!requesterIsOwner) {
            for (const admin of currentAdmins) {
              if (!cleanAdmins.includes(admin)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Only the owner can remove existing admins.' }))
                cleanAdmins = null
                break
              }
            }
          }

          if (!cleanAdmins) break

          const adminUpdate = systemMsg('room-admin-set', { admins: cleanAdmins }, identity)
          await room.append(adminUpdate)
          break
        }

        case 'set-room-owner': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.owner) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const ownerHex = await getRoomOwner(room)
          if (!ownerHex || requesterHex !== ownerHex) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only the owner can transfer ownership.' }))
            break
          }

          const nextOwner = String(msg.owner).trim()
          if (!nextOwner) break

          const ownerUpdate = systemMsg('room-owner-set', { owner: nextOwner }, identity)
          await room.append(ownerUpdate)

          const admins = await getRoomAdmins(room)
          admins.add(nextOwner)
          const adminUpdate = systemMsg('room-admin-set', { admins: [...admins] }, identity)
          await room.append(adminUpdate)
          break
        }

        case 'disband-room': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const requesterHex = b4a.toString(identity.publicKey, 'hex')
          const ownerHex = await getRoomOwner(room)
          if (!ownerHex || requesterHex !== ownerHex) {
            ws.send(JSON.stringify({ type: 'error', message: 'Only the owner can disband this room.' }))
            break
          }

          const disbandMsg = systemMsg('room-disband', { by: requesterHex }, identity)
          await room.append(disbandMsg)
          clearActiveCallsForRoom(msg.roomKey)
          break
        }

        case 'start-call': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.callId || !msg.mode) break

          const channelId = msg.channelId || 'general'
          const dmKey = msg.dmKey ? String(msg.dmKey) : null
          const scope = String(msg.scope || (dmKey ? 'dm' : 'text'))
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex, channelId)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }
          if (!dmKey) {
            const modOnly = await channelIsModOnly(room, channelId)
            if (modOnly && !(await isRoomAdmin(room, senderHex))) {
              ws.send(JSON.stringify({ type: 'error', message: 'This channel is restricted to moderators/admins.' }))
              break
            }
          }

          const activeCall = getActiveCall(msg.roomKey, scope, channelId, dmKey)
          if (activeCall && String(activeCall.startedBy || '') !== senderHex) {
            const alreadyMsg = dmKey
              ? 'Call already in progress — this user is already calling you.'
              : 'Call already in progress in this channel.'
            ws.send(JSON.stringify({ type: 'error', message: alreadyMsg }))
            break
          }

          const startMsg = systemMsg('call-start', {
            callId: msg.callId,
            mode: msg.mode,
            scope,
            channelId,
            dmKey,
            dmParticipants: Array.isArray(msg.dmParticipants) ? msg.dmParticipants.map((v) => String(v)).filter(Boolean) : null
          }, identity)
          await room.append(startMsg)
          setActiveCall(msg.roomKey, scope, channelId, dmKey, {
            callId: String(msg.callId),
            startedBy: senderHex,
            startedAt: Date.now()
          })
          break
        }

        case 'join-call': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.callId) break

          const channelId = msg.channelId || 'general'
          const dmKey = msg.dmKey ? String(msg.dmKey) : null
          const scope = String(msg.scope || (dmKey ? 'dm' : 'text'))
          const senderHex = b4a.toString(identity.publicKey, 'hex')
          const moderationError = await getModerationError(room, senderHex, channelId)
          if (moderationError) {
            ws.send(JSON.stringify({ type: 'error', message: moderationError }))
            break
          }
          if (!dmKey) {
            const modOnly = await channelIsModOnly(room, channelId)
            if (modOnly && !(await isRoomAdmin(room, senderHex))) {
              ws.send(JSON.stringify({ type: 'error', message: 'This channel is restricted to moderators/admins.' }))
              break
            }
          }

          const joinMsg = systemMsg('call-join', {
            callId: msg.callId,
            mode: msg.mode || 'voice',
            scope,
            channelId,
            dmKey,
            dmParticipants: Array.isArray(msg.dmParticipants) ? msg.dmParticipants.map((v) => String(v)).filter(Boolean) : null
          }, identity)
          await room.append(joinMsg)
          break
        }

        case 'call-signal': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.callId || !msg.signal) break

          const signalMsg = systemMsg('call-signal', {
            callId: msg.callId,
            target: msg.target || null,
            signal: msg.signal,
            channelId: msg.channelId || 'general',
            dmKey: msg.dmKey ? String(msg.dmKey) : null
          }, identity)
          await room.append(signalMsg)
          break
        }

        case 'end-call': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.callId) break

          const endMsg = systemMsg('call-end', {
            callId: msg.callId,
            channelId: msg.channelId || 'general',
            dmKey: msg.dmKey ? String(msg.dmKey) : null
          }, identity)
          await room.append(endMsg)
          clearActiveCallByRoomCallId(msg.roomKey, msg.callId)
          break
        }

        case 'start-voice': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const sessionId = b4a.toString(b4a.from(`${Date.now()}-${Math.random()}`), 'hex').slice(0, 24)
          ensureVoiceSession(sessionId, msg.roomKey)
          addVoiceClient(sessionId, ws)
          const vm = voiceMsg('offer', sessionId, identity)
          vm.channelId = msg.channelId || 'voice-general'
          await room.append(vm)

          ws.send(JSON.stringify({
            type: 'voice-started',
            roomKey: msg.roomKey,
            channelId: msg.channelId || 'voice-general',
            sessionId
          }))
          break
        }

        case 'join-voice': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.sessionId) break

          ensureVoiceSession(msg.sessionId, msg.roomKey)
          addVoiceClient(msg.sessionId, ws)
          const vm = voiceMsg('answer', msg.sessionId, identity)
          vm.channelId = msg.channelId || 'voice-general'
          await room.append(vm)
          break
        }

        case 'voice-audio': {
          if (!msg.sessionId || !msg.dataBase64) break
          const session = voiceSessions.get(msg.sessionId)
          if (!session) break

          const audioBuf = b4a.from(msg.dataBase64, 'base64')
          for (const channel of session.channels) {
            try { channel.sendAudio(audioBuf) } catch {}
          }
          break
        }

        case 'end-voice': {
          const room = quibble.rooms.get(msg.roomKey)
          if (room && msg.sessionId) {
            const vm = voiceMsg('end', msg.sessionId, identity)
            vm.channelId = msg.channelId || 'voice-general'
            await room.append(vm)
          }
          closeVoiceSession(msg.sessionId)
          break
        }

        case 'start-video': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const sessionId = b4a.toString(b4a.from(`${Date.now()}-${Math.random()}`), 'hex').slice(0, 24)
          ensureVideoSession(sessionId, msg.roomKey)
          addVideoClient(sessionId, ws)
          const vm = videoMsg('offer', sessionId, identity)
          vm.channelId = msg.channelId || 'voice-general'
          await room.append(vm)

          ws.send(JSON.stringify({
            type: 'video-started',
            roomKey: msg.roomKey,
            channelId: msg.channelId || 'voice-general',
            sessionId
          }))
          break
        }

        case 'join-video': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room || !msg.sessionId) break

          ensureVideoSession(msg.sessionId, msg.roomKey)
          addVideoClient(msg.sessionId, ws)
          const vm = videoMsg('answer', msg.sessionId, identity)
          vm.channelId = msg.channelId || 'voice-general'
          await room.append(vm)
          break
        }

        case 'video-frame': {
          if (!msg.sessionId || !msg.dataBase64) break
          const session = videoSessions.get(msg.sessionId)
          if (!session) break

          const frameBuf = b4a.from(msg.dataBase64, 'base64')
          for (const channel of session.channels) {
            try { channel.sendFrame(frameBuf) } catch {}
          }
          break
        }

        case 'end-video': {
          const room = quibble.rooms.get(msg.roomKey)
          if (room && msg.sessionId) {
            const vm = videoMsg('end', msg.sessionId, identity)
            vm.channelId = msg.channelId || 'voice-general'
            await room.append(vm)
          }
          closeVideoSession(msg.sessionId)
          break
        }

        case 'get-history': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break

          const limit = Math.max(1, Math.min(500, Number(msg.count) || 100))
          const beforeSeq = Number.isInteger(msg.beforeSeq) ? msg.beforeSeq : null
          const page = await room.historyPage({ limit, beforeSeq })

          ws.send(JSON.stringify({
            type: 'history',
            roomKey: msg.roomKey,
            messages: page.messages,
            total: page.total,
            nextBeforeSeq: page.nextBeforeSeq
          }))
          break
        }

        case 'watch-room': {
          const room = quibble.rooms.get(msg.roomKey)
          if (!room) break
          startWatching(room, msg.roomKey, ws)
          break
        }

        case 'leave-room': {
          const room = quibble.rooms.get(msg.roomKey)
          if (room) {
            try {
              const leaveMsg = systemMsg('leave', { name: identity.name }, identity)
              await room.append(leaveMsg)
            } catch {}
            unpersistRoom(msg.roomKey, room.inviteLink)
          } else {
            unpersistRoom(msg.roomKey)
          }
          await quibble.leaveRoom(msg.roomKey)
          stopWatching(msg.roomKey, ws)
          break
        }

        case 'reset-local-db': {
          ws.send(JSON.stringify({ type: 'local-db-reset-ready' }))
          scheduleLocalReset()
          break
        }

        case 'download-seed-phrase': {
          const phrase = await getSeedPhrase({ dir: identity.dir, name: identity.name || 'anon' })
          const shortKey = b4a.toString(identity.publicKey, 'hex').slice(0, 12)
          ws.send(JSON.stringify({
            type: 'seed-phrase-download',
            fileName: `quibble-seed-${shortKey}.txt`,
            content: `${phrase}\n`
          }))
          break
        }

        case 'import-seed-phrase': {
          const phrase = String(msg.seedPhrase || '')
          await importSeedPhrase(phrase, { dir: identity.dir, name: identity.name || 'anon' })
          ws.send(JSON.stringify({ type: 'seed-phrase-imported' }))
          scheduleIdentityReload()
          break
        }
      }
    } catch (err) {
      const rawMessage = String(err?.message || 'Server error')
      if (rawMessage === 'Not writable') {
        const roomKey = msg?.roomKey ? String(msg.roomKey) : null
        const room = roomKey ? quibble.rooms.get(roomKey) : null
        ws.send(JSON.stringify({
          type: 'room-permission',
          roomKey,
          writable: room ? Boolean(room.writable) : false
        }))
        ws.send(JSON.stringify({
          type: 'error',
          code: 'room-not-writable',
          roomKey,
          message: 'This room is read-only on this device. Ask a current room writer to grant write access before sending messages.'
        }))
      } else {
        ws.send(JSON.stringify({ type: 'error', message: rawMessage }))
      }
    }
  })

  ws.on('close', () => {
    // Clean up all watchers for this ws
    for (const [keyHex, watchers] of roomWatchers) {
      for (const w of watchers) {
        if (w.ws === ws) {
          w.unsub()
          watchers.delete(w)
        }
      }
      if (watchers.size === 0) roomWatchers.delete(keyHex)
    }

    const sessionIds = wsVoiceSessions.get(ws)
    if (sessionIds) {
      for (const sessionId of sessionIds) {
        const session = voiceSessions.get(sessionId)
        if (!session) continue
        session.wsClients.delete(ws)
      }
      wsVoiceSessions.delete(ws)
    }

    const videoSessionIds = wsVideoSessions.get(ws)
    if (videoSessionIds) {
      for (const sessionId of videoSessionIds) {
        const session = videoSessions.get(sessionId)
        if (!session) continue
        session.wsClients.delete(ws)
      }
      wsVideoSessions.delete(ws)
    }
  })
})

function startWatching (room, keyHex, ws) {
  if (!roomWatchers.has(keyHex)) roomWatchers.set(keyHex, new Set())
  const watchers = roomWatchers.get(keyHex)

  // Don't double-watch from same ws
  for (const w of watchers) {
    if (w.ws === ws) return
  }

  const entry = { ws: null, unsub: null }

  const unsub = room.watch((msg, seq) => {
    if (ws.readyState !== 1) {
      if (entry.unsub) entry.unsub()
      watchers.delete(entry)
      if (watchers.size === 0) roomWatchers.delete(keyHex)
      return
    }

    if (msg?.type === 'voice' && msg?.sessionId) {
      if (msg.action === 'offer' || msg.action === 'answer') {
        ensureVoiceSession(msg.sessionId, keyHex)
      }
      if (msg.action === 'end') {
        closeVoiceSession(msg.sessionId)
      }
    }

    if (msg?.type === 'video' && msg?.sessionId) {
      if (msg.action === 'offer' || msg.action === 'answer') {
        ensureVideoSession(msg.sessionId, keyHex)
      }
      if (msg.action === 'end') {
        closeVideoSession(msg.sessionId)
      }
    }

    if (msg?.type === 'system' && msg?.action === 'add-writer') {
      try {
        ws.send(JSON.stringify({
          type: 'room-permission',
          roomKey: keyHex,
          writable: Boolean(room.writable)
        }))
      } catch {}
    }

    try {
      ws.send(JSON.stringify({
        type: 'message',
        roomKey: keyHex,
        msg: { ...msg, _seq: seq }
      }))
    } catch {}
  })

  entry.ws = ws
  entry.unsub = unsub
  watchers.add(entry)
}

function stopWatching (keyHex, ws) {
  const watchers = roomWatchers.get(keyHex)
  if (!watchers) return
  for (const w of watchers) {
    if (w.ws === ws) {
      w.unsub()
      watchers.delete(w)
    }
  }
}

// ─── Peer events ───
quibble.swarm.on('connection', (socket, info) => {
  const peerKey = b4a.toString(info.publicKey, 'hex')
  broadcast({ type: 'peer-connected', peerKey })

  for (const [sessionId, session] of voiceSessions) {
    attachVoiceSocket(sessionId, session.roomKey, socket)
  }

  for (const [sessionId, session] of videoSessions) {
    attachVideoSocket(sessionId, session.roomKey, socket)
  }
})

function broadcast (msg) {
  const data = JSON.stringify(msg)
  for (const ws of wss.clients) {
    try { ws.send(data) } catch {}
  }
}

async function findMessageById (room, messageId) {
  let beforeSeq = null

  while (true) {
    const page = await room.historyPage({ limit: 500, beforeSeq })
    for (let i = page.messages.length - 1; i >= 0; i--) {
      const candidate = page.messages[i]
      if (candidate?.id === messageId) return candidate
    }
    if (page.nextBeforeSeq == null) return null
    beforeSeq = page.nextBeforeSeq
  }
}

async function getLatestUserReactionState (room, { messageId, emoji, senderKey }) {
  let beforeSeq = null
  let active = false
  let bestSeq = -1
  let bestTimestamp = -1

  while (true) {
    const page = await room.historyPage({ limit: 500, beforeSeq })

    for (const candidate of page.messages) {
      if (!candidate || String(candidate.sender || '') !== senderKey) continue

      let targetId = null
      let reactionEmoji = null
      let on = false

      if (candidate.type === 'reaction') {
        targetId = String(candidate.targetId || '')
        reactionEmoji = String(candidate.emoji || '')
        on = true
      } else if (candidate.type === 'system' && candidate.action === 'message-reaction') {
        targetId = String(candidate.data?.messageId || '')
        reactionEmoji = String(candidate.data?.emoji || '')
        on = candidate.data?.on !== false
      } else {
        continue
      }

      if (targetId !== messageId || reactionEmoji !== emoji) continue

      const seq = Number.isInteger(candidate._seq) ? candidate._seq : null
      const timestamp = Number(candidate.timestamp) || 0

      if (seq != null) {
        if (seq >= bestSeq) {
          bestSeq = seq
          bestTimestamp = timestamp
          active = Boolean(on)
        }
      } else if (bestSeq < 0 && timestamp >= bestTimestamp) {
        bestTimestamp = timestamp
        active = Boolean(on)
      }
    }

    if (page.nextBeforeSeq == null) return active
    beforeSeq = page.nextBeforeSeq
  }
}

function addVoiceClient (sessionId, ws) {
  if (!wsVoiceSessions.has(ws)) wsVoiceSessions.set(ws, new Set())
  wsVoiceSessions.get(ws).add(sessionId)

  const session = voiceSessions.get(sessionId)
  if (session) session.wsClients.add(ws)
}

function ensureVoiceSession (sessionId, roomKey) {
  if (!voiceSessions.has(sessionId)) {
    voiceSessions.set(sessionId, {
      roomKey,
      channels: new Set(),
      sockets: new Set(),
      wsClients: new Set()
    })
  }

  const session = voiceSessions.get(sessionId)
  session.roomKey = roomKey

  for (const socket of quibble.connections) {
    attachVoiceSocket(sessionId, roomKey, socket)
  }
}

function attachVoiceSocket (sessionId, roomKey, socket) {
  const session = voiceSessions.get(sessionId)
  if (!session || session.sockets.has(socket)) return

  try {
    const channel = attachVoice(socket, sessionId)
    session.sockets.add(socket)
    session.channels.add(channel)

    channel.on('audio', (buf) => {
      broadcastToVoiceClients(sessionId, {
        type: 'voice-audio',
        roomKey,
        sessionId,
        dataBase64: b4a.toString(buf, 'base64')
      })
    })

    channel.on('control', (data) => {
      if (data?.action === 'end') {
        closeVoiceSession(sessionId)
      }
    })

    channel.on('close', () => {
      session.channels.delete(channel)
      session.sockets.delete(socket)
    })
  } catch {}
}

function broadcastToVoiceClients (sessionId, msg) {
  const session = voiceSessions.get(sessionId)
  if (!session) return
  const data = JSON.stringify(msg)

  for (const ws of session.wsClients) {
    try {
      if (ws.readyState === 1) ws.send(data)
    } catch {}
  }
}

function closeVoiceSession (sessionId) {
  const session = voiceSessions.get(sessionId)
  if (!session) return

  for (const channel of session.channels) {
    try { channel.end() } catch {}
  }

  broadcastToVoiceClients(sessionId, {
    type: 'voice-ended',
    roomKey: session.roomKey,
    sessionId
  })

  for (const ws of session.wsClients) {
    const ids = wsVoiceSessions.get(ws)
    if (ids) ids.delete(sessionId)
  }

  voiceSessions.delete(sessionId)
}

function addVideoClient (sessionId, ws) {
  if (!wsVideoSessions.has(ws)) wsVideoSessions.set(ws, new Set())
  wsVideoSessions.get(ws).add(sessionId)

  const session = videoSessions.get(sessionId)
  if (session) session.wsClients.add(ws)
}

function ensureVideoSession (sessionId, roomKey) {
  if (!videoSessions.has(sessionId)) {
    videoSessions.set(sessionId, {
      roomKey,
      channels: new Set(),
      sockets: new Set(),
      wsClients: new Set()
    })
  }

  const session = videoSessions.get(sessionId)
  session.roomKey = roomKey

  for (const socket of quibble.connections) {
    attachVideoSocket(sessionId, roomKey, socket)
  }
}

function attachVideoSocket (sessionId, roomKey, socket) {
  const session = videoSessions.get(sessionId)
  if (!session || session.sockets.has(socket)) return

  try {
    const channel = attachVideo(socket, sessionId)
    session.sockets.add(socket)
    session.channels.add(channel)

    channel.on('frame', (buf) => {
      broadcastToVideoClients(sessionId, {
        type: 'video-frame',
        roomKey,
        sessionId,
        dataBase64: b4a.toString(buf, 'base64')
      })
    })

    channel.on('control', (data) => {
      if (data?.action === 'end') {
        closeVideoSession(sessionId)
      }
    })

    channel.on('close', () => {
      session.channels.delete(channel)
      session.sockets.delete(socket)
    })
  } catch {}
}

function broadcastToVideoClients (sessionId, msg) {
  const session = videoSessions.get(sessionId)
  if (!session) return
  const data = JSON.stringify(msg)

  for (const ws of session.wsClients) {
    try {
      if (ws.readyState === 1) ws.send(data)
    } catch {}
  }
}

function closeVideoSession (sessionId) {
  const session = videoSessions.get(sessionId)
  if (!session) return

  for (const channel of session.channels) {
    try { channel.end() } catch {}
  }

  broadcastToVideoClients(sessionId, {
    type: 'video-ended',
    roomKey: session.roomKey,
    sessionId
  })

  for (const ws of session.wsClients) {
    const ids = wsVideoSessions.get(ws)
    if (ids) ids.delete(sessionId)
  }

  videoSessions.delete(sessionId)
}

// ─── Start ───
const listenPort = await findOpenPort(DEFAULT_PORT)
if (listenPort !== DEFAULT_PORT) {
  console.warn(`⚠️  Port ${DEFAULT_PORT} is in use, using ${listenPort} instead.`)
}

httpServer.listen(listenPort, LISTEN_HOST, () => {
  console.log(`\n  🚀 Quibble Web UI running at http://localhost:${listenPort}`)
  const lanUrls = getLanUrls(listenPort)
  for (const url of lanUrls) {
    console.log(`  📱 LAN: ${url}`)
  }
  console.log('')
  console.log(`  Identity: ${identity.name} (${b4a.toString(identity.publicKey, 'hex').slice(0, 16)}…)`)
  console.log(`  Storage:  ${storageDir}\n`)
})
