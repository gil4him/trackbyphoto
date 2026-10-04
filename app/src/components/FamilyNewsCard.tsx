import { S } from '../lib/strings'
import type { ElderNews } from '../lib/reactionsModel'

/**
 * The one card under the camera button on the parent's phone. Dim when there
 * is nothing new, coral when family sent a heart or a comment. One line, no
 * counts, no list.
 */
export function FamilyNewsCard({ news, onOpen }: { news: ElderNews; onOpen: () => void }) {
  if (news.state === 'none') {
    return <div className="news-card" role="status">{S.elderCardEmpty}</div>
  }
  const { item } = news
  const line = item.kind === 'comment' ? S.elderCardComment(item.actorName) : S.elderCardHeart(item.actorName)
  return (
    <button type="button" className={`news-card tappable ${news.state === 'new' ? 'on' : ''}`} onClick={onOpen}>
      <span className="news-heart" aria-hidden="true">{item.kind === 'comment' ? '💬' : '❤️'}</span>
      <span>{line}</span>
    </button>
  )
}
