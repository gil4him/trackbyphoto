import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Nanum Gothic, self-hosted, for both editions (styles.css font stack).
import '@fontsource/nanum-gothic/400.css'
import '@fontsource/nanum-gothic/700.css'
import '@fontsource/nanum-gothic/800.css'
import './styles.css'
import { registerAppCache } from './lib/sw'

registerAppCache()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
