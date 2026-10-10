import { PUBLIC_ORIGIN } from '../lib/publicUrl'

/** 개인정보처리방침 · 이용약관 — the simple edition's pages (app/legal),
 *  opened in the browser. */
export function LegalLinks() {
  return (
    <div className="legal-links">
      <a href={`${PUBLIC_ORIGIN}/privacy`} target="_blank" rel="noreferrer">개인정보처리방침</a>
      <span aria-hidden="true">·</span>
      <a href={`${PUBLIC_ORIGIN}/terms`} target="_blank" rel="noreferrer">이용약관</a>
    </div>
  )
}
