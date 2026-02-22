(() => {
  const MOBILE_BREAKPOINT = 900

  const isMobileViewport = () => window.innerWidth <= MOBILE_BREAKPOINT

  const closeDrawers = () => {
    document.body.classList.remove('mobile-show-channels', 'mobile-show-members')
  }

  const toggleChannelsDrawer = () => {
    if (!isMobileViewport()) return
    const showingChannels = document.body.classList.contains('mobile-show-channels')
    document.body.classList.remove('mobile-show-members')
    document.body.classList.toggle('mobile-show-channels', !showingChannels)
  }

  const toggleMembersDrawer = () => {
    if (!isMobileViewport()) return
    const showingMembers = document.body.classList.contains('mobile-show-members')
    document.body.classList.remove('mobile-show-channels')
    document.body.classList.toggle('mobile-show-members', !showingMembers)
  }

  const applyViewportClass = () => {
    const isMobile = isMobileViewport()
    document.body.classList.toggle('mobile-ui', isMobile)
    if (!isMobile) closeDrawers()
  }

  const init = () => {
    applyViewportClass()

    const btnMobileChannels = document.getElementById('btnMobileChannels')
    const backdrop = document.getElementById('mobileDrawerBackdrop')

    btnMobileChannels?.addEventListener('click', (event) => {
      event.preventDefault()
      toggleChannelsDrawer()
    })

    backdrop?.addEventListener('click', closeDrawers)

    dom.btnToggleMembers?.addEventListener('click', (event) => {
      if (!isMobileViewport()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      toggleMembersDrawer()
    }, true)

    dom.serverList?.addEventListener('click', () => {
      if (!isMobileViewport()) return
      closeDrawers()
    })

    dom.textChannelList?.addEventListener('click', () => {
      if (!isMobileViewport()) return
      closeDrawers()
    })

    dom.voiceChannelList?.addEventListener('click', () => {
      if (!isMobileViewport()) return
      closeDrawers()
    })

    window.addEventListener('resize', applyViewportClass)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
