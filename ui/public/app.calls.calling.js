/* ===================================================================
   PeerJS-based video/voice calling for Quibble
   ===================================================================
   All WebRTC complexity (ICE, STUN, TURN, offer/answer, candidates)
   is handled by PeerJS. Signaling goes through a self-hosted PeerServer
   running alongside the Quibble HTTP server (port + 1).

   The Autobase room channel is used only to announce call-start,
   call-join, and call-end events so the UI stays in sync.

   Media flows P2P between browsers via WebRTC (DTLS/SRTP encrypted).
   Peer IDs are derived from each user's Hypercore/Pear public key.
   =================================================================== */

let peerInstance = null
const activeMediaConnections = new Map() // remotePeerJsId -> MediaConnection
let _peerReadyPromise = null
let _peerReadyResolve = null

/* --- PeerJS identity (derived from Hypercore public key) ------------ */

function getPeerJsId () {
  const pub = state.identity?.publicKey
  if (!pub) return null
  return 'qb-' + String(pub).replace(/[^a-zA-Z0-9]/g, '').slice(0, 48)
}

/* --- PeerJS ICE config --------------------------------------------- */

function getPeerJsIceConfig () {
  const servers = state.rtcIceServers && state.rtcIceServers.length > 0
    ? state.rtcIceServers
    : [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
  return { iceServers: servers }
}

/* --- PeerJS instance lifecycle -------------------------------------- */

function ensurePeerInstance () {
  if (peerInstance && !peerInstance.destroyed && !peerInstance.disconnected) return peerInstance

  const myId = getPeerJsId()
  if (!myId) return null

  if (peerInstance) {
    try { peerInstance.destroy() } catch {}
  }

  // Build PeerServer connection options
  // Connect to self-hosted PeerServer on same host, port + 1
  const peerServerPort = state.peerServerPort || (Number(location.port) + 1)
  const peerServerPath = state.peerServerPath || '/peerjs'
  const peerServerKey = state.peerServerKey || 'quibble'

  const peerOpts = {
    host: location.hostname,
    port: peerServerPort,
    path: peerServerPath,
    key: peerServerKey,
    secure: location.protocol === 'https:',
    debug: 1,
    config: getPeerJsIceConfig()
  }

  console.log('[PeerJS] Connecting to self-hosted PeerServer at', location.hostname + ':' + peerServerPort + peerServerPath)

  _peerReadyPromise = new Promise((resolve) => { _peerReadyResolve = resolve })

  peerInstance = new Peer(myId, peerOpts)

  peerInstance.on('open', (id) => {
    console.log('[PeerJS] Connected to signaling server, id:', id)
    if (_peerReadyResolve) { _peerReadyResolve(); _peerReadyResolve = null }
  })

  peerInstance.on('error', (err) => {
    console.error('[PeerJS] Error:', err.type, err.message || err)

    if (err.type === 'unavailable-id') {
      // ID already taken — append timestamp suffix and retry
      try { peerInstance.destroy() } catch {}
      const fallbackId = myId + '-' + Date.now().toString(36)
      console.log('[PeerJS] Retrying with fallback id:', fallbackId)

      _peerReadyPromise = new Promise((resolve) => { _peerReadyResolve = resolve })
      peerInstance = new Peer(fallbackId, peerOpts)
      setupPeerListeners(peerInstance)
      peerInstance.on('open', () => {
        if (_peerReadyResolve) { _peerReadyResolve(); _peerReadyResolve = null }
      })
    }

    if (err.type === 'network' || err.type === 'server-error') {
      console.warn('[PeerJS] Network/server error — will retry on next call attempt')
      if (_peerReadyResolve) { _peerReadyResolve(); _peerReadyResolve = null }
    }
  })

  peerInstance.on('disconnected', () => {
    console.warn('[PeerJS] Disconnected from signaling server, reconnecting...')
    try { peerInstance.reconnect() } catch {}
  })

  setupPeerListeners(peerInstance)
  return peerInstance
}

function setupPeerListeners (peer) {
  peer.on('call', (mediaConnection) => {
    console.log('[PeerJS] Incoming call from:', mediaConnection.peer)

    if (!state.activeCall || !state.localCallStream) {
      console.warn('[PeerJS] Ignoring incoming call - no active call state')
      return
    }

    mediaConnection.answer(state.localCallStream)
    wireMediaConnection(mediaConnection)
  })
}

function wireMediaConnection (mc) {
  const remotePeerId = mc.peer

  mc.on('stream', (remoteStream) => {
    console.log('[PeerJS] Got remote stream from:', remotePeerId)
    state.remoteStreams.set(remotePeerId, remoteStream)
    syncPeerConnectionsFromPeerJs()
    renderRemoteVideos()
  })

  mc.on('close', () => {
    console.log('[PeerJS] Media connection closed:', remotePeerId)
    state.remoteStreams.delete(remotePeerId)
    activeMediaConnections.delete(remotePeerId)
    syncPeerConnectionsFromPeerJs()
    renderRemoteVideos()
  })

  mc.on('error', (err) => {
    console.error('[PeerJS] Media connection error:', remotePeerId, err)
    state.remoteStreams.delete(remotePeerId)
    activeMediaConnections.delete(remotePeerId)
    syncPeerConnectionsFromPeerJs()
    renderRemoteVideos()
  })

  activeMediaConnections.set(remotePeerId, mc)
  syncPeerConnectionsFromPeerJs()
}

async function callPeer (remotePeerId, localStream) {
  const peer = ensurePeerInstance()
  if (!peer || !localStream) return

  if (activeMediaConnections.has(remotePeerId)) return

  // Wait for peer to be ready (connected to signaling server)
  if (_peerReadyPromise) {
    await _peerReadyPromise
  }

  // Small delay to ensure the remote peer has also registered
  await new Promise((r) => setTimeout(r, 500))

  console.log('[PeerJS] Calling peer:', remotePeerId)
  const mc = peer.call(remotePeerId, localStream)
  if (!mc) {
    console.error('[PeerJS] peer.call() returned null for:', remotePeerId)
    return
  }

  wireMediaConnection(mc)
}

function syncPeerConnectionsFromPeerJs () {
  state.peerConnections.clear()
  for (const [peerId, mc] of activeMediaConnections) {
    const pc = mc.peerConnection
    if (pc) state.peerConnections.set(peerId, pc)
  }
}

/* --- Scope helpers -------------------------------------------------- */

function resolveCallScope (opts = {}) {
  const roomKey = state.activeRoom
  if (!roomKey) return null

  const inlineVoice = Boolean(opts.inlineChannelUi)
  const scope = inlineVoice ? 'voice' : (state.activeDmKey ? 'dm' : 'text')

  if (scope === 'voice') {
    const channelId = opts.channelId || state.activeVoiceChannelByRoom.get(roomKey) || 'voice-general'
    return { scope, roomKey, channelId, dmKey: null, dmParticipants: null }
  }

  const channelId = state.activeTextChannelByRoom.get(roomKey) || 'general'
  const dmKey = scope === 'dm' ? state.activeDmKey : null
  const dmParticipants = scope === 'dm' ? (getActiveDmParticipants?.() || null) : null
  return { scope, roomKey, channelId, dmKey, dmParticipants }
}

function callMatchesCurrentView (data, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return false

  const dmKey = data?.dmKey ? String(data.dmKey) : null
  const activeDmKey = state.activeDmKey ? String(state.activeDmKey) : null
  if (dmKey !== activeDmKey) return false

  if (!dmKey) {
    const channelId = String(data?.channelId || 'general')
    const activeText = String(state.activeTextChannelByRoom.get(state.activeRoom) || 'general')
    const activeVoice = String(state.activeVoiceChannelByRoom.get(state.activeRoom) || 'voice-general')
    if (channelId !== activeText && channelId !== activeVoice) return false
  }

  return true
}

function callMatchesActiveCallScope (data) {
  if (!state.activeCall) return false
  if (String(data?.callId || '') !== String(state.activeCall.id || '')) return false

  const activeDmKey = state.activeCall.dmKey ? String(state.activeCall.dmKey) : null
  const incomingDmKey = data?.dmKey ? String(data.dmKey) : null
  if (activeDmKey !== incomingDmKey) return false

  return String(data?.channelId || 'general') === String(state.activeCall.channelId || 'general')
}

function getCallScopeLabel (scope) {
  if (scope?.dmKey) return 'this DM'
  if (scope?.scope === 'voice') {
    const vc = getChannelById(scope.roomKey, 'voice', scope.channelId)
    return vc ? 'voice ' + vc.name : 'voice channel'
  }

  const tc = getChannelById(scope?.roomKey, 'text', scope?.channelId)
  return tc ? '#' + tc.name : '#general'
}

/* --- Media acquisition ---------------------------------------------- */

async function requestCallMedia (mode) {
  try {
    const micEnabled = state.settings.micEnabled !== false
    const camEnabled = state.settings.cameraEnabled !== false
    const audio = {
      noiseSuppression: Boolean(state.settings.noiseCancellation),
      echoCancellation: Boolean(state.settings.noiseCancellation)
    }
    if (state.settings.micId) audio.deviceId = { exact: state.settings.micId }
    const video = {
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
    if (state.settings.cameraId) video.deviceId = { exact: state.settings.cameraId }

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

    if (mode === 'video' && camEnabled) {
      const liveVideo = stream.getVideoTracks().find((t) => t.readyState === 'live') || null
      if (!liveVideo) {
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          const freshTrack = fallback.getVideoTracks()[0] || null
          if (freshTrack) {
            for (const t of stream.getVideoTracks()) {
              stream.removeTrack(t)
              try { t.stop() } catch {}
            }
            stream.addTrack(freshTrack)
          }
        } catch (videoErr) {
          console.warn('Video fallback capture failed:', videoErr)
        }
      }
    }

    if (forceMutedTracks) {
      for (const t of stream.getTracks()) t.enabled = false
    }
    return stream
  } catch (err) {
    console.error('Call media access failed:', err)
    return null
  }
}

/* --- Call lifecycle ------------------------------------------------- */

async function startCall (mode, options = {}) {
  const scope = resolveCallScope(options)
  if (!scope) return
  if (state.activeCall) await endCall(true)

  if (isCurrentUserBannedFromRoom(scope.roomKey) || (!scope.dmKey && isCurrentUserKickedFromChannel(scope.roomKey, scope.channelId))) {
    await appAlert('You cannot join this channel.', { title: 'Access blocked' })
    return
  }

  const callId = Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8)
  const stream = await requestCallMedia(mode)
  if (!stream) return

  // Start PeerJS and wait for signaling connection
  ensurePeerInstance()
  if (_peerReadyPromise) await _peerReadyPromise

  state.activeCall = { id: callId, mode, roomKey: scope.roomKey, channelId: scope.channelId, dmKey: scope.dmKey, scope: scope.scope }
  state.localCallStream = stream

  const inlineChannelUi = Boolean(options.inlineChannelUi) && mode === 'voice'
  if (inlineChannelUi) {
    showInlineVoiceCallControls()
  } else {
    showCallStage(mode)
    attachLocalStream(stream)
  }
  applyLocalMediaTrackState()
  applyCallBitrate(state.settings.callBitrateMode || 'auto')
  ensureAutoCallBitrateLoop?.()
  if (typeof renderChannelLists === 'function') renderChannelLists()

  send({
    type: 'start-call',
    roomKey: scope.roomKey,
    scope: scope.scope,
    channelId: scope.channelId,
    dmKey: scope.dmKey,
    dmParticipants: scope.dmParticipants,
    callId,
    mode,
    peerJsId: getPeerJsId()
  })
}

async function joinCall (callId, mode, channelId, options = {}) {
  stopRingtoneLoop()
  const stream = await requestCallMedia(mode)
  if (!stream || !state.activeRoom) return

  // Start PeerJS and wait for signaling connection
  ensurePeerInstance()
  if (_peerReadyPromise) await _peerReadyPromise

  const scope = {
    scope: options.scope || (options.dmKey ? 'dm' : (options.inlineChannelUi ? 'voice' : 'text')),
    roomKey: state.activeRoom,
    channelId: channelId || state.activeTextChannelByRoom.get(state.activeRoom) || 'general',
    dmKey: options.dmKey || null,
    dmParticipants: Array.isArray(options.dmParticipants) ? options.dmParticipants : null
  }

  state.activeCall = { id: callId, mode, roomKey: scope.roomKey, channelId: scope.channelId, dmKey: scope.dmKey, scope: scope.scope }
  state.localCallStream = stream
  if (scope.scope === 'voice') state.activeVoiceChannelByRoom.set(state.activeRoom, scope.channelId)

  const inlineChannelUi = Boolean(options.inlineChannelUi) && mode === 'voice' && scope.scope === 'voice'
  if (inlineChannelUi) {
    showInlineVoiceCallControls()
  } else {
    showCallStage(mode)
    attachLocalStream(stream)
  }
  applyLocalMediaTrackState()
  applyCallBitrate(state.settings.callBitrateMode || 'auto')
  ensureAutoCallBitrateLoop?.()
  if (typeof renderChannelLists === 'function') renderChannelLists()

  send({
    type: 'join-call',
    roomKey: scope.roomKey,
    scope: scope.scope,
    channelId: scope.channelId,
    dmKey: scope.dmKey,
    dmParticipants: scope.dmParticipants,
    callId,
    mode,
    peerJsId: getPeerJsId()
  })

  const starterPeerId = options.peerJsId || options.starterPeerJsId
  if (starterPeerId && starterPeerId !== getPeerJsId()) {
    callPeer(starterPeerId, stream)
  }
}

/* --- Incoming Autobase messages ------------------------------------- */

async function onIncomingCallStart (msg, roomKey) {
  if (!callMatchesCurrentView(msg?.data, roomKey)) return
  if (msg.sender === state.identity?.publicKey) return
  if (state.activeCall) return

  const callId = msg.data?.callId
  const mode = msg.data?.mode || 'voice'
  const channelId = msg.data?.channelId || 'general'
  const starterPeerJsId = msg.data?.peerJsId || null
  const scope = {
    scope: msg.data?.scope || (msg.data?.dmKey ? 'dm' : 'text'),
    roomKey,
    channelId,
    dmKey: msg.data?.dmKey || null,
    dmParticipants: Array.isArray(msg.data?.dmParticipants) ? msg.data.dmParticipants : null
  }
  if (!callId) return

  const label = getCallScopeLabel(scope)
  startRingtoneLoop()
  const ok = await appConfirm((msg.senderName || 'Someone') + ' started a ' + mode + ' call in ' + label + '. Join?', {
    title: 'Incoming call',
    confirmText: 'Join'
  })
  stopRingtoneLoop()
  if (!ok) return

  joinCall(callId, mode, channelId, Object.assign({}, scope, { peerJsId: starterPeerJsId }))
}

async function onIncomingCallJoin (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (!callMatchesActiveCallScope(msg?.data || {})) return
  if (msg.sender === state.identity?.publicKey) return

  const remotePeerId = msg.data?.peerJsId
  if (remotePeerId && remotePeerId !== getPeerJsId() && state.localCallStream) {
    callPeer(remotePeerId, state.localCallStream)
  }
}

function onIncomingCallSignal (_msg, _roomKey) {
  // PeerJS handles all WebRTC signaling internally - no-op
}

function onIncomingCallEnd (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (!callMatchesActiveCallScope(msg?.data || {})) return
  endCall(false)
}

/* --- End call ------------------------------------------------------- */

async function endCall (notifyRemote) {
  if (!state.activeCall) return

  stopRingtoneLoop()

  if (typeof stopCallRecording === 'function' && state.callRecording?.active) {
    await stopCallRecording()
  }

  if (notifyRemote) {
    send({
      type: 'end-call',
      roomKey: state.activeCall.roomKey,
      channelId: state.activeCall.channelId,
      dmKey: state.activeCall.dmKey || null,
      callId: state.activeCall.id
    })
  }

  for (const mc of activeMediaConnections.values()) {
    try { mc.close() } catch {}
  }
  activeMediaConnections.clear()

  for (const pc of state.peerConnections.values()) {
    try { pc.close() } catch {}
  }
  state.peerConnections.clear()
  state.remoteStreams.clear()

  if (state.localCallStream) {
    for (const t of state.localCallStream.getTracks()) t.stop()
  }
  if (state.callScreenStream) {
    for (const t of state.callScreenStream.getTracks()) t.stop()
  }

  state.localCallStream = null
  state.activeCall = null
  ensureAutoCallBitrateLoop?.()
  hideCallStage()
  if (typeof renderChannelLists === 'function') renderChannelLists()
}

/* --- UI helpers ----------------------------------------------------- */

function showInlineVoiceCallControls () {
  dom.callStage?.classList.add('hidden')
  dom.btnEndCall?.classList.remove('hidden')
  if (dom.callStatus) dom.callStatus.textContent = 'Voice call active'

  dom.btnVoice.classList.add('text-quibble-green')
  dom.btnVideoCall.classList.remove('text-quibble-green')
  refreshCallControlsMenu()
  updateHeaderActionVisibility?.()
}

function showCallStage (mode) {
  dom.callStage?.classList.remove('hidden')
  dom.btnEndCall?.classList.remove('hidden')
  dom.callStatus.textContent = mode[0].toUpperCase() + mode.slice(1) + ' call active'

  dom.btnVoice.classList.add('text-quibble-green')
  dom.btnVideoCall.classList.toggle('text-quibble-green', mode === 'video')
  dom.btnCallScreenShare?.classList.toggle('bg-quibble-blurple', Boolean(state.callScreenStream))
  refreshCallControlsMenu()
  updateHeaderActionVisibility?.()
}

function hideCallStage () {
  dom.callStage?.classList.add('hidden')
  dom.btnEndCall?.classList.add('hidden')

  dom.btnVoice.classList.remove('text-quibble-green')
  dom.btnVideoCall.classList.remove('text-quibble-green')
  dom.callStage?.classList.remove('call-stage-expanded')
  dom.callStage?.classList.remove('fixed', 'inset-0', 'z-40', 'bg-quibble-bg')
  state.callTheater = false
  state.callScreenStream = null

  if (dom.localVideo) {
    dom.localVideo.srcObject = null
    dom.localVideo.classList.add('hidden')
  }
  if (dom.remoteVideos) dom.remoteVideos.innerHTML = ''
  updateGlobalMediaButtons()
  refreshCallControlsMenu()
  updateHeaderActionVisibility?.()
}

function attachLocalStream (stream) {
  if (!dom.localVideo) return
  dom.localVideo.srcObject = stream
  dom.localVideo.classList.remove('hidden')
  if (typeof bindCallVideoFullscreen === 'function') bindCallVideoFullscreen(dom.localVideo, 'you')
}

/* --- Compat stubs (referenced by other scripts) --------------------- */

function getRtcIceServers () {
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}
