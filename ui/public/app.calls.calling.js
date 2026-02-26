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
    return vc ? `voice ${vc.name}` : 'voice channel'
  }

  const tc = getChannelById(scope?.roomKey, 'text', scope?.channelId)
  return tc ? `#${tc.name}` : '#general'
}

async function startCall (mode, options = {}) {
  const scope = resolveCallScope(options)
  if (!scope) return
  if (state.activeCall) await endCall(true)

  if (isCurrentUserBannedFromRoom(scope.roomKey) || (!scope.dmKey && isCurrentUserKickedFromChannel(scope.roomKey, scope.channelId))) {
    await appAlert('You cannot join this channel.', { title: 'Access blocked' })
    return
  }

  const callId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
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
    mode
  })
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
      const liveVideo = stream.getVideoTracks().find((track) => track.readyState === 'live') || null
      if (!liveVideo) {
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
          const freshTrack = fallback.getVideoTracks()[0] || null
          if (freshTrack) {
            for (const track of stream.getVideoTracks()) {
              stream.removeTrack(track)
              try { track.stop() } catch {}
            }
            stream.addTrack(freshTrack)
          }
        } catch (videoErr) {
          console.warn('Video fallback capture failed:', videoErr)
        }
      }
    }

    if (forceMutedTracks) {
      for (const track of stream.getTracks()) track.enabled = false
    }
    return stream
  } catch (err) {
    console.error('Call media access failed:', err)
    return null
  }
}

function resolveRemotePeerStream (peerKey, event) {
  const current = state.remoteStreams.get(peerKey) || null
  const incoming = event?.streams?.[0] || null

  let target = current || incoming || new MediaStream()

  const mergeTrack = (track) => {
    if (!track) return
    const exists = target.getTracks().some((candidate) => candidate.id === track.id)
    if (!exists) target.addTrack(track)
  }

  if (incoming) {
    if (!current) {
      target = incoming
    } else if (current.id !== incoming.id) {
      for (const track of current.getTracks()) mergeTrack(track)
    }

    for (const track of incoming.getTracks()) mergeTrack(track)
  }

  mergeTrack(event?.track || null)
  return target
}

async function onIncomingCallStart (msg, roomKey) {
  if (!callMatchesCurrentView(msg?.data, roomKey)) return
  if (msg.sender === state.identity?.publicKey) return
  if (state.activeCall) return

  const callId = msg.data?.callId
  const mode = msg.data?.mode || 'voice'
  const channelId = msg.data?.channelId || 'general'
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
  const ok = await appConfirm(`${msg.senderName || 'Someone'} started a ${mode} call in ${label}. Join?`, {
    title: 'Incoming call',
    confirmText: 'Join'
  })
  stopRingtoneLoop()
  if (!ok) return

  joinCall(callId, mode, channelId, scope)
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
    mode
  })
}

async function onIncomingCallJoin (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall) return
  if (!callMatchesActiveCallScope(msg?.data || {})) return
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
    dmKey: state.activeCall.dmKey || null,
    callId: state.activeCall.id,
    target: msg.sender,
    signal: { type: 'offer', sdp: offer.sdp }
  })
}

async function onIncomingCallSignal (msg, roomKey) {
  if (!state.activeRoom || state.activeRoom !== roomKey) return
  if (!state.activeCall || !msg?.data?.signal) return
  if (!callMatchesActiveCallScope(msg.data)) return
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
      dmKey: state.activeCall.dmKey || null,
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
  if (!callMatchesActiveCallScope(msg?.data || {})) return
  endCall(false)
}

const PEER_DISCONNECT_GRACE_MS = 12000
const peerDisconnectTimers = new Map()
const peerIceRestartAttempts = new Map()

function clearPeerDisconnectTimer (peerKey) {
  const timer = peerDisconnectTimers.get(peerKey)
  if (timer) clearTimeout(timer)
  peerDisconnectTimers.delete(peerKey)
}

function clearPeerConnectionState (peerKey) {
  clearPeerDisconnectTimer(peerKey)
  peerIceRestartAttempts.delete(peerKey)
}

function removePeerConnection (peerKey, pc = null) {
  const current = state.peerConnections.get(peerKey)
  if (pc && current && current !== pc) return

  clearPeerConnectionState(peerKey)
  if (!current) return

  try { current.close() } catch {}
  state.peerConnections.delete(peerKey)
  state.remoteStreams.delete(peerKey)
  renderRemoteVideos()
}

function schedulePeerDisconnectCleanup (peerKey, pc) {
  clearPeerDisconnectTimer(peerKey)
  const timer = setTimeout(() => {
    const current = state.peerConnections.get(peerKey)
    if (!current || current !== pc) return
    if (!['disconnected', 'failed', 'closed'].includes(current.connectionState)) return
    removePeerConnection(peerKey, current)
  }, PEER_DISCONNECT_GRACE_MS)
  peerDisconnectTimers.set(peerKey, timer)
}

async function attemptPeerIceRestart (peerKey, pc) {
  if (!pc || pc.connectionState === 'closed') return false
  if (!state.activeCall) return false

  const attempts = Number(peerIceRestartAttempts.get(peerKey) || 0)
  if (attempts >= 1) return false
  peerIceRestartAttempts.set(peerKey, attempts + 1)

  try {
    if (typeof pc.restartIce === 'function') pc.restartIce()
    const offer = await pc.createOffer({ iceRestart: true })
    await pc.setLocalDescription(offer)

    send({
      type: 'call-signal',
      roomKey: state.activeRoom,
      channelId: state.activeCall.channelId,
      dmKey: state.activeCall.dmKey || null,
      callId: state.activeCall.id,
      target: peerKey,
      signal: { type: 'offer', sdp: offer.sdp }
    })
    return true
  } catch (err) {
    console.warn('ICE restart attempt failed:', err)
    return false
  }
}

async function ensurePeerConnection (peerKey) {
  if (state.peerConnections.has(peerKey)) return
  if (!state.localCallStream || !state.activeCall) return

  const pc = new RTCPeerConnection({
    iceServers: [{
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302'
      ]
    }]
  })

  const localAudioTrack = state.localCallStream.getAudioTracks()[0] || null
  if (localAudioTrack) pc.addTrack(localAudioTrack, state.localCallStream)

  const screenTrack = state.callScreenStream?.getVideoTracks?.()[0] || null
  const localCameraTrack = state.localCallStream.getVideoTracks()[0] || null
  const localVideoTrack = screenTrack || localCameraTrack
  if (localVideoTrack) {
    const sourceStream = screenTrack ? state.callScreenStream : state.localCallStream
    pc.addTrack(localVideoTrack, sourceStream)
  }

  preferAv1VideoCodec(pc)

  pc.onicecandidate = (event) => {
    if (!event.candidate || !state.activeCall) return
    send({
      type: 'call-signal',
      roomKey: state.activeRoom,
      channelId: state.activeCall.channelId,
      dmKey: state.activeCall.dmKey || null,
      callId: state.activeCall.id,
      target: peerKey,
      signal: { type: 'candidate', candidate: event.candidate }
    })
  }

  pc.ontrack = (event) => {
    const stream = resolveRemotePeerStream(peerKey, event)
    const track = event?.track || null
    if (track) {
      track.onunmute = () => renderRemoteVideos()
      track.onended = () => renderRemoteVideos()
    }
    state.remoteStreams.set(peerKey, stream)
    renderRemoteVideos()
  }

  pc.onconnectionstatechange = () => {
    if (state.settings.callBitrateMode === 'auto') applyCallBitrate('auto')

    if (pc.connectionState === 'connected') {
      clearPeerConnectionState(peerKey)
      return
    }

    if (pc.connectionState === 'disconnected') {
      schedulePeerDisconnectCleanup(peerKey, pc)
      return
    }

    if (pc.connectionState === 'failed') {
      schedulePeerDisconnectCleanup(peerKey, pc)
      attemptPeerIceRestart(peerKey, pc).catch(() => {})
      if (dom.callStatus) dom.callStatus.textContent = 'Call connection unstable — retrying…'
      return
    }

    if (pc.connectionState === 'closed') {
      removePeerConnection(peerKey, pc)
    }
  }

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      clearPeerConnectionState(peerKey)
      return
    }

    if (pc.iceConnectionState === 'failed') {
      schedulePeerDisconnectCleanup(peerKey, pc)
      attemptPeerIceRestart(peerKey, pc).catch(() => {})
    }
  }

  state.peerConnections.set(peerKey, pc)
}

function preferAv1VideoCodec (pc) {
  if (!pc || typeof RTCRtpSender === 'undefined') return
  if (typeof RTCRtpSender.getCapabilities !== 'function') return

  const videoCaps = RTCRtpSender.getCapabilities('video')
  const codecs = Array.isArray(videoCaps?.codecs) ? videoCaps.codecs : []
  if (codecs.length === 0) return

  const av1 = codecs.filter((codec) => /(^|\/)AV1X?/i.test(String(codec?.mimeType || '')))
  if (av1.length === 0) return

  const others = codecs.filter((codec) => !/(^|\/)AV1X?/i.test(String(codec?.mimeType || '')))
  const preferred = [...av1, ...others]

  for (const transceiver of pc.getTransceivers()) {
    if (transceiver?.sender?.track?.kind !== 'video') continue
    if (typeof transceiver.setCodecPreferences !== 'function') continue
    try {
      transceiver.setCodecPreferences(preferred)
    } catch {}
  }
}

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

  for (const pc of state.peerConnections.values()) {
    try { pc.close() } catch {}
  }

  for (const peerKey of state.peerConnections.keys()) {
    clearPeerConnectionState(peerKey)
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
  ensureAutoCallBitrateLoop?.()
  hideCallStage()
  if (typeof renderChannelLists === 'function') renderChannelLists()
}

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
  dom.callStatus.textContent = `${mode[0].toUpperCase() + mode.slice(1)} call active`

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
