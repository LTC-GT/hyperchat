const ROOM_ICON_FALLBACKS = ['😀', '😎', '🚀', '🎯', '🎮', '🧠', '🛸', '🐳', '🦄', '🌈', '⚡', '🔥', '🫧', '🍀', '🐙', '🦊', '🌙', '⭐']
let inlineEditMessageId = null
let inlineEditDraft = ''
let activeReactionPicker = null

function closeReactionPicker () {
  if (!activeReactionPicker) return
  activeReactionPicker.remove()
  activeReactionPicker = null
  document.removeEventListener('mousedown', handleReactionPickerOutsideClick, true)
}

function handleReactionPickerOutsideClick (event) {
  if (!activeReactionPicker) return
  if (activeReactionPicker.contains(event.target)) return
  closeReactionPicker()
}

function normalizeReactionEmoji (value) {
  const emoji = String(value || '').trim()
  if (!emoji || emoji.length > 64) return ''
  return emoji
}

function getMessageReactionEntries (roomKey, messageId) {
  const byMessage = state.messageReactionsByRoom.get(roomKey)
  if (!byMessage || !messageId) return []
  const byEmoji = byMessage.get(String(messageId))
  if (!byEmoji) return []

  const selfKey = state.identity?.publicKey
  return [...byEmoji.entries()]
    .map(([emoji, senders]) => ({
      emoji,
      count: senders.size,
      reacted: Boolean(selfKey && senders.has(selfKey))
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || String(a.emoji).localeCompare(String(b.emoji)))
}

function renderReactionGlyph (emoji) {
  const token = String(emoji || '').trim()
  const custom = /^:([a-z0-9_-]+):$/i.exec(token)
  if (custom && state.activeRoom) {
    const src = state.roomEmojis.get(state.activeRoom)?.get(custom[1].toLowerCase())
    if (src) {
      return `<img src="${esc(src)}" alt="${esc(token)}" class="h-4 w-4 rounded">`
    }
  }
  return `<span class="leading-none">${esc(token)}</span>`
}

function renderReactionBar (msg) {
  if (!state.activeRoom || !msg?.id) return ''
  const entries = getMessageReactionEntries(state.activeRoom, msg.id)
  if (entries.length === 0) return ''

  const chips = entries.map((entry) => {
    const stateClasses = entry.reacted
      ? 'bg-quibble-blurple text-white border-quibble-blurple'
      : 'bg-quibble-serverbar text-quibble-text-s border-quibble-divider hover:bg-quibble-hover'

    return `
      <button class="reaction-chip inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${stateClasses}" data-reaction="${esc(entry.emoji)}">
        ${renderReactionGlyph(entry.emoji)}
        <span>${entry.count}</span>
      </button>
    `
  }).join('')

  return `<div class="flex flex-wrap gap-1 mt-1">${chips}</div>`
}

function toggleMessageReaction (msg, emoji) {
  if (!state.activeRoom || !msg?.id) return
  const normalized = normalizeReactionEmoji(emoji)
  if (!normalized) return

  send({
    type: 'toggle-message-reaction',
    roomKey: state.activeRoom,
    messageId: msg.id,
    emoji: normalized
  })
}

function openReactionPicker (anchor, msg) {
  if (!anchor || !msg?.id || !state.activeRoom) return
  closeReactionPicker()

  const panel = document.createElement('div')
  panel.className = 'fixed z-50 w-72 max-h-64 overflow-y-auto bg-quibble-serverbar border border-quibble-divider rounded-lg shadow-xl p-3'

  const systemEmojis = getSystemEmojiList()
  const custom = [...(state.roomEmojis.get(state.activeRoom) || new Map()).entries()]

  const customTitle = document.createElement('div')
  customTitle.className = 'text-xs uppercase tracking-wide text-quibble-text-m mb-2'
  customTitle.textContent = 'Server Emojis'
  panel.appendChild(customTitle)

  const customGrid = document.createElement('div')
  customGrid.className = 'grid grid-cols-8 gap-1.5'
  for (const [name, src] of custom) {
    const button = document.createElement('button')
    button.className = 'h-8 w-8 rounded hover:bg-quibble-hover flex items-center justify-center'
    button.dataset.emoji = `:${name}:`
    button.title = `:${name}:`
    button.innerHTML = `<img src="${esc(src)}" class="h-6 w-6 rounded" alt=":${esc(name)}:">`
    customGrid.appendChild(button)
  }
  panel.appendChild(customGrid)

  const divider = document.createElement('div')
  divider.className = 'border-b border-quibble-divider mt-2 mb-2'
  panel.appendChild(divider)

  const systemTitle = document.createElement('div')
  systemTitle.className = 'text-xs uppercase tracking-wide text-quibble-text-m mb-2'
  systemTitle.textContent = 'System Emojis'
  panel.appendChild(systemTitle)

  const systemGrid = document.createElement('div')
  systemGrid.className = 'grid grid-cols-8 gap-1.5'
  for (const emoji of systemEmojis) {
    const button = document.createElement('button')
    button.className = 'h-8 w-8 rounded hover:bg-quibble-hover text-xl leading-none'
    button.dataset.emoji = emoji
    button.textContent = emoji
    systemGrid.appendChild(button)
  }
  panel.appendChild(systemGrid)

  document.body.appendChild(panel)
  activeReactionPicker = panel

  panel.querySelectorAll('[data-emoji]').forEach((button) => {
    button.addEventListener('click', () => {
      toggleMessageReaction(msg, button.dataset.emoji)
      closeReactionPicker()
    })
  })

  const anchorRect = anchor.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const viewportPadding = 8

  let left = anchorRect.right - panelRect.width
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - panelRect.width - viewportPadding))

  let top = anchorRect.top - panelRect.height - 8
  if (top < viewportPadding) {
    top = Math.min(window.innerHeight - panelRect.height - viewportPadding, anchorRect.bottom + 8)
  }

  panel.style.left = `${left}px`
  panel.style.top = `${top}px`

  requestAnimationFrame(() => {
    document.addEventListener('mousedown', handleReactionPickerOutsideClick, true)
  })
}

function wireMessageReactionControls (container, msg) {
  container.querySelectorAll('.reaction-add-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      openReactionPicker(button, msg)
    })
  })

  container.querySelectorAll('.reaction-chip').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      toggleMessageReaction(msg, button.dataset.reaction)
    })
  })
}

function pickDefaultRoomEmoji (seed = '') {
  const source = String(seed || '')
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  }
  return ROOM_ICON_FALLBACKS[hash % ROOM_ICON_FALLBACKS.length]
}

function addRoom (keyHex, link, opts = {}) {
  const writable = typeof opts.writable === 'boolean' ? opts.writable : true

  if (state.rooms.has(keyHex)) {
    const room = state.rooms.get(keyHex)
    if (link) room.link = link
    if (typeof opts.writable === 'boolean') room.writable = opts.writable
    renderServerList()
    if (state.activeRoom === keyHex) updateComposerAccess()
    return
  }

  const roomName = `Room ${state.rooms.size + 1}`
  state.rooms.set(keyHex, {
    link,
    name: roomName,
    iconEmoji: pickDefaultRoomEmoji(keyHex),
    iconImage: null,
    writable
  })
  state.messagesByRoom.set(keyHex, state.messagesByRoom.get(keyHex) || [])
  state.seenSeqByRoom.set(keyHex, state.seenSeqByRoom.get(keyHex) || new Set())
  state.historyCursorByRoom.set(keyHex, state.historyCursorByRoom.has(keyHex) ? state.historyCursorByRoom.get(keyHex) : null)
  state.historyLoadingByRoom.set(keyHex, false)
  state.roomBansByRoom.set(keyHex, state.roomBansByRoom.get(keyHex) || new Map())
  state.channelKicksByRoom.set(keyHex, state.channelKicksByRoom.get(keyHex) || new Map())
  state.roomEmojis.set(keyHex, state.roomEmojis.get(keyHex) || new Map())
  state.messageReactionsByRoom.set(keyHex, state.messageReactionsByRoom.get(keyHex) || new Map())
  state.roomAdmins.set(keyHex, state.roomAdmins.get(keyHex) || new Set([state.identity?.publicKey].filter(Boolean)))
  state.roomOwnerByRoom.set(keyHex, state.roomOwnerByRoom.get(keyHex) || state.identity?.publicKey || null)

  if (!state.channelsByRoom.has(keyHex)) {
    state.channelsByRoom.set(keyHex, {
      text: [{ id: 'general', name: 'general' }],
      voice: [{ id: 'voice-general', name: 'General' }]
    })
  }

  if (!state.activeTextChannelByRoom.has(keyHex)) state.activeTextChannelByRoom.set(keyHex, 'general')
  if (!state.activeVoiceChannelByRoom.has(keyHex)) state.activeVoiceChannelByRoom.set(keyHex, 'voice-general')

  renderServerList()
}

function removeRoomLocal (roomKey, { navigateHome = false } = {}) {
  state.rooms.delete(roomKey)
  state.messagesByRoom.delete(roomKey)
  state.seenSeqByRoom.delete(roomKey)
  state.historyCursorByRoom.delete(roomKey)
  state.historyLoadingByRoom.delete(roomKey)
  state.roomEmojis.delete(roomKey)
  state.messageReactionsByRoom.delete(roomKey)
  state.roomAdmins.delete(roomKey)
  state.roomOwnerByRoom.delete(roomKey)
  state.roomBansByRoom.delete(roomKey)
  state.channelKicksByRoom.delete(roomKey)
  state.channelKicksByRoom.delete(`${roomKey}::room`)
  state.channelsByRoom.delete(roomKey)
  state.activeTextChannelByRoom.delete(roomKey)
  state.activeVoiceChannelByRoom.delete(roomKey)
  state.usernameConflictByRoom.delete(roomKey)

  if (navigateHome) {
    dom.btnHome.click()
  }

  renderServerList()
}

function handleRoomDisband (roomKey, msg) {
  const by = msg?.senderName || 'The owner'
  if (state.activeRoom === roomKey) {
    appAlert(`${by} disbanded this group.`, { title: 'Group disbanded' })
  }
  removeRoomLocal(roomKey, { navigateHome: state.activeRoom === roomKey })
}

function selectRoom (keyHex) {
  state.activeRoom = keyHex
  state.activeDmKey = null
  state.activeSearchChannelId = null
  const room = state.rooms.get(keyHex)
  if (!room) return

  dom.roomTitle.textContent = room.name
  dom.noRoomSelected.classList.add('hidden')
  dom.channelItems.classList.remove('hidden')
  dom.btnInvite.classList.remove('hidden')

  dom.welcomeState.classList.add('hidden')
  dom.chatArea.classList.remove('hidden')

  const textId = state.activeTextChannelByRoom.get(keyHex) || 'general'
  const channel = getChannelById(keyHex, 'text', textId)
  dom.chatHeaderTitle.textContent = channel?.name || 'general'
  dom.chatHeaderDesc.textContent = textId === 'general'
    ? `${room.name} channel`
    : `#${channel?.name || 'general'}`
  dom.messageInput.placeholder = `Message #${channel?.name || 'general'}`
  clearSearchResultsView({ clearInput: true })

  if (state.membersVisible) dom.membersSidebar.classList.remove('hidden')

  updateAdminControls()
  renderChannelLists()
  renderMessages()
  renderPinnedBar()
  renderThreadPanel()
  renderCallEventFeed()
  renderServerList()
  renderEmojiPicker()
  renderAdminPanel()
  renderFriendsHome()
  updateMemberList()
  updateSecurityStatus()
  updateHeaderActionVisibility()
  scrollToBottom()
  clearUnread(keyHex)
  ensureUsernameUniquenessForRoom(keyHex)
}

function renderServerList () {
  dom.serverList.innerHTML = ''

  for (const [keyHex, room] of state.rooms) {
    const initial = (room.name || 'R').charAt(0).toUpperCase()
    const iconEmoji = room.iconEmoji || pickDefaultRoomEmoji(keyHex)
    const iconMarkup = room.iconImage
      ? `<img src="${room.iconImage}" class="w-10 h-10 rounded-[35%] object-cover" alt="${esc(room.name || 'Room icon')}">`
      : `<span class="text-xl leading-none">${esc(iconEmoji || initial)}</span>`
    const isActive = state.activeRoom === keyHex

    const div = document.createElement('div')
    div.className = 'relative group'
    div.dataset.roomKey = keyHex
    div.innerHTML = `
      <div class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-1 rounded-r-full server-pill transition-all ${isActive ? 'h-10 bg-white' : 'h-5 bg-white opacity-0 group-hover:opacity-100'}"></div>
      <button class="server-icon w-12 h-12 ${isActive ? 'rounded-[35%] bg-quibble-blurple' : 'rounded-[50%] bg-quibble-bg hover:bg-quibble-blurple'} flex items-center justify-center transition-all text-white font-semibold overflow-hidden" title="${esc(room.name)}">${iconMarkup}</button>
      <div class="unread-dot absolute top-0 right-0 w-2 h-2 bg-white rounded-full hidden"></div>
    `

    div.querySelector('button').addEventListener('click', () => selectRoom(keyHex))
    dom.serverList.appendChild(div)
  }
}

function markUnread (roomKey) {
  const row = [...dom.serverList.children].find((n) => n.dataset.roomKey === roomKey)
  const dot = row?.querySelector('.unread-dot')
  if (dot) dot.classList.remove('hidden')
}

function clearUnread (roomKey) {
  const row = [...dom.serverList.children].find((n) => n.dataset.roomKey === roomKey)
  const dot = row?.querySelector('.unread-dot')
  if (dot) dot.classList.add('hidden')
}

function renderMessages () {
  closeReactionPicker()
  updateRoomWelcomeBanner()
  dom.messages.innerHTML = ''
  const msgs = getVisibleMessagesForActiveTextChannel()
  let lastGroupableSender = null
  let lastGroupableTs = 0

  for (const msg of msgs) {
    const el = createMessageEl(msg, lastGroupableSender, lastGroupableTs)
    if (el) dom.messages.appendChild(el)
    if (isGroupableMessage(msg)) {
      lastGroupableSender = msg.sender
      lastGroupableTs = msg.timestamp
    }
  }

  renderThreadPanel()
}

function updateRoomWelcomeBanner () {
  if (!dom.roomWelcomeTitle || !dom.roomWelcomeDesc) return

  if (!state.activeRoom) {
    dom.roomWelcomeTitle.textContent = 'Welcome to #general'
    dom.roomWelcomeDesc.textContent = 'This is the start of the room. Share the invite link to let others join.'
    return
  }

  const channelId = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  const channel = getChannelById(state.activeRoom, 'text', channelId)
  const channelName = String(channel?.name || 'general')

  dom.roomWelcomeTitle.textContent = `Welcome to #${channelName}`
  dom.roomWelcomeDesc.textContent = channelId === 'general'
    ? 'This is the start of the room. Share the invite link to let others join.'
    : `This is the start of #${channelName}.`
}

function appendMessage (msg) {
  if (state.searchResultsActive) return
  const activeText = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  if (!messageBelongsToTextChannel(msg, activeText)) return
  if (state.activeDmKey && msg.dmKey !== state.activeDmKey) return
  if (!state.activeDmKey && msg.dmKey) return
  if (msg.threadRootId) return

  const visible = getVisibleMessagesForActiveTextChannel()
  const prev = getPreviousGroupableMessage(visible, visible.length - 2)
  const el = createMessageEl(msg, prev?.sender, prev?.timestamp)
  if (el) dom.messages.appendChild(el)
}

function isGroupableMessage (msg) {
  return msg?.type === 'text' || msg?.type === 'file'
}

function getPreviousGroupableMessage (messages, startIndex) {
  for (let index = startIndex; index >= 0; index--) {
    const candidate = messages[index]
    if (isGroupableMessage(candidate)) return candidate
  }
  return null
}

function createMessageEl (msg, lastSender, lastTime) {
  if (msg.type === 'system') return createSystemMessageEl(msg)
  if (msg.type === 'file') return createFileMessageEl(msg, lastSender, lastTime)
  if (msg.type === 'voice') return createVoiceMessageEl(msg)
  if (msg.type === 'text') return createTextMessageEl(msg, lastSender, lastTime)
  return null
}

function getSenderAvatarMarkup (msg) {
  const isSelf = msg.sender === state.identity?.publicKey
  const avatar = msg.senderAvatar || (isSelf ? state.profile.avatar : null)
  return avatar
    ? `<img src="${avatar}" class="w-full h-full object-cover">`
    : getDefaultAvatar(msg.senderName)
}

function createSystemMessageEl (msg) {
  if (msg.action === 'call-signal' || msg.action === 'call-start' || msg.action === 'call-join' || msg.action === 'call-end') return null
  if (msg.action === 'message-edit') return null
  if (msg.action === 'presence-set') return null

  const div = document.createElement('div')
  div.className = 'flex items-center gap-2 px-1 py-1 text-xs text-quibble-text-m fade-in'

  let text = ''
  if (msg.action === 'join') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> joined the room`
  else if (msg.action === 'leave') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> left the room`
  else if (msg.action === 'custom-emoji-add') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> added emoji :${esc(msg.data?.name || 'emoji')}:`
  else if (msg.action === 'custom-emoji-remove') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> removed emoji :${esc(msg.data?.name || 'emoji')}:`
  else if (msg.action === 'room-admin-set') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> updated server admins`
  else if (msg.action === 'room-owner-set') {
    if (msg.data?.initial) return null
    text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> transferred server ownership`
  }
  else if (msg.action === 'room-name-set') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> renamed the server to <span class="font-medium text-quibble-text">${esc(msg.data?.name || 'Untitled')}</span>`
  else if (msg.action === 'room-profile-set') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> updated the server profile icon`
  else if (msg.action === 'room-disband') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> disbanded the group`
  else if (msg.action === 'message-pin') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> pinned a message`
  else if (msg.action === 'message-unpin') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> unpinned a message`
  else if (msg.action === 'friend-request') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> sent a friend request`
  else if (msg.action === 'friend-accept') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> accepted a friend request`
  else if (msg.action === 'room-kick') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> kicked <span class="font-medium text-quibble-text">${esc(msg.data?.targetName || 'a user')}</span> from the server`
  else if (msg.action === 'room-unkick') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> restored <span class="font-medium text-quibble-text">${esc(msg.data?.targetName || 'a user')}</span> to the server`
  else if (msg.action === 'channel-add') text = `<span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> created ${esc(msg.data?.kind || 'text')} channel ${esc(msg.data?.name || '')}`
  else return null

  const avatar = getSenderAvatarMarkup(msg)
  div.innerHTML = `
    <div class="w-5 h-5 rounded-full bg-quibble-blurple flex items-center justify-center text-[10px] font-bold overflow-hidden">${avatar}</div>
    <span>${text}</span>
    <span class="ml-auto">${formatTime(msg.timestamp)}</span>
  `
  return div
}

function createVoiceMessageEl (msg) {
  const div = document.createElement('div')
  div.className = 'flex items-center gap-2 px-1 py-1 text-xs text-quibble-text-m fade-in'
  if (msg.action === 'offer') {
    div.innerHTML = `<span>🎤</span><span><span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> started legacy voice</span><span class="ml-auto">${formatTime(msg.timestamp)}</span>`
  } else if (msg.action === 'answer') {
    div.innerHTML = `<span>🟢</span><span><span class="font-medium text-quibble-text">${esc(msg.senderName || 'Someone')}</span> joined legacy voice</span><span class="ml-auto">${formatTime(msg.timestamp)}</span>`
  } else {
    div.innerHTML = `<span>🔇</span><span>Legacy voice ended</span><span class="ml-auto">${formatTime(msg.timestamp)}</span>`
  }
  return div
}

function createFileMessageEl (msg, lastSender, lastTime) {
  const grouped = msg.sender === lastSender && (msg.timestamp - lastTime) < 420000
  const wrapper = document.createElement('div')
  const reactionBar = renderReactionBar(msg)

  const fileCard = `
    <div class="bg-quibble-serverbar rounded-md px-3 py-2 mt-1 max-w-full">
      <div class="inline-flex items-center gap-3 max-w-full">
        <span class="text-xl">📎</span>
        <div class="min-w-0">
          <div class="text-sm text-quibble-text truncate">${esc(msg.filename || 'file')}</div>
          <div class="text-xs text-quibble-text-m">${formatBytes(msg.size || 0)}</div>
        </div>
        <button class="download-btn ml-2 px-2 py-1 rounded bg-quibble-blurple text-white text-xs" data-core="${esc(msg.coreKey)}" data-name="${esc(msg.filename || 'download.bin')}" data-mime="${esc(msg.mimeType || 'application/octet-stream')}">Download</button>
        <button class="pin-btn px-2 py-1 rounded bg-quibble-active text-quibble-text text-xs" data-id="${esc(msg.id || '')}">Pin</button>
        <button class="thread-btn px-2 py-1 rounded bg-quibble-active text-quibble-text text-xs" data-id="${esc(msg.id || '')}">Thread</button>
        <button class="reaction-add-btn px-2 py-1 rounded bg-quibble-active text-quibble-text text-xs" data-id="${esc(msg.id || '')}">React</button>
      </div>
      ${reactionBar}
    </div>
  `

  if (grouped) {
    wrapper.className = 'flex pl-[72px] pr-4 py-0.5 msg-hover relative group fade-in'
    wrapper.innerHTML = `<div class="min-w-0 flex-1">${fileCard}</div>`
  } else {
    const avatar = getSenderAvatarMarkup(msg)

    wrapper.className = 'flex gap-4 px-4 pt-4 pb-0.5 msg-hover fade-in'
    wrapper.innerHTML = `
      <div class="w-10 h-10 rounded-full bg-quibble-blurple flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden mt-0.5">${avatar}</div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="font-medium text-sm" style="color:${getNameColor(msg.sender)}">${esc(msg.senderName || 'Unknown')}</span>
          <span class="text-[11px] text-quibble-text-m">${formatDate(msg.timestamp)}</span>
        </div>
        ${fileCard}
      </div>
    `
  }

  wrapper.querySelector('.download-btn')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget
    send({
      type: 'download-file',
      roomKey: state.activeRoom,
      coreKey: btn.dataset.core,
      fileName: btn.dataset.name,
      mimeType: btn.dataset.mime
    })
  })

  wrapper.querySelector('.pin-btn')?.addEventListener('click', (ev) => {
    const id = ev.currentTarget.dataset.id
    if (!id || !state.activeRoom) return
    send({ type: 'pin-message', roomKey: state.activeRoom, channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general', messageId: id })
  })

  wrapper.querySelector('.thread-btn')?.addEventListener('click', (ev) => {
    const id = ev.currentTarget.dataset.id
    if (!id) return
    openThreadPanel(id)
  })

  wireMessageReactionControls(wrapper, msg)

  return wrapper
}

function createTextMessageEl (msg, lastSender, lastTime) {
  const grouped = msg.sender === lastSender && (msg.timestamp - lastTime) < 420000
  const div = document.createElement('div')
  const reactionBar = renderReactionBar(msg)
  const previews = renderUrlPreviews(msg)
  const canEdit = msg.sender === state.identity?.publicKey
  const isEditing = canEdit && msg.id && msg.id === inlineEditMessageId
  const editedBadge = msg.editedAt ? '<span class="ml-1 text-[11px] text-quibble-text-m">(edited)</span>' : ''
  const editValue = esc(inlineEditDraft || msg.text || '')
  const editField = `
    <div class="mt-1" style="width:min(920px, calc(100vw - 220px)); max-width:100%;">
      <input
        type="text"
        data-inline-edit-input="${esc(msg.id || '')}"
        value="${editValue}"
        placeholder="Edit message"
        class="w-full bg-quibble-serverbar rounded px-2 py-1 text-sm text-quibble-text font-mono focus:outline-none focus:ring-2 focus:ring-quibble-blurple"
        style="white-space: nowrap; overflow-x: auto; overflow-y: hidden;"
      >
      <div class="flex gap-1 mt-1">
        <button class="save-edit-btn px-2 py-0.5 rounded bg-quibble-blurple text-white text-[11px]">Save</button>
        <button class="cancel-edit-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Cancel</button>
      </div>
    </div>
  `

  if (grouped) {
    div.className = 'flex pl-[72px] pr-4 py-0.5 msg-hover relative group fade-in'
    div.innerHTML = `
      <span class="absolute left-4 top-1 text-[10px] text-quibble-text-m opacity-0 group-hover:opacity-100 w-[44px] text-right">${formatTimeShort(msg.timestamp)}</span>
      <div class="min-w-0 flex-1">
        ${isEditing ? editField : `<div class="text-sm text-quibble-text-s leading-relaxed break-words">${formatContent(msg.text)}${editedBadge}</div>`}
        ${isEditing ? '' : previews}
        ${isEditing ? '' : reactionBar}
      </div>
      <div class="${isEditing ? 'hidden' : 'opacity-0 group-hover:opacity-100'} flex gap-1 ml-2">
        ${canEdit ? '<button class="edit-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Edit</button>' : ''}
        <button class="pin-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Pin</button>
        <button class="thread-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Thread</button>
        <button class="reaction-add-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">React</button>
      </div>
    `
    div.querySelector('.edit-btn')?.addEventListener('click', () => beginInlineEdit(msg))
    wireInlineEditEvents(div, msg)
    div.querySelector('.pin-btn')?.addEventListener('click', () => {
      if (!msg.id || !state.activeRoom) return
      send({ type: 'pin-message', roomKey: state.activeRoom, channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general', messageId: msg.id })
    })
    div.querySelector('.thread-btn')?.addEventListener('click', () => openThreadPanel(msg.id))
    wireMessageReactionControls(div, msg)
    return div
  }

  const avatar = getSenderAvatarMarkup(msg)

  div.className = 'flex gap-4 px-4 pt-4 pb-0.5 msg-hover fade-in'
  div.innerHTML = `
    <div class="w-10 h-10 rounded-full bg-quibble-blurple flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden mt-0.5">${avatar}</div>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="font-medium text-sm" style="color:${getNameColor(msg.sender)}">${esc(msg.senderName || 'Unknown')}</span>
        <span class="text-[11px] text-quibble-text-m">${formatDate(msg.timestamp)}</span>
      </div>
      ${isEditing ? editField : `<div class="text-sm text-quibble-text-s leading-relaxed break-words">${formatContent(msg.text)}${editedBadge}</div>`}
      ${isEditing ? '' : previews}
      ${isEditing ? '' : reactionBar}
      <div class="${isEditing ? 'hidden' : 'flex'} gap-1 mt-1">
        ${canEdit ? '<button class="edit-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Edit</button>' : ''}
        <button class="pin-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Pin</button>
        <button class="thread-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">Thread</button>
        <button class="reaction-add-btn px-2 py-0.5 rounded bg-quibble-active text-[11px]">React</button>
      </div>
    </div>
  `

  div.querySelector('.edit-btn')?.addEventListener('click', () => beginInlineEdit(msg))
  wireInlineEditEvents(div, msg)
  div.querySelector('.pin-btn')?.addEventListener('click', () => {
    if (!msg.id || !state.activeRoom) return
    send({ type: 'pin-message', roomKey: state.activeRoom, channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general', messageId: msg.id })
  })
  div.querySelector('.thread-btn')?.addEventListener('click', () => openThreadPanel(msg.id))
  wireMessageReactionControls(div, msg)

  return div
}

function wireInlineEditEvents (container, msg) {
  const input = container.querySelector(`[data-inline-edit-input="${esc(msg.id || '')}"]`)
  if (!input) return

  const save = () => submitInlineEdit(msg, input.value)

  input.addEventListener('input', () => {
    inlineEditDraft = input.value
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelInlineEdit()
    }
  })

  container.querySelector('.save-edit-btn')?.addEventListener('click', save)
  container.querySelector('.cancel-edit-btn')?.addEventListener('click', cancelInlineEdit)
}

function beginInlineEdit (msg) {
  if (!msg?.id) return
  inlineEditMessageId = msg.id
  inlineEditDraft = String(msg.text || '')
  renderMessages()

  requestAnimationFrame(() => {
    const safeId = CSS?.escape ? CSS.escape(String(msg.id)) : String(msg.id)
    const input = document.querySelector(`[data-inline-edit-input="${safeId}"]`)
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  })
}

function cancelInlineEdit () {
  inlineEditMessageId = null
  inlineEditDraft = ''
  renderMessages()
}

function submitInlineEdit (msg, nextValue) {
  if (!msg?.id || !state.activeRoom) return
  const current = String(msg.text || '')
  const text = String(nextValue || '').trim()
  if (!text || text === current) return

  inlineEditMessageId = null
  inlineEditDraft = ''
  renderMessages()

  send({
    type: 'edit-message',
    roomKey: state.activeRoom,
    channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general',
    messageId: msg.id,
    text
  })
}

// Message input / files / emoji

dom.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

function updateMessageInputSize () {
  if (!dom.messageInput) return
  const minHeight = 48
  const maxHeight = 192

  dom.messageInput.style.height = `${minHeight}px`
  const nextHeight = Math.min(dom.messageInput.scrollHeight, maxHeight)
  dom.messageInput.style.height = `${nextHeight}px`
  dom.messageInput.style.overflowY = dom.messageInput.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

dom.messageInput.addEventListener('input', () => {
  updateMessageInputSize()
})

function scheduleMessageInputSizeSync () {
  requestAnimationFrame(() => updateMessageInputSize())
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    scheduleMessageInputSizeSync()
  }, { once: true })
} else {
  scheduleMessageInputSizeSync()
}

window.addEventListener('load', () => {
  scheduleMessageInputSizeSync()
}, { once: true })

document.fonts?.ready
  ?.then(() => {
    scheduleMessageInputSizeSync()
  })
  .catch(() => {})

dom.messagesScroll?.addEventListener('scroll', () => {
  if (!state.activeRoom) return
  if (dom.messagesScroll.scrollTop > 120) return

  const cursor = state.historyCursorByRoom.get(state.activeRoom)
  if (cursor == null) return

  requestRoomHistory(state.activeRoom, { count: 100, beforeSeq: cursor })
})

function sendMessage () {
  const text = dom.messageInput.value.trim()
  if (!text || !state.activeRoom) return
  const room = state.rooms.get(state.activeRoom)
  if (room?.writable === false) {
    appAlert('This room is read-only for this identity. Ask an existing writer to grant write access first.', { title: 'Read-only room' })
    return
  }

  const dmParticipants = getActiveDmParticipants()

  send({
    type: 'send-message',
    roomKey: state.activeRoom,
    channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general',
    text,
    dmKey: state.activeDmKey,
    dmParticipants
  })

  dom.messageInput.value = ''
  updateMessageInputSize()
}

dom.btnAttachFile.addEventListener('click', () => dom.fileInput.click())
dom.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file || !state.activeRoom) return

  const dataBase64 = await fileToBase64(file)
  const dmParticipants = getActiveDmParticipants()
  send({
    type: 'upload-file',
    roomKey: state.activeRoom,
    channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general',
    dmKey: state.activeDmKey,
    dmParticipants,
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    dataBase64
  })

  dom.fileInput.value = ''
})

dom.btnEmoji.addEventListener('click', () => {
  dom.emojiPicker.classList.toggle('hidden')
  renderEmojiPicker()
})

function rebuildRoomEmojiMap (roomKey) {
  const map = new Map()
  const msgs = state.messagesByRoom.get(roomKey) || []

  for (const m of msgs) {
    if (m?.type === 'system' && m?.action === 'custom-emoji-add' && m?.data?.name && m?.data?.imageData) {
      map.set(String(m.data.name).toLowerCase(), m.data.imageData)
    }
    if (m?.type === 'system' && m?.action === 'custom-emoji-remove' && m?.data?.name) {
      map.delete(String(m.data.name).toLowerCase())
    }
  }

  state.roomEmojis.set(roomKey, map)
}

let cachedSystemEmojiList = null
function getSystemEmojiList () {
  if (Array.isArray(cachedSystemEmojiList) && cachedSystemEmojiList.length > 0) return cachedSystemEmojiList

  const list = [...UNICODE_EMOJIS]
  const seen = new Set(list)
  const pushUnique = (emoji) => {
    if (!emoji || seen.has(emoji)) return
    seen.add(emoji)
    list.push(emoji)
  }

  const ranges = [
    [0x2600, 0x27BF],
    [0x1F000, 0x1FAFF]
  ]

  for (const [start, end] of ranges) {
    for (let codePoint = start; codePoint <= end; codePoint++) {
      const emoji = String.fromCodePoint(codePoint)
      if (/\p{Emoji_Presentation}/u.test(emoji)) {
        pushUnique(emoji)
      }
    }
  }

  cachedSystemEmojiList = list
  return cachedSystemEmojiList
}

function renderEmojiPicker () {
  if (!dom.emojiGrid || !dom.customEmojiGrid) return

  dom.customEmojiGrid.innerHTML = ''
  const custom = state.roomEmojis.get(state.activeRoom) || new Map()
  for (const [name, src] of custom) {
    const b = document.createElement('button')
    b.className = 'h-8 w-8 rounded hover:bg-quibble-hover flex items-center justify-center'
    b.title = `:${name}:`
    b.innerHTML = `<img src="${src}" class="h-6 w-6 rounded" alt=":${name}:">`
    b.addEventListener('click', () => insertAtCursor(dom.messageInput, `:${name}:`))
    dom.customEmojiGrid.appendChild(b)
  }

  dom.emojiGrid.innerHTML = ''
  const allSystemEmojis = getSystemEmojiList()
  const fragment = document.createDocumentFragment()
  for (const emoji of allSystemEmojis) {
    const b = document.createElement('button')
    b.className = 'h-8 w-8 rounded hover:bg-quibble-hover text-xl leading-none'
    b.textContent = emoji
    b.addEventListener('click', () => insertAtCursor(dom.messageInput, emoji))
    fragment.appendChild(b)
  }
  dom.emojiGrid.appendChild(fragment)
}

// Admin

