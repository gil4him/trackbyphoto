# Legal pages for the simple edition's site (dayliesimple.web.app)

`privacy.html` (개인정보처리방침) and `terms.html` (이용약관). Plain static
HTML — no JavaScript, no build step, no React — so they load on any phone and
can be opened before sign-in, and so an app-store reviewer always gets the
page itself rather than the app shell.

How they reach the web:

- `app/vite.config.ts` (`legalPages(mode)` / `LEGAL_PAGES`) copies them into
  `dist/privacy.html` and `dist/terms.html` when `mode === 'simple'`. The full
  build (TrackByPhoto) never ships them: they describe Daylie only.
- `firebase.json` rewrites `/privacy` and `/terms` to those files, ahead of
  the `**` → `/index.html` catch-all.
- The same `app/vite.config.ts` lists them in the service worker's
  `navigateFallbackDenylist`, so the cached app shell never answers for them.

English translations live in `en/` (`en/privacy.html`, `en/terms.html`,
`en/delete-account.html`) and are served at `/en/privacy`, `/en/terms` and
`/en/delete-account`. Each page links to its other-language version. The Korean
pages are the originals: change a Korean page and its English page together
(the English pages were brought level with the Korean ones on 2026-10-27).

`app/src/lib/legal.test.ts` checks the wiring and that each page still carries its
required sections.

Editing: they are both hand-written Korean with the styling inlined (the
colours mirror `app/src/styles.css`). Change the 시행일 at the top of both pages
together (legal.test.ts checks the date). Neither page carries `[확인 필요]`
markers any more (2026-10-27): store reviewers and customers read them, so
open questions live in this list instead.

What the pages say as of 2026-10-27 (store readiness review, blockers 1–3):

- Operator is Digioptics, LLC everywhere (both pages, 제1조, copyright.txt).
  The App Store developer name shown to customers is still whatever App Store
  Connect holds ("Zymer" in the sales reports) — align it there if it matters.
- Memos are written by Google's Gemini API (`cloudMemo` ON on simple since
  2026-10-22): privacy §2/§4/§5/§6 name Google LLC (Gemini API) with what is
  sent (photo, time, coarse location, the prompt), the paid-tier no-training
  terms, and a 국외 이전 block. The consent screens say so too
  (`app/src/lib/consent.ts`, simple-v2). If the cloud model is turned off or
  changed, update §4–§6 and the consent text first.
- Payments: RevenueCat, Inc. is a 수탁자 and a 국외 이전 recipient (uid, device
  type, store subscription state); card data never reaches us. 구독 정보 is a
  collected item; subscription records are kept 5 years (전자상거래법). terms
  제9조 covers plans, monthly auto-renewal, cancelling in the store, 청약철회 /
  refunds through Apple/Google, what happens when a plan ends, price changes.
  Since 2026-11-05 it also has the 2-week 무료 체험 item (one per store
  account, auto-charge after, cancel before the end, an in-app reminder about
  3 days before). Only the terms changed, so terms (ko + en) carry 시행일
  2026-11-05 while privacy keeps 2026-10-28.
- A parent's linked phone registers for push since 1.0.1 (photos and words
  from family only); both pages say so. Since 1.0.4 (시행일 2026-10-28) it
  also reports its app version, and family may send it an app-update notice;
  privacy §2 lists 앱 버전 and the update notice.
- `users/{uid}.arrival` (platform + ref, once at first sign-in) is listed as
  설치 경로. No analytics SDK, no ad id.
- Address lookups: photo coordinates and the typed home-address search both go
  to Nominatim only (`worker/src/geocode.ts`). Photon / komoot, named on the
  old `listing-play-en` branch, is not used and is not named.
- The family's own heart button was dropped 2026-10-12; the family writes
  words and the parent answers with words or a ‘고마워요’ heart, so the
  collected item is 한마디와 답장.

Still open (ask a lawyer when there is one):

1. Whether a Korean 국내대리인 (보호법 제31조의2) is required for a US LLC.
2. The 국외 이전 blocks cite 제28조의8 ① (necessary for the contract, disclosed
   in the policy). Worth a legal read, Gemini and RevenueCat included.
3. Photo retention. The 30일/90일/계속 picker in 설정 is **stored but not yet
   enforced**: `worker/src/handlers/retention.ts` deletes on the plan's
   `retentionDays` and only while the `retentionJob` flag is on. The policy
   says so plainly; tighten it once deletion actually runs. The plan sheet
   already promises per-plan retention ("Free는 7일 보관").
4. 위치정보법: whether Daylie must register as a 위치기반서비스 사업자.
5. 제10조 (liability, incl. the 3-month-fees cap for paid plans), 제9조's
   청약철회 wording for digital subscriptions, and 제12조 (venue) under 약관의
   규제에 관한 법률 / 전자상거래법.
6. Consent on behalf of a parent who cannot consent (제5조): the requirements
   for a legal representative.

In-app 계정 삭제 is described as living in 설정 with an email fallback, because
the self-serve flow was still being built when these pages were written. If it
ships under a different label, update both pages.
