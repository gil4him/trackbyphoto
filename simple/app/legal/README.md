# Legal pages for the simple edition's site (dayliesimple.web.app)

`privacy.html` (개인정보처리방침) and `terms.html` (이용약관). Plain static
HTML — no JavaScript, no build step, no React — so they load on any phone and
can be opened before sign-in, and so an app-store reviewer always gets the
page itself rather than the app shell.

English translations live in `en/` (`en/privacy.html`, `en/terms.html`,
`en/delete-account.html`) and are served at `/en/privacy`, `/en/terms` and
`/en/delete-account`. Each page links to its other-language version. The Korean
pages are the originals: change a Korean page and its English page together.

How they reach the web:

- `app/vite.config.ts` (`legalPages(mode)` / `LEGAL_PAGES`) copies them into
  `dist/privacy.html` and `dist/terms.html` when `mode === 'simple'`. The full
  build (TrackByPhoto) never ships them: they describe Daylie only.
- `firebase.json` rewrites `/privacy` and `/terms` to those files, ahead of
  the `**` → `/index.html` catch-all.
- The same `app/vite.config.ts` lists them in the service worker's
  `navigateFallbackDenylist`, so the cached app shell never answers for them.

`app/src/lib/legal.test.ts` checks the wiring and that each page still carries its
required sections.

Editing: they are both hand-written Korean with the styling inlined (the
colours mirror `app/src/styles.css`). Change the 시행일 at the top of both pages
together. The privacy page is what store reviewers read, so it carries no
`[확인 필요]` markers (2026-10-16; legal.test.ts checks); open questions
about it live in this list instead. terms.html still marks its open clauses.
The open items as of 2026-10-16:

1. Settled 2026-10-16: operator is Digioptics, LLC (the Play/App Store
   developer) on both pages. Still to confirm with a lawyer: whether a
   Korean 국내대리인 (보호법 제31조의2) is required.
2. The 국외 이전 clause now names Google LLC and OSMF with address, items,
   timing and purpose, citing 제28조의8 ① (necessary for the contract,
   disclosed in the policy). Worth a legal read.
3. Settled 2026-10-10: the simple worker has no Kakao key and no Gemini key,
   so the pages name neither. If either is turned on
   (`~/daylie-secrets/simple/worker.env`), update §4–§6 first.
4. Photo retention. The store app (simple) doesn't show the 30일/90일/계속
   picker and nothing deletes by age, so since 2026-10-20 the policy just says
   photos are kept until someone deletes them and that automatic deletion
   would be announced first. Revisit if retentionJob is ever turned on.
   Address lookups: typed home-address searches go to Nominatim (Enter) and
   Photon / komoot GmbH (search-as-you-type, with a ~100 m location bias);
   both are named in §5 and §6. komoot's address was taken from public
   registers; check it against their imprint.
5. 위치정보법: whether Daylie must register as a 위치기반서비스 사업자.
6. The liability limits (제9조) and the governing-law/venue clause (제11조)
   under 약관의 규제에 관한 법률.
7. Statutory retention duties, if any, and whether a cloud AI provider's own
   training/retention terms need naming.

In-app 계정 삭제 is described as living in 설정 with an email fallback, because
the self-serve flow was still being built when these pages were written. If it
ships under a different label, update both pages.
