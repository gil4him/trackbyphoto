// iOS 26 leaves the page shifted after the keyboard closes
// (visualViewport.offsetTop stays above 0; WebKit bug 297779, Apple forums
// thread 800125). Fixed bars, the tab bar among them, then sit out of place and
// drift up and down while scrolling until the app is restarted. When the
// keyboard goes away, scroll the page by one pixel and back, which makes the
// web view line the screen up with the page again.

/** The keyboard counts as open while the visible area is this much shorter. */
const KEYBOARD_MIN_PX = 120

export function resetViewportAfterKeyboard(win: Window = window): () => void {
  const vv = win.visualViewport
  if (!vv) return () => {}
  let open = vv.height < win.innerHeight - KEYBOARD_MIN_PX
  let timer: ReturnType<typeof setTimeout> | undefined

  const realign = () => {
    if (vv.offsetTop === 0) return
    const x = win.scrollX
    const y = win.scrollY
    win.scrollTo(x, y + 1)
    win.scrollTo(x, y)
  }
  const onResize = () => {
    const nowOpen = vv.height < win.innerHeight - KEYBOARD_MIN_PX
    // The keyboard's closing animation ends a moment after the resize.
    if (open && !nowOpen) {
      clearTimeout(timer)
      timer = setTimeout(realign, 350)
    }
    open = nowOpen
  }
  vv.addEventListener('resize', onResize)
  return () => {
    clearTimeout(timer)
    vv.removeEventListener('resize', onResize)
  }
}
