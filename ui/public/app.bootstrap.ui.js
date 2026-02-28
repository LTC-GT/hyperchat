function fitUserSettingsModal () {
  const modal = dom.userSettingsModal
  const scaleWrap = dom.userSettingsScaleWrap
  const panel = dom.userSettingsPanel
  if (!modal || !scaleWrap || !panel || modal.classList.contains('hidden')) return

  scaleWrap.style.transform = 'none'
  scaleWrap.style.height = 'auto'
  panel.style.zoom = '1'

  const modalStyles = window.getComputedStyle(modal)
  const padLeft = parseFloat(modalStyles.paddingLeft || '0')
  const padRight = parseFloat(modalStyles.paddingRight || '0')
  const padTop = parseFloat(modalStyles.paddingTop || '0')
  const padBottom = parseFloat(modalStyles.paddingBottom || '0')

  const availableWidth = Math.max(1, modal.clientWidth - padLeft - padRight)
  const availableHeight = Math.max(1, modal.clientHeight - padTop - padBottom)
  const naturalWidth = Math.max(1, panel.offsetWidth)
  const naturalHeight = Math.max(1, panel.scrollHeight)

  const widthScale = availableWidth / naturalWidth
  const heightScale = availableHeight / naturalHeight
  const scale = Math.min(1, widthScale, heightScale)

  if (typeof panel.style.zoom !== 'undefined') {
    panel.style.zoom = String(scale)
    return
  }

  scaleWrap.style.transform = `scale(${scale})`
  scaleWrap.style.height = `${naturalHeight * scale}px`
}

function scheduleFitUserSettingsModal () {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      fitUserSettingsModal()
    })
  })
}

function openUserSettings () {
  dom.userStatusMenu?.classList.add('hidden')
  hydrateSettingsModal()
  dom.userSettingsModal?.classList.remove('hidden')
  scheduleFitUserSettingsModal()
  runP2PNetworkTest()
  refreshMediaDevices().catch(() => {}).finally(() => {
    scheduleFitUserSettingsModal()
  })
}

function closeUserSettings () {
  if (dom.userSettingsScaleWrap) {
    dom.userSettingsScaleWrap.style.transform = 'none'
    dom.userSettingsScaleWrap.style.height = 'auto'
  }
  if (dom.userSettingsPanel) dom.userSettingsPanel.style.zoom = '1'
  dom.userSettingsModal?.classList.add('hidden')
}

function renderStatusMenuSelection () {
  const current = state.settings.presenceStatus || 'active'
  for (const option of document.querySelectorAll('.status-option')) {
    const value = option.getAttribute('data-status')
    const selected = value === current
    option.classList.toggle('bg-quibble-active', selected)
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
  if (dom.settingsEnableHD) dom.settingsEnableHD.checked = state.settings.enableHD !== false
  if (dom.settingsRecordSelf) dom.settingsRecordSelf.checked = state.settings.recordSelfInCall !== false
  dom.settingsNotificationTone.value = state.settings.notificationTone
  dom.settingsRingtone.value = state.settings.ringtone

  if (dom.settingsStunPreset) {
    dom.settingsStunPreset.value = state.settings.stunPreset || 'google'
    toggleCustomStunVisibility(state.settings.stunPreset)
  }
  if (dom.settingsCustomStunUrl) dom.settingsCustomStunUrl.value = state.settings.customStunUrl || ''

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
  scheduleFitUserSettingsModal()
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
      iceServers: getRtcIceServers(),
      iceCandidatePoolSize: 2
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

    pc.createDataChannel('quibble-p2p-test')
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

  const permissionQuery = navigator.permissions?.query
    ? async (name) => {
        try {
          const result = await navigator.permissions.query({ name })
          return result?.state || 'prompt'
        } catch {
          return 'prompt'
        }
      }
    : async () => 'prompt'

  const [cameraPermission, micPermission] = await Promise.all([
    permissionQuery('camera'),
    permissionQuery('microphone')
  ])

  const devices = await navigator.mediaDevices.enumerateDevices()
  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput')

  if (dom.settingsCamera) {
    dom.settingsCamera.innerHTML = '<option value="">System default camera</option>'
    for (const [idx, camera] of cameras.entries()) {
      const option = document.createElement('option')
      option.value = camera.deviceId
      option.textContent = camera.label || `Camera ${idx + 1}${cameraPermission === 'denied' ? ' (blocked)' : ''}`
      dom.settingsCamera.appendChild(option)
    }
    dom.settingsCamera.value = state.settings.cameraId
  }

  if (dom.settingsMic) {
    dom.settingsMic.innerHTML = '<option value="">System default microphone</option>'
    for (const [idx, mic] of mics.entries()) {
      const option = document.createElement('option')
      option.value = mic.deviceId
      option.textContent = mic.label || `Microphone ${idx + 1}${micPermission === 'denied' ? ' (blocked)' : ''}`
      dom.settingsMic.appendChild(option)
    }
    dom.settingsMic.value = state.settings.micId
  }
}

function toggleCustomStunVisibility (preset) {
  if (!dom.settingsCustomStunWrap) return
  dom.settingsCustomStunWrap.classList.toggle('hidden', preset !== 'custom')
}

dom.settingsStunPreset?.addEventListener('change', () => {
  toggleCustomStunVisibility(dom.settingsStunPreset.value)
})

dom.btnUserSettings?.addEventListener('click', openUserSettings)
dom.btnUserSettingsSidebar?.addEventListener('click', (e) => {
  e.stopPropagation()
  openUserSettings()
})
dom.btnProfileQuick?.addEventListener('click', (event) => {
  if (event.target?.closest('#btnToggleMicGlobal') || event.target?.closest('#btnToggleCameraGlobal') || event.target?.closest('#btnUserSettingsSidebar') || event.target?.closest('#btnInvite')) return
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

window.addEventListener('resize', () => {
  scheduleFitUserSettingsModal()
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
  state.settings.enableHD = Boolean(dom.settingsEnableHD?.checked)
  state.settings.recordSelfInCall = Boolean(dom.settingsRecordSelf?.checked)
  state.settings.notificationTone = dom.settingsNotificationTone?.value || 'chime'
  state.settings.ringtone = dom.settingsRingtone?.value || 'ring-bell'
  state.settings.stunPreset = dom.settingsStunPreset?.value || 'google'
  state.settings.customStunUrl = (dom.settingsCustomStunUrl?.value || '').trim()
  saveClientSettings()
  if (state.activeCall && typeof applyCallBitrate === 'function') {
    applyCallBitrate(state.settings.callBitrateMode || 'auto')
  }

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
  state.settings.notificationTone = dom.settingsNotificationTone?.value || 'chime'
  saveClientSettings()
  playTonePreset(state.settings.notificationTone)
})

dom.btnPreviewRingtone?.addEventListener('click', () => {
  state.settings.ringtone = dom.settingsRingtone?.value || 'ring-bell'
  saveClientSettings()
  playTonePreset(state.settings.ringtone, { repeats: 3 })
})

dom.btnRetestP2P?.addEventListener('click', () => {
  state.p2pNetworkTest.checkedAt = 0
  runP2PNetworkTest()
})

dom.btnDownloadSeedPhrase?.addEventListener('click', () => {
  send({ type: 'download-seed-phrase' })
})

dom.btnUploadSeedPhrase?.addEventListener('click', () => {
  dom.seedPhraseUploadInput?.click()
})

dom.seedPhraseUploadInput?.addEventListener('change', async (event) => {
  const file = event.target?.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const seedPhrase = parseSeedPhraseInput(text)
    if (!seedPhrase) {
      await appAlert('Could not read a seed phrase from that file.', { title: 'Invalid seed file' })
      return
    }

    const confirmed = await appConfirm('Import this seed phrase for this device identity? Quibble will close afterwards.', {
      title: 'Import seed phrase',
      confirmText: 'Import',
      cancelText: 'Cancel'
    })
    if (!confirmed) return

    send({ type: 'import-seed-phrase', seedPhrase })
  } finally {
    if (dom.seedPhraseUploadInput) dom.seedPhraseUploadInput.value = ''
  }
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

  send({
    type: 'create-room',
    emoji: state.pendingCreatedRoomProfile.emoji || '😀',
    imageData: state.pendingCreatedRoomProfile.imageData || null,
    mimeType: state.pendingCreatedRoomProfile.mimeType || null
  })
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

dom.btnInvite.addEventListener('click', (event) => {
  event.stopPropagation()
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

