# Legal pages for the simple edition's site (dayliesimple.web.app)

`privacy.html` (개인정보처리방침) and `terms.html` (이용약관). Plain static
HTML — no JavaScript, no build step, no React — so they load on any phone and
can be opened before sign-in, and so an app-store reviewer always gets the
page itself rather than the app shell.

How they reach the web:

- `vite.config.ts` (`legalPages(mode)` / `LEGAL_PAGES`) copies them into
  `dist/privacy.html` and `dist/terms.html` when `mode === 'simple'`. The full
  build (TrackByPhoto) never ships them: they describe 오늘하루 only.
- `firebase.json` rewrites `/privacy` and `/terms` to those files, ahead of
  the `**` → `/index.html` catch-all.
- The same `vite.config.ts` lists them in the service worker's
  `navigateFallbackDenylist`, so the cached app shell never answers for them.

`src/lib/legal.test.ts` checks the wiring and that each page still carries its
required sections.

Editing: they are both hand-written Korean with the styling inlined (the
colours mirror `src/styles.css`). Change the 시행일 at the top of both pages
together, and keep `[확인 필요]` on anything not yet confirmed. The open items
as of 2026-10-10:

1. Legal entity (상호 · 대표자 · 사업자등록번호 · 주소) and the named
   개인정보 보호책임자 — both pages say only "오늘하루 운영자".
2. The 국외 이전 clause: 보호법 제28조의8 notice/consent wording, and each
   recipient's exact address (Google LLC, Kakao, OSMF/Nominatim).
3. Whether the worker's Kakao Local key is set in production, and whether the
   `cloudMemo` path to Google's Gemini API is on — i.e. whether photos ever
   reach a cloud model. Both are out-of-repo config
   (`~/daylie-secrets/simple/worker.env`, `admin_config/plans`).
4. Photo retention. The 30일/90일/계속 picker in 설정 is **stored but not yet
   enforced**: `worker/src/handlers/retention.ts` deletes on the plan's
   `retentionDays` and only while the `retentionJob` flag is on. The policy
   says so plainly; tighten it once the picker actually drives deletion.
5. 위치정보법: whether 오늘하루 must register as a 위치기반서비스 사업자.
6. The liability limits (제9조) and the governing-law/venue clause (제11조)
   under 약관의 규제에 관한 법률.
7. Statutory retention duties, if any, and whether a cloud AI provider's own
   training/retention terms need naming.

In-app 계정 삭제 is described as living in 설정 with an email fallback, because
the self-serve flow was still being built when these pages were written. If it
ships under a different label, update both pages.
