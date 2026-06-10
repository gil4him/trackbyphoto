// Map a memo's one-word activity category to a CSS class that paints the
// thumbnail / photo header with a category-tinted gradient. The classes are
// defined in styles.css. We keep this in one place so Today, Ask, and the
// MemoDetail review header all agree.
//
// The schema in `types.ts` ships these 6 today: 식사/산책/휴식/가족/꽃/기타.
// We also map 병원/외출 because the design prototype includes them — once we
// expand the schema (or accept legacy docs from older builds), the UI just
// renders them correctly with no further changes.
export function categoryThumbClass(activity?: string): string {
  switch (activity) {
    case '식사': return 'p-lunch'
    case '산책': return 'p-walk'
    case '휴식': return 'p-rest'
    case '가족': return 'p-family'
    case '꽃':   return 'p-flower'
    case '병원': return 'p-hospital'
    case '외출': return 'p-out'
    case '기타': return 'p-other'
    default:    return 'p-other'
  }
}
