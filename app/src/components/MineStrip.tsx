import { MemoThumb } from './MemoThumb'
import type { Memo } from '../types'

/**
 * One's own photos of today on the family's 오늘, floating on the camera
 * button's line like the button itself, newest next to it, scrolling side to
 * side. Nothing when there are none yet: the button alone says 사진 찍기.
 */
export function MineStrip({ memos, onOpen }: { memos: Memo[]; onOpen: (id: string) => void }) {
  if (memos.length === 0) return null
  return (
    <div className="mine-float" role="list" aria-label={`내 오늘 사진 ${memos.length}장`}>
      {memos.map((m) => (
        <button type="button" role="listitem" key={m.id} className="mine-float-thumb" onClick={() => onOpen(m.id)} aria-label="자세히 보기">
          <MemoThumb memo={m} />
        </button>
      ))}
    </div>
  )
}
