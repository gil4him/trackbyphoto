import type { TextLevel } from '../lib/textScale'

/**
 * "가" above the floating camera on the parent's 내 사진 and memo pages:
 * each tap makes the text a step bigger (보통 → 크게 → 아주 크게 → 보통).
 */
export function TextSizeFab({ level, onNext }: { level: TextLevel; onNext: () => void }) {
  return (
    <div className="text-fab-wrap">
      <button type="button" className="text-fab" aria-label={`글자 크기: ${level.label}`} onClick={onNext}>
        <span aria-hidden="true">가</span>
      </button>
    </div>
  )
}
