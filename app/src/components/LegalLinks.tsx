import { PUBLIC_ORIGIN } from '../lib/publicUrl'
import { legalPath, tr } from '../lib/lang'

/** 개인정보처리방침 · 이용약관 — the simple edition's pages (simple/app/legal),
 *  opened in this window; each page has its own way back into the app. */
export function LegalLinks() {
  return (
    <div className="legal-links">
      <a href={`${PUBLIC_ORIGIN}${legalPath('privacy')}`}>{tr('개인정보처리방침', 'Privacy policy')}</a>
      <span aria-hidden="true">·</span>
      <a href={`${PUBLIC_ORIGIN}${legalPath('terms')}`}>{tr('이용약관', 'Terms of use')}</a>
    </div>
  )
}
