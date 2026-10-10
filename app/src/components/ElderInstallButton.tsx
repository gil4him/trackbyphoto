import { useEffect, useState } from 'react'
import { currentInstallPath, onInstallChange, promptInstall, type InstallPath } from '../lib/install'

/**
 * On a parent's phone that is connected in a browser tab: one button that
 * puts the 오늘하루 icon on the home screen. Shown only while the browser
 * offers its own install dialog (Android), so one tap is all it takes; it
 * disappears once the icon exists. Nothing is shown on an iPhone: an icon
 * added there would not be connected.
 */
export function ElderInstallButton({ path: forced, compact = false }: {
  /** For tests; otherwise detected. */
  path?: InstallPath
  /** The small corner version on the simple edition's camera screen. */
  compact?: boolean
}) {
  const [, rerender] = useState(0)
  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), [])
  if ((forced ?? currentInstallPath()) !== 'prompt') return null
  return (
    <button type="button" className={compact ? 'elder-cam-install' : 'elder-install'} onClick={() => { void promptInstall() }}>
      {compact ? '아이콘 만들기' : '홈 화면에 아이콘 만들기'}
    </button>
  )
}
