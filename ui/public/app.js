const APP_PARTS = ['app.bootstrap.js', 'app.chat.js', 'app.calls.js']

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
