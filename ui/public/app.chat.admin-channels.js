function rebuildRoomAdmins (roomKey) {
  const admins = new Set()
  const msgs = state.messagesByRoom.get(roomKey) || []
  let snapshot = false

  for (const msg of msgs) {
    if (msg?.type === 'system' && msg?.action === 'room-admin-set' && Array.isArray(msg?.data?.admins)) {
      snapshot = true
      admins.clear()
      for (const key of msg.data.admins) {
        if (key) admins.add(String(key))
      }
    }
  }

  if (!snapshot) {
    const firstSender = msgs.find((m) => m?.sender)?.sender
    if (firstSender) admins.add(firstSender)
  }

  state.roomAdmins.set(roomKey, admins)
}

function rebuildRoomOwner (roomKey) {
  const msgs = state.messagesByRoom.get(roomKey) || []
  let owner = null

  for (const msg of msgs) {
    if (msg?.type === 'system' && msg?.action === 'room-owner-set' && msg?.data?.owner) {
      owner = String(msg.data.owner)
    }
  }

  if (!owner) {
    const firstSender = msgs.find((m) => m?.sender)?.sender
    if (firstSender) owner = String(firstSender)
  }

  state.roomOwnerByRoom.set(roomKey, owner)

  if (owner) {
    const admins = new Set(state.roomAdmins.get(roomKey) || [])
    admins.add(owner)
    state.roomAdmins.set(roomKey, admins)
  }
}

function rebuildRoomProfile (roomKey) {
  const msgs = state.messagesByRoom.get(roomKey) || []
  let latest = null

  for (const msg of msgs) {
    if (msg?.type !== 'system' || msg?.action !== 'room-profile-set' || !msg?.data) continue
    latest = msg.data
  }

  const room = state.rooms.get(roomKey)
  if (!room) return

  if (!latest) {
    room.iconEmoji = room.iconEmoji || pickDefaultRoomEmoji(roomKey)
    room.iconImage = room.iconImage || null
    state.rooms.set(roomKey, room)
    renderServerList()
    return
  }

  room.iconEmoji = String(latest.emoji || room.iconEmoji || pickDefaultRoomEmoji(roomKey)).trim()
  room.iconImage = typeof latest.imageData === 'string' && latest.imageData.startsWith('data:image/')
    ? latest.imageData
    : null

  if (!room.iconEmoji) room.iconEmoji = pickDefaultRoomEmoji(roomKey)
  state.rooms.set(roomKey, room)
  renderServerList()
}

function rebuildRoomName (roomKey) {
  const msgs = state.messagesByRoom.get(roomKey) || []
  let latestName = ''

  for (const msg of msgs) {
    if (msg?.type !== 'system' || msg?.action !== 'room-name-set' || !msg?.data?.name) continue
    latestName = String(msg.data.name).trim()
  }

  if (!latestName) return

  const room = state.rooms.get(roomKey)
  if (!room) return
  room.name = latestName
  state.rooms.set(roomKey, room)

  if (state.activeRoom === roomKey) {
    const activeTextChannelId = state.activeTextChannelByRoom.get(roomKey) || 'general'
    const activeTextChannel = getChannelById(roomKey, 'text', activeTextChannelId)
    dom.roomTitle.textContent = latestName
    dom.chatHeaderDesc.textContent = activeTextChannelId === 'general'
      ? `${latestName} channel`
      : `#${activeTextChannel?.name || 'general'}`
  }

  renderServerList()
}

function isCurrentUserOwner () {
  if (!state.activeRoom || !state.identity?.publicKey) return false
  return state.roomOwnerByRoom.get(state.activeRoom) === state.identity.publicKey
}

function isCurrentUserAdmin () {
  if (!state.activeRoom || !state.identity?.publicKey) return false
  if (isCurrentUserOwner()) return true
  const admins = state.roomAdmins.get(state.activeRoom) || new Set()
  return admins.has(state.identity.publicKey)
}

function updateAdminControls () {
  const isAdmin = isCurrentUserAdmin()
  dom.btnAdmin?.classList.toggle('hidden', !isAdmin)
  updateHeaderActionVisibility()
}

function updateHeaderActionVisibility () {
  const inRoom = Boolean(state.activeRoom)
  const inDm = Boolean(state.activeRoom && state.activeDmKey)
  const inTextChannel = Boolean(inRoom && !inDm)
  const activeTextChannelId = inRoom
    ? (state.activeTextChannelByRoom.get(state.activeRoom) || 'general')
    : 'general'
  const canCallFromHeader = inDm || inTextChannel
  const hasLiveCall = Boolean(state.activeCall && state.activeCall.roomKey === state.activeRoom)
  const isAdmin = inRoom && isCurrentUserAdmin()
  const showSecurityStatus = inRoom && !inDm

  if (dom.channelSearch) {
    dom.channelSearch.disabled = !inRoom
    dom.channelSearch.placeholder = inDm
      ? 'Search DMs'
      : inRoom
        ? 'Search mentions in text channels'
        : 'Search'
  }
  dom.btnChannelSearchSubmit?.classList.toggle('hidden', !inRoom)

  dom.btnVoice?.classList.toggle('hidden', !canCallFromHeader || hasLiveCall)
  dom.btnVideoCall?.classList.toggle('hidden', !canCallFromHeader || hasLiveCall)
  dom.btnCallControls?.classList.toggle('hidden', !hasLiveCall)
  dom.btnCallControls?.parentElement?.classList.toggle('hidden', !hasLiveCall)
  dom.btnEndCall?.classList.toggle('hidden', !hasLiveCall)

  const showMembersToggle = inRoom && (!inDm || hasLiveCall)
  dom.btnToggleMembers?.classList.toggle('hidden', !showMembersToggle)
  if (!showMembersToggle) updateMembersToggleButton?.(false)
  else updateMembersToggleButton?.(state.membersVisible)

  const showHeaderUserCog = inDm
  const showHeaderAdminCog = inRoom && !inDm && isAdmin
  dom.btnUserSettings?.classList.toggle('hidden', !showHeaderUserCog)
  dom.btnAdmin?.classList.toggle('hidden', !showHeaderAdminCog)

  dom.securityStatusBtn?.parentElement?.classList.toggle('hidden', !showSecurityStatus)
  if (!showSecurityStatus) dom.securityTooltip?.classList.add('hidden')

  if (!inRoom || !hasLiveCall) {
    dom.callControlsMenu?.classList.add('hidden')
  }

  if (!inRoom) {
    hideSearchDropdown()
    clearSearchResultsView({ clearInput: true })
  }

  if (typeof refreshCallControlsMenu === 'function') refreshCallControlsMenu()
}

function hideSearchDropdown () {
  if (!dom.channelSearchDropdown) return
  dom.channelSearchDropdown.classList.add('hidden')
  dom.channelSearchDropdown.innerHTML = ''
}

function clearSearchResultsView ({ clearInput = false } = {}) {
  state.searchResultsActive = false
  state.activeSearchChannelId = null
  if (clearInput && dom.channelSearch) dom.channelSearch.value = ''
  hideSearchDropdown()
  dom.searchResultsView?.classList.add('hidden')
  if (dom.searchResultsView) dom.searchResultsView.innerHTML = ''
  dom.messagesScroll?.classList.remove('hidden')
  dom.messageComposer?.classList.remove('hidden')
}

function showSearchResultsView ({ title, subtitle, rows }) {
  if (!dom.searchResultsView || !dom.messagesScroll) return
  state.searchResultsActive = true
  dom.messagesScroll.classList.add('hidden')
  dom.messageComposer?.classList.add('hidden')
  dom.searchResultsView.classList.remove('hidden')

  const body = rows.length
    ? rows.map((row) => `
      <div class="bg-quibble-serverbar rounded px-3 py-2 mb-2">
        <div class="text-xs text-quibble-text-m mb-1">${esc(row.meta)}</div>
        <div class="text-sm text-quibble-text">${formatContent(row.text || '')}</div>
      </div>
    `).join('')
    : '<div class="text-sm text-quibble-text-m">No results found.</div>'

  dom.searchResultsView.innerHTML = `
    <div class="mb-4">
      <h3 class="text-lg font-semibold">${esc(title)}</h3>
      <p class="text-xs text-quibble-text-m">${esc(subtitle)}</p>
    </div>
    ${body}
  `
}

function getActiveDmSearchMatches (query) {
  if (!state.activeRoom || !state.activeDmKey) return []
  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const q = query.toLowerCase()
  return roomMsgs
    .filter((msg) => msg?.type === 'text' && msg?.dmKey === state.activeDmKey && !msg?.threadRootId)
    .filter((msg) => String(msg.text || '').toLowerCase().includes(q))
    .map((msg) => ({
      text: msg.text || '',
      meta: `${msg.senderName || 'Unknown'} • ${formatDate(msg.timestamp)}`
    }))
}

function getActiveServerSearchMatches (query) {
  if (!state.activeRoom) return []
  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const q = query.toLowerCase()
  const selectedChannel = state.activeSearchChannelId

  return roomMsgs
    .filter((msg) => msg?.type === 'text' && !msg?.dmKey && !msg?.threadRootId)
    .filter((msg) => !selectedChannel || (msg.channelId || 'general') === selectedChannel)
    .filter((msg) => String(msg.text || '').toLowerCase().includes(q))
    .map((msg) => {
      const channelId = msg.channelId || 'general'
      const channelName = getChannelById(state.activeRoom, 'text', channelId)?.name || channelId
      return {
        text: msg.text || '',
        meta: `#${channelName} • ${msg.senderName || 'Unknown'} • ${formatDate(msg.timestamp)}`
      }
    })
}

function renderServerSearchDropdown (query) {
  if (!dom.channelSearchDropdown || !state.activeRoom || !query) {
    hideSearchDropdown()
    return
  }

  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const q = query.toLowerCase()
  const counts = new Map()

  for (const msg of roomMsgs) {
    if (msg?.type !== 'text' || msg?.dmKey || msg?.threadRootId) continue
    const text = String(msg.text || '').toLowerCase()
    if (!text.includes(q)) continue
    const channelId = msg.channelId || 'general'
    counts.set(channelId, (counts.get(channelId) || 0) + 1)
  }

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (rows.length === 0) {
    hideSearchDropdown()
    return
  }

  dom.channelSearchDropdown.innerHTML = ''
  for (const [channelId, count] of rows) {
    const channelName = getChannelById(state.activeRoom, 'text', channelId)?.name || channelId
    const button = document.createElement('button')
    button.className = 'w-full text-left px-3 py-2 hover:bg-quibble-hover border-b border-quibble-divider/40 last:border-b-0'
    button.innerHTML = `<div class="text-sm text-quibble-text">#${esc(channelName)}</div><div class="text-[11px] text-quibble-text-m">${count} mention${count === 1 ? '' : 's'}</div>`
    button.addEventListener('click', () => {
      state.activeSearchChannelId = channelId
      runHeaderSearch()
    })
    dom.channelSearchDropdown.appendChild(button)
  }

  dom.channelSearchDropdown.classList.remove('hidden')
}

function runHeaderSearch () {
  const query = String(dom.channelSearch?.value || '').trim()
  if (!state.activeRoom || !query) {
    clearSearchResultsView()
    return
  }

  hideSearchDropdown()

  if (state.activeDmKey) {
    const results = getActiveDmSearchMatches(query)
    dom.chatHeaderTitle.textContent = 'DM Search Results'
    dom.chatHeaderDesc.textContent = `"${query}"`
    showSearchResultsView({
      title: 'Direct Message Results',
      subtitle: `Search query: ${query}`,
      rows: results
    })
    return
  }

  const results = getActiveServerSearchMatches(query)
  const scopeLabel = state.activeSearchChannelId
    ? `#${getChannelById(state.activeRoom, 'text', state.activeSearchChannelId)?.name || state.activeSearchChannelId}`
    : 'all text channels'

  dom.chatHeaderTitle.textContent = 'Server Search Results'
  dom.chatHeaderDesc.textContent = `${scopeLabel} • "${query}"`
  showSearchResultsView({
    title: 'Server Search Results',
    subtitle: `Scope: ${scopeLabel}`,
    rows: results
  })
}

function handleHeaderSearchInput () {
  const query = String(dom.channelSearch?.value || '').trim()
  state.activeSearchChannelId = null

  if (!state.activeRoom || !query) {
    hideSearchDropdown()
    if (!query) clearSearchResultsView()
    return
  }

  if (state.activeDmKey) {
    hideSearchDropdown()
    return
  }

  renderServerSearchDropdown(query)
}

function resolveMemberNameByKey (roomKey, publicKey) {
  if (!publicKey) return 'Unknown'
  if (publicKey === state.identity?.publicKey) {
    return state.profile.fullName || state.profile.username || 'You'
  }

  const msgs = state.messagesByRoom.get(roomKey) || []
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m?.sender === publicKey && m?.senderName) return m.senderName
  }

  return publicKey.slice(0, 12)
}

function renderAdminPanel () {
  if (!state.activeRoom || !dom.adminEmojiList || !dom.adminList) return
  const isOwner = isCurrentUserOwner()
  const ownerKey = state.roomOwnerByRoom.get(state.activeRoom) || ''
  const ownerLabel = ownerKey
    ? `${resolveMemberNameByKey(state.activeRoom, ownerKey)} (${ownerKey.slice(0, 10)}…)`
    : 'Unknown'

  if (dom.ownerCurrent) dom.ownerCurrent.textContent = ownerLabel
  if (dom.ownerTransferInput) {
    dom.ownerTransferInput.disabled = !isOwner
    if (!isOwner) dom.ownerTransferInput.value = ''
  }
  if (dom.btnTransferOwner) dom.btnTransferOwner.disabled = !isOwner
  if (dom.btnDisbandGroup) dom.btnDisbandGroup.disabled = !isOwner
  if (dom.btnDeleteServer) dom.btnDeleteServer.disabled = !isOwner

  const room = state.rooms.get(state.activeRoom)
  if (dom.adminServerNameInput) {
    dom.adminServerNameInput.value = room?.name || ''
    dom.adminServerNameInput.disabled = !isCurrentUserAdmin()
  }
  if (dom.btnAdminSetServerName) dom.btnAdminSetServerName.disabled = !isCurrentUserAdmin()
  const currentEmoji = room?.iconEmoji || pickDefaultRoomEmoji(state.activeRoom)
  if (dom.adminServerAvatarPreview) {
    if (room?.iconImage) {
      dom.adminServerAvatarPreview.innerHTML = `<img src="${room.iconImage}" class="w-full h-full object-cover" alt="Server icon">`
    } else {
      dom.adminServerAvatarPreview.textContent = currentEmoji
    }
  }
  if (dom.btnAdminSetServerAvatar) dom.btnAdminSetServerAvatar.disabled = !isCurrentUserAdmin()
  if (dom.btnAdminClearServerAvatar) dom.btnAdminClearServerAvatar.disabled = !isCurrentUserAdmin()

  const custom = state.roomEmojis.get(state.activeRoom) || new Map()
  dom.adminEmojiList.innerHTML = ''
  for (const [name, src] of custom) {
    const row = document.createElement('div')
    row.className = 'flex items-center justify-between bg-quibble-serverbar rounded px-2 py-2'
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <img src="${src}" class="h-6 w-6 rounded" alt=":${name}:" />
        <span class="text-sm">:${esc(name)}:</span>
      </div>
      ${isCurrentUserAdmin() ? `<button class="remove-emoji text-xs px-2 py-1 rounded bg-quibble-red text-white" data-name="${esc(name)}">Remove</button>` : ''}
    `

    row.querySelector('.remove-emoji')?.addEventListener('click', (ev) => {
      const emojiName = ev.currentTarget.dataset.name
      send({ type: 'remove-custom-emoji', roomKey: state.activeRoom, name: emojiName })
    })

    dom.adminEmojiList.appendChild(row)
  }

  const admins = new Set(state.roomAdmins.get(state.activeRoom) || [])
  if (ownerKey) admins.add(ownerKey)
  dom.adminList.innerHTML = ''
  for (const admin of admins) {
    const row = document.createElement('div')
    row.className = 'bg-quibble-serverbar rounded px-2 py-2 text-xs break-all'
    const isOwnerAdmin = admin === ownerKey
    row.innerHTML = `${isOwnerAdmin ? '👑 ' : ''}${esc(resolveMemberNameByKey(state.activeRoom, admin))} <span class="text-quibble-text-m">(${esc(admin.slice(0, 10))}…)</span>`
    dom.adminList.appendChild(row)
  }

  renderModerationPanel()
}

function renderModerationPanel () {
  if (!state.activeRoom || !dom.moderationChannelSelect || !dom.adminBanList) return

  const channels = state.channelsByRoom.get(state.activeRoom) || { text: [], voice: [] }
  const current = dom.moderationChannelSelect.value
  const options = [{ value: '__server__', label: 'Entire Server' }]
  for (const c of channels.text) options.push({ value: c.id, label: `#${c.name}` })
  for (const c of channels.voice) options.push({ value: c.id, label: `🔊 ${c.name}` })

  dom.moderationChannelSelect.innerHTML = ''
  for (const option of options) {
    const el = document.createElement('option')
    el.value = option.value
    el.textContent = option.label
    dom.moderationChannelSelect.appendChild(el)
  }
  if (options.some((o) => o.value === current)) dom.moderationChannelSelect.value = current

  const bans = state.roomBansByRoom.get(state.activeRoom) || new Map()
  const roomKicks = state.channelKicksByRoom.get(`${state.activeRoom}::room`) || new Map()
  const combined = new Map([...bans, ...roomKicks])
  dom.adminBanList.innerHTML = ''
  for (const [key, data] of combined) {
    const row = document.createElement('div')
    row.className = 'bg-quibble-serverbar rounded px-2 py-2 flex items-center gap-2'
    row.innerHTML = `<span class="flex-1 truncate">${esc(data.name || key.slice(0, 12))}</span><span class="text-quibble-text-m">${esc(key.slice(0, 8))}…</span>`
    dom.adminBanList.appendChild(row)
  }

  if (dom.btnKickUserChannel) {
    dom.btnKickUserChannel.textContent = dom.moderationChannelSelect.value === '__server__' ? 'Kick Server' : 'Kick Channel'
  }
}

dom.btnAdmin?.addEventListener('click', () => {
  if (!isCurrentUserAdmin()) return
  renderAdminPanel()
  dom.adminModal?.classList.remove('hidden')
})

dom.btnCloseAdminModal?.addEventListener('click', () => {
  dom.adminModal?.classList.add('hidden')
})

dom.btnAdminAddEmoji?.addEventListener('click', () => {
  if (!isCurrentUserAdmin()) return
  dom.customEmojiInput.click()
})

dom.customEmojiInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file || !state.activeRoom || !isCurrentUserAdmin()) return

  const name = (await appPrompt('Custom emoji name (letters, numbers, _):', {
    title: 'Add custom emoji',
    placeholder: 'emoji_name'
  }))?.trim().toLowerCase()
  const cleanName = (name || '').replace(/[^a-z0-9_]/g, '')
  if (!cleanName) return

  const imageData = await fileToDataURL(file)
  send({
    type: 'add-custom-emoji',
    roomKey: state.activeRoom,
    name: cleanName,
    imageData,
    mimeType: file.type || 'image/png'
  })

  dom.customEmojiInput.value = ''
})

dom.btnAdminSetServerAvatar?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return
  dom.serverAvatarInput?.click()
})

dom.serverAvatarInput?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file || !state.activeRoom || !isCurrentUserAdmin()) return

  const room = state.rooms.get(state.activeRoom)
  const emoji = room?.iconEmoji || pickDefaultRoomEmoji(state.activeRoom)
  const imageData = await fileToDataURL(file)

  send({
    type: 'set-room-profile',
    roomKey: state.activeRoom,
    emoji,
    imageData,
    mimeType: file.type || 'image/webp'
  })

  if (dom.serverAvatarInput) dom.serverAvatarInput.value = ''
})

dom.btnAdminClearServerAvatar?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return
  const emoji = pickDefaultRoomEmoji(`${state.activeRoom}-${Date.now().toString(36)}`)
  send({
    type: 'set-room-profile',
    roomKey: state.activeRoom,
    emoji,
    imageData: null,
    mimeType: null
  })
})

dom.btnAdminSetServerName?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return
  const name = String(dom.adminServerNameInput?.value || '').replace(/\s+/g, ' ').trim().slice(0, 48)
  if (!name) return
  send({ type: 'set-room-name', roomKey: state.activeRoom, name })
})

dom.adminServerNameInput?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  dom.btnAdminSetServerName?.click()
})

dom.btnAddAdmin?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return

  const key = (dom.adminPubKeyInput?.value || '').trim()
  if (!key) return

  const admins = new Set(state.roomAdmins.get(state.activeRoom) || [])
  admins.add(key)

  send({ type: 'set-room-admins', roomKey: state.activeRoom, admins: [...admins] })
  dom.adminPubKeyInput.value = ''
})

dom.btnTransferOwner?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserOwner()) return
  const target = String(dom.ownerTransferInput?.value || '').trim()
  if (!target) return
  if (target === state.roomOwnerByRoom.get(state.activeRoom)) return
  send({ type: 'set-room-owner', roomKey: state.activeRoom, owner: target })
  dom.ownerTransferInput.value = ''
})

dom.btnDisbandGroup?.addEventListener('click', async () => {
  if (!state.activeRoom || !isCurrentUserOwner()) return
  if (!(await appConfirm('Disband this group for everyone? This cannot be undone.', {
    title: 'Disband group',
    confirmText: 'Disband'
  }))) return
  send({ type: 'disband-room', roomKey: state.activeRoom })
})

dom.btnDeleteServer?.addEventListener('click', async () => {
  if (!state.activeRoom || !isCurrentUserOwner()) return
  if (!(await appConfirm('Delete this server from your list and disband it for all members?', {
    title: 'Delete server',
    confirmText: 'Delete'
  }))) return
  send({ type: 'disband-room', roomKey: state.activeRoom })
})

dom.btnKickUserChannel?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return
  const username = (dom.moderationUserInput?.value || '').trim()
  const channelId = (dom.moderationChannelSelect?.value || '').trim()
  if (!username || !channelId) return
  send({ type: 'kick-user-channel', roomKey: state.activeRoom, username, channelId })
  dom.moderationUserInput.value = ''
})

dom.moderationChannelSelect?.addEventListener('change', () => {
  if (!dom.btnKickUserChannel) return
  dom.btnKickUserChannel.textContent = dom.moderationChannelSelect?.value === '__server__' ? 'Kick Server' : 'Kick Channel'
})

dom.btnBanUser?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return
  const username = (dom.moderationUserInput?.value || '').trim()
  if (!username) return
  send({ type: 'ban-user', roomKey: state.activeRoom, username })
  dom.moderationUserInput.value = ''
})

dom.btnUnbanUser?.addEventListener('click', () => {
  if (!state.activeRoom || !isCurrentUserAdmin()) return
  const username = (dom.moderationUserInput?.value || '').trim()
  if (!username) return
  send({ type: 'unban-user', roomKey: state.activeRoom, username })
  dom.moderationUserInput.value = ''
})

// Channels

dom.btnAddTextChannel?.addEventListener('click', async () => {
  if (!state.activeRoom) return
  const name = (await appPrompt('Text channel name? (e.g. memes)', {
    title: 'Create text channel',
    placeholder: 'memes'
  }))?.trim()
  if (!name) return
  const modOnly = !(await appConfirm('Make this channel moderator/admin only?', {
    title: 'Channel visibility',
    confirmText: 'No',
    cancelText: 'Yes'
  }))
  send({ type: 'add-channel', roomKey: state.activeRoom, kind: 'text', name, modOnly })
})

dom.btnAddVoiceChannel?.addEventListener('click', async () => {
  if (!state.activeRoom) return
  const name = (await appPrompt('Voice channel name? (e.g. hangout)', {
    title: 'Create voice channel',
    placeholder: 'hangout'
  }))?.trim()
  if (!name) return
  const modOnly = !(await appConfirm('Make this voice channel moderator/admin only?', {
    title: 'Channel visibility',
    confirmText: 'No',
    cancelText: 'Yes'
  }))
  send({ type: 'add-channel', roomKey: state.activeRoom, kind: 'voice', name, modOnly })
})

dom.channelSearch?.addEventListener('input', handleHeaderSearchInput)
dom.channelSearch?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  e.preventDefault()
  runHeaderSearch()
})
dom.btnChannelSearchSubmit?.addEventListener('click', runHeaderSearch)

function rebuildChannels (roomKey) {
  const channels = {
    text: [{ id: 'general', name: 'general', modOnly: false }],
    voice: [{ id: 'voice-general', name: 'General', modOnly: false }]
  }

  const seenText = new Set(['general'])
  const seenVoice = new Set(['voice-general'])

  const msgs = state.messagesByRoom.get(roomKey) || []
  for (const msg of msgs) {
    if (msg?.type !== 'system' || msg?.action !== 'channel-add' || !msg?.data) continue

    const kind = msg.data.kind === 'voice' ? 'voice' : 'text'
    const id = String(msg.data.id || '').trim()
    const name = String(msg.data.name || '').trim()
    if (!id || !name) continue

    if (kind === 'text' && !seenText.has(id)) {
      channels.text.push({ id, name, modOnly: Boolean(msg.data.modOnly) })
      seenText.add(id)
    }
    if (kind === 'voice' && !seenVoice.has(id)) {
      channels.voice.push({ id, name, modOnly: Boolean(msg.data.modOnly) })
      seenVoice.add(id)
    }
  }

  state.channelsByRoom.set(roomKey, channels)

  if (!state.activeTextChannelByRoom.get(roomKey) || !channels.text.some((c) => c.id === state.activeTextChannelByRoom.get(roomKey))) {
    state.activeTextChannelByRoom.set(roomKey, channels.text[0].id)
  }
  if (!state.activeVoiceChannelByRoom.get(roomKey) || !channels.voice.some((c) => c.id === state.activeVoiceChannelByRoom.get(roomKey))) {
    state.activeVoiceChannelByRoom.set(roomKey, channels.voice[0].id)
  }
}

function getChannelById (roomKey, kind, id) {
  const channels = state.channelsByRoom.get(roomKey)
  if (!channels) return null
  return (channels[kind] || []).find((c) => c.id === id) || null
}

function updateComposerAccess () {
  if (!state.activeRoom) return
  const room = state.rooms.get(state.activeRoom)
  const textId = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  const channel = getChannelById(state.activeRoom, 'text', textId)
  const blockedByReadOnly = room?.writable === false
  const blockedByRole = Boolean(channel?.modOnly) && !isCurrentUserAdmin()
  const blockedByBan = isCurrentUserBannedFromRoom(state.activeRoom)
  const blockedByServerKick = isCurrentUserKickedFromServer(state.activeRoom)
  const blockedByKick = isCurrentUserKickedFromChannel(state.activeRoom, textId)
  const blocked = blockedByReadOnly || blockedByRole || blockedByBan || blockedByServerKick || blockedByKick
  dom.messageInput.disabled = blocked
  dom.btnAttachFile.disabled = blocked
  dom.btnEmoji.disabled = blocked
  if (blockedByReadOnly) dom.messageInput.placeholder = 'Read-only room (writer access required)'
  else if (blockedByBan) dom.messageInput.placeholder = 'You are banned from this room'
  else if (blockedByServerKick) dom.messageInput.placeholder = 'You were kicked from this server'
  else if (blockedByKick) dom.messageInput.placeholder = 'You were kicked from this channel'
  else if (blockedByRole) dom.messageInput.placeholder = 'Moderator/Admin only channel'
  else dom.messageInput.placeholder = `Message #${channel?.name || 'general'}`
  updateMessageInputSize()
}

