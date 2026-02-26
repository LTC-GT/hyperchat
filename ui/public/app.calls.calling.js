/* ===================================================================
   PeerJS-based video/voice calling for Quibble
   ===================================================================
   Based on the PeerJS library (https://peerjs.com/docs/#api).

   All WebRTC complexity (ICE, STUN/TURN, offer/answer, candidates)
   is handled by PeerJS.  Signaling goes through a self-hosted
   PeerServer running alongside the Quibble HTTP server (port + 1).

   The Autobase room channel announces call-start / call-join /
   call-end events so every member's UI stays in sync.

   Media flows P2P between browsers via WebRTC (DTLS/SRTP encrypted).
   TURN servers are included in the default ICE config so calls work
   across different networks, symmetric NATs and firewalls.

   Peer IDs are derived from the user's Hypercore public key.
   =================================================================== */

/* ─── Module state ─────────────────────────────────────────────────── */

let peerInstance = null                       // PeerJS Peer
const activeMediaConnections = new Map()      // remotePeerJsId → MediaConnection
let _peerOpenPromise = null                   // resolves when peer.on('open') fires

/* ─── PeerJS identity ──────────────────────────────────────────────── */

function getPeerJsId () {
  const pub = state.identity?.publicKey
  if (!pub) return null
  return 'qb-' + String(pub).replace(/[^a-zA-Z0-9]/g, '').slice(0, 48)
}

/* ─── ICE config (STUN + TURN for cross-network P2P) ──────────────── */

function getPeerJsIceConfig () {
  const hasCustom = state.rtcIceServers && state.rtcIceServers.length > 0
  const servers = hasCustom
    ? state.rtcIceServers
    : [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: 'turn:global.relay.metered.ca:80', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
        { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
        { urls: 'turn:global.relay.metered.ca:443', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' },
        { urls: 'turn:global.relay.metered.ca:443?transport=tcp', username: 'e8dd65b92c81bce34e5765b8', credential: 'kMQuBG7UrDaAx3uv' }
      ]
  return { iceServers: servers }
}

/* ─── PeerJS instance lifecycle ────────────────────────────────────── */

/**
 * Create or return the singleton PeerJS Peer.
 *
 * Modelled on the videochat-peerjs-example: create once, register the
 * `peer.on('call')` handler immediately so incoming calls are never missed.
 */
function ensurePeerInstance () {
  // Healthy — reuse
  if (peerInstance && !peerInstance.destroyed && !peerInstance.disconnected) {
    return peerInstance
  }

  // Disconnected but alive — reconnect
  if (peerInstance && !peerInstance.destroyed && peerInstance.disconnected) {
    console.log('[PeerJS] Reconnecting…')
    try { peerInstance.reconnect() } catch (e) { console.warn('[PeerJS] reconnect error:', e) }
    return peerInstance
  }

  const myId = getPeerJsId()
  if (!myId) return null

  // Tear down stale instance
  if (peerInstance) { try { peerInstance.destroy() } catch {} }
  peerInstance = null

  const peerServerHost = state.peerServerHost || location.hostname
  const peerServerPort = state.peerServerPort || (Number(location.port) + 1)
  const peerServerPath = state.peerServerPath || '/peerjs'
  const peerServerKey  = state.peerServerKey  || 'quibble'

  console.log('[PeerJS] Creating peer', myId, '→', peerServerHost + ':' + peerServerPort + peerServerPath)

  _peerOpenPromise = new Promise((resolve) => {
    peerInstance = new Peer(myId, {
      host:   peerServerHost,
      port:   peerServerPort,
      path:   peerServerPath,
      key:    peerServerKey,
      secure: location.protocol === 'https:',
      debug:  2,
      config: getPeerJsIceConfig()
    })

    /* ── open ─────────────────────────────────────────────────── */
    peerInstance.on('open', (openId) => {
      console.log('[PeerJS] Connected — id:', openId)
      resolve()
    })

    /* ── error ────────────────────────────────────────────────── */
    peerInstance.on('error', (err) => {
      console.error('[PeerJS] Error:', err.type, err.message || err)

      if (err.type === 'unavailable-id') {
        // Stale session on PeerServer — destroy and recreate after timeout
        console.log('[PeerJS] ID taken (stale). Retrying in 6 s…')
        try { peerInstance.destroy() } catch {}
        peerInstance = null
        setTimeout(() => ensurePeerInstance(), 6000)
        resolve()                       // unblock anyone awaiting open
        return
      }

      // For network / server / other errors just resolve so callers
      // don't hang; the call itself will fail gracefully.
      resolve()
    })

    /* ── disconnected ─────────────────────────────────────────── */
    peerInstance.on('disconnected', () => {
      if (peerInstance && !peerInstance.destroyed) {
        console.warn('[PeerJS] Disconnected — reconnecting…')
        try { peerInstance.reconnect() } catch {}
      }
    })

    /* ── incoming call (core handler — like the PeerJS example) ─ */
    peerInstance.on('call', (incomingCall) => {
      console.log('[PeerJS] Incoming call from:', incomingCall.peer)

      if (!state.activeCall || !state.localCallStream) {
        console.warn('[PeerJS] No active call / no local stream — ignoring')
        return
      }

      // Answer immediately with our local stream (same as example)
      incomingCall.answer(state.localCallStream)
      wireMediaConnection(incomingCall)
    })
  })

  return peerInstance
}

/**
 * Wait until the Peer has connected to PeerServer (open event).
 */
async function waitForPeerOpen () {
  if (_peerOpenPromise) await _peerOpenPromise
}

/* ─── Wire a MediaConnection ───────────────────────────────────────── */

function wireMediaConnection (mc) {
  const remotePeerId = mc.peer

  mc.on('stream', (remoteStream) => {
    console.log('[PeerJS] Remote stream from:', remotePeerId)
    window.peer_stream = remoteStream             // global ref (like example)
    state.remoteStreams.set(remotePeerId, remoteStream)
    syncPeerConnectionsFromPeerJs()
    renderRemoteVideos()
  })

  mc.on('close', () => {
    console.log('[PeerJS] Media closed:', remotePeerId)
    state.remoteStreams.delete(remotePeerId)
    activeMediaConnections.delete(remotePeerId)
    syncPeerConnectionsFromPeerJs()
    renderRemoteVideos()
  })

  mc.on('error', (err) => {
    console.error('[PeerJS] Media error:', remotePeerId, err)
    state.remoteStreams.delete(remotePeerId)
    activeMediaConnections.delete(remotePeerId)
    syncPeerConnectionsFromPeerJs()
    renderRemoteVideos()
  })

  activeMediaConnections.set(remotePeerId, mc)
  syncPeerConnectionsFromPeerJs()
}

/* ─── Outgoing call to a remote peer ───────────────────────────────── */

async function callPeer (remotePeerId, localStream) {
  if (!localStream) { console.error('[PeerJS] callPeer: no local stream'); return }
  if (activeMediaConnections.has(remotePeerId)) return   // already connected

  const peer = ensurePeerInstance()
  if (!peer) { console.error('[PeerJS] callPeer: no peer instance'); return }
  await waitForPeerOpen()

  // Retry loop — the remote peer may not have registered on PeerServer
  // yet (Autobase message arrives before PeerServer registration).
  const MAX_ATTEMPTS = 6
  const RETRY_DELAY  = 2500

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (activeMediaConnections.has(remotePeerId)) return  // connected inbound

    console.log(`[PeerJS] Calling ${remotePeerId} (attempt ${attempt}/${MAX_ATTEMPTS})`)
    const mc = peerInstance.call(remotePeerId, localStream)
    if (!mc) {
      console.warn('[PeerJS] peer.call() returned null')
      await delay(RETRY_DELAY)
      continue
    }

    const result = await raceCallResult(mc, remotePeerId, 8000)

    if (result === 'stream') {
      wireMediaConnection(mc)
      console.log('[PeerJS] Connected to', remotePeerId)
      return
    }

    // Clean up failed attempt
    try { mc.close() } catch {}

    if (attempt < MAX_ATTEMPTS) {
      console.log(`[PeerJS] Attempt ${attempt} → ${result}. Retrying in ${RETRY_DELAY} ms…`)
      await delay(RETRY_DELAY)
    }
  }

  console.error('[PeerJS] All attempts exhausted for', remotePeerId)
}

/**
 * Race the call result: resolves 'stream' | 'error' | 'close' | 'peer-unavailable' | 'timeout'.
 */
function raceCallResult (mc, remotePeerId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const settle = (v) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      removePeerListener()
      resolve(v)
    }

    const timer = setTimeout(() => settle('timeout'), timeoutMs)
    mc.on('stream', () => settle('stream'))
    mc.on('error',  () => settle('error'))
    mc.on('close',  () => settle('close'))

    // PeerJS emits 'peer-unavailable' on the Peer, not the MediaConnection
    const onPeerError = (err) => {
      if (err.type === 'peer-unavailable' && String(err.message || '').includes(remotePeerId)) {
        settle('peer-unavailable')
      }
    }
    peerInstance.on('error', onPeerError)
    function removePeerListener () { try { peerInstance.off('error', onPeerError) } catch {} }
  })
}

function delay (ms) { return new Promise((r) => setTimeout(r, ms)) }

/* ─── Sync state.peerConnections from PeerJS media connections ────── */

function syncPeerConnectionsFromPeerJs () {
  state.peerConnections.clear()
  for (const [peerId, mc] of activeMediaConnections) {
    const pc = mc.peerConnection
    if (pc) state.peerConnections.set(peerId, pc)
  }
}

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

    // Store as global ref (like the PeerJS example: window.localStream)
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

  // Connect to PeerServer eagerly and wait for open
  ensurePeerInstance()
  await waitForPeerOpen()

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

  // Announce the call via Autobase so the remote peer's UI shows the
  // incoming-call prompt.  We send this BEFORE calling them with PeerJS
  // so they have time to join and register on PeerServer.
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

  // Connect to PeerServer eagerly and wait for open
  ensurePeerInstance()
  await waitForPeerOpen()

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

  // Announce join via Autobase.  The call starter receives this and
  // initiates the PeerJS media connection to us via onIncomingCallJoin.
  // We answer automatically via the peer.on('call') handler above.
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
}

/* ─── Incoming Autobase messages ───────────────────────────────────── */

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
    // The joiner is ready on PeerServer — call them.
    // They will answer via peer.on('call') automatically.
    callPeer(remotePeerId, state.localCallStream)
  }
}

function onIncomingCallSignal (_msg, _roomKey) {
  // PeerJS handles all WebRTC signaling internally — no-op
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

  // Close all PeerJS media connections
  for (const mc of activeMediaConnections.values()) {
    try { mc.close() } catch {}
  }
  activeMediaConnections.clear()

  for (const pc of state.peerConnections.values()) {
    try { pc.close() } catch {}
  }
  state.peerConnections.clear()
  state.remoteStreams.clear()

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
  return getPeerJsIceConfig().iceServers
}
