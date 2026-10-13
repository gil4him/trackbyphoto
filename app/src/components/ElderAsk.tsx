/**
 * One plain sentence and one big button, shown to the parent just before the
 * phone's own permission question — the bare system dialog is where an older
 * parent taps "deny". Nothing else on screen. simple/Daylie-v3-Simple-Core.md §2.
 */
export function ElderAsk({ text, next = '다음', onNext }: { text: string; next?: string; onNext: () => void }) {
  return (
    <div className="elder-ask" role="dialog" aria-label={text}>
      <p className="elder-ask-text">{text}</p>
      <button type="button" className="elder-ask-next" onClick={onNext}>{next}</button>
    </div>
  )
}
