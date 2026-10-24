const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * A floating calendar button on the photo lists (과거, the parent's 내 사진):
 * the phone's own date picker, then the list jumps to that day. The date
 * field itself covers the button (invisible), so a tap opens the picker
 * in every browser and web view.
 */
export function CalendarFab({ days, onPick }: { days: Date[]; onPick: (day: Date) => void }) {
  if (days.length === 0) return null
  return (
    <div className="cal-fab-wrap">
      <label className="cal-fab" aria-label="날짜로 찾기">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        <input
          type="date"
          className="cal-fab-input"
          min={iso(days[days.length - 1])}
          max={iso(days[0])}
          defaultValue={iso(days[0])}
          onChange={(e) => {
            const [y, m, d] = e.target.value.split('-').map(Number)
            if (y) onPick(new Date(y, m - 1, d))
          }}
        />
      </label>
    </div>
  )
}
