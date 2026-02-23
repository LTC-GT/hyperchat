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
  messageReactionsByRoom: new Map(),
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
  callRecording: {
    active: false,
    recorder: null,
    mixedStream: null,
    chunks: [],
    mimeType: '',
    canvas: null,
    canvasStream: null,
    animationFrame: 0,
    audioContext: null,
    audioDestination: null,
    audioSources: new Map(),
    audioSyncTimer: null,
    includeSelf: true,
    startedAt: 0
  },
  sessionCallEventsByRoom: new Map(), // roomKey -> [{ id, msg }]

  settings: {
    cameraId: '',
    micId: '',
    cameraEnabled: true,
    micEnabled: true,
    presenceStatus: 'active',
    noiseCancellation: true,
    enableHD: true,
    recordSelfInCall: true,
    callBitrateMode: 'auto',
    notificationTone: 'chime',
    ringtone: 'ring-bell'
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
  pendingSeedPhrase: '',

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
  seedBackupModal: $('#seedBackupModal'),
  seedPhraseText: $('#seedPhraseText'),
  btnSeedBackupCopy: $('#btnSeedBackupCopy'),
  btnSeedBackupContinue: $('#btnSeedBackupContinue'),

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
  userSettingsScaleWrap: $('#userSettingsScaleWrap'),
  userSettingsPanel: $('#userSettingsPanel'),
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
  settingsEnableHD: $('#settingsEnableHD'),
  settingsRecordSelf: $('#settingsRecordSelf'),
  settingsNotificationTone: $('#settingsNotificationTone'),
  settingsRingtone: $('#settingsRingtone'),
  btnPreviewNotificationTone: $('#btnPreviewNotificationTone'),
  btnPreviewRingtone: $('#btnPreviewRingtone'),
  settingsP2PStatus: $('#settingsP2PStatus'),
  settingsP2PExplain: $('#settingsP2PExplain'),
  btnRetestP2P: $('#btnRetestP2P'),
  btnDownloadSeedPhrase: $('#btnDownloadSeedPhrase'),
  btnUploadSeedPhrase: $('#btnUploadSeedPhrase'),
  seedPhraseUploadInput: $('#seedPhraseUploadInput'),
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
  roomWelcome: $('#roomWelcome'),
  roomWelcomeTitle: $('#roomWelcomeTitle'),
  roomWelcomeDesc: $('#roomWelcomeDesc'),
  messageInput: $('#messageInput'),
  chatHeaderTitle: $('#chatHeaderTitle'),
  chatHeaderDesc: $('#chatHeaderDesc'),
  securityStatusBtn: $('#securityStatusBtn'),
  securityTooltip: $('#securityTooltip'),
  securityPeers: $('#securityPeers'),
  securityKnownMembers: $('#securityKnownMembers'),
  securityConn: $('#securityConn'),
  securityEncrypt: $('#securityEncrypt'),

  membersSidebar: $('#membersSidebar'),
  btnToggleMembers: $('#btnToggleMembers'),
  memberListActive: $('#memberListActive'),
  memberListAway: $('#memberListAway'),
  onlineActiveCount: $('#onlineActiveCount'),
  onlineAwayCount: $('#onlineAwayCount'),
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
  btnCallControls: $('#btnCallControls'),
  callControlsMenu: $('#callControlsMenu'),
  callBitrateMenu: $('#callBitrateMenu'),
  btnCallMicMenu: $('#btnCallMicMenu'),
  btnCallCameraMenu: $('#btnCallCameraMenu'),
  btnCallScreenShareMenu: $('#btnCallScreenShareMenu'),
  btnCallRecordMenu: $('#btnCallRecordMenu'),
  btnCallTheaterMenu: $('#btnCallTheaterMenu'),
  btnCallFullscreenMenu: $('#btnCallFullscreenMenu'),
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
const WS_CONNECT_TIMEOUT_MS = 8000
const WS_RECONNECT_DELAY_MS = 2000
const CLIENT_SETTINGS_KEY = 'quibble-client-settings-v1'
const LEGACY_CLIENT_SETTINGS_KEY = 'quibble-client-settings-v0'
const PRESENCE_STATUSES = ['active', 'away']
let localDbResetPending = false
let wsSessionToken = 0
let wsConnectTimeout = null
let wsReconnectTimer = null

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

  const title = String(activeAppDialog.title || 'Quibble')
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
    title: options.title || 'Quibble',
    message,
    confirmText: options.confirmText || 'OK'
  })
}

function appConfirm (message, options = {}) {
  return queueAppDialog({
    mode: 'confirm',
    title: options.title || 'Quibble',
    message,
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel'
  })
}

function appPrompt (message, options = {}) {
  return queueAppDialog({
    mode: 'prompt',
    title: options.title || 'Quibble',
    message,
    defaultValue: options.defaultValue || '',
    placeholder: options.placeholder || '',
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel'
  })
}

function downloadTextFile (fileName, content) {
  const blob = new Blob([String(content || '')], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = String(fileName || 'seed-phrase.txt')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function parseSeedPhraseInput (raw) {
  const text = String(raw || '').trim()
  if (!text) return ''

  try {
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed.seedPhrase === 'string') {
      return String(parsed.seedPhrase).trim()
    }
  } catch {}

  return text
}

function hideSeedBackupModal () {
  dom.seedBackupModal?.classList.add('hidden')
}

function showSeedBackupModal (payload) {
  const phrase = String(payload?.seedPhrase || '').trim()

  state.pendingSeedPhrase = phrase
  if (dom.seedPhraseText) dom.seedPhraseText.textContent = phrase
  dom.seedBackupModal?.classList.remove('hidden')
}

function loadClientSettings () {
  try {
    const raw = localStorage.getItem(CLIENT_SETTINGS_KEY) || localStorage.getItem(LEGACY_CLIENT_SETTINGS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    state.settings = {
      ...state.settings,
      cameraId: String(parsed.cameraId || ''),
      micId: String(parsed.micId || ''),
      cameraEnabled: parsed.cameraEnabled !== false,
      micEnabled: parsed.micEnabled !== false,
      presenceStatus: PRESENCE_STATUSES.includes(parsed.presenceStatus)
        ? parsed.presenceStatus
        : (parsed.presenceStatus === 'online' ? 'active' : 'away'),
      noiseCancellation: parsed.noiseCancellation !== false,
      enableHD: parsed.enableHD !== false,
      recordSelfInCall: parsed.recordSelfInCall !== false,
      callBitrateMode: (String(parsed.callBitrateMode || 'auto').toLowerCase() === 'auto' || Number(parsed.callBitrateMode) > 0)
        ? String(parsed.callBitrateMode || 'auto').toLowerCase()
        : 'auto',
      notificationTone: String(parsed.notificationTone || 'chime'),
      ringtone: String(parsed.ringtone || 'ring-bell')
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
      presenceStatus: state.settings.presenceStatus || 'active',
      noiseCancellation: state.settings.noiseCancellation,
      enableHD: state.settings.enableHD !== false,
      recordSelfInCall: state.settings.recordSelfInCall !== false,
      callBitrateMode: String(state.settings.callBitrateMode || 'auto'),
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

  appAlert('Local DB was deleted. Quibble will close now. Relaunch the app to continue with Introduce yourself.', {
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

function playTonePreset (name, options = {}) {
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

  const repeats = Math.max(1, Number(options.repeats) || 1)
  const seq = steps[name] || steps.ping
  const seqDuration = Math.max(...seq.map(([, d, o]) => d + o))
  const repeatGap = Number(options.repeatGap)
  const cycleGap = Number.isFinite(repeatGap) ? Math.max(0, repeatGap) : 0.12
  const cycleLength = seqDuration + cycleGap

  for (let cycle = 0; cycle < repeats; cycle++) {
    const cycleOffset = cycle * cycleLength
    for (const [freq, duration, offset] of seq) {
      const startAt = now + cycleOffset + offset
      const stopAt = startAt + duration
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, startAt)
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startAt)
      osc.stop(stopAt)
    }
  }

  const total = (repeats * cycleLength) + 0.2
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

