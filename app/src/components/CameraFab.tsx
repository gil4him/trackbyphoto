import { useCapture } from '../hooks/useCapture'

/**
 * The floating camera button: on every family page but Home (which has the
 * big 사진 찍기), and on the parent's 내 사진 and memo pages (back to the
 * camera). Bottom-right, above the tab bar; bigger in the parent app.
 */
export function CameraFab({ onClick, disabled = false, label = '사진 찍기' }: {
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <div className="cam-fab-wrap">
      <button type="button" className="cam-fab" aria-label={label} disabled={disabled} onClick={onClick}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2l.9-1.4A1.5 1.5 0 0 1 8.9 4h6.2a1.5 1.5 0 0 1 1.3.6L17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
          <circle cx="12" cy="12.3" r="3.4" />
        </svg>
      </button>
    </div>
  )
}

/**
 * The family app's floating camera: a photo for the family member's own
 * record from any page — also while looking at a parent's. Must sit inside
 * ToastProvider (useCapture toasts).
 */
export function FamilyCamera({ uid, viewingOther, show }: { uid: string; viewingOther: boolean; show: boolean }) {
  const capture = useCapture(uid, { savedSub: viewingOther ? '내 기록으로 저장했어요' : '가족에게 보내는 중이에요' })
  return (
    <>
      {capture.inputEl}
      {capture.processing}
      {show && <CameraFab onClick={capture.takePhoto} disabled={capture.busy} />}
    </>
  )
}
