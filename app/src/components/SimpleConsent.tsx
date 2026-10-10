import { useState } from 'react'
import { SIMPLE_CONSENT_DETAILS, SIMPLE_CONSENT_TITLE, simpleConsentText } from '../lib/consent'
import { consentButtonLabel, sentToName } from '../lib/people'

/**
 * The simple edition's one consent screen on the parent's phone, right after
 * it is linked: one question, one sentence, one 네 — and the details only if
 * asked for. docs/Daylie-v3-Simple-Core.md §5.
 */
export function SimpleConsent({ caregivers, busy = false, initialOpen = false, onAccept }: {
  caregivers: { status: string; caregiverName?: string }[]
  busy?: boolean
  /** For tests: start with the details shown. */
  initialOpen?: boolean
  onAccept: () => void
}) {
  const [open, setOpen] = useState(initialOpen)
  const name = sentToName(caregivers)
  return (
    <div className="simple-consent">
      <h1 className="simple-consent-title">{SIMPLE_CONSENT_TITLE}</h1>
      <p className="simple-consent-text">{simpleConsentText(name)}</p>
      <button className="pair-btn" disabled={busy} onClick={onAccept}>{consentButtonLabel(caregivers)}</button>
      {open ? (
        <ul className="simple-consent-details">
          {SIMPLE_CONSENT_DETAILS.map((d) => <li key={d}>{d}</li>)}
        </ul>
      ) : (
        <button className="simple-consent-more" onClick={() => setOpen(true)}>자세한 내용 보기</button>
      )}
    </div>
  )
}
