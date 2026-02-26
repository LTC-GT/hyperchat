const PRESENCE_AWAY_AFTER_MS = 10 * 60 * 1000
const PRESENCE_REFRESH_INTERVAL_MS = 60 * 1000
let presenceAwayTimer = null
let presenceRefreshTimer = null
let lastPresenceBroadcastAt = 0
let autoBitrateTimer = null

function normalizePresenceStatus (value) {
  const status = String(value || 'active').toLowerCase()
  if (status === 'active' || status === 'away') return status
  if (status === 'online') return 'active'
  return 'away'
}

function resolveEffectivePresenceStatus (status, lastActivityAt) {
  const normalized = normalizePresenceStatus(status)
  const at = Number(lastActivityAt) || 0
  if (normalized !== 'active') return normalized
  if (!at) return 'active'
  return (Date.now() - at >= PRESENCE_AWAY_AFTER_MS) ? 'away' : 'active'
}

function getPresenceMeta (statusOverride = null, lastActivityAt = null) {
  const status = resolveEffectivePresenceStatus(statusOverride || state.settings.presenceStatus, lastActivityAt || state.lastPresenceActivityAt)
  if (status === 'away') return { label: 'Online - Away', dotClass: 'bg-quibble-blurple', visibleOnline: true }
  return { label: 'Online - Active', dotClass: 'bg-quibble-green', visibleOnline: true }
}

function schedulePresenceAwayTimer () {
  if (presenceAwayTimer) clearTimeout(presenceAwayTimer)
  if (normalizePresenceStatus(state.settings.presenceStatus) === 'away') return

  const lastActivityAt = Number(state.lastPresenceActivityAt) || Date.now()
  const remaining = Math.max(0, PRESENCE_AWAY_AFTER_MS - (Date.now() - lastActivityAt))
  presenceAwayTimer = setTimeout(() => {
    presenceAwayTimer = null
    maybeSetPresenceAway()
  }, remaining)
}

function maybeSetPresenceAway () {
  const lastActivityAt = Number(state.lastPresenceActivityAt) || 0
  if (!lastActivityAt) return
  if ((Date.now() - lastActivityAt) < PRESENCE_AWAY_AFTER_MS) {
    schedulePresenceAwayTimer()
    return
  }
  setPresenceStatus('away', { forceBroadcast: true, at: lastActivityAt })
}

function setPresenceStatus (status, options = {}) {
  const nextStatus = normalizePresenceStatus(status)
  const prevStatus = normalizePresenceStatus(state.settings.presenceStatus)
  const changed = nextStatus !== prevStatus
  const at = Number(options.at) || Date.now()

  state.settings.presenceStatus = nextStatus
  saveClientSettings()

  const shouldBroadcast = options.broadcast !== false && (changed || options.forceBroadcast)
  if (shouldBroadcast && typeof send === 'function') {
    send({ type: 'set-presence-status', status: nextStatus, at })
    lastPresenceBroadcastAt = Date.now()
  }

  schedulePresenceAwayTimer()
  updateUserPanel()
  updateMemberList()
}

function noteLocalPresenceActivity (_source = 'ui') {
  const now = Date.now()
  state.lastPresenceActivityAt = now

  const current = normalizePresenceStatus(state.settings.presenceStatus)
  const shouldHeartbeat = now - lastPresenceBroadcastAt >= 120000
  if (current !== 'active' || shouldHeartbeat) {
    setPresenceStatus('active', { forceBroadcast: true, at: now })
    return
  }

  schedulePresenceAwayTimer()
  updateMemberList()
}

function initPresenceTracking () {
  if (!Number.isFinite(Number(state.lastPresenceActivityAt))) {
    state.lastPresenceActivityAt = Date.now()
  }

  state.settings.presenceStatus = normalizePresenceStatus(state.settings.presenceStatus)
  schedulePresenceAwayTimer()

  if (!presenceRefreshTimer) {
    presenceRefreshTimer = setInterval(() => {
      maybeSetPresenceAway()
      updateMemberList()
      updateUserPanel()
    }, PRESENCE_REFRESH_INTERVAL_MS)
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') noteLocalPresenceActivity('visibility')
  })

  window.addEventListener('focus', () => {
    noteLocalPresenceActivity('focus')
  })
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
    dom.btnToggleMicGlobal.classList.toggle('text-quibble-red', !micEnabled)
    dom.btnToggleMicGlobal.classList.toggle('bg-quibble-active', !micEnabled)
    dom.btnToggleMicGlobal.title = micEnabled ? 'Mute Microphone' : 'Unmute Microphone'
    dom.btnToggleMicGlobal.setAttribute('aria-pressed', String(!micEnabled))
  }
  if (dom.btnToggleCameraGlobal) {
    dom.btnToggleCameraGlobal.classList.toggle('text-quibble-red', !camEnabled)
    dom.btnToggleCameraGlobal.classList.toggle('bg-quibble-active', !camEnabled)
    dom.btnToggleCameraGlobal.title = camEnabled ? 'Disable Camera' : 'Enable Camera'
    dom.btnToggleCameraGlobal.setAttribute('aria-pressed', String(!camEnabled))
  }

  dom.micDisabledSlash?.classList.toggle('hidden', micEnabled)
  dom.cameraDisabledSlash?.classList.toggle('hidden', camEnabled)
  refreshCallControlsMenu()
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
    bindCallVideoFullscreen(video, peer)
    dom.remoteVideos.appendChild(video)
  }
}

function bindCallVideoFullscreen (videoEl, label = 'participant') {
  if (!videoEl) return
  videoEl.style.cursor = 'zoom-in'
  videoEl.title = `Click to fullscreen ${label}`
  videoEl.onclick = async () => {
    try {
      if (document.fullscreenElement === videoEl) {
        await document.exitFullscreen?.()
        return
      }
      if (document.fullscreenElement) await document.exitFullscreen?.()
      await videoEl.requestFullscreen?.()
    } catch {}
  }
}

function getCallRecordingMimeType () {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
  const candidates = [
    'video/webm;codecs=av01.0.08M.08,opus',
    'video/webm;codecs=av1,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

function getCallRecordingElements () {
  const includeSelf = state.callRecording.includeSelf !== false
  const tiles = []
  if (includeSelf && dom.localVideo?.srcObject) tiles.push(dom.localVideo)
  if (dom.remoteVideos) {
    const remote = [...dom.remoteVideos.querySelectorAll('video')]
    for (const video of remote) {
      if (video?.srcObject) tiles.push(video)
    }
  }
  return tiles.filter((video) => video.readyState >= 2 || video.srcObject)
}

function drawRecordingFrame () {
  const recording = state.callRecording
  if (!recording.active || !recording.canvas) return
  const ctx = recording.canvas.getContext('2d')
  if (!ctx) return

  const width = recording.canvas.width
  const height = recording.canvas.height
  ctx.fillStyle = '#111827'
  ctx.fillRect(0, 0, width, height)

  const tiles = getCallRecordingElements()
  if (tiles.length === 0) {
    ctx.fillStyle = '#9ca3af'
    ctx.font = 'bold 36px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Quibble Call Recording', width / 2, height / 2 - 8)
    ctx.font = '22px sans-serif'
    ctx.fillText('Audio only', width / 2, height / 2 + 34)
  } else {
    const cols = Math.ceil(Math.sqrt(tiles.length))
    const rows = Math.ceil(tiles.length / cols)
    const tileW = Math.floor(width / cols)
    const tileH = Math.floor(height / rows)

    for (let index = 0; index < tiles.length; index++) {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = col * tileW
      const y = row * tileH
      const video = tiles[index]

      ctx.fillStyle = '#000000'
      ctx.fillRect(x, y, tileW, tileH)

      const vw = Number(video.videoWidth) || tileW
      const vh = Number(video.videoHeight) || tileH
      const scale = Math.max(tileW / vw, tileH / vh)
      const dw = vw * scale
      const dh = vh * scale
      const dx = x + (tileW - dw) / 2
      const dy = y + (tileH - dh) / 2

      try { ctx.drawImage(video, dx, dy, dw, dh) } catch {}

      const label = video === dom.localVideo ? 'You' : (video.dataset.peer || 'Peer')
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(x + 12, y + tileH - 42, 180, 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = '16px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(label, x + 20, y + tileH - 23)
    }
  }

  recording.animationFrame = window.requestAnimationFrame(drawRecordingFrame)
}

function syncCallRecordingAudioSources () {
  const recording = state.callRecording
  if (!recording.active || !recording.audioContext || !recording.audioDestination) return

  const targetStreams = new Map()
  if (recording.includeSelf && state.localCallStream) {
    const localAudioTracks = state.localCallStream.getAudioTracks().filter((track) => track.readyState === 'live')
    if (localAudioTracks.length) targetStreams.set(`self:${state.localCallStream.id}`, state.localCallStream)
  }
  for (const [peer, stream] of state.remoteStreams) {
    const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live')
    if (audioTracks.length) targetStreams.set(`peer:${peer}`, stream)
  }

  for (const [key, node] of recording.audioSources.entries()) {
    if (targetStreams.has(key)) continue
    try { node.disconnect() } catch {}
    recording.audioSources.delete(key)
  }

  for (const [key, stream] of targetStreams.entries()) {
    if (recording.audioSources.has(key)) continue
    try {
      const sourceNode = recording.audioContext.createMediaStreamSource(stream)
      sourceNode.connect(recording.audioDestination)
      recording.audioSources.set(key, sourceNode)
    } catch {}
  }
}

function buildRecordingFileName () {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  const roomName = (state.rooms.get(state.activeCall?.roomKey || '')?.name || 'call').replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `quibble-${roomName || 'call'}-${stamp}.webm`
}

async function startCallRecording () {
  if (!state.activeCall || state.callRecording.active) return
  if (typeof MediaRecorder === 'undefined') {
    await appAlert('Recording is not supported in this browser.', { title: 'Recording unavailable' })
    return
  }

  const recording = state.callRecording
  recording.includeSelf = state.settings.recordSelfInCall !== false
  recording.chunks = []
  recording.mimeType = getCallRecordingMimeType()

  recording.canvas = document.createElement('canvas')
  recording.canvas.width = 1280
  recording.canvas.height = 720
  recording.canvasStream = recording.canvas.captureStream(30)

  const audioContext = new (window.AudioContext || window.webkitAudioContext)()
  recording.audioContext = audioContext
  recording.audioDestination = audioContext.createMediaStreamDestination()
  recording.audioSources = new Map()
  syncCallRecordingAudioSources()

  const outputTracks = [...recording.canvasStream.getVideoTracks(), ...recording.audioDestination.stream.getAudioTracks()]
  recording.mixedStream = new MediaStream(outputTracks)

  const recorderOptions = recording.mimeType ? { mimeType: recording.mimeType } : undefined
  const bitrateHint = Math.max(1000000, Math.min(12000000, Number(state.settings.callBitrateMode) || computeAutoCallBitrate() || 2500000))
  if (recorderOptions) recorderOptions.videoBitsPerSecond = bitrateHint
  const recorder = recorderOptions
    ? new MediaRecorder(recording.mixedStream, recorderOptions)
    : new MediaRecorder(recording.mixedStream)

  recorder.ondataavailable = (event) => {
    if (!event.data || event.data.size <= 0) return
    recording.chunks.push(event.data)
  }

  recorder.onstop = () => {
    const parts = [...recording.chunks]
    const mime = recording.mimeType || 'video/webm'
    recording.chunks = []
    if (parts.length > 0) {
      const blob = new Blob(parts, { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = buildRecordingFileName()
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }
  }

  recording.recorder = recorder
  recording.active = true
  recording.startedAt = Date.now()
  drawRecordingFrame()
  recording.audioSyncTimer = setInterval(syncCallRecordingAudioSources, 1500)
  recorder.start(1000)
  refreshCallControlsMenu()
}

async function stopCallRecording () {
  const recording = state.callRecording
  if (!recording.active) return

  recording.active = false
  if (recording.animationFrame) {
    cancelAnimationFrame(recording.animationFrame)
    recording.animationFrame = 0
  }
  if (recording.audioSyncTimer) {
    clearInterval(recording.audioSyncTimer)
    recording.audioSyncTimer = null
  }
  for (const node of recording.audioSources.values()) {
    try { node.disconnect() } catch {}
  }
  recording.audioSources.clear()

  const recorder = recording.recorder
  recording.recorder = null
  if (recorder && recorder.state !== 'inactive') {
    try { recorder.stop() } catch {}
  }

  if (recording.mixedStream) {
    for (const track of recording.mixedStream.getTracks()) {
      try { track.stop() } catch {}
    }
  }
  if (recording.canvasStream) {
    for (const track of recording.canvasStream.getTracks()) {
      try { track.stop() } catch {}
    }
  }
  if (recording.audioContext) {
    try { await recording.audioContext.close() } catch {}
  }

  recording.mixedStream = null
  recording.canvasStream = null
  recording.canvas = null
  recording.audioDestination = null
  recording.audioContext = null
  recording.startedAt = 0
  refreshCallControlsMenu()
}

async function toggleCallRecording () {
  if (state.callRecording.active) {
    await stopCallRecording()
  } else {
    await startCallRecording()
  }
}

function buildCameraConstraintsFromSettings () {
  const constraints = {
    width: state.settings.enableHD === false
      ? { ideal: 960, max: 1280 }
      : { ideal: 1920, max: 2560 },
    height: state.settings.enableHD === false
      ? { ideal: 540, max: 720 }
      : { ideal: 1080, max: 1440 },
    frameRate: state.settings.enableHD === false
      ? { ideal: 24, max: 30 }
      : { ideal: 30, max: 60 }
  }
  if (state.settings.cameraId) constraints.deviceId = { exact: state.settings.cameraId }
  return constraints
}

function getPeerVideoSender (pc) {
  const byTrack = pc.getSenders().find((sender) => sender?.track?.kind === 'video')
  if (byTrack) return byTrack
  const transceiver = pc.getTransceivers().find((candidate) => {
    const senderKind = candidate?.sender?.track?.kind
    const receiverKind = candidate?.receiver?.track?.kind
    return senderKind === 'video' || receiverKind === 'video'
  })
  return transceiver?.sender || null
}

async function ensureLocalCameraTrack () {
  if (!state.localCallStream) return null
  const existing = state.localCallStream.getVideoTracks().find((track) => track.readyState === 'live') || null
  if (existing) return existing

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: buildCameraConstraintsFromSettings(), audio: false })
    const freshTrack = stream.getVideoTracks()[0] || null
    if (!freshTrack) return null

    for (const track of state.localCallStream.getVideoTracks()) {
      state.localCallStream.removeTrack(track)
      try { track.stop() } catch {}
    }
    state.localCallStream.addTrack(freshTrack)
    return freshTrack
  } catch {
    return null
  }
}

async function toggleCallScreenShare () {
  if (!state.activeCall || !state.localCallStream) return

  if (state.callScreenStream) {
    for (const track of state.callScreenStream.getTracks()) track.stop()
    state.callScreenStream = null
    const cameraEnabled = state.settings.cameraEnabled !== false
    const camTrack = cameraEnabled ? (await ensureLocalCameraTrack()) : null
    await replaceVideoTrack(camTrack)
    if (camTrack) {
      attachLocalStream(state.localCallStream)
    } else if (dom.localVideo) {
      dom.localVideo.srcObject = null
      dom.localVideo.classList.add('hidden')
    }
    dom.btnCallScreenShare?.classList.remove('bg-quibble-blurple')
    refreshCallControlsMenu()
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
    bindCallVideoFullscreen(dom.localVideo, 'you')
    screenTrack.onended = () => {
      if (state.callScreenStream) toggleCallScreenShare().catch(() => {})
    }
    dom.btnCallScreenShare?.classList.add('bg-quibble-blurple')
    refreshCallControlsMenu()
  } catch (err) {
    console.error('Screen share failed', err)
  }
}

async function replaceVideoTrack (track) {
  for (const pc of state.peerConnections.values()) {
    const sender = getPeerVideoSender(pc)
    if (sender) {
      await sender.replaceTrack(track || null)
    } else if (track && state.localCallStream) {
      const sourceStream = state.callScreenStream && state.callScreenStream.getVideoTracks().includes(track)
        ? state.callScreenStream
        : state.localCallStream
      pc.addTrack(track, sourceStream)
    }
  }
}

function applyCallBitrate (bitrate) {
  const mode = String(bitrate || state.settings.callBitrateMode || 'auto').toLowerCase()
  const usingAuto = mode === 'auto'
  const target = usingAuto
    ? computeAutoCallBitrate()
    : (Number.isFinite(Number(mode)) ? Number(mode) : computeAutoCallBitrate())

  if (dom.callBitrate) dom.callBitrate.value = usingAuto ? 'auto' : String(target)
  if (dom.callBitrateMenu) dom.callBitrateMenu.value = usingAuto ? 'auto' : String(target)

  const effectiveVideoCap = state.settings.enableHD === false ? Math.min(target, 700000) : target
  for (const pc of state.peerConnections.values()) {
    for (const sender of pc.getSenders()) {
      if (!sender?.track?.kind || !sender?.getParameters || !sender?.setParameters) continue
      if (sender.track.kind !== 'audio' && sender.track.kind !== 'video') continue

      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]

      if (sender.track.kind === 'audio') {
        params.encodings[0].maxBitrate = Math.max(24000, Math.min(160000, Math.floor(target / 16)))
      } else {
        params.encodings[0].maxBitrate = effectiveVideoCap
      }

      sender.setParameters(params).catch(() => {})
    }
  }

  refreshCallControlsMenu()
}

function setCallBitrateMode (mode) {
  const value = String(mode || 'auto').toLowerCase()
  state.settings.callBitrateMode = value === 'auto' ? 'auto' : String(Number(value) > 0 ? Number(value) : 'auto')
  saveClientSettings()
  applyCallBitrate(state.settings.callBitrateMode)
  ensureAutoCallBitrateLoop()
}

function computeAutoCallBitrate () {
  const peerCount = Math.max(1, state.peerConnections.size || state.peers.size || 1)
  const networkStatus = state.p2pNetworkTest?.status || 'idle'
  const hdEnabled = state.settings.enableHD !== false
  const isScreenShare = Boolean(state.callScreenStream)

  let perPeer = 1200000
  if (networkStatus === 'friendly') perPeer = 2600000
  if (networkStatus === 'unfriendly') perPeer = 900000
  if (networkStatus === 'error') perPeer = 800000

  if (!hdEnabled) perPeer = Math.min(perPeer, 700000)
  if (isScreenShare) perPeer = Math.max(perPeer, 2200000)

  const connectedBias = Math.max(1, [...state.peerConnections.values()].filter((pc) => pc.connectionState === 'connected').length)
  const total = Math.floor((perPeer * connectedBias) / peerCount)
  return Math.max(240000, Math.min(8000000, total))
}

function ensureAutoCallBitrateLoop () {
  if (autoBitrateTimer) {
    clearInterval(autoBitrateTimer)
    autoBitrateTimer = null
  }

  if (!state.activeCall || String(state.settings.callBitrateMode || 'auto') !== 'auto') return
  autoBitrateTimer = setInterval(() => {
    if (!state.activeCall || String(state.settings.callBitrateMode || 'auto') !== 'auto') {
      if (autoBitrateTimer) {
        clearInterval(autoBitrateTimer)
        autoBitrateTimer = null
      }
      return
    }
    applyCallBitrate('auto')
  }, 4000)
}

function refreshCallControlsMenu () {
  const hasCall = Boolean(state.activeCall)
  const inCall = hasCall && state.activeCall.roomKey === state.activeRoom
  const micEnabled = state.settings.micEnabled !== false
  const camEnabled = state.settings.cameraEnabled !== false

  if (dom.callBitrateMenu && dom.callBitrate) {
    const mode = String(state.settings.callBitrateMode || dom.callBitrate.value || 'auto')
    if (dom.callBitrate.value !== mode) dom.callBitrate.value = mode
    dom.callBitrateMenu.value = mode
    dom.callBitrateMenu.disabled = !inCall
  }

  if (dom.btnCallMicMenu) {
    dom.btnCallMicMenu.textContent = micEnabled ? 'Mute Microphone' : 'Unmute Microphone'
  }
  if (dom.btnCallCameraMenu) {
    dom.btnCallCameraMenu.textContent = camEnabled ? 'Disable Camera' : 'Enable Camera'
  }

  if (dom.btnCallScreenShareMenu) {
    dom.btnCallScreenShareMenu.textContent = state.callScreenStream ? 'Stop Screen Share' : 'Screen Share'
    dom.btnCallScreenShareMenu.disabled = !inCall
    dom.btnCallScreenShareMenu.classList.toggle('opacity-50', !inCall)
  }

  if (dom.btnCallRecordMenu) {
    dom.btnCallRecordMenu.textContent = state.callRecording.active ? 'Stop Recording' : 'Start Recording'
    dom.btnCallRecordMenu.disabled = !inCall
    dom.btnCallRecordMenu.classList.toggle('opacity-50', !inCall)
    dom.btnCallRecordMenu.classList.toggle('text-quibble-red', state.callRecording.active)
  }

  if (dom.btnCallTheaterMenu) {
    dom.btnCallTheaterMenu.textContent = state.callTheater ? 'Exit Theater Mode' : 'Theater Mode'
    dom.btnCallTheaterMenu.disabled = !inCall
    dom.btnCallTheaterMenu.classList.toggle('opacity-50', !inCall)
  }

  if (dom.btnCallFullscreenMenu) {
    const isFullscreen = Boolean(document.fullscreenElement)
    dom.btnCallFullscreenMenu.textContent = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'
    dom.btnCallFullscreenMenu.disabled = !inCall
    dom.btnCallFullscreenMenu.classList.toggle('opacity-50', !inCall)
  }
}

// Members panel

function updateMembersToggleButton (isOn = state.membersVisible) {
  const on = Boolean(isOn)
  const onIcon = document.getElementById('iconMembersOn')
  const offIcon = document.getElementById('iconMembersOff')
  onIcon?.classList.toggle('hidden', on)
  offIcon?.classList.toggle('hidden', !on)
  dom.btnToggleMembers?.setAttribute('aria-pressed', String(on))
}

dom.btnToggleMembers.addEventListener('click', () => {
  state.membersVisible = !state.membersVisible
  if (state.membersVisible && state.activeRoom) dom.membersSidebar.classList.remove('hidden')
  else dom.membersSidebar.classList.add('hidden')
  updateMembersToggleButton(state.membersVisible)
})

function updateMemberList () {
  if (!dom.memberListActive || !dom.memberListAway) return
  dom.memberListActive.innerHTML = ''
  dom.memberListAway.innerHTML = ''

  const ownerKey = state.activeRoom ? state.roomOwnerByRoom.get(state.activeRoom) : null
  const selfStatus = resolveEffectivePresenceStatus(state.settings.presenceStatus, state.lastPresenceActivityAt)
  const selfPresence = getPresenceMeta(selfStatus, state.lastPresenceActivityAt)

  const activeRows = []
  const awayRows = []

  const appendByStatus = (row, status) => {
    if (status === 'away') awayRows.push(row)
    else activeRows.push(row)
  }

  appendByStatus(createMemberEl({
    key: state.identity?.publicKey,
    name: state.profile.fullName || state.profile.username || 'You',
    avatar: state.profile.avatar,
    isOnline: selfPresence.visibleOnline,
    isAway: selfStatus === 'away',
    isSelf: true,
    isOwner: ownerKey === state.identity?.publicKey
  }), selfStatus)

  const peers = new Map()
  const peerLastActivity = new Map()
  const peerPresence = new Map()
  if (state.activeRoom) {
    const msgs = state.messagesByRoom.get(state.activeRoom) || []
    for (const m of msgs) {
      if (m.sender && m.sender !== state.identity?.publicKey && m.senderName) {
        peers.set(m.sender, { name: m.senderName, avatar: m.senderAvatar || null })
      }

      if (m?.sender && m.sender !== state.identity?.publicKey) {
        const at = Number(m.timestamp) || Date.now()
        const prev = Number(peerLastActivity.get(m.sender) || 0)
        if (at > prev) peerLastActivity.set(m.sender, at)
      }

      if (m?.type === 'system' && m?.action === 'presence-set' && m?.sender && m.sender !== state.identity?.publicKey) {
        const status = normalizePresenceStatus(m.data?.status)
        const at = Number(m.data?.at) || Number(m.timestamp) || Date.now()
        peerPresence.set(m.sender, { status, at })
      }
    }
  }

  for (const [key, peer] of peers) {
    const p = peerPresence.get(key)
    const fallbackAt = Number(peerLastActivity.get(key) || 0)
    const effective = resolveEffectivePresenceStatus(p?.status || 'active', p?.at || fallbackAt)
    appendByStatus(createMemberEl({
      key,
      name: peer.name,
      avatar: peer.avatar,
      isOnline: true,
      isAway: effective === 'away',
      isSelf: false,
      isOwner: ownerKey === key
    }), effective)
  }

  for (const row of activeRows) dom.memberListActive.appendChild(row)
  for (const row of awayRows) dom.memberListAway.appendChild(row)

  if (dom.onlineActiveCount) dom.onlineActiveCount.textContent = String(activeRows.length)
  if (dom.onlineAwayCount) dom.onlineAwayCount.textContent = String(awayRows.length)

  updateSecurityStatus()
}

function createMemberEl ({ key, name, avatar, isOnline, isAway = false, isSelf, isOwner = false }) {
  const div = document.createElement('div')
  div.className = 'flex items-center gap-3 px-2 py-1.5 rounded hover:bg-quibble-hover cursor-pointer group'
  const av = avatar ? `<img src="${avatar}" class="w-full h-full object-cover">` : getDefaultAvatar(name)
  const isFriend = key ? state.friends.has(key) : false
  const dotClass = isAway ? 'bg-quibble-blurple' : 'bg-quibble-green'
  const crownBadge = isOwner
    ? '<div style="position:absolute; top:-8px; left:50%; transform:translateX(-50%); z-index:3; pointer-events:none; line-height:1;" title="Server Owner" aria-label="Server Owner">👑</div>'
    : ''

  div.innerHTML = `
    <div class="relative flex-shrink-0">
      <div class="w-8 h-8 rounded-full bg-quibble-blurple flex items-center justify-center text-xs font-bold overflow-hidden">${av}</div>
      ${crownBadge}
      ${isOnline ? `<div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 ${dotClass} rounded-full border-2 border-quibble-members"></div>` : ''}
    </div>
    <span class="text-sm text-quibble-text-s group-hover:text-quibble-text truncate flex-1">${esc(name)}</span>
    ${(!isSelf && key) ? `<button class="friend-btn text-[11px] px-2 py-0.5 rounded ${isFriend ? 'bg-quibble-green text-white' : 'bg-quibble-active text-quibble-text'}">${isFriend ? 'Friend' : 'Add'}</button>` : ''}
    ${(!isSelf && key && isFriend) ? '<button class="dm-btn text-[11px] px-2 py-0.5 rounded bg-quibble-blurple text-white">DM</button>' : ''}
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

