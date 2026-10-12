import { installBrowserDesktop } from './transport'
import { ApiError } from '../api/http'
import { consumeLoginDestination } from '../login/destination'
import { guestMode, lockGuestEditors } from './guest'
import './hosted-workspace.css'

async function start() {
  document.documentElement.dataset.hosted = 'true'
  try {
    await installBrowserDesktop()
    if (guestMode) lockGuestEditors()
    const destination = guestMode ? '/app' : consumeLoginDestination()
    if (destination !== '/app' && destination !== location.pathname + location.search) { location.replace(destination); return }
    // Pixi's official static shader synchronizer keeps Live2D working under CSP
    // without granting JavaScript eval to the hosted application.
    const [{ install }, { ShaderSystem }] = await Promise.all([import('@pixi/unsafe-eval'), import('pixi.js')])
    install({ ShaderSystem })
    // The original desktop entry owns every component, stylesheet and animation.
    const entry = import.meta.glob('../../../desktop/src/renderer/app/main.js')
    await entry['../../../desktop/src/renderer/app/main.js']!()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const outcome = new URLSearchParams(location.search).get('login')
      const next = new URLSearchParams({ next: location.pathname + location.search })
      if (outcome === 'failed' || outcome === 'cancelled') next.set('login', outcome)
      location.replace(`/login?${next.toString()}`); return
    }
    const { createApp } = await import('vue')
    const { default: StartupError } = await import('./StartupError.vue')
    createApp(StartupError).mount('#app')
  }
}
void start()
