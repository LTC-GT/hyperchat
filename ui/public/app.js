const APP_PARTS = [
  'app.bootstrap.core.js',
  'app.bootstrap.connection.js',
  'app.bootstrap.ui.js',
  'app.chat.rooms-messages.js',
  'app.chat.admin-channels.js',
  'app.chat.channels-calls.js',
  'app.calls.calling.js',
  'app.calls.presence-members.js',
  'app.calls.home-utils.js',
  'ui.desktop.js',
  'ui.mobile.js'
]

async function loadScriptSequentially (src) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = resolve
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

async function loadAppParts () {
  for (const src of APP_PARTS) {
    await loadScriptSequentially(src)
  }
}

loadAppParts().catch((err) => {
  console.error(err)
})
