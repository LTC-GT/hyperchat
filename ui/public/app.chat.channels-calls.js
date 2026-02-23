function getVoiceChannelParticipants (channelId) {
  if (!state.activeRoom || !channelId || !state.activeCall) return []
  if (state.activeCall.roomKey !== state.activeRoom || state.activeCall.channelId !== channelId) return []

  const participants = new Map()
  const selfKey = state.identity?.publicKey
  if (selfKey) {
    participants.set(selfKey, {
      name: state.profile.fullName || state.profile.username || 'You',
      avatar: state.profile.avatar || null,
      isSelf: true
    })
  }

  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  for (const msg of roomMsgs) {
    if (msg?.type !== 'system') continue
    if (msg.action !== 'call-start' && msg.action !== 'call-join') continue
    if (msg.data?.channelId !== channelId) continue
    if (msg.data?.callId !== state.activeCall.id) continue
    if (!msg.sender) continue

    participants.set(msg.sender, {
      name: msg.senderName || msg.sender.slice(0, 8),
      avatar: msg.senderAvatar || null,
      isSelf: msg.sender === selfKey
    })
  }

  return [...participants.entries()].map(([key, meta]) => ({ key, ...meta }))
}

function renderChannelLists () {
  if (!state.activeRoom) return

  const channels = state.channelsByRoom.get(state.activeRoom) || { text: [], voice: [] }
  const activeText = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  const activeVoice = state.activeVoiceChannelByRoom.get(state.activeRoom) || 'voice-general'

  dom.textChannelList.innerHTML = ''
  for (const channel of channels.text) {
    const btn = document.createElement('button')
    const isActive = channel.id === activeText
    btn.className = `w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-left text-sm ${isActive ? 'bg-quibble-active text-quibble-text' : 'text-quibble-text-s hover:text-quibble-text hover:bg-quibble-hover'}`
    btn.innerHTML = `<span class="text-quibble-text-m">#</span><span>${esc(channel.name)}</span>${channel.modOnly ? '<span class="ml-auto text-[10px]">🔒</span>' : ''}`

    btn.addEventListener('click', () => {
      state.activeTextChannelByRoom.set(state.activeRoom, channel.id)
      state.activeDmKey = null
      state.activeThreadRootId = null
      clearSearchResultsView()
      dom.chatHeaderTitle.textContent = channel.name
      const roomName = state.rooms.get(state.activeRoom)?.name || 'Room'
      dom.chatHeaderDesc.textContent = channel.id === 'general'
        ? `${roomName} channel`
        : `#${channel.name}`
      dom.messageInput.placeholder = `Message #${channel.name}`
      renderChannelLists()
      renderMessages()
      renderPinnedBar()
      closeThreadPanel()
      updateHeaderActionVisibility()
      scrollToBottom()
    })

    dom.textChannelList.appendChild(btn)
  }

  dom.voiceChannelList.innerHTML = ''
  for (const channel of channels.voice) {
    const row = document.createElement('div')
    const isActive = channel.id === activeVoice
    const isConnectedHere = Boolean(
      state.activeCall &&
      state.activeCall.roomKey === state.activeRoom &&
      state.activeCall.channelId === channel.id
    )
    const participants = getVoiceChannelParticipants(channel.id)
    const blockedVoice = isCurrentUserBannedFromRoom(state.activeRoom) || isCurrentUserKickedFromChannel(state.activeRoom, channel.id)
    row.className = `w-full rounded text-left text-sm ${isActive ? 'bg-quibble-active text-quibble-text' : 'text-quibble-text-s hover:text-quibble-text hover:bg-quibble-hover'}`
    const participantsHtml = participants.length
      ? `<div class="px-2 pb-1.5 space-y-1">${participants.map((participant) => {
          const avatar = participant.avatar
            ? `<img src="${esc(participant.avatar)}" class="w-full h-full object-cover">`
            : getDefaultAvatar(participant.name)
          return `
            <div class="flex items-center gap-2 pl-6 text-xs text-quibble-text-s">
              <div class="w-5 h-5 rounded-full bg-quibble-blurple flex items-center justify-center text-[10px] font-bold overflow-hidden">${avatar}</div>
              <span class="truncate">${esc(participant.name)}${participant.isSelf ? ' (You)' : ''}</span>
            </div>
          `
        }).join('')}</div>`
      : ''
    row.innerHTML = `
      <div class="flex items-center gap-1.5 px-2 py-1.5">
        <button class="voice-select flex items-center gap-1.5 flex-1 text-left">
          <span class="text-quibble-text-m">🔊</span><span>${esc(channel.name)}</span>
        </button>
        ${channel.modOnly ? '<span class="text-[10px]">🔒</span>' : ''}
        <button class="voice-join px-2 py-0.5 text-[11px] rounded ${blockedVoice ? 'bg-quibble-active text-quibble-text-m' : isConnectedHere ? 'bg-quibble-green text-white' : 'bg-quibble-blurple text-white'}" ${blockedVoice || isConnectedHere ? 'disabled' : ''}>${isConnectedHere ? 'Joined' : 'Join'}</button>
      </div>
      ${participantsHtml}
    `

    const selectBtn = row.querySelector('.voice-select')
    const joinBtn = row.querySelector('.voice-join')

    selectBtn.addEventListener('click', () => {
      state.activeVoiceChannelByRoom.set(state.activeRoom, channel.id)
      renderChannelLists()
    })

    joinBtn.addEventListener('click', async () => {
      if (isConnectedHere) return
      state.activeVoiceChannelByRoom.set(state.activeRoom, channel.id)
      await startCall('voice', { inlineChannelUi: true })
      renderChannelLists()
    })

    dom.voiceChannelList.appendChild(row)
  }

  updateComposerAccess()
  if (!dom.adminModal?.classList.contains('hidden')) renderModerationPanel()
}

function getVisibleMessagesForActiveTextChannel () {
  const roomMsgs = state.messagesByRoom.get(state.activeRoom) || []
  const activeText = state.activeTextChannelByRoom.get(state.activeRoom) || 'general'
  return roomMsgs.filter((msg) => {
    if (msg?.sender && msg.type !== 'system' && isSenderBlockedForChannel(state.activeRoom, activeText, msg.sender)) return false
    if (!messageBelongsToTextChannel(msg, activeText)) return false
    if (state.activeDmKey) return msg.dmKey === state.activeDmKey
    if (msg.dmKey) return false
    if (msg.threadRootId) return false
    return true
  })
}

function messageBelongsToTextChannel (msg, channelId) {
  if (!msg) return false

  if (msg.type === 'text' || msg.type === 'file') {
    return (msg.channelId || 'general') === channelId
  }

  if (msg.type === 'system') {
    if (msg.action === 'channel-add' || msg.action === 'room-admin-set' || msg.action === 'room-owner-set' || msg.action === 'room-name-set' || msg.action === 'room-profile-set' || msg.action === 'room-disband' || msg.action?.startsWith('custom-emoji-')) return true
    if (msg.action === 'message-pin' || msg.action === 'message-unpin') {
      return (msg.data?.channelId || 'general') === channelId
    }
    if (msg.action === 'friend-request' || msg.action === 'friend-accept') return false
    if (msg.action === 'room-ban' || msg.action === 'room-unban' || msg.action === 'room-kick' || msg.action === 'room-unkick' || msg.action === 'channel-kick' || msg.action === 'channel-unkick') return true
    if (msg.action?.startsWith('call-')) return false
    return channelId === 'general'
  }

  if (msg.type === 'voice') return channelId === 'general'
  return true
}

// Calls: voice/video/screen with WebRTC and room-message signaling

dom.btnVoice?.addEventListener('click', async () => { await startCall('voice') })
dom.btnVideoCall?.addEventListener('click', async () => { await startCall('video') })
dom.btnEndCall?.addEventListener('click', async () => { await endCall(true) })
dom.btnCallControls?.addEventListener('click', (e) => {
  e.stopPropagation()
  dom.callControlsMenu?.classList.toggle('hidden')
  if (!dom.callControlsMenu?.classList.contains('hidden') && typeof refreshCallControlsMenu === 'function') {
    refreshCallControlsMenu()
  }
})
dom.btnCallScreenShare?.addEventListener('click', async () => { await toggleCallScreenShare() })
dom.btnCallTheater?.addEventListener('click', () => {
  state.callTheater = !state.callTheater
  dom.callStage?.classList.toggle('fixed', state.callTheater)
  dom.callStage?.classList.toggle('inset-0', state.callTheater)
  dom.callStage?.classList.toggle('z-40', state.callTheater)
  dom.callStage?.classList.toggle('bg-quibble-bg', state.callTheater)
  dom.callStage?.classList.toggle('call-stage-expanded', state.callTheater || document.fullscreenElement === dom.callStage)
  refreshCallControlsMenu?.()
})
dom.btnCallFullscreen?.addEventListener('click', async () => {
  if (!document.fullscreenElement) await dom.callStage?.requestFullscreen?.()
  else await document.exitFullscreen?.()
  dom.callStage?.classList.toggle('call-stage-expanded', state.callTheater || document.fullscreenElement === dom.callStage)
  refreshCallControlsMenu?.()
})
dom.callBitrate?.addEventListener('change', () => {
  const mode = String(dom.callBitrate.value || 'auto')
  if (typeof setCallBitrateMode === 'function') setCallBitrateMode(mode)
  else applyCallBitrate(mode)
})
dom.callBitrateMenu?.addEventListener('change', () => {
  const mode = String(dom.callBitrateMenu.value || 'auto')
  if (dom.callBitrate) dom.callBitrate.value = mode
  if (typeof setCallBitrateMode === 'function') setCallBitrateMode(mode)
  else applyCallBitrate(mode)
})
dom.btnCallMicMenu?.addEventListener('click', () => {
  toggleGlobalMicrophone()
  refreshCallControlsMenu?.()
})
dom.btnCallCameraMenu?.addEventListener('click', () => {
  toggleGlobalCamera()
  refreshCallControlsMenu?.()
})
dom.btnCallScreenShareMenu?.addEventListener('click', async () => {
  await toggleCallScreenShare()
  refreshCallControlsMenu?.()
})
dom.btnCallRecordMenu?.addEventListener('click', async () => {
  await toggleCallRecording?.()
  refreshCallControlsMenu?.()
})
dom.btnCallTheaterMenu?.addEventListener('click', () => {
  dom.btnCallTheater?.click()
  refreshCallControlsMenu?.()
})
dom.btnCallFullscreenMenu?.addEventListener('click', async () => {
  await (dom.btnCallFullscreen?.click())
  refreshCallControlsMenu?.()
})

document.addEventListener('click', (e) => {
  if (!dom.channelSearchDropdown || !dom.channelSearch) return
  const target = e.target
  if (dom.channelSearchDropdown.contains(target) || target === dom.channelSearch || target === dom.btnChannelSearchSubmit) return
  hideSearchDropdown()

  const clickedCallControlsButton = Boolean(dom.btnCallControls && (target === dom.btnCallControls || dom.btnCallControls.contains(target)))
  if (!clickedCallControlsButton && dom.callControlsMenu && !dom.callControlsMenu.contains(target)) {
    dom.callControlsMenu.classList.add('hidden')
  }
})

document.addEventListener('fullscreenchange', () => {
  dom.callStage?.classList.toggle('call-stage-expanded', state.callTheater || document.fullscreenElement === dom.callStage)
  refreshCallControlsMenu?.()
})

updateMessageInputSize()

