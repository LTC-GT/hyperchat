async function startCall (mode) {
  if (!state.activeRoom) return
  if (state.activeCall) await endCall(true)

  const channelId = state.activeVoiceChannelByRoom.get(state.activeRoom) || 'voice-general'
  if (isCurrentUserBannedFromRoom(state.activeRoom) || isCurrentUserKickedFromChannel(state.activeRoom, channelId)) {
    await appAlert('You cannot join this channel.', { title: 'Access blocked' })
    return
  }
  const callId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
  const stream = await requestCallMedia(mode)
  if (!stream) return

  state.activeCall = { id: callId, mode, roomKey: state.activeRoom, channelId }
  state.localCallStream = stream

  showCallStage(mode)
  attachLocalStream(stream)
  applyLocalMediaTrackState()
  applyCallBitrate(Number(dom.callBitrate?.value || 48000))

  send({ type: 'start-call', roomKey: state.activeRoom, channelId, callId, mode })
}

async function requestCallMedia (mode) {
  try {
    const micEnabled = state.settings.micEnabled !== false
    const camEnabled = state.settings.cameraEnabled !== false
    const audio = {
      noiseSuppression: Boolean(state.settings.noiseCancellation),
      echoCancellation: Boolean(state.settings.noiseCancellation)
    }
    if (state.settings.micId) audio.deviceId = { exact: state.settings.micId }
    const video = state.settings.cameraId ? { deviceId: { exact: state.settings.cameraId } } : true

    let constraints = null
    if (mode === 'video') {
      constraints = { audio: micEnabled ? audio : false, video: camEnabled ? video : false }
    } else {
      constraints = { audio: micEnabled ? audio : false, video: false }
    }

    let forceMutedTracks = false
    if (!constraints.audio && !constraints.video) {
      constraints = { audio, video: false }
      forceMutedTracks = true
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    if (forceMutedTracks) {
      for (const track of stream.getTracks()) track.enabled = false
    }
    return stream
  } catch (err) {
    console.error('Call media access failed:', err)
    return null
  }
}

async function onIncomingCallStart (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (msg.sender === state.identity?.publicKey) return
  if (state.activeCall) return

  const callId = msg.data?.callId
  const mode = msg.data?.mode || 'voice'
  const channelId = msg.data?.channelId || 'voice-general'
  if (!callId) return

  const label = getChannelById(state.activeRoom, 'voice', channelId)?.name || 'voice'
  startRingtoneLoop()
  const ok = await appConfirm(`${msg.senderName || 'Someone'} started a ${mode} call in ${label}. Join?`, {
    title: 'Incoming call',
    confirmText: 'Join'
  })
  stopRingtoneLoop()
  if (!ok) return

  joinCall(callId, mode, channelId)
}

async function joinCall (callId, mode, channelId) {
  stopRingtoneLoop()
  const stream = await requestCallMedia(mode)
  if (!stream || !state.activeRoom) return

  state.activeCall = { id: callId, mode, roomKey: state.activeRoom, channelId }
  state.localCallStream = stream
  state.activeVoiceChannelByRoom.set(state.activeRoom, channelId)

  showCallStage(mode)
  attachLocalStream(stream)
  applyLocalMediaTrackState()
  applyCallBitrate(Number(dom.callBitrate?.value || 48000))

  send({ type: 'join-call', roomKey: state.activeRoom, channelId, callId, mode })
}

async function onIncomingCallJoin (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (msg.data?.callId !== state.activeCall.id) return
  if (msg.sender === state.identity?.publicKey) return

  await ensurePeerConnection(msg.sender)
  const pc = state.peerConnections.get(msg.sender)
  if (!pc) return

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  send({
    type: 'call-signal',
    roomKey: state.activeRoom,
    channelId: state.activeCall.channelId,
    callId: state.activeCall.id,
    target: msg.sender,
    signal: { type: 'offer', sdp: offer.sdp }
  })
}

async function onIncomingCallSignal (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall || !msg?.data?.signal) return
  if (msg.data.callId !== state.activeCall.id) return
  if (msg.data.target && msg.data.target !== state.identity?.publicKey) return
  if (msg.sender === state.identity?.publicKey) return

  await ensurePeerConnection(msg.sender)
  const pc = state.peerConnections.get(msg.sender)
  if (!pc) return

  const signal = msg.data.signal

  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    send({
      type: 'call-signal',
      roomKey: state.activeRoom,
      channelId: state.activeCall.channelId,
      callId: state.activeCall.id,
      target: msg.sender,
      signal: { type: 'answer', sdp: answer.sdp }
    })
    return
  }

  if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }))
    return
  }

  if (signal.type === 'candidate' && signal.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate))
  }
}

function onIncomingCallEnd (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (msg?.data?.callId !== state.activeCall.id) return
  endCall(false)
}

async function ensurePeerConnection (peerKey) {
  if (state.peerConnections.has(peerKey)) return
  if (!state.localCallStream || !state.activeCall) return

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  })

  for (const track of state.localCallStream.getTracks()) {
    pc.addTrack(track, state.localCallStream)
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate || !state.activeCall) return
    send({
      type: 'call-signal',
      roomKey: state.activeRoom,
      channelId: state.activeCall.channelId,
      callId: state.activeCall.id,
      target: peerKey,
      signal: { type: 'candidate', candidate: event.candidate }
    })
  }

  pc.ontrack = (event) => {
    const stream = event.streams?.[0]
    if (!stream) return
    state.remoteStreams.set(peerKey, stream)
    renderRemoteVideos()
  }

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      state.peerConnections.delete(peerKey)
      state.remoteStreams.delete(peerKey)
      renderRemoteVideos()
    }
  }

  state.peerConnections.set(peerKey, pc)
}

async function endCall (notifyRemote) {
  if (!state.activeCall) return

  stopRingtoneLoop()

  if (notifyRemote) {
    send({
      type: 'end-call',
      roomKey: state.activeCall.roomKey,
      channelId: state.activeCall.channelId,
      callId: state.activeCall.id
    })
  }

  for (const pc of state.peerConnections.values()) {
    try { pc.close() } catch {}
  }
  state.peerConnections.clear()
  state.remoteStreams.clear()

  if (state.localCallStream) {
    for (const track of state.localCallStream.getTracks()) track.stop()
  }
  if (state.callScreenStream) {
    for (const track of state.callScreenStream.getTracks()) track.stop()
  }

  state.localCallStream = null
  state.activeCall = null
  hideCallStage()
}

function showCallStage (mode) {
  dom.callStage?.classList.remove('hidden')
  dom.btnEndCall?.classList.remove('hidden')
  dom.callStatus.textContent = `${mode[0].toUpperCase() + mode.slice(1)} call active`

  dom.btnVoice.classList.add('text-discord-green')
  dom.btnVideoCall.classList.toggle('text-discord-green', mode === 'video')
  dom.btnCallScreenShare?.classList.toggle('bg-discord-blurple', Boolean(state.callScreenStream))
}

function hideCallStage () {
  dom.callStage?.classList.add('hidden')
  dom.btnEndCall?.classList.add('hidden')

  dom.btnVoice.classList.remove('text-discord-green')
  dom.btnVideoCall.classList.remove('text-discord-green')
  dom.callStage?.classList.remove('fixed', 'inset-0', 'z-40', 'bg-discord-bg')
  state.callTheater = false
  state.callScreenStream = null

  if (dom.localVideo) {
    dom.localVideo.srcObject = null
    dom.localVideo.classList.add('hidden')
  }
  if (dom.remoteVideos) dom.remoteVideos.innerHTML = ''
  updateGlobalMediaButtons()
}

function attachLocalStream (stream) {
  if (!dom.localVideo) return
  dom.localVideo.srcObject = stream
  dom.localVideo.classList.remove('hidden')
}

function getPresenceMeta () {
  const status = state.settings.presenceStatus || 'online'
  if (status === 'idle') return { label: 'Idle', dotClass: 'bg-discord-blurple', visibleOnline: true }
  if (status === 'dnd') return { label: 'Do Not Disturb', dotClass: 'bg-discord-red', visibleOnline: true }
  if (status === 'invisible') return { label: 'Invisible', dotClass: 'bg-discord-divider', visibleOnline: false }
  if (status === 'offline') return { label: 'Offline', dotClass: 'bg-discord-divider', visibleOnline: false }
  return { label: 'Online', dotClass: 'bg-discord-green', visibleOnline: true }
}

function setPresenceStatus (status) {
  if (!['online', 'idle', 'dnd', 'invisible', 'offline'].includes(String(status))) return
  state.settings.presenceStatus = String(status)
  saveClientSettings()
  if (typeof send === 'function') {
    send({ type: 'set-presence-status', status: state.settings.presenceStatus })
  }
  updateUserPanel()
  updateMemberList()
}

function applyLocalMediaTrackState () {
  if (!state.localCallStream) {
    updateGlobalMediaButtons()
    return
  }

  const micEnabled = state.settings.micEnabled !== false
  const camEnabled = state.settings.cameraEnabled !== false
  for (const track of state.localCallStream.getAudioTracks()) track.enabled = micEnabled
  for (const track of state.localCallStream.getVideoTracks()) track.enabled = camEnabled
  updateGlobalMediaButtons()
}

function updateGlobalMediaButtons () {
  const micEnabled = state.settings.micEnabled !== false
  const camEnabled = state.settings.cameraEnabled !== false

  if (dom.btnToggleMicGlobal) {
    dom.btnToggleMicGlobal.classList.toggle('text-discord-red', !micEnabled)
    dom.btnToggleMicGlobal.classList.toggle('bg-discord-active', !micEnabled)
    dom.btnToggleMicGlobal.title = micEnabled ? 'Mute Microphone' : 'Unmute Microphone'
    dom.btnToggleMicGlobal.setAttribute('aria-pressed', String(!micEnabled))
  }
  if (dom.btnToggleCameraGlobal) {
    dom.btnToggleCameraGlobal.classList.toggle('text-discord-red', !camEnabled)
    dom.btnToggleCameraGlobal.classList.toggle('bg-discord-active', !camEnabled)
    dom.btnToggleCameraGlobal.title = camEnabled ? 'Disable Camera' : 'Enable Camera'
    dom.btnToggleCameraGlobal.setAttribute('aria-pressed', String(!camEnabled))
  }

  dom.micDisabledSlash?.classList.toggle('hidden', micEnabled)
  dom.cameraDisabledSlash?.classList.toggle('hidden', camEnabled)
}

function toggleGlobalMicrophone () {
  state.settings.micEnabled = !(state.settings.micEnabled !== false)
  saveClientSettings()
  applyLocalMediaTrackState()
}

function toggleGlobalCamera () {
  state.settings.cameraEnabled = !(state.settings.cameraEnabled !== false)
  saveClientSettings()
  applyLocalMediaTrackState()
}

function renderRemoteVideos () {
  if (!dom.remoteVideos) return
  dom.remoteVideos.innerHTML = ''

  for (const [peer, stream] of state.remoteStreams) {
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.className = 'w-full rounded bg-black/40'
    video.dataset.peer = peer
    video.srcObject = stream
    dom.remoteVideos.appendChild(video)
  }
}

async function toggleCallScreenShare () {
  if (!state.activeCall || !state.localCallStream) return

  if (state.callScreenStream) {
    for (const track of state.callScreenStream.getTracks()) track.stop()
    state.callScreenStream = null
    const camTrack = state.localCallStream.getVideoTracks()[0] || null
    await replaceVideoTrack(camTrack)
    if (camTrack) attachLocalStream(state.localCallStream)
    dom.btnCallScreenShare?.classList.remove('bg-discord-blurple')
    return
  }

  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const screenTrack = display.getVideoTracks()[0]
    if (!screenTrack) return
    state.callScreenStream = display
    await replaceVideoTrack(screenTrack)
    dom.localVideo.srcObject = display
    dom.localVideo.classList.remove('hidden')
    screenTrack.onended = () => {
      if (state.callScreenStream) toggleCallScreenShare().catch(() => {})
    }
    dom.btnCallScreenShare?.classList.add('bg-discord-blurple')
  } catch (err) {
    console.error('Screen share failed', err)
  }
}

async function replaceVideoTrack (track) {
  for (const pc of state.peerConnections.values()) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video')
    if (sender) {
      await sender.replaceTrack(track || null)
    } else if (track && state.localCallStream) {
      pc.addTrack(track, state.localCallStream)
    }
  }
}

function applyCallBitrate (bitrate) {
  for (const pc of state.peerConnections.values()) {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio')
    if (!sender?.getParameters || !sender?.setParameters) continue
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
    params.encodings[0].maxBitrate = bitrate
    sender.setParameters(params).catch(() => {})
  }
}

// Members panel

dom.btnToggleMembers.addEventListener('click', () => {
  state.membersVisible = !state.membersVisible
  if (state.membersVisible && state.activeRoom) dom.membersSidebar.classList.remove('hidden')
  else dom.membersSidebar.classList.add('hidden')
})

function updateMemberList () {
  dom.memberList.innerHTML = ''
  const ownerKey = state.activeRoom ? state.roomOwnerByRoom.get(state.activeRoom) : null
  const presence = getPresenceMeta()
  dom.memberList.appendChild(createMemberEl({
    key: state.identity?.publicKey,
    name: state.profile.fullName || state.profile.username || 'You',
    avatar: state.profile.avatar,
    isOnline: presence.visibleOnline,
    isSelf: true,
    isOwner: ownerKey === state.identity?.publicKey
  }))

  const peers = new Map()
  if (state.activeRoom) {
    const msgs = state.messagesByRoom.get(state.activeRoom) || []
    for (const m of msgs) {
      if (m.sender && m.sender !== state.identity?.publicKey && m.senderName) {
        peers.set(m.sender, { name: m.senderName, avatar: m.senderAvatar || null })
      }
    }
  }

  for (const [key, peer] of peers) {
    dom.memberList.appendChild(createMemberEl({ key, name: peer.name, avatar: peer.avatar, isOnline: false, isSelf: false, isOwner: ownerKey === key }))
  }

  dom.onlineCount.textContent = String(1 + peers.size)
  updateSecurityStatus()
}

function createMemberEl ({ key, name, avatar, isOnline, isSelf, isOwner = false }) {
  const div = document.createElement('div')
  div.className = 'flex items-center gap-3 px-2 py-1.5 rounded hover:bg-discord-hover cursor-pointer group'
  const av = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : getDefaultAvatar(name)
  const isFriend = key ? state.friends.has(key) : false

  div.innerHTML = `
    <div class="relative flex-shrink-0">
      <div class="w-8 h-8 rounded-full bg-discord-blurple flex items-center justify-center text-xs font-bold overflow-hidden">${av}</div>
      ${isOnline ? '<div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-discord-green rounded-full border-2 border-discord-members"></div>' : ''}
    </div>
    <span class="text-sm text-discord-text-s group-hover:text-discord-text truncate flex-1">${isOwner ? '👑 ' : ''}${esc(name)}</span>
    ${(!isSelf && key) ? `<button class="friend-btn text-[11px] px-2 py-0.5 rounded ${isFriend ? 'bg-discord-green text-white' : 'bg-discord-active text-discord-text'}">${isFriend ? 'Friend' : 'Add'}</button>` : ''}
    ${(!isSelf && key && isFriend) ? '<button class="dm-btn text-[11px] px-2 py-0.5 rounded bg-discord-blurple text-white">DM</button>' : ''}
  `

  div.querySelector('.friend-btn')?.addEventListener('click', () => {
    if (!key || !state.activeRoom || isFriend) return
    send({ type: 'friend-request', roomKey: state.activeRoom, targetKey: key, targetName: name })
  })
  div.querySelector('.dm-btn')?.addEventListener('click', () => openDmWithFriend(key, name))

  return div
}

// Home

dom.btnHome.addEventListener('click', () => {
  state.activeRoom = null
  state.activeSearchChannelId = null
  dom.roomTitle.textContent = 'Friends'
  dom.chatHeaderTitle.textContent = 'Friends'
  dom.chatHeaderDesc.textContent = 'Direct messages'
  dom.noRoomSelected.classList.remove('hidden')
  dom.channelItems.classList.add('hidden')
  dom.btnInvite.classList.add('hidden')
  dom.welcomeState.classList.remove('hidden')
  dom.chatArea.classList.add('hidden')
  dom.membersSidebar.classList.add('hidden')
  dom.emojiPicker.classList.add('hidden')
  dom.pinnedBar?.classList.add('hidden')
  if (dom.callEventFeed) dom.callEventFeed.innerHTML = ''
  dom.adminModal?.classList.add('hidden')
  closeUsernameConflictModal()
  state.activeDmKey = null
  clearSearchResultsView?.({ clearInput: true })
  closeThreadPanel()
  renderFriendsHome()
  renderServerList()
  updateHeaderActionVisibility?.()
})

function rebuildPinnedMap (roomKey) {
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
    .filter(Boolean)
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
    row.className = 'text-xs bg-discord-serverbar rounded px-2 py-1 flex items-center gap-2'
    row.innerHTML = `<span class="truncate">${esc((msg.text || msg.filename || '').slice(0, 80) || '(message)')}</span><button class="ml-auto text-discord-text-m hover:text-discord-text">Unpin</button>`
    row.querySelector('button')?.addEventListener('click', () => {
      send({ type: 'unpin-message', roomKey: state.activeRoom, channelId, messageId: msg.id })
    })
    dom.pinnedList.appendChild(row)
  }
}

dom.btnClearPinView?.addEventListener('click', () => {
  dom.pinnedBar?.classList.add('hidden')
})

function openThreadPanel (rootId) {
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
    row.className = 'bg-discord-serverbar rounded p-2 text-xs'
    row.innerHTML = `<p class="text-discord-text">${esc(msg.senderName || 'Unknown')}</p><p class="text-discord-text-s mt-1">${formatContent(msg.text || msg.filename || '')}</p>`
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

function addCallEventCard (msg) {
  if (!state.activeRoom || msg.data?.channelId !== (state.activeVoiceChannelByRoom.get(state.activeRoom) || 'voice-general')) return
  if (!dom.callEventFeed) return

  const card = document.createElement('div')
  card.className = 'bg-discord-serverbar/80 border border-discord-divider rounded px-3 py-2 text-xs fade-in'
  if (msg.action === 'call-start') card.textContent = `${msg.senderName || 'Someone'} started a ${msg.data?.mode || 'voice'} call`
  if (msg.action === 'call-join') card.textContent = `${msg.senderName || 'Someone'} joined the call`
  if (msg.action === 'call-end') card.textContent = 'Call ended'
  dom.callEventFeed.prepend(card)

  while (dom.callEventFeed.children.length > 8) {
    dom.callEventFeed.lastElementChild.remove()
  }
}

function renderCallEventFeed () {
  if (!state.activeRoom || !dom.callEventFeed) return
  dom.callEventFeed.innerHTML = ''
  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const actions = new Set(['call-start', 'call-join', 'call-end'])
  const latest = roomMsgs.filter((m) => m?.type === 'system' && actions.has(m.action)).slice(-8)
  for (const msg of latest) addCallEventCard(msg)
}

function rebuildFriends (roomKey) {
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
        state.friends.set(target, { name: msg.senderName || 'Friend' })
        state.friendRequests.delete(target)
      }
      if (target === state.identity?.publicKey && from) {
        state.friends.set(from, { name: msg.senderName || 'Friend' })
        state.friendRequests.delete(from)
      }
    }
  }
}

function rebuildModerationState (roomKey) {
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

function isCurrentUserBannedFromRoom (roomKey) {
  const bans = state.roomBansByRoom.get(roomKey) || new Map()
  return bans.has(state.identity?.publicKey)
}

function isCurrentUserKickedFromChannel (roomKey, channelId) {
  const roomKicks = state.channelKicksByRoom.get(`${roomKey}::room`) || new Map()
  if (roomKicks.has(state.identity?.publicKey)) return true
  const kicks = state.channelKicksByRoom.get(roomKey) || new Map()
  return kicks.get(channelId)?.has(state.identity?.publicKey) || false
}

function isCurrentUserKickedFromServer (roomKey) {
  const roomKicks = state.channelKicksByRoom.get(`${roomKey}::room`) || new Map()
  return roomKicks.has(state.identity?.publicKey)
}

function isSenderBlockedForChannel (roomKey, channelId, sender) {
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
    row.className = 'bg-discord-bg rounded px-2 py-2 flex items-center gap-2'
    row.innerHTML = `<span class="flex-1 truncate">${esc(req.name)}</span><button class="accept px-2 py-0.5 rounded bg-discord-green text-white text-xs">Accept</button>`
    row.querySelector('.accept')?.addEventListener('click', () => {
      if (!state.activeRoom) return
      send({ type: 'friend-accept', roomKey: req.roomKey || state.activeRoom, targetKey: key })
      state.friends.set(key, { name: req.name })
      state.friendRequests.delete(key)
      renderFriendsHome()
      updateMemberList()
    })
    dom.friendRequestList.appendChild(row)
  }
  if (dom.friendRequestCount) dom.friendRequestCount.textContent = String(state.friendRequests.size)

  if (state.friendRequests.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'text-discord-text-m text-xs px-1 py-1'
    empty.textContent = 'No pending requests'
    dom.friendRequestList.appendChild(empty)
  }

  dom.friendList.innerHTML = ''
  for (const [key, friend] of state.friends) {
    const row = document.createElement('div')
    row.className = 'bg-discord-bg rounded px-2 py-2 flex items-center gap-2'
    row.innerHTML = `<span class="flex-1 truncate">${esc(friend.name || key.slice(0, 8))}</span><button class="dm px-2 py-0.5 rounded bg-discord-blurple text-white text-xs">DM</button>`
    row.querySelector('.dm')?.addEventListener('click', () => openDmWithFriend(key, friend.name))
    dom.friendList.appendChild(row)
  }

  if (state.friends.size === 0) {
    const empty = document.createElement('p')
    empty.className = 'text-discord-text-m text-xs px-1 py-1'
    empty.textContent = 'No friends yet'
    dom.friendList.appendChild(empty)
  }
}

function openDmWithFriend (friendKey, friendName) {
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

function getDmKey (a, b) {
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

  const memberKeys = new Set()
  if (state.activeRoom) {
    const msgs = state.messagesByRoom.get(state.activeRoom) || []
    for (const msg of msgs) {
      if (msg?.sender) memberKeys.add(msg.sender)
    }
  }
  dom.securityKnownMembers.textContent = String(memberKeys.size)
}

function renderUrlPreviews (msg) {
  if (!msg?.text) return ''
  const urls = [...msg.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]).slice(0, 2)
  if (urls.length === 0) return ''

  return urls.map((url) => {
    let host = url
    try { host = new URL(url).host } catch {}
    const summary = esc(url.replace(/^https?:\/\//, '').slice(0, 90))
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="block mt-1 bg-discord-serverbar border border-discord-divider rounded px-2 py-2 hover:bg-discord-hover"><p class="text-xs text-discord-text">${esc(host)}</p><p class="text-[11px] text-discord-text-m truncate">${summary}</p></a>`
  }).join('')
}

function updateUserPanel () {
  const fullName = state.profile.fullName || state.profile.username || 'Anonymous'
  const username = state.profile.username || 'user'
  const presence = getPresenceMeta()
  dom.userNameDisplay.textContent = fullName
  if (dom.userHandleDisplay) {
    const compactUser = username.length > 14 ? `${username.slice(0, 14)}…` : username
    const compactPresence = presence.label === 'Do Not Disturb' ? 'DND' : presence.label
    dom.userHandleDisplay.textContent = `@${compactUser} • ${compactPresence}`
  }
  if (state.profile.avatar) {
    dom.userAvatar.innerHTML = `<img src="${state.profile.avatar}" class="w-full h-full object-cover">`
  } else {
    dom.userAvatar.textContent = (fullName || '?').charAt(0).toUpperCase()
  }

  if (dom.userStatusDot) {
    dom.userStatusDot.classList.remove('bg-discord-green', 'bg-discord-red', 'bg-discord-blurple', 'bg-discord-divider')
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

function esc (str) {
  const d = document.createElement('div')
  d.textContent = str || ''
  return d.innerHTML
}

function formatContent (text) {
  let html = esc(text)
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-discord-serverbar rounded px-3 py-2 my-1 text-sm font-mono whitespace-pre-wrap">$1</pre>')
  html = html.replace(/`([^`]+)`/g, '<code class="bg-discord-serverbar rounded px-1 py-0.5 text-sm font-mono">$1</code>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-blue-400 hover:underline">$1</a>')
  html = html.replace(/\n/g, '<br>')
  html = applyCustomEmoji(html)
  return html
}

function applyCustomEmoji (html) {
  if (!state.activeRoom) return html
  const custom = state.roomEmojis.get(state.activeRoom) || new Map()
  for (const [name, src] of custom) {
    const pattern = new RegExp(`:${name}:`, 'g')
    html = html.replace(pattern, `<img src="${src}" alt=":${name}:" class="inline-block h-5 w-5 align-text-bottom rounded">`)
  }
  return html
}

function formatDate (ts) {
  const d = new Date(ts)
  const now = new Date()
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`
  return `${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })} ${time}`
}

function formatTime (ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatTimeShort (ts) {
  return formatTime(ts)
}

function formatBytes (size) {
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

function getDefaultAvatar (name) {
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

function insertAtCursor (el, text) {
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

function fileToBase64 (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function fileToDataURL (file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function base64ToBlob (base64, type) {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type })
}

document.addEventListener('click', (e) => {
  const target = e.target
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

dom.app.classList.remove('hidden')
updateHeaderActionVisibility?.()
updateConnectionGate()
connect()
