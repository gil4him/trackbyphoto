export function Processing({ show, message }: { show: boolean; message: string }) {
  if (!show) return null
  return (
    <div className="processing show" role="status" aria-live="polite">
      <div className="spinner" />
      <div className="msg">{message}</div>
    </div>
  )
}
