/**
 * One plain sentence and one big 다음, shown to the parent just before the
 * phone's own permission question — the bare system dialog is where an older
 * parent taps "deny". Nothing else on screen. docs/Daylie-v3-Simple-Core.md §2.
 */
export function ElderAsk({ text, onNext }: { text: string; onNext: () => void }) {
  return (
    <div className="elder-ask" role="dialog" aria-label={text}>
      <p className="elder-ask-text">{text}</p>
      <button type="button" className="elder-ask-next" onClick={onNext}>다음</button>
    </div>
  )
}
