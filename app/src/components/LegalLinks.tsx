import { PUBLIC_ORIGIN } from '../lib/publicUrl'

/** 개인정보처리방침 · 이용약관 — the simple edition's pages (simple/app/legal),
 *  opened in this window; each page has its own way back into the app. */
export function LegalLinks() {
  return (
    <div className="legal-links">
      <a href={`${PUBLIC_ORIGIN}/privacy`}>개인정보처리방침</a>
      <span aria-hidden="true">·</span>
      <a href={`${PUBLIC_ORIGIN}/terms`}>이용약관</a>
    </div>
  )
}
