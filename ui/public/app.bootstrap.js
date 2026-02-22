const UNICODE_EMOJIS = ['😀', '😂', '😍', '😎', '🤔', '😭', '🔥', '✅', '🎉', '🚀', '💯', '👀', '❤️', '👍', '👎', '🙏', '✨', '🎧', '🎤', '📎', '📁', '😅', '😴', '🤝']

const state = {
  ws: null,
  identity: null,
  profile: { fullName: '', username: '', avatar: null, setupDone: false },
  rooms: new Map(),
  activeRoom: null,
  peers: new Set(),
  membersVisible: true,
  messagesByRoom: new Map(),
  seenIds: new Set(),
  seenSeqByRoom: new Map(),
  historyCursorByRoom: new Map(),
  historyLoadingByRoom: new Map(),
  historyTimeoutByRoom: new Map(),
  roomEmojis: new Map(),
  roomAdmins: new Map(),
  roomOwnerByRoom: new Map(),
  roomBansByRoom: new Map(),
  channelKicksByRoom: new Map(),
  channelsByRoom: new Map(),
  activeTextChannelByRoom: new Map(),
  activeVoiceChannelByRoom: new Map(),
  channelSearchQuery: '',
  activeSearchChannelId: null,
  searchResultsActive: false,
  activeThreadRootId: null,
  pinnedByRoomChannel: new Map(),
  friends: new Map(), // pubKey -> { name }
  friendRequests: new Map(), // pubKey -> { name, roomKey }
  activeDmKey: null,
  linkPreviewCache: new Map(),

  activeCall: null, // { id, mode, roomKey, channelId }
  localCallStream: null,
  peerConnections: new Map(), // peerKey -> RTCPeerConnection
  remoteStreams: new Map(), // peerKey -> MediaStream
  callTheater: false,
  callScreenStream: null,

  settings: {
    cameraId: '',
    micId: '',
    cameraEnabled: true,
    micEnabled: true,
    presenceStatus: 'online',
    noiseCancellation: true,
    notificationTone: 'ping',
    ringtone: 'ring-classic'
  },
  p2pNetworkTest: {
    status: 'idle',
    summary: '',
    checkedAt: 0,
    runToken: 0
  },
  audioPreviewTimer: null,
  ringingTimer: null,
  usernameConflictByRoom: new Map(),
  pendingCreatedRoomProfile: null,
  createRoomDraft: {
    name: '',
    emoji: '😀',
    imageData: null,
    mimeType: null
  },

  boot: {
    connected: false,
    identityReady: false,
    roomDiscoveryReady: false,
    pendingRoomHistory: new Set(),
    loadedRoomHistory: new Set(),
    sessionToken: 0,
    profilePromptShown: false
  }
}

const $ = (sel) => document.querySelector(sel)

const dom = {
  app: $('#app'),
  connectionGate: $('#connectionGate'),
  connectionGateTitle: $('#connectionGateTitle'),
  connectionGateDetail: $('#connectionGateDetail'),
  setupModal: $('#setupModal'),
  setupFullName: $('#setupFullName'),
  setupUsername: $('#setupUsername'),
  setupSubmit: $('#setupSubmit'),
  avatarInput: $('#avatarInput'),
  avatarPreview: $('#avatarPreview'),

  roomModal: $('#roomModal'),
  roomModalStepPick: $('#roomModalStepPick'),
  roomModalStepCreate: $('#roomModalStepCreate'),
  roomModalFooterPick: $('#roomModalFooterPick'),
  roomModalFooterCreate: $('#roomModalFooterCreate'),
  btnAddRoom: $('#btnAddRoom'),
  btnCreateRoom: $('#btnCreateRoom'),
  btnCreateRoomBack: $('#btnCreateRoomBack'),
  btnCreateRoomContinue: $('#btnCreateRoomContinue'),
  btnJoinRoom: $('#btnJoinRoom'),
  joinLinkInput: $('#joinLinkInput'),
  createRoomNameInput: $('#createRoomNameInput'),
  createRoomIconPreview: $('#createRoomIconPreview'),
  btnCreateRoomUploadIcon: $('#btnCreateRoomUploadIcon'),
  btnCreateRoomRandomEmoji: $('#btnCreateRoomRandomEmoji'),
  createRoomIconInput: $('#createRoomIconInput'),
  btnCloseRoomModal: $('#btnCloseRoomModal'),

  inviteModal: $('#inviteModal'),
  inviteLinkDisplay: $('#inviteLinkDisplay'),
  btnCopyInvite: $('#btnCopyInvite'),
  btnCloseInviteModal: $('#btnCloseInviteModal'),
  appDialogModal: $('#appDialogModal'),
  appDialogTitle: $('#appDialogTitle'),
  appDialogMessage: $('#appDialogMessage'),
  appDialogInputWrap: $('#appDialogInputWrap'),
  appDialogInput: $('#appDialogInput'),
  appDialogCancel: $('#appDialogCancel'),
  appDialogConfirm: $('#appDialogConfirm'),

  serverList: $('#serverList'),
  roomTitle: $('#roomTitle'),
  channelSearch: $('#channelSearch'),
  channelSearchDropdown: $('#channelSearchDropdown'),
  btnChannelSearchSubmit: $('#btnChannelSearchSubmit'),
  channelItems: $('#channelItems'),
  textChannelList: $('#textChannelList'),
  voiceChannelList: $('#voiceChannelList'),
  btnAddTextChannel: $('#btnAddTextChannel'),
  btnAddVoiceChannel: $('#btnAddVoiceChannel'),
  noRoomSelected: $('#noRoomSelected'),

  userAvatar: $('#userAvatar'),
  userStatusDot: $('#userStatusDot'),
  userStatusMenu: $('#userStatusMenu'),
  btnAvatarStatus: $('#btnAvatarStatus'),
  userNameDisplay: $('#userNameDisplay'),
  userHandleDisplay: $('#userHandleDisplay'),
  btnProfileQuick: $('#btnProfileQuick'),
  btnToggleMicGlobal: $('#btnToggleMicGlobal'),
  btnToggleCameraGlobal: $('#btnToggleCameraGlobal'),
  micDisabledSlash: $('#micDisabledSlash'),
  cameraDisabledSlash: $('#cameraDisabledSlash'),
  btnUserSettingsSidebar: $('#btnUserSettingsSidebar'),
  btnUserSettings: $('#btnUserSettings'),
  btnInvite: $('#btnInvite'),

  userSettingsModal: $('#userSettingsModal'),
  btnCloseUserSettings: $('#btnCloseUserSettings'),
  btnCancelUserSettings: $('#btnCancelUserSettings'),
  btnSaveUserSettings: $('#btnSaveUserSettings'),
  settingsFullName: $('#settingsFullName'),
  settingsUsername: $('#settingsUsername'),
  settingsAvatarPreview: $('#settingsAvatarPreview'),
  btnChangeAvatar: $('#btnChangeAvatar'),
  settingsCamera: $('#settingsCamera'),
  settingsMic: $('#settingsMic'),
  settingsNoiseCancel: $('#settingsNoiseCancel'),
  settingsNotificationTone: $('#settingsNotificationTone'),
  settingsRingtone: $('#settingsRingtone'),
  btnPreviewNotificationTone: $('#btnPreviewNotificationTone'),
  btnPreviewRingtone: $('#btnPreviewRingtone'),
  settingsP2PStatus: $('#settingsP2PStatus'),
  settingsP2PExplain: $('#settingsP2PExplain'),
  btnRetestP2P: $('#btnRetestP2P'),
  btnResetLocalDB: $('#btnResetLocalDB'),

  welcomeState: $('#welcomeState'),
  chatArea: $('#chatArea'),
  searchResultsView: $('#searchResultsView'),
  messagesScroll: $('#messagesScroll'),
  messages: $('#messages'),
  pinnedBar: $('#pinnedBar'),
  pinnedList: $('#pinnedList'),
  btnClearPinView: $('#btnClearPinView'),
  threadPanel: $('#threadPanel'),
  threadRoot: $('#threadRoot'),
  threadMessages: $('#threadMessages'),
  threadInput: $('#threadInput'),
  btnSendThread: $('#btnSendThread'),
  btnCloseThread: $('#btnCloseThread'),
  callEventFeed: $('#callEventFeed'),
  messageInput: $('#messageInput'),
  chatHeaderTitle: $('#chatHeaderTitle'),
  chatHeaderDesc: $('#chatHeaderDesc'),
  securityPeers: $('#securityPeers'),
  securityKnownMembers: $('#securityKnownMembers'),
  securityConn: $('#securityConn'),
  securityEncrypt: $('#securityEncrypt'),

  membersSidebar: $('#membersSidebar'),
  btnToggleMembers: $('#btnToggleMembers'),
  memberList: $('#memberList'),
  onlineCount: $('#onlineCount'),
  btnHome: $('#btnHome'),

  btnAttachFile: $('#btnAttachFile'),
  fileInput: $('#fileInput'),
  messageComposer: $('#messageComposer'),
  btnEmoji: $('#btnEmoji'),
  emojiPicker: $('#emojiPicker'),
  emojiGrid: $('#emojiGrid'),
  customEmojiGrid: $('#customEmojiGrid'),

  btnAdmin: $('#btnAdmin'),
  adminModal: $('#adminModal'),
  btnCloseAdminModal: $('#btnCloseAdminModal'),
  adminServerNameInput: $('#adminServerNameInput'),
  btnAdminSetServerName: $('#btnAdminSetServerName'),
  adminServerAvatarPreview: $('#adminServerAvatarPreview'),
  btnAdminSetServerAvatar: $('#btnAdminSetServerAvatar'),
  btnAdminClearServerAvatar: $('#btnAdminClearServerAvatar'),
  serverAvatarInput: $('#serverAvatarInput'),
  adminEmojiList: $('#adminEmojiList'),
  btnAdminAddEmoji: $('#btnAdminAddEmoji'),
  adminList: $('#adminList'),
  ownerCurrent: $('#ownerCurrent'),
  ownerTransferInput: $('#ownerTransferInput'),
  btnTransferOwner: $('#btnTransferOwner'),
  btnDisbandGroup: $('#btnDisbandGroup'),
  btnDeleteServer: $('#btnDeleteServer'),
  adminPubKeyInput: $('#adminPubKeyInput'),
  btnAddAdmin: $('#btnAddAdmin'),
  customEmojiInput: $('#customEmojiInput'),
  moderationUserInput: $('#moderationUserInput'),
  moderationChannelSelect: $('#moderationChannelSelect'),
  btnKickUserChannel: $('#btnKickUserChannel'),
  btnBanUser: $('#btnBanUser'),
  btnUnbanUser: $('#btnUnbanUser'),
  adminBanList: $('#adminBanList'),

  friendRequestCount: $('#friendRequestCount'),
  friendRequestList: $('#friendRequestList'),
  friendList: $('#friendList'),

  usernameConflictModal: $('#usernameConflictModal'),
  usernameConflictText: $('#usernameConflictText'),
  usernameConflictSuggestions: $('#usernameConflictSuggestions'),
  usernameConflictCustomInput: $('#usernameConflictCustomInput'),
  btnUsernameConflictApply: $('#btnUsernameConflictApply'),
  usernameConflictError: $('#usernameConflictError'),

  btnVoice: $('#btnVoice'),
  btnVideoCall: $('#btnVideoCall'),
  btnEndCall: $('#btnEndCall'),
  callStage: $('#callStage'),
  callStatus: $('#callStatus'),
  callBitrate: $('#callBitrate'),
  btnCallScreenShare: $('#btnCallScreenShare'),
  btnCallTheater: $('#btnCallTheater'),
  btnCallFullscreen: $('#btnCallFullscreen'),
  localVideo: $('#localVideo'),
  remoteVideos: $('#remoteVideos')
}

const appDialogQueue = []
let activeAppDialog = null

loadClientSettings()
initAppDialogs()

const BOOT_ROOM_DISCOVERY_WAIT_MS = 900
const CLIENT_SETTINGS_KEY = 'neet-client-settings-v1'
const PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible', 'offline']
let localDbResetPending = false

function initAppDialogs () {
  if (!dom.appDialogModal || !dom.appDialogConfirm || !dom.appDialogCancel) return

  dom.appDialogConfirm.addEventListener('click', () => resolveActiveAppDialog(true))
  dom.appDialogCancel.addEventListener('click', () => resolveActiveAppDialog(false))
  dom.appDialogModal.addEventListener('click', (event) => {
    if (event.target !== dom.appDialogModal) return
    if (activeAppDialog?.mode === 'alert') resolveActiveAppDialog(true)
    else resolveActiveAppDialog(false)
  })

  document.addEventListener('keydown', (event) => {
    if (!activeAppDialog || event.key !== 'Escape') return
    event.preventDefault()
    if (activeAppDialog.mode === 'alert') resolveActiveAppDialog(true)
    else resolveActiveAppDialog(false)
  })

  dom.appDialogInput?.addEventListener('keydown', (event) => {
    if (!activeAppDialog) return
    if (event.key === 'Enter') {
      event.preventDefault()
      resolveActiveAppDialog(true)
    }
  })
}

function queueAppDialog (options) {
  return new Promise((resolve) => {
    appDialogQueue.push({ ...options, resolve })
    pumpAppDialogQueue()
  })
}

function pumpAppDialogQueue () {
  if (activeAppDialog || appDialogQueue.length === 0 || !dom.appDialogModal) return
  activeAppDialog = appDialogQueue.shift()

  const title = String(activeAppDialog.title || 'Neet')
  const message = String(activeAppDialog.message || '')
  const mode = activeAppDialog.mode || 'alert'
  const showInput = mode === 'prompt'
  const showCancel = mode !== 'alert'

  if (dom.appDialogTitle) dom.appDialogTitle.textContent = title
  if (dom.appDialogMessage) dom.appDialogMessage.textContent = message
  dom.appDialogInputWrap?.classList.toggle('hidden', !showInput)

  if (dom.appDialogInput) {
    dom.appDialogInput.value = showInput ? String(activeAppDialog.defaultValue || '') : ''
    dom.appDialogInput.placeholder = String(activeAppDialog.placeholder || '')
  }

  dom.appDialogCancel?.classList.toggle('hidden', !showCancel)
  if (dom.appDialogCancel) dom.appDialogCancel.textContent = String(activeAppDialog.cancelText || 'Cancel')
  if (dom.appDialogConfirm) dom.appDialogConfirm.textContent = String(activeAppDialog.confirmText || 'OK')

  dom.appDialogModal.classList.remove('hidden')
  dom.appDialogModal.classList.add('flex')

  requestAnimationFrame(() => {
    if (!activeAppDialog) return
    if (showInput && dom.appDialogInput) {
      dom.appDialogInput.focus()
      dom.appDialogInput.select()
      return
    }
    dom.appDialogConfirm?.focus()
  })
}

function resolveActiveAppDialog (confirmed) {
  if (!activeAppDialog) return
  const current = activeAppDialog
  activeAppDialog = null

  if (dom.appDialogModal) {
    dom.appDialogModal.classList.add('hidden')
    dom.appDialogModal.classList.remove('flex')
  }

  if (current.mode === 'confirm') {
    current.resolve(Boolean(confirmed))
  } else if (current.mode === 'prompt') {
    if (!confirmed) current.resolve(null)
    else current.resolve(String(dom.appDialogInput?.value || ''))
  } else {
    current.resolve()
  }

  pumpAppDialogQueue()
}

function appAlert (message, options = {}) {
  return queueAppDialog({
    mode: 'alert',
    title: options.title || 'Neet',
    message,
    confirmText: options.confirmText || 'OK'
  })
}

function appConfirm (message, options = {}) {
  return queueAppDialog({
    mode: 'confirm',
    title: options.title || 'Neet',
    message,
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel'
  })
}

function appPrompt (message, options = {}) {
  return queueAppDialog({
    mode: 'prompt',
    title: options.title || 'Neet',
    message,
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder || '',
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel'
  })
}

function loadClientSettings () {
  try {
    const raw = localStorage.getItem(CLIENT_SETTINGS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    state.settings = {
      ...state.settings,
      cameraId: String(parsed.cameraId || ''),
      micId: String(parsed.micId || ''),
      cameraEnabled: parsed.cameraEnabled !== false,
      micEnabled: parsed.micEnabled !== false,
      presenceStatus: PRESENCE_STATUSES.includes(parsed.presenceStatus) ? parsed.presenceStatus : 'online',
      noiseCancellation: parsed.noiseCancellation !== false,
      notificationTone: String(parsed.notificationTone || 'ping'),
      ringtone: String(parsed.ringtone || 'ring-classic')
    }
  } catch {}
}

function saveClientSettings () {
  try {
    localStorage.setItem(CLIENT_SETTINGS_KEY, JSON.stringify({
      cameraId: state.settings.cameraId,
      micId: state.settings.micId,
      cameraEnabled: state.settings.cameraEnabled !== false,
      micEnabled: state.settings.micEnabled !== false,
      presenceStatus: state.settings.presenceStatus || 'online',
      noiseCancellation: state.settings.noiseCancellation,
      notificationTone: state.settings.notificationTone,
      ringtone: state.settings.ringtone
    }))
  } catch {}
}

function setResetButtonBusy (busy) {
  if (!dom.btnResetLocalDB) return
  dom.btnResetLocalDB.disabled = busy
  dom.btnResetLocalDB.classList.toggle('opacity-60', busy)
  dom.btnResetLocalDB.classList.toggle('cursor-not-allowed', busy)
  dom.btnResetLocalDB.textContent = busy ? 'Deleting…' : 'Delete Local DB & Restart'
}

function handleLocalDbResetReady () {
  localDbResetPending = false
  setResetButtonBusy(false)

  try {
    localStorage.removeItem(CLIENT_SETTINGS_KEY)
  } catch {}

  closeUserSettings()
  dom.userStatusMenu?.classList.add('hidden')

  appAlert('Local DB was deleted. Neet will close now. Relaunch the app to continue with Introduce yourself.', {
    title: 'Reset complete',
    confirmText: 'Close'
  }).finally(() => {
    setTimeout(() => {
      try { window.close() } catch {}
    }, 120)
  })
}

function stopRingtoneLoop () {
  if (state.ringingTimer) clearInterval(state.ringingTimer)
  state.ringingTimer = null
}

function playTonePreset (name) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return

  const ctx = new AudioCtx()
  const now = ctx.currentTime
  const steps = {
    ping: [[880, 0.08, 0], [660, 0.1, 0.09]],
    chime: [[523.25, 0.1, 0], [659.25, 0.12, 0.11], [783.99, 0.16, 0.24]],
    knock: [[210, 0.08, 0], [200, 0.08, 0.12], [190, 0.1, 0.24]],
    'ring-classic': [[659.25, 0.18, 0], [783.99, 0.18, 0.22], [659.25, 0.18, 0.44]],
    'ring-soft': [[440, 0.2, 0], [554.37, 0.2, 0.24], [659.25, 0.2, 0.48]],
    'ring-bell': [[987.77, 0.16, 0], [880, 0.16, 0.2], [783.99, 0.24, 0.4]]
  }

  const seq = steps[name] || steps.ping
  for (const [freq, duration, offset] of seq) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now + offset)
    gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now + offset)
    osc.stop(now + offset + duration)
  }

  const total = Math.max(...seq.map(([, d, o]) => d + o)) + 0.2
  setTimeout(() => { ctx.close().catch(() => {}) }, total * 1000)
}

function playNotificationTone () {
  playTonePreset(state.settings.notificationTone)
}

function startRingtoneLoop () {
  stopRingtoneLoop()
  playTonePreset(state.settings.ringtone)
  state.ringingTimer = setInterval(() => {
    playTonePreset(state.settings.ringtone)
  }, 1800)
}

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

function connect () {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  state.ws = new WebSocket(`${proto}://${location.host}`)
  state.ws.onopen = () => {
    console.log('[ws] connected')
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
  state.ws.onmessage = (e) => handleServerMessage(JSON.parse(e.data))
  state.ws.onclose = () => {
    console.log('[ws] disconnected, reconnecting in 2s…')
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
    setTimeout(connect, 2000)
  }
}

function send (msg) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg))
  }
}

function handleServerMessage (msg) {
  switch (msg.type) {
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
      updateUserPanel()
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
      addRoom(msg.roomKey, msg.link)
      applyPendingCreatedRoomProfile(msg.roomKey)
      selectRoom(msg.roomKey)
      requestRoomHistory(msg.roomKey, { count: 100 })
      break

    case 'room-joined':
      addRoom(msg.roomKey, msg.link)
      selectRoom(msg.roomKey)
      requestRoomHistory(msg.roomKey, { count: 100 })
      break

    case 'room-info':
      addRoom(msg.roomKey, msg.link)
      send({ type: 'watch-room', roomKey: msg.roomKey })
      requestRoomHistory(msg.roomKey, { count: 100 })
      break

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
        if (action === 'friend-request' || action === 'friend-accept') rebuildFriends(msg.roomKey)
        if (action === 'room-ban' || action === 'room-unban' || action === 'room-kick' || action === 'room-unkick' || action === 'channel-kick' || action === 'channel-unkick') rebuildModerationState(msg.roomKey)
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

      if (state.activeRoom === msg.roomKey) {
        updateAdminControls()
        renderChannelLists()
        renderPinnedBar()
        renderEmojiPicker()
        renderAdminPanel()
        renderThreadPanel()
        renderFriendsHome()
        if (msg.msg?.type === 'system' && msg.msg.action === 'message-edit') renderMessages()
        else appendMessage(msg.msg)
        scrollToBottom()
        ensureUsernameUniquenessForRoom(msg.roomKey)
      } else {
        markUnread(msg.roomKey)
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
    btn.className = 'rounded-md px-3 py-2 text-left text-sm bg-discord-serverbar hover:bg-discord-hover'
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

function openUserSettings () {
  dom.userStatusMenu?.classList.add('hidden')
  hydrateSettingsModal()
  dom.userSettingsModal?.classList.remove('hidden')
  runP2PNetworkTest()
  refreshMediaDevices().catch(() => {})
}

function closeUserSettings () {
  dom.userSettingsModal?.classList.add('hidden')
}

function renderStatusMenuSelection () {
  const current = state.settings.presenceStatus || 'online'
  for (const option of document.querySelectorAll('.status-option')) {
    const value = option.getAttribute('data-status')
    const selected = value === current
    option.classList.toggle('bg-discord-active', selected)
    option.setAttribute('aria-checked', String(selected))
  }
}

function positionStatusMenu () {
  if (!dom.userStatusMenu || !dom.btnProfileQuick) return
  const anchorRect = dom.btnProfileQuick.getBoundingClientRect()
  const menuWidth = 164
  const viewportPadding = 8

  const left = Math.max(
    viewportPadding,
    Math.min(anchorRect.left + 6, window.innerWidth - menuWidth - viewportPadding)
  )
  const top = Math.max(viewportPadding, anchorRect.top - 8)

  dom.userStatusMenu.style.position = 'fixed'
  dom.userStatusMenu.style.left = `${left}px`
  dom.userStatusMenu.style.top = `${top}px`
  dom.userStatusMenu.style.bottom = 'auto'
  dom.userStatusMenu.style.zIndex = '120'
  dom.userStatusMenu.style.width = `${menuWidth}px`
  dom.userStatusMenu.style.transform = 'translateY(-100%)'
}

function toggleStatusMenu (forceOpen) {
  if (!dom.userStatusMenu) return
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : dom.userStatusMenu.classList.contains('hidden')
  if (shouldOpen) positionStatusMenu()
  dom.userStatusMenu.classList.toggle('hidden', !shouldOpen)
  if (shouldOpen) renderStatusMenuSelection()
}

function hydrateSettingsModal () {
  if (!dom.settingsFullName) return
  dom.settingsFullName.value = state.profile.fullName || ''
  dom.settingsUsername.value = state.profile.username || ''
  dom.settingsNoiseCancel.checked = Boolean(state.settings.noiseCancellation)
  dom.settingsNotificationTone.value = state.settings.notificationTone
  dom.settingsRingtone.value = state.settings.ringtone

  if (state.profile.avatar) {
    dom.settingsAvatarPreview.innerHTML = `<img src="${state.profile.avatar}" class="w-full h-full object-cover">`
  } else {
    dom.settingsAvatarPreview.textContent = (state.profile.fullName || state.profile.username || '?').charAt(0).toUpperCase()
  }

  renderP2PNetworkStatus()
}

function getP2PNetworkStatusText () {
  const label = state.p2pNetworkTest.summary || ''
  if (state.p2pNetworkTest.status === 'testing') return '🟡 Checking your connection for direct peer-to-peer paths…'
  if (state.p2pNetworkTest.status === 'friendly') return `🟢 Good news: direct P2P should work (${label || 'public route found'})`
  if (state.p2pNetworkTest.status === 'unfriendly') return `🔴 Direct P2P may be limited (${label || 'only local ICE routes found'})`
  if (state.p2pNetworkTest.status === 'error') return `🔴 We could not complete the network check (${label || 'WebRTC is unavailable'})`
  return '🟡 Network test not run yet'
}

function getP2PNetworkExplanationText () {
  if (state.p2pNetworkTest.status === 'testing') {
    return 'This test checks whether your device can connect directly to other peers on the internet.'
  }

  if (state.p2pNetworkTest.status === 'friendly') {
    return 'Your network looks P2P-friendly, so HyperSwarm can usually establish direct peer connections quickly.'
  }

  if (state.p2pNetworkTest.status === 'unfriendly') {
    return 'Your router/firewall is likely strict. HyperSwarm will still try DHT discovery + NAT hole-punching, keep retrying peers, and connect where possible (often same-LAN or more open peers).'
  }

  if (state.p2pNetworkTest.status === 'error') {
    return 'The test could not run in this environment. HyperSwarm still attempts normal peer discovery and connection setup in the background.'
  }

  return 'Run the test to estimate how easily your device can form direct peer-to-peer links.'
}

function renderP2PNetworkStatus () {
  if (!dom.settingsP2PStatus) return
  dom.settingsP2PStatus.textContent = getP2PNetworkStatusText()
  if (dom.settingsP2PExplain) dom.settingsP2PExplain.textContent = getP2PNetworkExplanationText()
  if (dom.btnRetestP2P) {
    const testing = state.p2pNetworkTest.status === 'testing'
    dom.btnRetestP2P.disabled = testing
    dom.btnRetestP2P.classList.toggle('opacity-60', testing)
    dom.btnRetestP2P.classList.toggle('cursor-not-allowed', testing)
    dom.btnRetestP2P.textContent = testing ? 'Testing…' : 'Refresh / Retest'
  }
}

function extractIceCandidateType (candidateLine) {
  if (!candidateLine) return ''
  const match = String(candidateLine).match(/\btyp\s+([a-z]+)/i)
  return (match?.[1] || '').toLowerCase()
}

function summarizeCandidateTypes (typesSet) {
  const types = [...typesSet].filter(Boolean)
  if (types.length === 0) return 'no ICE candidates gathered'
  return `candidate types: ${types.join(', ')}`
}

function probeP2PNetwork () {
  return new Promise((resolve) => {
    if (!window.RTCPeerConnection) {
      resolve({ status: 'error', summary: 'WebRTC unsupported in this browser' })
      return
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      iceCandidatePoolSize: 1
    })

    const candidateTypes = new Set()
    let settled = false
    let timer = null

    const finish = (payload) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try { pc.close() } catch {}
      resolve(payload)
    }

    pc.onicecandidate = (event) => {
      if (event.candidate?.candidate) {
        const typ = extractIceCandidateType(event.candidate.candidate)
        if (typ) candidateTypes.add(typ)
      }
      if (!event.candidate) {
        const friendly = candidateTypes.has('srflx') || candidateTypes.has('relay')
        finish({
          status: friendly ? 'friendly' : 'unfriendly',
          summary: summarizeCandidateTypes(candidateTypes)
        })
      }
    }

    pc.onicecandidateerror = () => {
      if (candidateTypes.size > 0) return
      finish({ status: 'error', summary: 'ICE candidate discovery failed' })
    }

    timer = setTimeout(() => {
      const friendly = candidateTypes.has('srflx') || candidateTypes.has('relay')
      finish({
        status: candidateTypes.size ? (friendly ? 'friendly' : 'unfriendly') : 'error',
        summary: candidateTypes.size ? summarizeCandidateTypes(candidateTypes) : 'timeout waiting for ICE candidates'
      })
    }, 4500)

    pc.createDataChannel('neet-p2p-test')
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish({ status: 'error', summary: 'failed to create WebRTC offer' }))
  })
}

async function runP2PNetworkTest () {
  const now = Date.now()
  const recentlyChecked = now - state.p2pNetworkTest.checkedAt < 30000
  const currentlyTesting = state.p2pNetworkTest.status === 'testing'
  if (currentlyTesting || recentlyChecked) {
    renderP2PNetworkStatus()
    return
  }

  const token = state.p2pNetworkTest.runToken + 1
  state.p2pNetworkTest.runToken = token
  state.p2pNetworkTest.status = 'testing'
  state.p2pNetworkTest.summary = ''
  renderP2PNetworkStatus()

  const result = await probeP2PNetwork()
  if (token !== state.p2pNetworkTest.runToken) return

  state.p2pNetworkTest.status = result.status
  state.p2pNetworkTest.summary = result.summary
  state.p2pNetworkTest.checkedAt = Date.now()
  renderP2PNetworkStatus()
}

async function refreshMediaDevices () {
  if (!navigator.mediaDevices?.enumerateDevices) return

  try {
    const warmup = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    for (const track of warmup.getTracks()) track.stop()
  } catch {}

  const devices = await navigator.mediaDevices.enumerateDevices()
  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput')

  if (dom.settingsCamera) {
    dom.settingsCamera.innerHTML = '<option value="">System default camera</option>'
    for (const [idx, camera] of cameras.entries()) {
      const option = document.createElement('option')
      option.value = camera.deviceId
      option.textContent = camera.label || `Camera ${idx + 1}`
      dom.settingsCamera.appendChild(option)
    }
    dom.settingsCamera.value = state.settings.cameraId
  }

  if (dom.settingsMic) {
    dom.settingsMic.innerHTML = '<option value="">System default microphone</option>'
    for (const [idx, mic] of mics.entries()) {
      const option = document.createElement('option')
      option.value = mic.deviceId
      option.textContent = mic.label || `Microphone ${idx + 1}`
      dom.settingsMic.appendChild(option)
    }
    dom.settingsMic.value = state.settings.micId
  }
}

dom.btnUserSettings?.addEventListener('click', openUserSettings)
dom.btnUserSettingsSidebar?.addEventListener('click', (e) => {
  e.stopPropagation()
  openUserSettings()
})
dom.btnProfileQuick?.addEventListener('click', (event) => {
  if (event.target?.closest('#btnToggleMicGlobal') || event.target?.closest('#btnToggleCameraGlobal') || event.target?.closest('#btnUserSettingsSidebar')) return
  event.stopPropagation()
  toggleStatusMenu()
})

dom.btnAvatarStatus?.addEventListener('click', (event) => {
  event.stopPropagation()
  toggleStatusMenu()
})

for (const option of document.querySelectorAll('.status-option')) {
  option.addEventListener('click', () => {
    const value = option.getAttribute('data-status')
    if (!value || typeof setPresenceStatus !== 'function') return
    setPresenceStatus(value)
    renderStatusMenuSelection()
    dom.userStatusMenu?.classList.add('hidden')
  })
}

document.addEventListener('click', (event) => {
  if (!dom.userStatusMenu || dom.userStatusMenu.classList.contains('hidden')) return
  if (event.target?.closest('#btnProfileQuick') || event.target?.closest('#userStatusMenu')) return
  dom.userStatusMenu.classList.add('hidden')
})

window.addEventListener('resize', () => {
  if (!dom.userStatusMenu || dom.userStatusMenu.classList.contains('hidden')) return
  positionStatusMenu()
})

dom.btnToggleMicGlobal?.addEventListener('click', (event) => {
  event.stopPropagation()
  if (typeof toggleGlobalMicrophone === 'function') toggleGlobalMicrophone()
})

dom.btnToggleCameraGlobal?.addEventListener('click', (event) => {
  event.stopPropagation()
  if (typeof toggleGlobalCamera === 'function') toggleGlobalCamera()
})

dom.btnCloseUserSettings?.addEventListener('click', closeUserSettings)
dom.btnCancelUserSettings?.addEventListener('click', closeUserSettings)

dom.btnSaveUserSettings?.addEventListener('click', async () => {
  const fullName = (dom.settingsFullName?.value || '').trim()
  const username = sanitizeUsername(dom.settingsUsername?.value || '')
  if (!fullName || !username) {
    await appAlert('Full name and username are required.', { title: 'Incomplete profile' })
    return
  }

  state.profile.fullName = fullName
  state.profile.username = username
  state.settings.cameraId = dom.settingsCamera?.value || ''
  state.settings.micId = dom.settingsMic?.value || ''
  state.settings.noiseCancellation = Boolean(dom.settingsNoiseCancel?.checked)
  state.settings.notificationTone = dom.settingsNotificationTone?.value || 'ping'
  state.settings.ringtone = dom.settingsRingtone?.value || 'ring-classic'
  saveClientSettings()

  send({
    type: 'set-profile',
    fullName,
    username,
    avatar: state.profile.avatar
  })

  hydrateSetupModal()
  updateUserPanel()
  closeUserSettings()
})

dom.btnPreviewNotificationTone?.addEventListener('click', () => {
  state.settings.notificationTone = dom.settingsNotificationTone?.value || 'ping'
  saveClientSettings()
  playTonePreset(state.settings.notificationTone)
})

dom.btnPreviewRingtone?.addEventListener('click', () => {
  state.settings.ringtone = dom.settingsRingtone?.value || 'ring-classic'
  saveClientSettings()
  playTonePreset(state.settings.ringtone)
})

dom.btnRetestP2P?.addEventListener('click', () => {
  state.p2pNetworkTest.checkedAt = 0
  runP2PNetworkTest()
})

dom.btnResetLocalDB?.addEventListener('click', async () => {
  if (localDbResetPending) return

  const confirmed = await appConfirm('Delete all local DB data for this device and restart from Introduce yourself on next launch?', {
    title: 'Delete local DB',
    confirmText: 'Delete Local DB',
    cancelText: 'Cancel'
  })
  if (!confirmed) return

  localDbResetPending = true
  setResetButtonBusy(true)

  try {
    const response = await fetch('/__reset-local-db', { method: 'POST' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    handleLocalDbResetReady()
    return
  } catch {}

  if (state.ws?.readyState === WebSocket.OPEN) {
    send({ type: 'reset-local-db' })
    setTimeout(async () => {
      if (!localDbResetPending) return
      localDbResetPending = false
      setResetButtonBusy(false)
      await appAlert('Could not confirm local DB reset. Please try again.', { title: 'Reset failed' })
    }, 5000)
    return
  }

  localDbResetPending = false
  setResetButtonBusy(false)
  await appAlert('The app core is offline, so reset could not run. Reconnect and try again.', { title: 'Reset unavailable' })
})

dom.btnChangeAvatar?.addEventListener('click', (e) => {
  e.preventDefault()
  dom.avatarInput.click()
})

// Room modal

const CREATE_ROOM_EMOJI_OPTIONS = ['😀', '😎', '🚀', '🎯', '🎮', '🧠', '🛸', '🐳', '🦄', '🌈', '⚡', '🔥', '🍀', '🐙', '🦊', '🌙', '⭐', '🧩']

function pickCreateRoomEmoji () {
  const idx = Math.floor(Math.random() * CREATE_ROOM_EMOJI_OPTIONS.length)
  return CREATE_ROOM_EMOJI_OPTIONS[idx]
}

function normalizeCreateRoomName (value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 48)
}

function resetCreateRoomDraft () {
  const fallback = state.profile.fullName
    ? `${state.profile.fullName}'s server`
    : (state.profile.username ? `${state.profile.username}'s server` : 'My Server')

  state.createRoomDraft = {
    name: normalizeCreateRoomName(fallback) || 'My Server',
    emoji: pickCreateRoomEmoji(),
    imageData: null,
    mimeType: null
  }
}

function renderCreateRoomDraft () {
  if (dom.createRoomNameInput) dom.createRoomNameInput.value = state.createRoomDraft.name || ''

  if (dom.createRoomIconPreview) {
    if (state.createRoomDraft.imageData) {
      dom.createRoomIconPreview.innerHTML = `<img src="${state.createRoomDraft.imageData}" class="w-full h-full object-cover">`
    } else {
      dom.createRoomIconPreview.textContent = state.createRoomDraft.emoji || '😀'
    }
  }

  if (dom.btnCreateRoomContinue) {
    const ok = Boolean(normalizeCreateRoomName(state.createRoomDraft.name))
    dom.btnCreateRoomContinue.disabled = !ok
    dom.btnCreateRoomContinue.classList.toggle('opacity-60', !ok)
    dom.btnCreateRoomContinue.classList.toggle('cursor-not-allowed', !ok)
  }
}

function showRoomModalStep (step) {
  const creating = step === 'create'
  dom.roomModalStepPick?.classList.toggle('hidden', creating)
  dom.roomModalFooterPick?.classList.toggle('hidden', creating)
  dom.roomModalStepCreate?.classList.toggle('hidden', !creating)
  dom.roomModalFooterCreate?.classList.toggle('hidden', !creating)
}

function openRoomModal () {
  dom.roomModal.classList.remove('hidden')
  dom.joinLinkInput.value = ''
  dom.btnJoinRoom.disabled = true
  resetCreateRoomDraft()
  renderCreateRoomDraft()
  showRoomModalStep('pick')
}

function closeRoomModal () {
  dom.roomModal.classList.add('hidden')
  showRoomModalStep('pick')
}

function applyPendingCreatedRoomProfile (roomKey) {
  const pending = state.pendingCreatedRoomProfile
  if (!pending) return
  state.pendingCreatedRoomProfile = null

  const room = state.rooms.get(roomKey)
  if (room) {
    room.name = pending.name || room.name
    room.iconEmoji = pending.imageData ? (pending.emoji || room.iconEmoji) : (pending.emoji || room.iconEmoji)
    room.iconImage = pending.imageData || null
  }

  if (typeof renderServerList === 'function') renderServerList()

  send({
    type: 'set-room-profile',
    roomKey,
    emoji: pending.emoji || '😀',
    imageData: pending.imageData || null,
    mimeType: pending.mimeType || null
  })
}

dom.btnAddRoom.addEventListener('click', () => {
  openRoomModal()
})

dom.btnCloseRoomModal.addEventListener('click', () => closeRoomModal())

dom.btnCreateRoom.addEventListener('click', () => {
  resetCreateRoomDraft()
  renderCreateRoomDraft()
  showRoomModalStep('create')
})

dom.btnCreateRoomBack?.addEventListener('click', () => showRoomModalStep('pick'))

dom.createRoomNameInput?.addEventListener('input', (event) => {
  state.createRoomDraft.name = normalizeCreateRoomName(event.target?.value || '')
  renderCreateRoomDraft()
})

dom.btnCreateRoomRandomEmoji?.addEventListener('click', (event) => {
  event.preventDefault()
  state.createRoomDraft.emoji = pickCreateRoomEmoji()
  state.createRoomDraft.imageData = null
  state.createRoomDraft.mimeType = null
  renderCreateRoomDraft()
})

dom.btnCreateRoomUploadIcon?.addEventListener('click', (event) => {
  event.preventDefault()
  dom.createRoomIconInput?.click()
})

dom.createRoomIconInput?.addEventListener('change', async (event) => {
  const file = event.target?.files?.[0]
  if (!file) return
  state.createRoomDraft.imageData = await fileToDataURL(file)
  state.createRoomDraft.mimeType = file.type || 'image/webp'
  renderCreateRoomDraft()
})

dom.btnCreateRoomContinue?.addEventListener('click', () => {
  const name = normalizeCreateRoomName(state.createRoomDraft.name)
  if (!name) return

  state.pendingCreatedRoomProfile = {
    name,
    emoji: state.createRoomDraft.emoji || '😀',
    imageData: state.createRoomDraft.imageData || null,
    mimeType: state.createRoomDraft.mimeType || null
  }

  send({ type: 'create-room' })
  closeRoomModal()
})

dom.joinLinkInput.addEventListener('input', () => {
  dom.btnJoinRoom.disabled = !dom.joinLinkInput.value.trim()
})

dom.joinLinkInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !dom.btnJoinRoom.disabled) {
    e.preventDefault()
    joinRoom()
  }
})

dom.btnJoinRoom.addEventListener('click', joinRoom)

function joinRoom () {
  const link = dom.joinLinkInput.value.trim()
  if (!link) return
  send({ type: 'join-room', link })
  closeRoomModal()
}

function requestRoomHistory (roomKey, { count = 100, beforeSeq = null } = {}) {
  if (!roomKey) return
  if (state.historyLoadingByRoom.get(roomKey)) return

  const isInitialPage = beforeSeq == null
  if (isInitialPage && state.boot.identityReady && !state.boot.loadedRoomHistory.has(roomKey)) {
    state.boot.pendingRoomHistory.add(roomKey)
    updateConnectionGate()
  }

  state.historyLoadingByRoom.set(roomKey, true)
  armHistoryRequestTimeout(roomKey)
  send({ type: 'get-history', roomKey, count, beforeSeq })
}

function armHistoryRequestTimeout (roomKey) {
  clearHistoryRequestTimeout(roomKey)
  const timer = setTimeout(() => {
    state.historyLoadingByRoom.set(roomKey, false)
    state.boot.pendingRoomHistory.delete(roomKey)
    updateConnectionGate()
  }, 12000)
  state.historyTimeoutByRoom.set(roomKey, timer)
}

function clearHistoryRequestTimeout (roomKey) {
  const timer = state.historyTimeoutByRoom.get(roomKey)
  if (timer) clearTimeout(timer)
  state.historyTimeoutByRoom.delete(roomKey)
}

function clearHistoryTimers () {
  for (const timer of state.historyTimeoutByRoom.values()) {
    clearTimeout(timer)
  }
  state.historyTimeoutByRoom.clear()
}

// Invite modal

dom.btnInvite.addEventListener('click', () => {
  const room = state.rooms.get(state.activeRoom)
  if (!room) return
  dom.inviteLinkDisplay.value = room.link
  dom.inviteModal.classList.remove('hidden')
})

dom.btnCloseInviteModal.addEventListener('click', () => dom.inviteModal.classList.add('hidden'))
dom.btnCopyInvite.addEventListener('click', async () => {
  await navigator.clipboard.writeText(dom.inviteLinkDisplay.value)
  dom.btnCopyInvite.textContent = 'Copied!'
  setTimeout(() => { dom.btnCopyInvite.textContent = 'Copy' }, 1400)
})

