import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function createProfileStore (identity: Identity) {
  const profilePath = join(identity.dir!, 'profile.json')

  function normalizePresenceStatus (value: unknown) {
    const status = String(value || 'active').toLowerCase()
    if (status === 'active' || status === 'away') return status
    if (status === 'online') return 'active'
    return 'away'
  }

  function defaultAnonUsername () {
    return `anon${Math.floor(1000 + Math.random() * 9000)}`
  }

  function loadProfile () {
    try {
      if (existsSync(profilePath)) {
        const saved = JSON.parse(readFileSync(profilePath, 'utf-8'))
        return {
          fullName: saved.fullName || saved.name || identity.name,
          username: saved.username || saved.name || identity.name,
          avatar: saved.avatar || null,
          presenceStatus: normalizePresenceStatus(saved.presenceStatus),
          setupDone: Boolean(saved.setupDone),
          friendRoomKey: saved.friendRoomKey || null
        }
      }
    } catch {}

    const fallbackUsername = identity.name === 'anon' ? defaultAnonUsername() : identity.name
    return {
      fullName: fallbackUsername,
      username: fallbackUsername,
      avatar: null,
      presenceStatus: 'active',
      setupDone: false,
      friendRoomKey: null as string | null
    }
  }

  function saveProfile (data: Partial<{ fullName: string; username: string; avatar: string | null; presenceStatus: string; setupDone: boolean; friendRoomKey: string | null }> | null) {
    const existing = loadProfile()
    const merged = {
      ...existing,
      ...data,
      presenceStatus: normalizePresenceStatus(data?.presenceStatus ?? existing.presenceStatus)
    }
    writeFileSync(profilePath, JSON.stringify(merged, null, 2))
    return merged
  }

  return {
    profilePath,
    loadProfile,
    saveProfile
  }
}
