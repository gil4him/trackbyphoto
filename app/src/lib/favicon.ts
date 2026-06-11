// Draw the unread count onto the browser-tab favicon so the "web icon" shows a
// number in any browser tab — navigator.setAppBadge only badges an installed
// PWA, so a plain tab needs this. setFaviconBadge(0) restores the original icon.

let originalHref: string | null = null

function iconLink(): HTMLLinkElement | null {
  return document.querySelector("link[rel~='icon']")
}

export function setFaviconBadge(count: number): void {
  const link = iconLink()
  if (!link) return
  if (originalHref === null) originalHref = link.getAttribute('href')

  if (count <= 0) {
    if (originalHref) link.setAttribute('href', originalHref)
    return
  }

  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const drawBadge = () => {
    const r = 20
    const cx = size - r + 2
    const cy = r - 2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#FF3B30'
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 32px -apple-system, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(count > 9 ? '9+' : String(count), cx, cy + 1)
    link.setAttribute('href', canvas.toDataURL('image/png'))
  }

  const img = new Image()
  img.onload = () => {
    try { ctx.drawImage(img, 0, 0, size, size) } catch { /* tainted/blank — badge still draws */ }
    drawBadge()
  }
  img.onerror = () => {
    // Fallback base when the SVG won't rasterize: a coral rounded square.
    ctx.fillStyle = '#FF6B6B'
    const rad = 14
    ctx.beginPath()
    ctx.moveTo(rad, 0)
    ctx.arcTo(size, 0, size, size, rad)
    ctx.arcTo(size, size, 0, size, rad)
    ctx.arcTo(0, size, 0, 0, rad)
    ctx.arcTo(0, 0, size, 0, rad)
    ctx.closePath()
    ctx.fill()
    drawBadge()
  }
  img.src = originalHref || '/favicon.svg'
}
