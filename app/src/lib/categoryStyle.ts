// Map a memo's one-word activity category to a CSS class that paints the
// thumbnail / photo header with a category-tinted gradient. The classes are
// defined in styles.css. We keep this in one place so Today, Ask, and the
// MemoDetail review header all agree.
//
// Unknown or legacy values (old memos carry all sorts) fall back to p-other.
export function categoryThumbClass(activity?: string): string {
  switch (activity) {
    case '식사': return 'p-lunch'
    case '카페': return 'p-cafe'
    case '산책': return 'p-walk'
    case '여행': return 'p-out'
    case '출장': return 'p-work'
    case '이동': return 'p-move'
    case '쇼핑': return 'p-shop'
    case '휴식': return 'p-rest'
    case '모임':
    case '가족': return 'p-family'
    case '운동': return 'p-sport'
    case '자연':
    case '꽃':   return 'p-flower'
    case '병원': return 'p-hospital'
    case '외출': return 'p-out'
    case '기타': return 'p-other'
    default:    return 'p-other'
  }
}
