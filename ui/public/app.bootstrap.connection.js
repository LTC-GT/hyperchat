function startRoomDiscoveryWindow () {
  const token = ++state.boot.sessionToken
  state.boot.roomDiscoveryReady = false
  updateConnectionGate()

  setTimeout(() => {
    if (token !== state.boot.sessionToken) return
    state.boot.roomDiscoveryReady = true
    updateConnectionGate()
  }, BOOT_ROOM_DISCOVERY_WAIT_MS)
}

function updateConnectionGate () {
  if (!dom.connectionGate) return

  const waitingForConnection = !state.boot.connected
  const waitingForIdentity = state.boot.connected && !state.boot.identityReady
  const waitingForDiscovery = state.boot.connected && state.boot.identityReady && !state.boot.roomDiscoveryReady
  const waitingForHistory = state.boot.connected && state.boot.identityReady && state.boot.roomDiscoveryReady && state.boot.pendingRoomHistory.size > 0
  const blocked = waitingForConnection || waitingForIdentity || waitingForDiscovery || waitingForHistory

  dom.connectionGate.classList.toggle('hidden', !blocked)
  if (!blocked) return

  if (waitingForConnection) {
    dom.connectionGateTitle.textContent = 'Connecting to DAT…'
    dom.connectionGateDetail.textContent = 'Opening websocket and joining DHT peers'
    return
  }

  if (waitingForIdentity) {
    dom.connectionGateTitle.textContent = 'Authenticating…'
    dom.connectionGateDetail.textContent = 'Loading your identity and room access'
    return
  }

  if (waitingForDiscovery) {
    dom.connectionGateTitle.textContent = 'Discovering rooms…'
    dom.connectionGateDetail.textContent = 'Checking available DAT room feeds'
    return
  }

  dom.connectionGateTitle.textContent = 'Syncing history…'
  const pending = state.boot.pendingRoomHistory.size
  dom.connectionGateDetail.textContent = `Downloading initial message pages for ${pending} room${pending === 1 ? '' : 's'}`
}

function clearWsConnectTimeout () {
  if (!wsConnectTimeout) return
  clearTimeout(wsConnectTimeout)
  wsConnectTimeout = null
}

function clearWsReconnectTimer () {
  if (!wsReconnectTimer) return
  clearTimeout(wsReconnectTimer)
  wsReconnectTimer = null
}

function resetBootConnectionState () {
  state.boot.connected = false
  state.boot.identityReady = false
  state.boot.roomDiscoveryReady = false
  state.boot.pendingRoomHistory.clear()
  state.boot.loadedRoomHistory.clear()
  clearHistoryTimers()
  state.boot.sessionToken++
  dom.app.classList.remove('hidden')
  updateSecurityStatus()
  updateConnectionGate()
}

function scheduleReconnect (delay = WS_RECONNECT_DELAY_MS) {
  if (wsReconnectTimer) return
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null
    connect()
  }, delay)
}

function connect () {
  const token = ++wsSessionToken
  clearWsConnectTimeout()

  if (state.ws) {
    state.ws.onopen = null
    state.ws.onmessage = null
    state.ws.onclose = null
    state.ws.onerror = null
  }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  try {
    state.ws = new WebSocket(`${proto}://${location.host}`)
  } catch (error) {
    console.warn('[ws] failed to start socket, retrying soon', error)
    resetBootConnectionState()
    scheduleReconnect(1000)
    return
  }

  wsConnectTimeout = setTimeout(() => {
    if (token !== wsSessionToken) return
    if (state.ws?.readyState !== WebSocket.CONNECTING) return
    console.warn('[ws] connect timeout, forcing reconnect')
    resetBootConnectionState()
    try {
      state.ws.close()
    } catch {}
    scheduleReconnect(1000)
  }, WS_CONNECT_TIMEOUT_MS)

  state.ws.onopen = () => {
    if (token !== wsSessionToken) return
    console.log('[ws] connected')
    clearWsConnectTimeout()
    clearWsReconnectTimer()
    state.boot.connected = true
    state.boot.identityReady = false
    state.boot.roomDiscoveryReady = false
    state.boot.pendingRoomHistory.clear()
    state.boot.loadedRoomHistory.clear()
    clearHistoryTimers()
    state.boot.sessionToken++
    dom.app.classList.remove('hidden')
    updateSecurityStatus()
    updateConnectionGate()
  }
  state.ws.onmessage = (e) => {
    if (token !== wsSessionToken) return
    handleServerMessage(JSON.parse(e.data))
  }
  state.ws.onerror = (error) => {
    if (token !== wsSessionToken) return
    console.warn('[ws] socket error', error)
    if (state.ws?.readyState === WebSocket.CONNECTING || state.ws?.readyState === WebSocket.OPEN) {
      try {
        state.ws.close()
      } catch {}
    }
  }
  state.ws.onclose = () => {
    if (token !== wsSessionToken) return
    console.log('[ws] disconnected, reconnecting in 2s…')
    clearWsConnectTimeout()
    resetBootConnectionState()
    scheduleReconnect()
  }
}

function send (msg) {
  if (msg?.type !== 'set-presence-status') {
    noteLocalPresenceActivity?.('server')
  }
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg))
  }
}

function normalizeRtcIceServers (iceServers) {
  if (!Array.isArray(iceServers)) return []
  return iceServers
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
}

function handleServerMessage (msg) {
  switch (msg.type) {
    case 'rtc-config':
      state.rtcIceServers = normalizeRtcIceServers(msg.iceServers)
      state.peerServerHost = msg.peerServerHost || null
      state.peerServerPort = msg.peerServerPort || null
      state.peerServerPath = msg.peerServerPath || '/peerjs'
      state.peerServerKey = msg.peerServerKey || 'quibble'
      break

    case 'identity':
      state.boot.identityReady = true
      state.boot.pendingRoomHistory.clear()
      state.boot.loadedRoomHistory.clear()
      startRoomDiscoveryWindow()
      state.identity = { publicKey: msg.publicKey }
      state.profile = {
        fullName: msg.fullName || msg.name || '',
        username: msg.username || msg.name || '',
        avatar: msg.avatar,
        setupDone: msg.setupDone
      }
      if (PRESENCE_STATUSES.includes(msg.presenceStatus)) {
        state.settings.presenceStatus = msg.presenceStatus
        saveClientSettings()
      }
      state.lastPresenceActivityAt = Date.now()
      updateUserPanel()
      noteLocalPresenceActivity?.('identity')
      hydrateSetupModal()
      hydrateSettingsModal()
      refreshMediaDevices().catch(() => {})
      renderFriendsHome()
      updateSecurityStatus()
      renderEmojiPicker()
      if (state.profile.setupDone) {
        dom.setupModal.classList.add('hidden')
        state.boot.profilePromptShown = true
      } else if (!state.boot.profilePromptShown) {
        showSetupModal()
        state.boot.profilePromptShown = true
      }
      updateConnectionGate()
      break

    case 'profile-updated':
      state.profile = {
        fullName: msg.fullName || msg.name || '',
        username: msg.username || msg.name || '',
        avatar: msg.avatar,
        setupDone: msg.setupDone
      }
      if (PRESENCE_STATUSES.includes(msg.presenceStatus)) {
        state.settings.presenceStatus = msg.presenceStatus
        saveClientSettings()
      }
      updateUserPanel()
      hydrateSetupModal()
      hydrateSettingsModal()
      if (state.profile.setupDone) {
        dom.setupModal.classList.add('hidden')
      }
      break

    case 'room-created':
      addRoom(msg.roomKey, msg.link, { writable: msg.writable })
      applyPendingCreatedRoomProfile(msg.roomKey)
      selectRoom(msg.roomKey)
      requestRoomHistory(msg.roomKey, { count: 100 })
      break

    case 'room-joined':
      addRoom(msg.roomKey, msg.link, { writable: msg.writable })
      selectRoom(msg.roomKey)
      requestRoomHistory(msg.roomKey, { count: 100 })
      break

    case 'room-info':
      addRoom(msg.roomKey, msg.link, { writable: msg.writable })
      send({ type: 'watch-room', roomKey: msg.roomKey })
      requestRoomHistory(msg.roomKey, { count: 100 })
      break

    case 'room-permission': {
      const room = state.rooms.get(msg.roomKey)
      if (room && typeof msg.writable === 'boolean') {
        room.writable = msg.writable
        if (state.activeRoom === msg.roomKey && typeof updateComposerAccess === 'function') {
          updateComposerAccess()
        }
      }
      break
    }

    case 'room-deleted':
      removeRoomLocal(msg.roomKey, { navigateHome: state.activeRoom === msg.roomKey })
      break

    case 'history': {
      if (!state.messagesByRoom.has(msg.roomKey)) state.messagesByRoom.set(msg.roomKey, [])
      if (!state.seenSeqByRoom.has(msg.roomKey)) state.seenSeqByRoom.set(msg.roomKey, new Set())
      const roomMsgs = state.messagesByRoom.get(msg.roomKey)
      const seenSeq = state.seenSeqByRoom.get(msg.roomKey)

      for (const m of msg.messages) {
        if (Number.isInteger(m?._seq) && seenSeq.has(m._seq)) continue
        if (!m?.id || state.seenIds.has(m.id)) continue
        state.seenIds.add(m.id)
        if (Number.isInteger(m?._seq)) seenSeq.add(m._seq)
        roomMsgs.push(m)
      }

      state.historyCursorByRoom.set(msg.roomKey, Number.isInteger(msg.nextBeforeSeq) ? msg.nextBeforeSeq : null)
      state.historyLoadingByRoom.set(msg.roomKey, false)
      clearHistoryRequestTimeout(msg.roomKey)
      if (state.boot.pendingRoomHistory.has(msg.roomKey)) {
        state.boot.pendingRoomHistory.delete(msg.roomKey)
        state.boot.loadedRoomHistory.add(msg.roomKey)
      }
      updateConnectionGate()

      roomMsgs.sort((a, b) => a.timestamp - b.timestamp)
      applyMessageEdits(msg.roomKey)
      rebuildMessageReactions(msg.roomKey)
      rebuildChannels(msg.roomKey)
      rebuildRoomAdmins(msg.roomKey)
      rebuildRoomOwner(msg.roomKey)
      rebuildRoomName(msg.roomKey)
      rebuildRoomProfile(msg.roomKey)
      rebuildRoomEmojiMap(msg.roomKey)
      rebuildPinnedMap(msg.roomKey)
      rebuildFriends(msg.roomKey)
      rebuildModerationState(msg.roomKey)

      if (state.activeRoom === msg.roomKey) {
        updateAdminControls()
        renderChannelLists()
        renderMessages()
        renderPinnedBar()
        renderEmojiPicker()
        renderAdminPanel()
        renderThreadPanel()
        renderFriendsHome()
      }
      break
    }

    case 'message': {
      if (!state.messagesByRoom.has(msg.roomKey)) state.messagesByRoom.set(msg.roomKey, [])
      if (!state.seenSeqByRoom.has(msg.roomKey)) state.seenSeqByRoom.set(msg.roomKey, new Set())
      const roomMsgs = state.messagesByRoom.get(msg.roomKey)
      const seenSeq = state.seenSeqByRoom.get(msg.roomKey)

      if (Number.isInteger(msg.msg?._seq) && seenSeq.has(msg.msg._seq)) break

      const hasId = Boolean(msg.msg?.id)
      if (hasId && state.seenIds.has(msg.msg.id)) break
      if (hasId) state.seenIds.add(msg.msg.id)
      if (Number.isInteger(msg.msg?._seq)) seenSeq.add(msg.msg._seq)
      roomMsgs.push(msg.msg)

      const isReactionUpdate = msg.msg?.type === 'reaction' || (msg.msg?.type === 'system' && msg.msg.action === 'message-reaction')

      if (msg.msg?.sender && msg.msg.sender !== state.identity?.publicKey && (msg.msg.type === 'text' || msg.msg.type === 'file')) {
        playNotificationTone()
      }

      if (msg.msg?.type === 'system') {
        const action = msg.msg.action
        if (action === 'channel-add') rebuildChannels(msg.roomKey)
        if (action === 'room-admin-set') rebuildRoomAdmins(msg.roomKey)
        if (action === 'room-owner-set') rebuildRoomOwner(msg.roomKey)
        if (action === 'room-name-set') rebuildRoomName(msg.roomKey)
        if (action === 'room-profile-set') rebuildRoomProfile(msg.roomKey)
        if (action === 'custom-emoji-add' || action === 'custom-emoji-remove') rebuildRoomEmojiMap(msg.roomKey)
        if (action === 'message-pin' || action === 'message-unpin') rebuildPinnedMap(msg.roomKey)
        if (action === 'message-edit') applyMessageEdits(msg.roomKey)
        if (action === 'message-reaction') rebuildMessageReactions(msg.roomKey)
        if (action === 'friend-request' || action === 'friend-accept') rebuildFriends(msg.roomKey)
        if (action === 'room-ban' || action === 'room-unban' || action === 'room-kick' || action === 'room-unkick' || action === 'channel-kick' || action === 'channel-unkick') rebuildModerationState(msg.roomKey)
        if (action === 'presence-set' && state.activeRoom === msg.roomKey) updateMemberList()
        if (action === 'room-disband') {
          handleRoomDisband(msg.roomKey, msg.msg)
          break
        }

        if (action === 'channel-kick' && msg.msg.data?.targetKey === state.identity?.publicKey) {
          const kickedChannel = String(msg.msg.data?.channelId || '')
          if (kickedChannel && state.activeRoom === msg.roomKey) {
            const activeText = state.activeTextChannelByRoom.get(msg.roomKey)
            if (activeText === kickedChannel) {
              state.activeTextChannelByRoom.set(msg.roomKey, 'general')
            }
            const activeVoice = state.activeVoiceChannelByRoom.get(msg.roomKey)
            if (activeVoice === kickedChannel && state.activeCall) {
              endCall(true).catch(() => {})
            }
          }
        }

        if (action === 'room-kick' && msg.msg.data?.targetKey === state.identity?.publicKey) {
          if (state.activeRoom === msg.roomKey) {
            state.activeTextChannelByRoom.set(msg.roomKey, 'general')
            if (state.activeCall) {
              endCall(true).catch(() => {})
            }
          }
        }

        if (action === 'call-start') onIncomingCallStart(msg.msg, msg.roomKey)
        if (action === 'call-join') onIncomingCallJoin(msg.msg, msg.roomKey)
        if (action === 'call-signal') onIncomingCallSignal(msg.msg, msg.roomKey)
        if (action === 'call-end') onIncomingCallEnd(msg.msg, msg.roomKey)
        if (action === 'call-start' || action === 'call-end' || action === 'call-join') addCallEventCard(msg.msg)
      }

      if (msg.msg?.type === 'reaction') {
        rebuildMessageReactions(msg.roomKey)
      }

      if (state.activeRoom === msg.roomKey) {
        updateAdminControls()
        renderChannelLists()
        renderPinnedBar()
        renderEmojiPicker()
        renderAdminPanel()
        renderThreadPanel()
        renderFriendsHome()
        if ((msg.msg?.type === 'system' && msg.msg.action === 'message-edit') || isReactionUpdate) renderMessages()
        else appendMessage(msg.msg)
        if (!isReactionUpdate) scrollToBottom()
        ensureUsernameUniquenessForRoom(msg.roomKey)
      } else {
        if (!isReactionUpdate) markUnread(msg.roomKey)
      }
      break
    }

    case 'file-data': {
      const blob = base64ToBlob(msg.dataBase64, msg.mimeType || 'application/octet-stream')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = msg.fileName || 'download.bin'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      break
    }

    case 'account-seed-created':
      showSeedBackupModal(msg)
      break

    case 'seed-phrase-download': {
      downloadTextFile(msg.fileName || 'quibble-seed.txt', msg.content || '')
      break
    }

    case 'seed-phrase-imported':
      appAlert('Seed phrase imported. Quibble will now close so the restored identity is used on next launch.', {
        title: 'Identity restored',
        confirmText: 'Close'
      }).finally(() => {
        setTimeout(() => {
          try { window.close() } catch {}
        }, 120)
      })
      break

    case 'peer-connected':
      state.peers.add(msg.peerKey)
      updateMemberList()
      updateSecurityStatus()
      break

    case 'local-db-reset-ready':
      handleLocalDbResetReady()
      break

    case 'error':
      console.error('[server]', msg.message)
      for (const key of state.historyLoadingByRoom.keys()) {
        state.historyLoadingByRoom.set(key, false)
        clearHistoryRequestTimeout(key)
      }
      state.boot.pendingRoomHistory.clear()
      updateConnectionGate()
      appAlert(msg.message, { title: 'Server Error' })
      break
  }
}

function applyMessageEdits (roomKey) {
  const roomMsgs = state.messagesByRoom.get(roomKey) || []
  const byId = new Map()

  for (const entry of roomMsgs) {
    if (entry?.id) byId.set(String(entry.id), entry)
    if (entry?.type !== 'system' || entry?.action !== 'message-edit' || !entry?.data?.messageId) continue

    const target = byId.get(String(entry.data.messageId))
    if (!target || target.type !== 'text') continue

    target.text = String(entry.data.text || target.text || '')
    target.editedAt = Number(entry.timestamp) || Date.now()
  }
}

function rebuildMessageReactions (roomKey) {
  const roomMsgs = state.messagesByRoom.get(roomKey) || []
  const byMessage = new Map()

  const setReactionState = (messageId, emoji, sender, on) => {
    if (!messageId || !emoji || !sender) return
    const messageKey = String(messageId)
    const emojiKey = String(emoji)
    const senderKey = String(sender)

    let byEmoji = byMessage.get(messageKey)
    if (!byEmoji) {
      byEmoji = new Map()
      byMessage.set(messageKey, byEmoji)
    }

    let senders = byEmoji.get(emojiKey)
    if (!senders) {
      senders = new Set()
      byEmoji.set(emojiKey, senders)
    }

    if (on) senders.add(senderKey)
    else senders.delete(senderKey)

    if (senders.size === 0) byEmoji.delete(emojiKey)
    if (byEmoji.size === 0) byMessage.delete(messageKey)
  }

  for (const entry of roomMsgs) {
    if (entry?.type === 'reaction' && entry?.targetId && entry?.emoji && entry?.sender) {
      setReactionState(entry.targetId, entry.emoji, entry.sender, true)
      continue
    }

    if (entry?.type !== 'system' || entry?.action !== 'message-reaction') continue
    if (!entry?.data?.messageId || !entry?.data?.emoji || !entry?.sender) continue

    setReactionState(entry.data.messageId, entry.data.emoji, entry.sender, entry.data.on !== false)
  }

  state.messageReactionsByRoom.set(roomKey, byMessage)
}

function showSetupModal () {
  if (state.profile.setupDone) {
    dom.setupModal.classList.add('hidden')
    return
  }
  dom.setupModal.classList.remove('hidden')
  dom.app.classList.remove('hidden')
  hydrateSetupModal()
  validateSetup()
  dom.setupFullName.focus()
}

function hydrateSetupModal () {
  if (!dom.setupFullName || !dom.setupUsername) return
  if (!state.profile.username) state.profile.username = generateAnonUsername()
  if (!state.profile.fullName) state.profile.fullName = 'Anonymous'
  dom.setupFullName.value = state.profile.fullName || ''
  dom.setupUsername.value = state.profile.username || ''
  if (state.profile.avatar) {
    dom.avatarPreview.innerHTML = `<img src="${state.profile.avatar}" class="w-full h-full object-cover">`
  } else {
    dom.avatarPreview.textContent = (state.profile.fullName || state.profile.username || '?').charAt(0).toUpperCase()
  }
}

function validateSetup () {
  const fullName = dom.setupFullName.value.trim()
  const username = sanitizeUsername(dom.setupUsername.value)
  dom.setupSubmit.disabled = !(fullName && username)
}

dom.setupFullName.addEventListener('input', validateSetup)
dom.setupUsername.addEventListener('input', (e) => {
  const clean = sanitizeUsername(e.target.value)
  if (e.target.value !== clean) e.target.value = clean
  validateSetup()
})

dom.setupFullName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !dom.setupSubmit.disabled) {
    e.preventDefault()
    submitSetup()
  }
})

dom.setupUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !dom.setupSubmit.disabled) {
    e.preventDefault()
    submitSetup()
  }
})

dom.avatarInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  state.profile.avatar = await fileToDataURL(file)
  dom.avatarPreview.innerHTML = `<img src="${state.profile.avatar}" class="w-full h-full object-cover">`
  if (dom.settingsAvatarPreview) {
    dom.settingsAvatarPreview.innerHTML = `<img src="${state.profile.avatar}" class="w-full h-full object-cover">`
  }
  updateUserPanel()
})

dom.setupSubmit.addEventListener('click', submitSetup)
dom.btnSeedBackupContinue?.addEventListener('click', hideSeedBackupModal)
dom.btnSeedBackupCopy?.addEventListener('click', async () => {
  const phrase = String(state.pendingSeedPhrase || '').trim()
  if (!phrase) return

  try {
    await navigator.clipboard.writeText(phrase)
    dom.btnSeedBackupCopy.textContent = 'Copied'
    setTimeout(() => {
      if (dom.btnSeedBackupCopy) dom.btnSeedBackupCopy.textContent = 'Copy Seed Phrase'
    }, 1200)
  } catch {
    await appAlert('Copy failed. You can still use Download Seed Phrase in Local Data settings.', {
      title: 'Clipboard unavailable'
    })
  }
})

function submitSetup () {
  const fullName = dom.setupFullName.value.trim()
  const username = sanitizeUsername(dom.setupUsername.value)
  if (!fullName || !username) return

  send({ type: 'set-profile', fullName, username, avatar: state.profile.avatar })
  state.profile.fullName = fullName
  state.profile.username = username
  state.profile.setupDone = true
  dom.setupModal.classList.add('hidden')
  hydrateSettingsModal()
  updateUserPanel()
}

function sanitizeUsername (value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
}

function generateAnonUsername () {
  return `anon${Math.floor(1000 + Math.random() * 9000)}`
}

function collectRoomTakenUsernames (roomKey) {
  const taken = new Set()
  const msgs = state.messagesByRoom.get(roomKey) || []
  for (const msg of msgs) {
    if (!msg?.senderName) continue
    if (msg.sender === state.identity?.publicKey) continue
    const clean = sanitizeUsername(msg.senderName)
    if (clean) taken.add(clean)
  }
  return taken
}

function buildUsernameSuggestions (baseUsername, taken) {
  const base = sanitizeUsername(baseUsername) || 'anon'
  const out = []

  const add = (candidate) => {
    const clean = sanitizeUsername(candidate)
    if (!clean || taken.has(clean) || out.includes(clean)) return
    out.push(clean)
  }

  add(`${base}${Math.floor(100 + Math.random() * 9000)}`)
  add(`${base}${Math.floor(100 + Math.random() * 9000)}`)
  add(generateAnonUsername())

  while (out.length < 3) add(generateAnonUsername())
  return out.slice(0, 3)
}

function closeUsernameConflictModal () {
  dom.usernameConflictModal?.classList.add('hidden')
  if (dom.usernameConflictError) dom.usernameConflictError.textContent = ''
}

function openUsernameConflictModal (roomKey, baseUsername, suggestions) {
  if (!dom.usernameConflictModal || !dom.usernameConflictSuggestions) return
  const safeBase = sanitizeUsername(baseUsername) || 'anon'

  dom.usernameConflictText.textContent = `"${safeBase}" is already used in this server. Pick one of these 🙂`
  dom.usernameConflictSuggestions.innerHTML = ''
  dom.usernameConflictCustomInput.value = ''
  dom.usernameConflictError.textContent = ''

  for (const candidate of suggestions.slice(0, 3)) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'rounded-md px-3 py-2 text-left text-sm bg-quibble-serverbar hover:bg-quibble-hover'
    btn.textContent = candidate
    btn.addEventListener('click', () => applyUsernameConflictChoice(roomKey, candidate))
    dom.usernameConflictSuggestions.appendChild(btn)
  }

  dom.usernameConflictModal.classList.remove('hidden')
}

function ensureUsernameUniquenessForRoom (roomKey) {
  if (!roomKey || roomKey !== state.activeRoom) return

  let current = sanitizeUsername(state.profile.username)
  if (!current) {
    current = generateAnonUsername()
    state.profile.username = current
  }

  const taken = collectRoomTakenUsernames(roomKey)
  if (!taken.has(current)) {
    state.usernameConflictByRoom.delete(roomKey)
    closeUsernameConflictModal()
    return
  }

  const existing = state.usernameConflictByRoom.get(roomKey)
  const suggestions = existing?.base === current
    ? existing.suggestions
    : buildUsernameSuggestions(current, taken)

  state.usernameConflictByRoom.set(roomKey, {
    base: current,
    suggestions,
    taken: [...taken]
  })

  openUsernameConflictModal(roomKey, current, suggestions)
}

function applyUsernameConflictChoice (roomKey, candidate) {
  const clean = sanitizeUsername(candidate)
  if (!clean) return
  const conflict = state.usernameConflictByRoom.get(roomKey)
  const taken = new Set(conflict?.taken || [])
  if (taken.has(clean)) {
    dom.usernameConflictError.textContent = 'That username is already taken in this room.'
    return
  }

  const fullName = state.profile.fullName || 'Anonymous'
  state.profile.username = clean
  send({ type: 'set-profile', fullName, username: clean, avatar: state.profile.avatar })
  hydrateSetupModal()
  hydrateSettingsModal()
  updateUserPanel()
  state.usernameConflictByRoom.delete(roomKey)
  closeUsernameConflictModal()
}

dom.btnUsernameConflictApply?.addEventListener('click', () => {
  if (!state.activeRoom) return
  applyUsernameConflictChoice(state.activeRoom, dom.usernameConflictCustomInput?.value || '')
})

