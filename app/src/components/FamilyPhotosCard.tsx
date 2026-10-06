import { cardLine } from '../lib/familyPhotosModel'
import type { FamilyPhoto } from '../types'

/** On the parent's home screen: "민수가 사진을 보냈어요", lit while something is new. Nothing when there are no photos. */
export function FamilyPhotosCard({ photos, onOpen }: { photos: FamilyPhoto[]; onOpen: () => void }) {
  const card = cardLine(photos)
  if (!card) return null
  return (
    <button type="button" className={`news-card tappable fp-card ${card.lit ? 'on' : ''}`} onClick={onOpen}>
      <span className="news-heart" aria-hidden="true">🖼️</span>
      <span>{card.line}</span>
    </button>
  )
}
