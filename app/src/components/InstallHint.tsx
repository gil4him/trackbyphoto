import { useEffect, useState } from 'react'
import { currentInstallPath, onInstallChange, promptInstall, type InstallPath } from '../lib/install'

const DISMISS_KEY = 'tbp.installHint.dismissed'

const STEPS: Record<Exclude<InstallPath, 'none' | 'desktop' | 'prompt'>, { title: string; steps: string[] }> = {
  'in-app': {
    title: '먼저 Safari나 Chrome으로 열어 주세요',
    steps: [
      '화면 아래(또는 위)의 ⋯ 또는 공유 버튼을 눌러요.',
      '“다른 브라우저로 열기” 또는 “Safari로 열기”를 눌러요.',
      '열린 화면에서 이 안내를 다시 눌러 홈 화면에 추가해요.',
    ],
  },
  ios: {
    title: 'iPhone 홈 화면에 추가하기',
    steps: [
      'Safari 아래쪽의 공유 버튼(네모에서 화살표가 올라가는 모양)을 눌러요.',
      '목록을 내려 “홈 화면에 추가”를 눌러요.',
      '오른쪽 위 “추가”를 누르면 홈 화면에 오늘하루 아이콘이 생겨요.',
      '앞으로는 그 아이콘으로 열어 주세요. 알림도 거기서 켤 수 있어요.',
    ],
  },
  android: {
    title: '홈 화면에 추가하기',
    steps: [
      '브라우저 오른쪽 위의 ⋮ 메뉴를 눌러요.',
      '“홈 화면에 추가” 또는 “앱 설치”를 눌러요.',
      '홈 화면에 생긴 오늘하루 아이콘으로 열어 주세요.',
    ],
  },
}

/**
 * "홈 화면에 추가하면 알림을 바로 받아요" for someone using the website in a
 * browser tab. Shows the right steps for their phone, or the browser's own
 * install dialog when it offers one. Hidden once the site runs from a
 * home-screen icon, in the installed apps, on a computer that can't install,
 * and after it has been dismissed.
 */
export function InstallHint({ path: forced }: { /** For tests; otherwise detected. */ path?: InstallPath }) {
  const [, rerender] = useState(0)
  useEffect(() => onInstallChange(() => rerender((n) => n + 1)), [])
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  const [open, setOpen] = useState(false)

  const path = forced ?? currentInstallPath()
  if (dismissed || path === 'none' || path === 'desktop') return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    setDismissed(true)
  }
  const guide = path === 'prompt' ? null : STEPS[path]

  return (
    <>
      <div className="install-hint" role="note">
        <span className="install-msg">홈 화면에 추가하면 알림을 바로 받아요</span>
        {path === 'prompt'
          ? <button className="install-go" onClick={() => { void promptInstall() }}>추가하기</button>
          : <button className="install-go" onClick={() => setOpen(true)}>방법 보기</button>}
        <button className="notice-x" onClick={dismiss} aria-label="안내 닫기">✕</button>
      </div>

      {open && guide && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-title">{guide.title}</div>
            <div className="modal-body">
              <ol className="install-steps">
                {guide.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            </div>
            <div className="modal-actions">
              <button className="linkbtn" onClick={() => setOpen(false)}><span>알겠어요</span></button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
