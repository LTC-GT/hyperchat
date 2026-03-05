function rebuildPinnedMap (roomKey: string) {
  const msgs = state.messagesByRoom.get(roomKey) || []
  const map = new Map()

  for (const msg of msgs) {
    if (msg?.type !== 'system') continue
    if (msg.action === 'message-pin' && msg.data?.messageId) {
      map.set(`${msg.data.channelId || 'general'}:${msg.data.messageId}`, msg.data.messageId)
    }
    if (msg.action === 'message-unpin' && msg.data?.messageId) {
      map.delete(`${msg.data.channelId || 'general'}:${msg.data.messageId}`)
    }
  }

  state.pinnedByRoomChannel.set(roomKey, map)
}

function renderPinnedBar () {
  if (!state.activeRoom || !dom.pinnedBar || !dom.pinnedList) return
  const channelId = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  const pins = state.pinnedByRoomChannel.get(state.activeRoom) || new Map()
  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const pinnedMsgs = [...pins.keys()]
    .filter((key) => key.startsWith(`${channelId}:`))
    .map((key) => pins.get(key))
    .map((id) => roomMsgs.find((m) => m.id === id))
    .filter((msg): msg is ClientMessage => Boolean(msg))
    .slice(-3)

  if (pinnedMsgs.length === 0) {
    dom.pinnedBar.classList.add('hidden')
    dom.pinnedList.innerHTML = ''
    return
  }

  dom.pinnedBar.classList.remove('hidden')
  dom.pinnedList.innerHTML = ''
  for (const msg of pinnedMsgs) {
    const row = document.createElement('div')
    row.className = 'text-xs bg-quibble-serverbar rounded px-2 py-1 flex items-center gap-2'
    row.innerHTML = `<span class="truncate">${esc((msg.text || msg.filename || '').slice(0, 80) || '(message)')}</span><button class="ml-auto text-quibble-text-m hover:text-quibble-text">Unpin</button>`
    row.querySelector('button')?.addEventListener('click', () => {
      send({ type: 'unpin-message', roomKey: state.activeRoom, channelId, messageId: msg.id })
    })
    dom.pinnedList.appendChild(row)
  }
}

dom.btnClearPinView?.addEventListener('click', () => {
  dom.pinnedBar?.classList.add('hidden')
})

function openThreadPanel (rootId: string) {
  state.activeThreadRootId = rootId
  renderThreadPanel()
}

function closeThreadPanel () {
  state.activeThreadRootId = null
  dom.threadPanel?.classList.add('hidden')
  if (dom.threadMessages) dom.threadMessages.innerHTML = ''
}

function renderThreadPanel () {
  if (!state.activeRoom || !dom.threadPanel) return
  if (!state.activeThreadRootId) {
    dom.threadPanel.classList.add('hidden')
    return
  }

  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const root = roomMsgs.find((m) => m.id === state.activeThreadRootId)
  if (!root) {
    closeThreadPanel()
    return
  }

  dom.threadPanel.classList.remove('hidden')
  dom.threadRoot.textContent = `${root.senderName || 'Unknown'}: ${(root.text || root.filename || '').slice(0, 120)}`
  dom.threadMessages.innerHTML = ''

  const replies = roomMsgs.filter((m) => m.threadRootId === state.activeThreadRootId)
  for (const msg of replies) {
    const row = document.createElement('div')
    row.className = 'bg-quibble-serverbar rounded p-2 text-xs'
    row.innerHTML = `<p class="text-quibble-text">${esc(msg.senderName || 'Unknown')}</p><p class="text-quibble-text-s mt-1">${formatContent(msg.text || msg.filename || '')}</p>`
    dom.threadMessages.appendChild(row)
  }
}

dom.btnCloseThread?.addEventListener('click', () => closeThreadPanel())
dom.btnSendThread?.addEventListener('click', () => {
  if (!state.activeThreadRootId) return
  const text = (dom.threadInput?.value || '').trim()
  if (!text || !state.activeRoom) return

  send({
    type: 'send-message',
    roomKey: state.activeRoom,
    channelId: state.activeTextChannelByRoom.get(state.activeRoom) || 'general',
    text,
    threadRootId: state.activeThreadRootId,
    dmKey: state.activeDmKey,
    dmParticipants: getActiveDmParticipants()
  })
  dom.threadInput.value = ''
})

function addCallEventCard (msg: ClientMessage, opts: { persist?: boolean } = {}) {
  if (!state.activeRoom || !msg?.data) return
  if (!callMatchesCurrentView(msg.data, state.activeRoom)) return
  if (!dom.callEventFeed) return

  const persist = opts.persist !== false
  const roomKey = state.activeRoom

  if (!state._callEventTimers) state._callEventTimers = new Map()
  if (!state.sessionCallEventsByRoom) state.sessionCallEventsByRoom = new Map()

  const eventId = String(msg._sessionEventId || `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  if (!msg._sessionEventId) msg._sessionEventId = eventId

  if (persist) {
    const existing = state.sessionCallEventsByRoom.get(roomKey) || []
    const next = [...existing, { id: eventId, msg }].slice(-3)
    state.sessionCallEventsByRoom.set(roomKey, next)
  }

  const dismissCard = (card: HTMLElement | null) => {
    if (!card) return
    const timerId = card.dataset.timerId
    const timers = state._callEventTimers
    if (timerId && timers?.has(timerId)) {
      clearTimeout(timers.get(timerId))
      timers.delete(timerId)
    }

    const dismissedEventId = card.dataset.eventId
    if (dismissedEventId) {
      const roomEvents = state.sessionCallEventsByRoom.get(roomKey) || []
      state.sessionCallEventsByRoom.set(roomKey, roomEvents.filter((entry) => entry.id !== dismissedEventId))
    }

    card.remove()
  }

  if (dom.callEventFeed.children.length >= 3) {
    const topCard = dom.callEventFeed.firstElementChild as HTMLElement | null
    dismissCard(topCard)
  }

  const card = document.createElement('div')
  card.className = 'bg-quibble-serverbar/80 border border-quibble-divider rounded px-3 py-2 text-xs fade-in flex items-center gap-2'
  card.dataset.eventId = eventId
  let text = ''
  if (msg.action === 'call-start') text = `${msg.senderName || 'Someone'} started a ${msg.data?.mode || 'voice'} call in ${getCallScopeLabel(msg.data)}`
  if (msg.action === 'call-join') text = `${msg.senderName || 'Someone'} joined the call`
  if (msg.action === 'call-end') text = 'Call ended'
  card.innerHTML = `<span class="flex-1 truncate">${esc(text)}</span><button class="call-event-dismiss text-quibble-text-m hover:text-quibble-text text-xs px-1" aria-label="Dismiss call event">✕</button>`

  card.querySelector('.call-event-dismiss')?.addEventListener('click', () => {
    dismissCard(card)
  })

  const timerId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  card.dataset.timerId = timerId
  const timeoutHandle = setTimeout(() => {
    dismissCard(card)
  }, 10000)
  state._callEventTimers.set(timerId, timeoutHandle)

  dom.callEventFeed.prepend(card)
}

function renderCallEventFeed () {
  if (!state.activeRoom || !dom.callEventFeed) return

  if (!state._callEventTimers) state._callEventTimers = new Map()
  for (const handle of state._callEventTimers.values()) {
    clearTimeout(handle)
  }
  state._callEventTimers.clear()

  dom.callEventFeed.innerHTML = ''
  const roomEvents = state.sessionCallEventsByRoom?.get(state.activeRoom) || []
  for (const entry of roomEvents.slice(-3)) {
    if (!entry?.msg) continue
    addCallEventCard(entry.msg, { persist: false })
  }
}

function rebuildFriends (roomKey: string) {
  const msgs = state.messagesByRoom.get(roomKey) || []
  for (const msg of msgs) {
    if (msg?.type !== 'system') continue

    if (msg.action === 'friend-request' && msg.data?.targetKey === state.identity?.publicKey) {
      state.friendRequests.set(msg.sender, { name: msg.senderName || 'Unknown', roomKey })
    }

    if (msg.action === 'friend-accept') {
      const from = msg.data?.fromKey
      const target = msg.data?.targetKey
      if (from === state.identity?.publicKey && target) {
        const targetKey = String(target)
        state.friends.set(targetKey, { name: msg.senderName || 'Friend' })
        state.friendRequests.delete(targetKey)
      }
      if (target === state.identity?.publicKey && from) {
        const fromKey = String(from)
        state.friends.set(fromKey, { name: msg.senderName || 'Friend' })
        state.friendRequests.delete(fromKey)
      }
    }
  }
}

function rebuildModerationState (roomKey: string) {
  const msgs = state.messagesByRoom.get(roomKey) || []
  const bans = new Map()
  const roomKicks = new Map()
  const kicks = new Map()

  for (const msg of msgs) {
    if (msg?.type !== 'system') continue

    if (msg.action === 'room-ban' && msg.data?.targetKey) {
      bans.set(String(msg.data.targetKey), { name: String(msg.data.targetName || msg.data.targetKey) })
    }
    if (msg.action === 'room-unban' && msg.data?.targetKey) {
      bans.delete(String(msg.data.targetKey))
    }
    if (msg.action === 'room-kick' && msg.data?.targetKey) {
      roomKicks.set(String(msg.data.targetKey), { name: String(msg.data.targetName || msg.data.targetKey) })
    }
    if (msg.action === 'room-unkick' && msg.data?.targetKey) {
      roomKicks.delete(String(msg.data.targetKey))
    }
    if (msg.action === 'channel-kick' && msg.data?.targetKey && msg.data?.channelId) {
      const channelId = String(msg.data.channelId)
      if (!kicks.has(channelId)) kicks.set(channelId, new Set())
      kicks.get(channelId).add(String(msg.data.targetKey))
    }
    if (msg.action === 'channel-unkick' && msg.data?.targetKey && msg.data?.channelId) {
      const channelId = String(msg.data.channelId)
      kicks.get(channelId)?.delete(String(msg.data.targetKey))
    }
  }

  state.roomBansByRoom.set(roomKey, bans)
  state.channelKicksByRoom.set(`${roomKey}::room`, roomKicks)
  state.channelKicksByRoom.set(roomKey, kicks)
}

function isCurrentUserBannedFromRoom (roomKey: string) {
  const bans = state.roomBansByRoom.get(roomKey) || new Map()
  return bans.has(state.identity?.publicKey)
}

function isCurrentUserKickedFromChannel (roomKey: string, channelId: string) {
  const roomKicks = state.channelKicksByRoom.get(`${roomKey}::room`) || new Map()
  if (roomKicks.has(state.identity?.publicKey)) return true
  const kicks = state.channelKicksByRoom.get(roomKey) || new Map()
  return kicks.get(channelId)?.has(state.identity?.publicKey) || false
}

function isCurrentUserKickedFromServer (roomKey: string) {
  const roomKicks = state.channelKicksByRoom.get(`${roomKey}::room`) || new Map()
  return roomKicks.has(state.identity?.publicKey)
}

function isSenderBlockedForChannel (roomKey: string, channelId: string, sender: string) {
  const bans = state.roomBansByRoom.get(roomKey) || new Map()
  if (bans.has(sender)) return true
  const roomKicks = state.channelKicksByRoom.get(`${roomKey}::room`) || new Map()
  if (roomKicks.has(sender)) return true
  const kicks = state.channelKicksByRoom.get(roomKey) || new Map()
  return kicks.get(channelId)?.has(sender) || false
}

function renderFriendsHome () {
  if (!dom.friendRequestList || !dom.friendList) return

  dom.friendRequestList.innerHTML = ''
  for (const [key, req] of state.friendRequests) {
    const row = document.createElement('div')
    row.className = 'bg-quibble-bg rounded px-2 py-2 flex items-center gap-2'
    row.innerHTML = `<span class="flex-1 truncate">${esc(req.name)}</span><button class="accept px-2 py-0.5 rounded bg-quibble-green text-white text-xs">Accept</button>`
    row.querySelector('.accept')?.addEventListener('click', () => {
      const roomKey = req.roomKey || state.activeRoom
      if (!roomKey) return

      if (state.activeRoom !== roomKey) {
        selectRoom(roomKey)
      }

      send({ type: 'friend-accept', roomKey, targetKey: key })
      state.friends.set(key, { name: req.name })
      state.friendRequests.delete(key)
      openDmWithFriend(key, req.name)
      renderFriendsHome()
      updateMemberList()
    })
    dom.friendRequestList.appendChild(row)
  }
  if (dom.friendRequestCount) dom.friendRequestCount.textContent = String(state.friendRequests.size)

  if (state.friendRequests.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'text-quibble-text-m text-xs px-1 py-1'
    empty.textContent = 'No pending requests'
    dom.friendRequestList.appendChild(empty)
  }

  dom.friendList.innerHTML = ''
  for (const [key, friend] of state.friends) {
    const row = document.createElement('div')
    row.className = 'bg-quibble-bg rounded px-2 py-2 flex items-center gap-2'
    row.innerHTML = `<span class="flex-1 truncate">${esc(friend.name || key.slice(0, 8))}</span><button class="dm px-2 py-0.5 rounded bg-quibble-blurple text-white text-xs">DM</button>`
    row.querySelector('.dm')?.addEventListener('click', () => openDmWithFriend(key, friend.name))
    dom.friendList.appendChild(row)
  }

  if (state.friends.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'text-quibble-text-m text-xs px-1 py-1'
    empty.textContent = 'No friends yet'
    dom.friendList.appendChild(empty)
  }
}

function openDmWithFriend (friendKey: string, friendName: string | undefined) {
  if (!state.activeRoom) return
  state.activeSearchChannelId = null
  state.activeDmKey = getDmKey(state.identity?.publicKey, friendKey)
  state.activeThreadRootId = null
  clearSearchResultsView?.({ clearInput: true })
  dom.chatHeaderTitle.textContent = `@${friendName || friendKey.slice(0, 8)}`
  dom.messageInput.placeholder = `Message @${friendName || 'friend'}`
  renderMessages()
  renderPinnedBar()
  closeThreadPanel()
  updateHeaderActionVisibility?.()
}

function getDmKey (a: unknown, b: unknown) {
  return [String(a || ''), String(b || '')].sort().join(':')
}

function getActiveDmParticipants () {
  if (!state.activeDmKey) return null
  const parts = state.activeDmKey.split(':').filter(Boolean)
  return parts.length === 2 ? parts : null
}

function updateSecurityStatus () {
  if (!dom.securityPeers || !dom.securityConn) return
  const conn = state.ws?.readyState === WebSocket.OPEN ? 'Online' : 'Offline'
  dom.securityConn.textContent = conn
  dom.securityPeers.textContent = String(state.peers.size)
  dom.securityEncrypt.textContent = 'Autobase + XSalsa20-Poly1305'

  if (dom.securitySwarmConns) {
    dom.securitySwarmConns.textContent = String(state.swarmConnections ?? 0)
  }
  if (dom.securityWriters && state.activeRoom) {
    const writers = state.swarmWriters?.[state.activeRoom] ?? 0
    dom.securityWriters.textContent = String(writers)
  } else if (dom.securityWriters) {
    dom.securityWriters.textContent = '–'
  }

  const memberKeys = new Set()
  if (state.activeRoom) {
    const msgs = state.messagesByRoom.get(state.activeRoom) || []
    for (const msg of msgs) {
      if (msg?.sender) memberKeys.add(msg.sender)
    }
  }
  dom.securityKnownMembers.textContent = String(memberKeys.size)
}

function renderUrlPreviews (msg: ClientMessage) {
  if (!msg?.text) return ''
  const urls = [...msg.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]).slice(0, 2)
  if (urls.length === 0) return ''

  return urls.map((url) => {
    let host = url
    try { host = new URL(url).host } catch {}
    const summary = esc(url.replace(/^https?:\/\//, '').slice(0, 90))
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="block mt-1 bg-quibble-serverbar border border-quibble-divider rounded px-2 py-2 hover:bg-quibble-hover"><p class="text-xs text-quibble-text">${esc(host)}</p><p class="text-[11px] text-quibble-text-m truncate">${summary}</p></a>`
  }).join('')
}

function updateUserPanel () {
  const fullName = state.profile.fullName || state.profile.username || 'Anonymous'
  const username = state.profile.username || 'user'
  const presence = getPresenceMeta(state.settings.presenceStatus, state.lastPresenceActivityAt)
  dom.userNameDisplay.textContent = fullName
  if (dom.userHandleDisplay) {
    const compactUser = username.length > 14 ? `${username.slice(0, 14)}…` : username
    dom.userHandleDisplay.textContent = `@${compactUser}`
  }
  if (state.profile.avatar) {
    dom.userAvatar.innerHTML = `<img src="${state.profile.avatar}" class="w-full h-full object-cover">`
  } else {
    dom.userAvatar.textContent = (fullName || '?').charAt(0).toUpperCase()
  }

  if (dom.userStatusDot) {
    dom.userStatusDot.classList.remove('bg-quibble-green', 'bg-quibble-red', 'bg-quibble-blurple', 'bg-quibble-divider')
    dom.userStatusDot.classList.add(presence.dotClass)
  }

  updateGlobalMediaButtons()
}

updateGlobalMediaButtons()

function scrollToBottom () {
  requestAnimationFrame(() => {
    dom.messagesScroll.scrollTop = dom.messagesScroll.scrollHeight
  })
}

function esc (str: unknown) {
  const d = document.createElement('div')
  d.textContent = String(str || '')
  return d.innerHTML
}

function formatContent (text: string) {
  let html = esc(text)
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-quibble-serverbar rounded px-3 py-2 my-1 text-sm font-mono whitespace-pre-wrap">$1</pre>')
  html = html.replace(/`([^`]+)`/g, '<code class="bg-quibble-serverbar rounded px-1 py-0.5 text-sm font-mono">$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-blue-400 hover:underline">$1</a>')
  html = html.replace(/\n/g, '<br>')
  html = applyCustomEmoji(html)
  return html
}

function applyCustomEmoji (html: string) {
  if (!state.activeRoom) return html
  const custom = state.roomEmojis.get(state.activeRoom) || new Map()
  for (const [name, src] of custom) {
    const pattern = new RegExp(`:${name}:`, 'g')
    html = html.replace(pattern, `<img src="${src}" alt=":${name}:" class="inline-block h-5 w-5 align-text-bottom rounded">`)
  }
  return html
}

function formatDate (ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`
  return `${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })} ${time}`
}

function formatTime (ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatTimeShort (ts: number) {
  return formatTime(ts)
}

function formatBytes (size: number) {
  if (!size) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = size
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function getDefaultAvatar (name: string) {
  return `<span class="text-white">${(name || '?').charAt(0).toUpperCase()}</span>`
}

const NAME_COLORS = ['#f47b67', '#e78284', '#ea999c', '#ef9f76', '#e5c890', '#a6d189', '#81c8be', '#99d1db', '#85c1dc', '#8caaee', '#babbf1', '#ca9ee6', '#f4b8e4', '#eebebe']
function getNameColor (senderHex = '') {
  let hash = 0
  for (let i = 0; i < Math.min(senderHex.length, 8); i++) {
    hash = ((hash << 5) - hash) + senderHex.charCodeAt(i)
    hash |= 0
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length]
}

function insertAtCursor (el: HTMLTextAreaElement | DomRef, text: string) {
  const start = el.selectionStart
  const end = el.selectionEnd
  const before = el.value.slice(0, start)
  const after = el.value.slice(end)
  el.value = before + text + after
  const pos = start + text.length
  el.selectionStart = el.selectionEnd = pos
  el.focus()
  el.dispatchEvent(new Event('input'))
}

function fileToBase64 (file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function fileToDataURL (file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function base64ToBlob (base64: string, type: string) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type })
}

document.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as Node | null
  const clickedEmojiButton = Boolean(dom.btnEmoji && (target === dom.btnEmoji || dom.btnEmoji.contains(target)))
  if (dom.emojiPicker && !dom.emojiPicker.contains(target) && !clickedEmojiButton) {
    dom.emojiPicker.classList.add('hidden')
  }
  if (dom.adminModal && e.target === dom.adminModal) {
    dom.adminModal.classList.add('hidden')
  }
  if (dom.userSettingsModal && e.target === dom.userSettingsModal) {
    dom.userSettingsModal.classList.add('hidden')
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    dom.roomModal.classList.add('hidden')
    dom.inviteModal.classList.add('hidden')
    dom.emojiPicker.classList.add('hidden')
    dom.adminModal?.classList.add('hidden')
    dom.userSettingsModal?.classList.add('hidden')
  }
})

for (const modal of [dom.roomModal, dom.inviteModal]) {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden')
  })
}

// ─── Friend Link sharing ───
const FRIEND_LINK_PREFIX = 'pear://quibble/'

function generateFriendLink () {
  return (state as any).friendLink || null
}

function parseFriendLink (raw: string) {
  const text = String(raw || '').trim()
  // Accept pear://quibble/... format (z32-encoded invite link)
  if (text.startsWith(FRIEND_LINK_PREFIX)) {
    const encoded = text.slice(FRIEND_LINK_PREFIX.length).trim()
    if (encoded.length > 0) return text // return the full link for joining
  }
  // Also accept bare hex key (legacy)
  const bare = text.toLowerCase()
  if (/^[a-f0-9]{64}$/.test(bare)) return bare
  return null
}

dom.btnCopyFriendLink?.addEventListener('click', async () => {
  const link = generateFriendLink()
  if (!link) {
    appAlert('Friend link not available yet. Please wait for P2P connection.', { title: 'Error' })
    return
  }
  try {
    await navigator.clipboard.writeText(link)
    const btn = dom.btnCopyFriendLink
    const orig = btn.textContent
    btn.textContent = 'Copied!'
    setTimeout(() => { btn.textContent = orig }, 1500)
  } catch {
    appAlert(link, { title: 'Your Friend Link' })
  }
})

dom.btnPasteFriendLink?.addEventListener('click', async () => {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch {
    const manualInput = await appPrompt('Paste the friend link:', {
      title: 'Add Friend',
      placeholder: 'pear://quibble/... invite link',
      confirmText: 'Add Friend',
      cancelText: 'Cancel'
    })
    if (manualInput == null) return
    text = String(manualInput || '')
  }
  const parsed = parseFriendLink(text)
  if (!parsed) {
    appAlert('Invalid friend link. Expected a pear://quibble/... invite link.', { title: 'Invalid Link' })
    return
  }

  // Check if it's our own friend link
  if (parsed === (state as any).friendLink) {
    appAlert("That's your own friend link!", { title: 'Oops' })
    return
  }

  // If it's a pear:// link, join the friend room (no active room required)
  if (parsed.startsWith('pear://quibble/')) {
    send({ type: 'join-friend-room', link: parsed })
    appAlert('Joining friend room and sending request... They will see it once they sync.', { title: 'Request Sent' })
    return
  }

  // Legacy hex key handling - needs an active room
  const friendKey = parsed
  if (friendKey === state.identity?.publicKey) {
    appAlert("That's your own public key!", { title: 'Oops' })
    return
  }
  if (state.friends.has(friendKey)) {
    appAlert('You are already friends with this user.', { title: 'Already Friends' })
    openDmWithFriend(friendKey, state.friends.get(friendKey)?.name)
    return
  }
  if (!state.activeRoom) {
    appAlert('Legacy hex keys require an active room. Use a pear://quibble/ link instead.', { title: 'No Active Room' })
    return
  }
  send({ type: 'friend-request', roomKey: state.activeRoom, targetKey: friendKey, targetName: '' })
  state.friendRequests.set(friendKey, { name: friendKey.slice(0, 8), roomKey: state.activeRoom, outgoing: true })
  renderFriendsHome()
  appAlert('Friend request sent!', { title: 'Request Sent' })
})

dom.app.classList.remove('hidden')
updateHeaderActionVisibility?.()
updateConnectionGate()
initPresenceTracking()
connect()
