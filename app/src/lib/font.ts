/**
 * Nanum Gothic for the simple edition's parent screens. Loaded at runtime so
 * the full edition's bundle and markup stay as they are; until it arrives (or
 * offline) the system Korean font shows instead.
 */
const HREF = 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap'

export function ensureNanumGothic(): void {
  if (typeof document === 'undefined' || document.querySelector(`link[href="${HREF}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = HREF
  document.head.appendChild(link)
}
