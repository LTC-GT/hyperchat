/* ===================================================================
   Native WebRTC video/voice calling for Quibble
   ===================================================================
   Uses the browser's RTCPeerConnection API directly (no PeerJS).

   Signaling (SDP offers/answers, ICE candidates) flows through the
   Autobase room channel via 'call-signal' messages — the same P2P
   replication layer already used for chat.  No separate signaling
   server is needed.

   The Autobase room channel also announces call-start / call-join /
   call-end events so every member's UI stays in sync.

   Media flows P2P between browsers via WebRTC (DTLS/SRTP encrypted).
   TURN servers are included in the default ICE config so calls work
   across different networks, symmetric NATs and firewalls.

   Peer IDs are the Hypercore public key hex strings.

   Implements the 'Perfect Negotiation' pattern to handle simultaneous
   offers gracefully (see https://w3c.github.io/webrtc-pc/#perfect-negotiation-example).
   =================================================================== */

/* ─── Module state ─────────────────────────────────────────────────── */

const pendingIceCandidates = new Map()  // remotePeerId → [RTCIceCandidate]

/* ─── Peer identity ────────────────────────────────────────────────── */

function getLocalPeerId () {
  const pub = state.identity?.publicKey
  if (!pub) return null
  return String(pub)
}

/* ─── ICE config (STUN + TURN for cross-network P2P) ──────────────── */

const STUN_PRESETS = {
  google:     { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  metered:    { urls: 'stun:stun.relay.metered.ca:80' },
  twilio:     { urls: 'stun:global.stun.twilio.com:3478' },
  cloudflare: { urls: 'stun:stun.cloudflare.com:3478' },
  mozilla:    { urls: 'stun:stun.services.mozilla.com:3478' }
}

function getStunServerEntry () {
  const preset = state.settings.stunPreset || 'google'
  if (preset === 'custom') {
    const url = (state.settings.customStunUrl || '').trim()
    if (url) return { urls: url }
    return STUN_PRESETS.google
  }
  return STUN_PRESETS[preset] || STUN_PRESETS.google
}

function getRtcConfig () {
  const hasCustom = state.rtcIceServers && state.rtcIceServers.length > 0
  const servers = hasCustom
    ? state.rtcIceServers
    : [
        getStunServerEntry(),
        { urls: 'turn:global.relay.metered.ca:80', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
        { urls: 'turn:global.relay.metered.ca:443', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
        { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' }
      ]
  return { iceServers: servers, sdpSemantics: 'unified-plan' }
}

/* ─── Signaling via Autobase ───────────────────────────────────────── */

function sendCallSignal (payload) {
  send({
    type: 'call-signal',
    roomKey: state.activeCall?.roomKey,
    channelId: state.activeCall?.channelId,
    dmKey: state.activeCall?.dmKey || null,
    callId: state.activeCall?.id,
    signal: payload
  })
}

/* ─── RTCPeerConnection management (Perfect Negotiation) ──────────── */

/**
 * Determine politeness for the Perfect Negotiation pattern.
 * The peer with the lexicographically smaller ID is 'polite'.
 */
function isPolite (remotePeerId) {
  const local = getLocalPeerId()
  if (!local) return false
  return local < remotePeerId
}

/**
 * Create an RTCPeerConnection for the given remote peer.
 */
function createPeerConnection (remotePeerId) {
  if (state.peerConnections.has(remotePeerId)) {
    return state.peerConnections.get(remotePeerId)
  }

  const config = getRtcConfig()
  const pc = new RTCPeerConnection(config)
  state.peerConnections.set(remotePeerId, pc)

  // Track negotiation state for Perfect Negotiation
  pc._makingOffer = false
  pc._ignoreOffer = false

  // Add local tracks
  if (state.localCallStream) {
    for (const track of state.localCallStream.getTracks()) {
      pc.addTrack(track, state.localCallStream)
    }
  }

  // ── ICE candidates → send via Autobase ──
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      sendCallSignal({
        type: 'ice-candidate',
        from: getLocalPeerId(),
        to: remotePeerId,
        candidate: candidate.toJSON()
      })
    }
  }

  // ── ICE connection state monitoring ──
  pc.oniceconnectionstatechange = () => {
    console.log('[WebRTC] ICE state (' + remotePeerId.slice(0, 8) + '):', pc.iceConnectionState)
    if (pc.iceConnectionState === 'failed') {
      console.warn('[WebRTC] ICE failed — restarting ICE')
      restartIce(remotePeerId)
    }
    if (pc.iceConnectionState === 'disconnected') {
      // Give it a moment to recover before restarting
      setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected') {
          console.warn('[WebRTC] Still disconnected — restarting ICE')
          restartIce(remotePeerId)
        }
      }, 3000)
    }
  }

  // ── Remote tracks ──
  pc.ontrack = (event) => {
    console.log('[WebRTC] Remote track from:', remotePeerId.slice(0, 8), event.track.kind)
    let remoteStream = state.remoteStreams.get(remotePeerId)
    if (!remoteStream) {
      remoteStream = new MediaStream()
      state.remoteStreams.set(remotePeerId, remoteStream)
    }
    remoteStream.addTrack(event.track)

    event.track.onended = () => {
      remoteStream.removeTrack(event.track)
      if (remoteStream.getTracks().length === 0) {
        state.remoteStreams.delete(remotePeerId)
      }
      renderRemoteVideos()
    }

    renderRemoteVideos()
  }

  // ── Negotiation needed (Perfect Negotiation: polite/impolite) ──
  pc.onnegotiationneeded = async () => {
    try {
      pc._makingOffer = true
      await pc.setLocalDescription()
      sendCallSignal({
        type: 'offer',
        from: getLocalPeerId(),
        to: remotePeerId,
        sdp: pc.localDescription.sdp
      })
    } catch (err) {
      console.error('[WebRTC] negotiationneeded error:', err)
    } finally {
      pc._makingOffer = false
    }
  }

  return pc
}

/* ─── Handle incoming signaling messages ───────────────────────────── */

async function handleOffer (remotePeerId, sdp) {
  const pc = createPeerConnection(remotePeerId)
  const polite = isPolite(remotePeerId)

  const offerCollision = pc._makingOffer || pc.signalingState !== 'stable'

  if (offerCollision && !polite) {
    // Impolite peer ignores the incoming offer during collision
    pc._ignoreOffer = true
    console.log('[WebRTC] Ignoring colliding offer (impolite)')
    return
  }
  pc._ignoreOffer = false

  await pc.setRemoteDescription({ type: 'offer', sdp })
  drainPendingCandidates(remotePeerId, pc)

  await pc.setLocalDescription()
  sendCallSignal({
    type: 'answer',
    from: getLocalPeerId(),
    to: remotePeerId,
    sdp: pc.localDescription.sdp
  })
}

async function handleAnswer (remotePeerId, sdp) {
  const pc = state.peerConnections.get(remotePeerId)
  if (!pc) return

  if (pc.signalingState === 'stable') {
    console.log('[WebRTC] Ignoring answer in stable state')
    return
  }

  await pc.setRemoteDescription({ type: 'answer', sdp })
  drainPendingCandidates(remotePeerId, pc)
}

async function handleIceCandidate (remotePeerId, candidate) {
  const pc = state.peerConnections.get(remotePeerId)
  if (!pc || !pc.remoteDescription) {
    // Buffer the candidate until we have a remote description
    if (!pendingIceCandidates.has(remotePeerId)) {
      pendingIceCandidates.set(remotePeerId, [])
    }
    pendingIceCandidates.get(remotePeerId).push(candidate)
    return
  }

  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate))
  } catch (err) {
    if (!pc._ignoreOffer) {
      console.error('[WebRTC] addIceCandidate error:', err)
    }
  }
}

function drainPendingCandidates (remotePeerId, pc) {
  const buffered = pendingIceCandidates.get(remotePeerId)
  if (!buffered || buffered.length === 0) return
  pendingIceCandidates.delete(remotePeerId)
  for (const c of buffered) {
    try { pc.addIceCandidate(new RTCIceCandidate(c)) } catch (e) { console.warn('[WebRTC] drain candidate err:', e) }
  }
}

function restartIce (remotePeerId) {
  const pc = state.peerConnections.get(remotePeerId)
  if (!pc || pc.connectionState === 'closed') return
  try { pc.restartIce() } catch (e) { console.warn('[WebRTC] restartIce error:', e) }
}

/* ─── Outgoing call to a remote peer ───────────────────────────────── */

async function callPeer (remotePeerId) {
  if (!state.localCallStream) { console.error('[WebRTC] callPeer: no local stream'); return }
  if (remotePeerId === getLocalPeerId()) return  // don't call self

  // createPeerConnection triggers onnegotiationneeded which sends the offer
  createPeerConnection(remotePeerId)
}

function delay (ms) { return new Promise((r) => setTimeout(r, ms)) }

/* ─── Scope helpers ──────────────────────────────────────────────── */

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
    const activeText  = String(state.activeTextChannelByRoom.get(state.activeRoom) || 'general')
    const activeVoice = String(state.activeVoiceChannelByRoom.get(state.activeRoom) || 'voice-general')
    if (channelId !== activeText && channelId !== activeVoice) return false
  }

  return true
}

function callMatchesActiveCallScope (data) {
  if (!state.activeCall) return false
  if (String(data?.callId || '') !== String(state.activeCall.id || '')) return false

  const activeDmKey  = state.activeCall.dmKey ? String(state.activeCall.dmKey) : null
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

/* ─── Media acquisition ────────────────────────────────────────────── */

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
    window.localStream = stream

    if (mode === 'video' && camEnabled) {
      const liveVideo = stream.getVideoTracks().find((t) => t.readyState === 'live') || null
      if (!liveVideo) {
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          const freshTrack = fallback.getVideoTracks()[0] || null
          if (freshTrack) {
            for (const t of stream.getVideoTracks()) { stream.removeTrack(t); try { t.stop() } catch {} }
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

/* ─── Call lifecycle ───────────────────────────────────────────────── */

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
    peerId: getLocalPeerId()
  })
}

async function joinCall (callId, mode, channelId, options = {}) {
  stopRingtoneLoop()
  const stream = await requestCallMedia(mode)
  if (!stream || !state.activeRoom) return

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
    peerId: getLocalPeerId()
  })

  // Initiate WebRTC connection to the call starter
  if (options.peerId && options.peerId !== getLocalPeerId()) {
    setTimeout(() => {
      if (state.activeCall && state.localCallStream) {
        console.log('[WebRTC] Joiner calling starter:', options.peerId.slice(0, 8))
        callPeer(options.peerId)
      }
    }, 500)
  }
}

/* ─── Incoming Autobase messages ───────────────────────────────────── */

async function onIncomingCallStart (msg, roomKey) {
  if (!callMatchesCurrentView(msg?.data, roomKey)) return
  if (msg.sender === state.identity?.publicKey) return
  if (state.activeCall) return

  const callId = msg.data?.callId
  const mode = msg.data?.mode || 'voice'
  const channelId = msg.data?.channelId || 'general'
  const starterPeerId = msg.data?.peerId || null
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

  joinCall(callId, mode, channelId, Object.assign({}, scope, { peerId: starterPeerId }))
}

async function onIncomingCallJoin (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (!callMatchesActiveCallScope(msg?.data || {})) return
  if (msg.sender === state.identity?.publicKey) return

  const remotePeerId = msg.data?.peerId
  if (remotePeerId && remotePeerId !== getLocalPeerId() && state.localCallStream) {
    callPeer(remotePeerId)
  }
}

async function onIncomingCallSignal (msg, _roomKey) {
  if (!state.activeCall) return
  const signal = msg.data?.signal || msg.signal
  if (!signal) return

  const from = signal.from
  const to = signal.to
  const localId = getLocalPeerId()

  // Only process signals addressed to us
  if (to && to !== localId) return
  // Ignore our own signals
  if (from === localId) return

  try {
    switch (signal.type) {
      case 'offer':
        await handleOffer(from, signal.sdp)
        break
      case 'answer':
        await handleAnswer(from, signal.sdp)
        break
      case 'ice-candidate':
        await handleIceCandidate(from, signal.candidate)
        break
      default:
        console.warn('[WebRTC] Unknown signal type:', signal.type)
    }
  } catch (err) {
    console.error('[WebRTC] Signal handling error:', err)
  }
}

function onIncomingCallEnd (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (!callMatchesActiveCallScope(msg?.data || {})) return
  endCall(false)
}

/* ─── End call ─────────────────────────────────────────────────────── */

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

  // Close all RTCPeerConnections
  for (const pc of state.peerConnections.values()) {
    try { pc.close() } catch {}
  }
  state.peerConnections.clear()
  state.remoteStreams.clear()
  pendingIceCandidates.clear()

  // Stop local media tracks
  if (state.localCallStream) {
    for (const t of state.localCallStream.getTracks()) t.stop()
  }
  if (state.callScreenStream) {
    for (const t of state.callScreenStream.getTracks()) t.stop()
  }

  state.localCallStream = null
  state.activeCall = null
  window.localStream = null
  window.peer_stream = null
  ensureAutoCallBitrateLoop?.()
  hideCallStage()
  if (typeof renderChannelLists === 'function') renderChannelLists()
}

/* ─── UI helpers ───────────────────────────────────────────────────── */

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

/* ─── Compat stubs (referenced by other scripts) ───────────────────── */

function getRtcIceServers () {
  return getRtcConfig().iceServers
}
