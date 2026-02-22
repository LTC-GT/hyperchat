const ROOM_ICON_FALLBACKS = ['😀', '😎', '🚀', '🎯', '🎮', '🧠', '🛸', '🐳', '🦄', '🌈', '⚡', '🔥', '🫧', '🍀', '🐙', '🦊', '🌙', '⭐']

function pickDefaultRoomEmoji (seed = '') {
  const source = String(seed || '')
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  }
  return ROOM_ICON_FALLBACKS[hash % ROOM_ICON_FALLBACKS.length]
}

function addRoom (keyHex, link) {
  if (state.rooms.has(keyHex)) return

  const roomName = `Room ${state.rooms.size + 1}`
  state.rooms.set(keyHex, {
    link,
    name: roomName,
    iconEmoji: pickDefaultRoomEmoji(keyHex),
    iconImage: null
  })
  state.messagesByRoom.set(keyHex, state.messagesByRoom.get(keyHex) || [])
  state.seenSeqByRoom.set(keyHex, state.seenSeqByRoom.get(keyHex) || new Set())
  state.historyCursorByRoom.set(keyHex, state.historyCursorByRoom.has(keyHex) ? state.historyCursorByRoom.get(keyHex) : null)
  state.historyLoadingByRoom.set(keyHex, false)
  state.roomBansByRoom.set(keyHex, state.roomBansByRoom.get(keyHex) || new Map())
  state.channelKicksByRoom.set(keyHex, state.channelKicksByRoom.get(keyHex) || new Map())
  state.roomEmojis.set(keyHex, state.roomEmojis.get(keyHex) || new Map())
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
  dom.chatHeaderDesc.textContent = `${room.name} channel`
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
      <button class="server-icon w-12 h-12 ${isActive ? 'rounded-[35%] bg-discord-blurple' : 'rounded-[50%] bg-discord-bg hover:bg-discord-blurple'} flex items-center justify-center transition-all text-white font-semibold overflow-hidden" title="${esc(room.name)}">${iconMarkup}</button>
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
  dom.messages.innerHTML = ''
  const msgs = getVisibleMessagesForActiveTextChannel()
  let lastSender = null
  let lastTs = 0

  for (const msg of msgs) {
    const el = createMessageEl(msg, lastSender, lastTs)
    if (el) dom.messages.appendChild(el)
    lastSender = msg.sender
    lastTs = msg.timestamp
  }

  renderThreadPanel()
}

function appendMessage (msg) {
  if (state.searchResultsActive) return
  const activeText = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  if (!messageBelongsToTextChannel(msg, activeText)) return
  if (state.activeDmKey && msg.dmKey !== state.activeDmKey) return
  if (!state.activeDmKey && msg.dmKey) return
  if (msg.threadRootId) return

  const visible = getVisibleMessagesForActiveTextChannel()
  const prev = visible.length >= 2 ? visible[visible.length - 2] : null
  const el = createMessageEl(msg, prev?.sender, prev?.timestamp)
  if (el) dom.messages.appendChild(el)
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

  const div = document.createElement('div')
  div.className = 'flex items-center gap-2 px-1 py-1 text-xs text-discord-text-m fade-in'

  let text = ''
  if (msg.action === 'join') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> joined the room`
  else if (msg.action === 'leave') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> left the room`
  else if (msg.action === 'custom-emoji-add') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> added emoji :${esc(msg.data?.name || 'emoji')}:`
  else if (msg.action === 'custom-emoji-remove') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> removed emoji :${esc(msg.data?.name || 'emoji')}:`
  else if (msg.action === 'room-admin-set') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> updated server admins`
  else if (msg.action === 'room-owner-set') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> transferred server ownership`
  else if (msg.action === 'room-name-set') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> renamed the server to <span class="font-medium text-discord-text">${esc(msg.data?.name || 'Untitled')}</span>`
  else if (msg.action === 'room-profile-set') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> updated the server profile icon`
  else if (msg.action === 'room-disband') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> disbanded the group`
  else if (msg.action === 'message-pin') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> pinned a message`
  else if (msg.action === 'message-unpin') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> unpinned a message`
  else if (msg.action === 'friend-request') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> sent a friend request`
  else if (msg.action === 'friend-accept') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> accepted a friend request`
  else if (msg.action === 'room-kick') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> kicked <span class="font-medium text-discord-text">${esc(msg.data?.targetName || 'a user')}</span> from the server`
  else if (msg.action === 'room-unkick') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> restored <span class="font-medium text-discord-text">${esc(msg.data?.targetName || 'a user')}</span> to the server`
  else if (msg.action === 'channel-add') text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> created ${esc(msg.data?.kind || 'text')} channel ${esc(msg.data?.name || '')}`
  else text = `<span class="font-medium text-discord-text">${esc(msg.senderName || 'System')}</span>: ${esc(msg.action || 'event')}`

  const avatar = getSenderAvatarMarkup(msg)
  div.innerHTML = `
    <div class="w-5 h-5 rounded-full bg-discord-blurple flex items-center justify-center text-[10px] font-bold overflow-hidden">${avatar}</div>
    <span>${text}</span>
    <span class="ml-auto">${formatTime(msg.timestamp)}</span>
  `
  return div
}

function createVoiceMessageEl (msg) {
  const div = document.createElement('div')
  div.className = 'flex items-center gap-2 px-1 py-1 text-xs text-discord-text-m fade-in'
  if (msg.action === 'offer') {
    div.innerHTML = `<span>🎤</span><span><span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> started legacy voice</span><span class="ml-auto">${formatTime(msg.timestamp)}</span>`
  } else if (msg.action === 'answer') {
    div.innerHTML = `<span>🟢</span><span><span class="font-medium text-discord-text">${esc(msg.senderName || 'Someone')}</span> joined legacy voice</span><span class="ml-auto">${formatTime(msg.timestamp)}</span>`
  } else {
    div.innerHTML = `<span>🔇</span><span>Legacy voice ended</span><span class="ml-auto">${formatTime(msg.timestamp)}</span>`
  }
  return div
}

function createFileMessageEl (msg, lastSender, lastTime) {
  const grouped = msg.sender === lastSender && (msg.timestamp - lastTime) < 420000
  const wrapper = document.createElement('div')

  const fileCard = `
    <div class="bg-discord-serverbar rounded-md px-3 py-2 mt-1 inline-flex items-center gap-3 max-w-full">
      <span class="text-xl">📎</span>
      <div class="min-w-0">
        <div class="text-sm text-discord-text truncate">${esc(msg.filename || 'file')}</div>
        <div class="text-xs text-discord-text-m">${formatBytes(msg.size || 0)}</div>
      </div>
      <button class="download-btn ml-2 px-2 py-1 rounded bg-discord-blurple text-white text-xs" data-core="${esc(msg.coreKey)}" data-name="${esc(msg.filename || 'download.bin')}" data-mime="${esc(msg.mimeType || 'application/octet-stream')}">Download</button>
      <button class="pin-btn px-2 py-1 rounded bg-discord-active text-discord-text text-xs" data-id="${esc(msg.id || '')}">Pin</button>
      <button class="thread-btn px-2 py-1 rounded bg-discord-active text-discord-text text-xs" data-id="${esc(msg.id || '')}">Thread</button>
    </div>
  `

  if (grouped) {
    wrapper.className = 'flex pl-[72px] pr-4 py-0.5 msg-hover relative group fade-in'
    wrapper.innerHTML = `<div class="min-w-0 flex-1">${fileCard}</div>`
  } else {
    const avatar = getSenderAvatarMarkup(msg)

    wrapper.className = 'flex gap-4 px-4 pt-4 pb-0.5 msg-hover fade-in'
    wrapper.innerHTML = `
      <div class="w-10 h-10 rounded-full bg-discord-blurple flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden mt-0.5">${avatar}</div>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="font-medium text-sm" style="color:${getNameColor(msg.sender)}">${esc(msg.senderName || 'Unknown')}</span>
          <span class="text-[11px] text-discord-text-m">${formatDate(msg.timestamp)}</span>
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

  return wrapper
}

function createTextMessageEl (msg, lastSender, lastTime) {
  const grouped = msg.sender === lastSender && (msg.timestamp - lastTime) < 420000
  const div = document.createElement('div')
  const previews = renderUrlPreviews(msg)
  const canEdit = msg.sender === state.identity?.publicKey
  const editedBadge = msg.editedAt ? '<span class="ml-1 text-[11px] text-discord-text-m">(edited)</span>' : ''

  if (grouped) {
    div.className = 'flex pl-[72px] pr-4 py-0.5 msg-hover relative group fade-in'
    div.innerHTML = `
      <span class="absolute left-4 top-1 text-[10px] text-discord-text-m opacity-0 group-hover:opacity-100 w-[44px] text-right">${formatTimeShort(msg.timestamp)}</span>
      <div class="min-w-0 flex-1">
        <div class="text-sm text-discord-text-s leading-relaxed break-words">${formatContent(msg.text)}${editedBadge}</div>
        ${previews}
      </div>
      <div class="opacity-0 group-hover:opacity-100 flex gap-1 ml-2">
        ${canEdit ? '<button class="edit-btn px-2 py-0.5 rounded bg-discord-active text-[11px]">Edit</button>' : ''}
        <button class="pin-btn px-2 py-0.5 rounded bg-discord-active text-[11px]">Pin</button>
        <button class="thread-btn px-2 py-0.5 rounded bg-discord-active text-[11px]">Thread</button>
      </div>
    `
    div.querySelector('.edit-btn')?.addEventListener('click', () => editMessagePrompt(msg))
    div.querySelector('.pin-btn')?.addEventListener('click', () => {
      if (!msg.id || !state.activeRoom) return
      send({ type: 'pin-message', roomKey: state.activeRoom, channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general', messageId: msg.id })
    })
    div.querySelector('.thread-btn')?.addEventListener('click', () => openThreadPanel(msg.id))
    return div
  }

  const avatar = getSenderAvatarMarkup(msg)

  div.className = 'flex gap-4 px-4 pt-4 pb-0.5 msg-hover fade-in'
  div.innerHTML = `
    <div class="w-10 h-10 rounded-full bg-discord-blurple flex items-center justify-center text-sm font-bold flex-shrink-0 overflow-hidden mt-0.5">${avatar}</div>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="font-medium text-sm" style="color:${getNameColor(msg.sender)}">${esc(msg.senderName || 'Unknown')}</span>
        <span class="text-[11px] text-discord-text-m">${formatDate(msg.timestamp)}</span>
      </div>
      <div class="text-sm text-discord-text-s leading-relaxed break-words">${formatContent(msg.text)}${editedBadge}</div>
      ${previews}
      <div class="flex gap-1 mt-1">
        ${canEdit ? '<button class="edit-btn px-2 py-0.5 rounded bg-discord-active text-[11px]">Edit</button>' : ''}
        <button class="pin-btn px-2 py-0.5 rounded bg-discord-active text-[11px]">Pin</button>
        <button class="thread-btn px-2 py-0.5 rounded bg-discord-active text-[11px]">Thread</button>
      </div>
    </div>
  `

  div.querySelector('.edit-btn')?.addEventListener('click', () => editMessagePrompt(msg))
  div.querySelector('.pin-btn')?.addEventListener('click', () => {
    if (!msg.id || !state.activeRoom) return
    send({ type: 'pin-message', roomKey: state.activeRoom, channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general', messageId: msg.id })
  })
  div.querySelector('.thread-btn')?.addEventListener('click', () => openThreadPanel(msg.id))

  return div
}

async function editMessagePrompt (msg) {
  if (!msg?.id || !state.activeRoom) return
  const current = String(msg.text || '')
  const next = await appPrompt('Edit message', {
    title: 'Edit message',
    defaultValue: current,
    placeholder: 'Type your updated message'
  })
  if (next == null) return
  const text = String(next).trim()
  if (!text || text === current) return

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

dom.messageInput.addEventListener('input', () => {
  dom.messageInput.style.height = '44px'
  dom.messageInput.style.height = Math.min(dom.messageInput.scrollHeight, 192) + 'px'
})

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
  dom.messageInput.style.height = '44px'
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

function renderEmojiPicker () {
  if (!dom.emojiGrid || !dom.customEmojiGrid) return

  dom.customEmojiGrid.innerHTML = ''
  const custom = state.roomEmojis.get(state.activeRoom) || new Map()
  for (const [name, src] of custom) {
    const b = document.createElement('button')
    b.className = 'h-8 w-8 rounded hover:bg-discord-hover flex items-center justify-center'
    b.title = `:${name}:`
    b.innerHTML = `<img src="${src}" class="h-6 w-6 rounded" alt=":${name}:">`
    b.addEventListener('click', () => insertAtCursor(dom.messageInput, `:${name}:`))
    dom.customEmojiGrid.appendChild(b)
  }

  dom.emojiGrid.innerHTML = ''
  for (const emoji of UNICODE_EMOJIS) {
    const b = document.createElement('button')
    b.className = 'h-8 w-8 rounded hover:bg-discord-hover text-xl leading-none'
    b.textContent = emoji
    b.addEventListener('click', () => insertAtCursor(dom.messageInput, emoji))
    dom.emojiGrid.appendChild(b)
  }
}

// Admin

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
    dom.roomTitle.textContent = latestName
    dom.chatHeaderDesc.textContent = `${latestName} channel`
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
  const isAdmin = inRoom && isCurrentUserAdmin()

  if (dom.channelSearch) {
    dom.channelSearch.disabled = !inRoom
    dom.channelSearch.placeholder = inDm
      ? 'Search DMs'
      : inRoom
        ? 'Search mentions in text channels'
        : 'Search'
  }
  dom.btnChannelSearchSubmit?.classList.toggle('hidden', !inRoom)

  dom.btnVoice?.classList.toggle('hidden', !inDm)
  dom.btnVideoCall?.classList.toggle('hidden', !inDm)

  if (!inDm && !state.activeCall) {
    dom.btnEndCall?.classList.add('hidden')
  }

  dom.btnToggleMembers?.classList.toggle('hidden', !inRoom || inDm)

  const showHeaderUserCog = inDm || (inRoom && !isAdmin)
  const showHeaderAdminCog = inRoom && !inDm && isAdmin
  dom.btnUserSettings?.classList.toggle('hidden', !showHeaderUserCog)
  dom.btnAdmin?.classList.toggle('hidden', !showHeaderAdminCog)

  if (!inRoom) {
    hideSearchDropdown()
    clearSearchResultsView({ clearInput: true })
  }
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
      <div class="bg-discord-serverbar rounded px-3 py-2 mb-2">
        <div class="text-xs text-discord-text-m mb-1">${esc(row.meta)}</div>
        <div class="text-sm text-discord-text">${formatContent(row.text || '')}</div>
      </div>
    `).join('')
    : '<div class="text-sm text-discord-text-m">No results found.</div>'

  dom.searchResultsView.innerHTML = `
    <div class="mb-4">
      <h3 class="text-lg font-semibold">${esc(title)}</h3>
      <p class="text-xs text-discord-text-m">${esc(subtitle)}</p>
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
    button.className = 'w-full text-left px-3 py-2 hover:bg-discord-hover border-b border-discord-divider/40 last:border-b-0'
    button.innerHTML = `<div class="text-sm text-discord-text">#${esc(channelName)}</div><div class="text-[11px] text-discord-text-m">${count} mention${count === 1 ? '' : 's'}</div>`
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
    row.className = 'flex items-center justify-between bg-discord-serverbar rounded px-2 py-2'
    row.innerHTML = `
      <div class="flex items-center gap-2">
        <img src="${src}" class="h-6 w-6 rounded" alt=":${name}:" />
        <span class="text-sm">:${esc(name)}:</span>
      </div>
      ${isCurrentUserAdmin() ? `<button class="remove-emoji text-xs px-2 py-1 rounded bg-discord-red text-white" data-name="${esc(name)}">Remove</button>` : ''}
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
    row.className = 'bg-discord-serverbar rounded px-2 py-2 text-xs break-all'
    const isOwnerAdmin = admin === ownerKey
    row.innerHTML = `${isOwnerAdmin ? '👑 ' : ''}${esc(resolveMemberNameByKey(state.activeRoom, admin))} <span class="text-discord-text-m">(${esc(admin.slice(0, 10))}…)</span>`
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
    row.className = 'bg-discord-serverbar rounded px-2 py-2 flex items-center gap-2'
    row.innerHTML = `<span class="flex-1 truncate">${esc(data.name || key.slice(0, 12))}</span><span class="text-discord-text-m">${esc(key.slice(0, 8))}…</span>`
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
  const modOnly = await appConfirm('Make this channel moderator/admin only?', {
    title: 'Channel visibility',
    confirmText: 'Yes'
  })
  send({ type: 'add-channel', roomKey: state.activeRoom, kind: 'text', name, modOnly })
})

dom.btnAddVoiceChannel?.addEventListener('click', async () => {
  if (!state.activeRoom) return
  const name = (await appPrompt('Voice channel name? (e.g. hangout)', {
    title: 'Create voice channel',
    placeholder: 'hangout'
  }))?.trim()
  if (!name) return
  const modOnly = await appConfirm('Make this voice channel moderator/admin only?', {
    title: 'Channel visibility',
    confirmText: 'Yes'
  })
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
  const textId = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  const channel = getChannelById(state.activeRoom, 'text', textId)
  const blockedByRole = Boolean(channel?.modOnly) && !isCurrentUserAdmin()
  const blockedByBan = isCurrentUserBannedFromRoom(state.activeRoom)
  const blockedByServerKick = isCurrentUserKickedFromServer(state.activeRoom)
  const blockedByKick = isCurrentUserKickedFromChannel(state.activeRoom, textId)
  const blocked = blockedByRole || blockedByBan || blockedByKick
  dom.messageInput.disabled = blocked
  dom.btnAttachFile.disabled = blocked
  dom.btnEmoji.disabled = blocked
  if (blockedByBan) dom.messageInput.placeholder = 'You are banned from this room'
  else if (blockedByServerKick) dom.messageInput.placeholder = 'You were kicked from this server'
  else if (blockedByKick) dom.messageInput.placeholder = 'You were kicked from this channel'
  else if (blockedByRole) dom.messageInput.placeholder = 'Moderator/Admin only channel'
  else dom.messageInput.placeholder = `Message #${channel?.name || 'general'}`
}

function getVoiceChannelParticipants (channelId) {
  if (!state.activeRoom || !channelId || !state.activeCall) return []
  if (state.activeCall.roomKey !== state.activeRoom || state.activeCall.channelId !== channelId) return []

  const participants = new Map()
  const selfKey = state.identity?.publicKey
  if (selfKey) {
    participants.set(selfKey, {
      name: state.profile.fullName || state.profile.username || 'You',
      avatar: state.profile.avatar || null,
      isSelf: true
    })
  }

  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  for (const msg of roomMsgs) {
    if (msg?.type !== 'system') continue
    if (msg.action !== 'call-start' && msg.action !== 'call-join') continue
    if (msg.data?.channelId !== channelId) continue
    if (msg.data?.callId !== state.activeCall.id) continue
    if (!msg.sender) continue

    participants.set(msg.sender, {
      name: msg.senderName || msg.sender.slice(0, 8),
      avatar: msg.senderAvatar || null,
      isSelf: msg.sender === selfKey
    })
  }

  return [...participants.entries()].map(([key, meta]) => ({ key, ...meta }))
}

function renderChannelLists () {
  if (!state.activeRoom) return

  const channels = state.channelsByRoom.get(state.activeRoom) || { text: [], voice: [] }
  const activeText = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  const activeVoice = state.activeVoiceChannelByRoom.get(state.activeRoom) || 'voice-general'

  dom.textChannelList.innerHTML = ''
  for (const channel of channels.text) {
    const btn = document.createElement('button')
    const isActive = channel.id === activeText
    btn.className = `w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-sm ${isActive ? 'bg-discord-active text-discord-text' : 'text-discord-text-s hover:text-discord-text hover:bg-discord-hover'}`
    btn.innerHTML = `<span class="text-discord-text-m">#</span><span>${esc(channel.name)}</span>${channel.modOnly ? '<span class="ml-auto text-[10px]">🔒</span>' : ''}`

    btn.addEventListener('click', () => {
      state.activeTextChannelByRoom.set(state.activeRoom, channel.id)
      state.activeDmKey = null
      state.activeThreadRootId = null
      clearSearchResultsView()
      dom.chatHeaderTitle.textContent = channel.name
      dom.messageInput.placeholder = `Message #${channel.name}`
      renderChannelLists()
      renderMessages()
      renderPinnedBar()
      closeThreadPanel()
      updateHeaderActionVisibility()
      scrollToBottom()
    })

    dom.textChannelList.appendChild(btn)
  }

  dom.voiceChannelList.innerHTML = ''
  for (const channel of channels.voice) {
    const row = document.createElement('div')
    const isActive = channel.id === activeVoice
    const isConnectedHere = Boolean(
      state.activeCall &&
      state.activeCall.roomKey === state.activeRoom &&
      state.activeCall.channelId === channel.id
    )
    const participants = getVoiceChannelParticipants(channel.id)
    const blockedVoice = isCurrentUserBannedFromRoom(state.activeRoom) || isCurrentUserKickedFromChannel(state.activeRoom, channel.id)
    row.className = `w-full rounded text-left text-sm ${isActive ? 'bg-discord-active text-discord-text' : 'text-discord-text-s hover:text-discord-text hover:bg-discord-hover'}`
    const participantsHtml = participants.length
      ? `<div class="px-2 pb-1.5 space-y-1">${participants.map((participant) => {
          const avatar = participant.avatar
            ? `<img src="${esc(participant.avatar)}" class="w-full h-full object-cover">`
            : getDefaultAvatar(participant.name)
          return `
            <div class="flex items-center gap-2 pl-6 text-xs text-discord-text-s">
              <div class="w-5 h-5 rounded-full bg-discord-blurple flex items-center justify-center text-[10px] font-bold overflow-hidden">${avatar}</div>
              <span class="truncate">${esc(participant.name)}${participant.isSelf ? ' (You)' : ''}</span>
            </div>
          `
        }).join('')}</div>`
      : ''
    row.innerHTML = `
      <div class="flex items-center gap-1.5 px-2 py-1.5">
        <button class="voice-select flex items-center gap-1.5 flex-1 text-left">
          <span class="text-discord-text-m">🔊</span><span>${esc(channel.name)}</span>
        </button>
        ${channel.modOnly ? '<span class="text-[10px]">🔒</span>' : ''}
        <button class="voice-join px-2 py-0.5 text-[11px] rounded ${blockedVoice ? 'bg-discord-active text-discord-text-m' : isConnectedHere ? 'bg-discord-green text-white' : 'bg-discord-blurple text-white'}" ${blockedVoice || isConnectedHere ? 'disabled' : ''}>${isConnectedHere ? 'Joined' : 'Join'}</button>
      </div>
      ${participantsHtml}
    `

    const selectBtn = row.querySelector('.voice-select')
    const joinBtn = row.querySelector('.voice-join')

    selectBtn.addEventListener('click', () => {
      state.activeVoiceChannelByRoom.set(state.activeRoom, channel.id)
      renderChannelLists()
    })

    joinBtn.addEventListener('click', async () => {
      if (isConnectedHere) return
      state.activeVoiceChannelByRoom.set(state.activeRoom, channel.id)
      await startCall('voice', { inlineChannelUi: true })
      renderChannelLists()
    })

    dom.voiceChannelList.appendChild(row)
  }

  updateComposerAccess()
  if (!dom.adminModal?.classList.contains('hidden')) renderModerationPanel()
}

function getVisibleMessagesForActiveTextChannel () {
  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const activeText = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  return roomMsgs.filter((msg) => {
    if (msg?.sender && msg.type !== 'system' && isSenderBlockedForChannel(state.activeRoom, activeText, msg.sender)) return false
    if (!messageBelongsToTextChannel(msg, activeText)) return false
    if (state.activeDmKey) return msg.dmKey === state.activeDmKey
    if (msg.dmKey) return false
    if (msg.threadRootId) return false
    return true
  })
}

function messageBelongsToTextChannel (msg, channelId) {
  if (!msg) return false

  if (msg.type === 'text' || msg.type === 'file') {
    return (msg.channelId || 'general') === channelId
  }

  if (msg.type === 'system') {
    if (msg.action === 'channel-add' || msg.action === 'room-admin-set' || msg.action === 'room-owner-set' || msg.action === 'room-name-set' || msg.action === 'room-profile-set' || msg.action === 'room-disband' || msg.action?.startsWith('custom-emoji-')) return true
    if (msg.action === 'message-pin' || msg.action === 'message-unpin') {
      return (msg.data?.channelId || 'general') === channelId
    }
    if (msg.action === 'friend-request' || msg.action === 'friend-accept') return true
    if (msg.action === 'room-ban' || msg.action === 'room-unban' || msg.action === 'room-kick' || msg.action === 'room-unkick' || msg.action === 'channel-kick' || msg.action === 'channel-unkick') return true
    if (msg.action?.startsWith('call-')) return false
    return channelId === 'general'
  }

  if (msg.type === 'voice') return channelId === 'general'
  return true
}

// Calls: voice/video/screen with WebRTC and room-message signaling

dom.btnVoice?.addEventListener('click', async () => { await startCall('voice') })
dom.btnVideoCall?.addEventListener('click', async () => { await startCall('video') })
dom.btnEndCall?.addEventListener('click', async () => { await endCall(true) })
dom.btnCallScreenShare?.addEventListener('click', async () => { await toggleCallScreenShare() })
dom.btnCallTheater?.addEventListener('click', () => {
  state.callTheater = !state.callTheater
  dom.callStage?.classList.toggle('fixed', state.callTheater)
  dom.callStage?.classList.toggle('inset-0', state.callTheater)
  dom.callStage?.classList.toggle('z-40', state.callTheater)
  dom.callStage?.classList.toggle('bg-discord-bg', state.callTheater)
})
dom.btnCallFullscreen?.addEventListener('click', async () => {
  if (!document.fullscreenElement) await dom.callStage?.requestFullscreen?.()
  else await document.exitFullscreen?.()
})
dom.callBitrate?.addEventListener('change', () => applyCallBitrate(Number(dom.callBitrate.value)))

document.addEventListener('click', (e) => {
  if (!dom.channelSearchDropdown || !dom.channelSearch) return
  const target = e.target
  if (dom.channelSearchDropdown.contains(target) || target === dom.channelSearch || target === dom.btnChannelSearchSubmit) return
  hideSearchDropdown()
})

