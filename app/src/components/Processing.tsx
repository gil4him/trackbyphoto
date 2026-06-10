export function Processing({ show, message, sub }: { show: boolean; message: string; sub?: string }) {
  if (!show) return null
  return (
    <div className="processing show" role="status" aria-live="polite">
      <div className="ring" />
      <div className="p">{message}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}
