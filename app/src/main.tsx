import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'   // includes the self-hosted Nanum Gothic @font-face rules
import { registerAppCache } from './lib/sw'
import { lang } from './lib/lang'

document.documentElement.lang = lang

registerAppCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
