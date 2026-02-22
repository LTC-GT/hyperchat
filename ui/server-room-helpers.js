import { createServer as createNetServer } from 'node:net'

export async function getRoomOwner (room) {
  const history = await room.history(1000)
  let owner = null

  for (const msg of history) {
    if (msg?.type === 'system' && msg?.action === 'room-owner-set' && msg?.data?.owner) {
      owner = String(msg.data.owner)
    }
  }

  if (!owner) {
    const firstSender = history.find((msg) => msg?.sender)?.sender
    if (firstSender) owner = String(firstSender)
  }

  return owner
}

export async function getRoomAdmins (room) {
  const history = await room.history(1000)
  let admins = null
  const owner = await getRoomOwner(room)

  for (const msg of history) {
    if (msg?.type === 'system' && msg?.action === 'room-admin-set' && Array.isArray(msg?.data?.admins)) {
      admins = new Set(msg.data.admins.map((v) => String(v)))
    }
  }

  if (!admins) {
    admins = new Set()
    if (owner) admins.add(owner)
  }

  if (owner) admins.add(owner)
  return admins
}

export async function isRoomAdmin (room, publicKeyHex) {
  const admins = await getRoomAdmins(room)
  if (admins.size === 0) {
    return Boolean(room.writable)
  }

  return admins.has(publicKeyHex)
}

export async function getRoomModerationState (room) {
  const history = await room.history(2000)
  const bans = new Set()
  const banNames = new Map()
  const kickedFromRoom = new Set()
  const roomKickNames = new Map()
  const kickedByChannel = new Map()

  for (const msg of history) {
    if (msg?.type !== 'system') continue

    if (msg.action === 'room-ban' && msg.data?.targetKey) {
      const key = String(msg.data.targetKey)
      bans.add(key)
      banNames.set(key, String(msg.data.targetName || key))
    }
    if (msg.action === 'room-unban' && msg.data?.targetKey) {
      const key = String(msg.data.targetKey)
      bans.delete(key)
      banNames.delete(key)
    }
    if (msg.action === 'room-kick' && msg.data?.targetKey) {
      const key = String(msg.data.targetKey)
      kickedFromRoom.add(key)
      roomKickNames.set(key, String(msg.data.targetName || key))
    }
    if (msg.action === 'room-unkick' && msg.data?.targetKey) {
      const key = String(msg.data.targetKey)
      kickedFromRoom.delete(key)
      roomKickNames.delete(key)
    }
    if (msg.action === 'channel-kick' && msg.data?.targetKey && msg.data?.channelId) {
      const channelId = String(msg.data.channelId)
      if (!kickedByChannel.has(channelId)) kickedByChannel.set(channelId, new Set())
      kickedByChannel.get(channelId).add(String(msg.data.targetKey))
    }
    if (msg.action === 'channel-unkick' && msg.data?.targetKey && msg.data?.channelId) {
      const channelId = String(msg.data.channelId)
      kickedByChannel.get(channelId)?.delete(String(msg.data.targetKey))
    }
  }

  return { bans, banNames, kickedFromRoom, roomKickNames, kickedByChannel }
}

export async function getModerationError (room, publicKeyHex, channelId = null) {
  const moderationState = await getRoomModerationState(room)
  if (moderationState.bans.has(publicKeyHex)) return 'You are banned from this room.'
  if (moderationState.kickedFromRoom.has(publicKeyHex)) return 'You have been kicked from this server.'
  if (channelId && moderationState.kickedByChannel.get(String(channelId))?.has(publicKeyHex)) {
    return 'You have been kicked from this channel.'
  }
  return null
}

export async function resolveUserByUsername (room, username) {
  const target = String(username || '').trim().toLowerCase()
  if (!target) return null

  const history = await room.history(2000)
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i]
    if (!msg?.sender || !msg?.senderName) continue
    if (String(msg.senderName).trim().toLowerCase() !== target) continue
    return { key: String(msg.sender), name: String(msg.senderName) }
  }

  return null
}

export async function channelIsModOnly (room, channelId) {
  const history = await room.history(1000)
  const channelFlags = new Map()

  for (const msg of history) {
    if (msg?.type !== 'system' || msg?.action !== 'channel-add' || !msg?.data?.id) continue
    channelFlags.set(String(msg.data.id), Boolean(msg.data.modOnly))
  }

  return Boolean(channelFlags.get(String(channelId)))
}

export async function findOpenPort (startPort) {
  if (process.env.PORT) return startPort

  for (let port = startPort; port < startPort + 20; port++) {
    const available = await canListen(port)
    if (available) return port
  }

  throw new Error(`Could not find open port in range ${startPort}-${startPort + 19}`)
}

function canListen (port) {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()

    probe.once('error', (err) => {
      probe.close()
      if (err?.code === 'EADDRINUSE') return resolve(false)
      reject(err)
    })

    probe.listen(port, () => {
      probe.close(() => resolve(true))
    })
  })
}
