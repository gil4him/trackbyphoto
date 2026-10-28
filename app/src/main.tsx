import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'   // includes the self-hosted Nanum Gothic @font-face rules
import { Capacitor } from '@capacitor/core'
import { registerAppCache } from './lib/sw'
import { lang } from './lib/lang'
import { resetViewportAfterKeyboard } from './lib/keyboardViewport'

document.documentElement.lang = lang

registerAppCache()
// The store app's web view measures the screen in full, so layout rules that
// make up for a browser's short measurement (styles.css, body) must not apply.
if (Capacitor.isNativePlatform()) document.documentElement.classList.add('native')
// iPhone app: put the page back where it belongs after the keyboard closes.
if (Capacitor.getPlatform() === 'ios') resetViewportAfterKeyboard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
