# Daylie 운영실 — Admin Dashboard Build (for Claude Code)

> Read this whole file before writing any code. Work **one phase at a time**. After each phase:
> run checks, run the §Q UI QA pass, commit, **STOP & REPORT**. Do not start the next phase until the owner says "go".

The design reference is `docs/admin/admin-hq-mockup.html` (open it in a browser). It is a static mockup with **sample numbers**. Build its structure and look, but every number in the real dashboard must come from real data. Where data does not exist yet, show the designed **연결 필요 / 아직 기록 안 함** empty state. Never ship a made-up number.

---

## 0. Ground rules (apply to every phase)

1. **Scope.** The dashboard lives at `/admin` (simple and full editions). Only the admin email in `app/src/lib/admin.ts` (`ADMIN_EMAIL`) can see it. Do not change that check.
2. **Do not change** `firestore.rules`, `storage.rules`, pairing/consent logic, the elder camera capture/upload path, or anything a parent or family member sees.
3. **No new Firestore collections.** Allowed storage:
   - `admin_config/dashboard` (new doc in an existing collection; rules already allow admin read/write) — dashboard settings: price assumptions, monthly cost entries, inbox state (resolved/snoozed), budget.
   - Existing admin-readable docs: `admin_totals/global`, `admin_daily/{YYYY-MM-DD}`, `admin_log`, `admin_config/plans`, `system/worker`.
4. **Heavy reads go through the worker.** Add read-only worker request handlers (same pattern as `adminListPeople` in `worker/src/handlers/adminPeople.ts`, registered in `worker/src/handlers/requests.ts`, admin check from `worker/src/handlers/admin.ts`). Cache results in worker memory for 5 minutes. A `refresh: true` param skips the cache.
5. **Writes that must be logged** (feature flags) go through a worker handler that writes the change **and** an `admin_log` row. Clients cannot write `admin_log` (rules), so never try to.
6. **Design.** Tokens only from `app/src/styles.css :root` (`--ground #EAF6F0`, `--surface`, `--surface-dim`, `--ink`, `--muted`, `--line`, `--accent #FF8A1F`, `--accent-tint`, `--accent-line`, `--accent-pressed`, `--good`, `--danger`). If the mockup uses a tint that is missing (`--accent-ink #8A4300`, `--good-tint #E3F4EA`, `--danger-tint #FDECEC`), add it **once** to `:root` with that name. No other new hex. Nanum Gothic. Dark text on orange, never white on orange. Light mode only. No gradients except the striped "결제 준비 중" bar.
7. **Copy is Korean**, plain, from the owner's side: 가족, 부모님, 사진, 메모 서버, 처리할 일. No English labels in the UI except plan names (Free/Basic/Plus/Family) and flag keys shown as small `code`.
8. **Tests.** Every new pure function (metrics math, inbox rules, funnel, cohort, revenue calc) gets a vitest unit test. `npm test` (app and worker), `npm run build:simple`, `npm run build:full` must pass before each commit.
9. **Small commits**, one per phase, message `admin D<n>: <what>`.

---

## Phase D0 — Shell and navigation

Goal: the new frame, with today's tabs still working inside it.

- Copy the mockup's shell: left menu (236px, white) on desktop; on screens ≤900px the menu becomes one horizontal scrolling tab row at the top. Brand block `D` + `Daylie 운영실` + `Simple · 베타` (or `Full` by `isSimple()`).
- Views and URLs (keep the existing `?tab=` scheme in `lib/admin.ts`):
  `today` 오늘 · `inbox` 할 일 · `growth` 성장 · `families` 가족 · `revenue` 매출 · `costs` 비용 · `system` 시스템 · `flags` 기능 스위치 · `ai` AI 도구 (the existing `SuperAdmin` tools, unchanged, last in the menu).
- Old URLs keep working: `overview` → `today`, `parents` → `families&kind=parent`, `children` → `families&kind=child`. `?uid=` still opens `PersonDetail` (unchanged).
- Menu footer: live worker dot from `useWorkerStatus` + "마지막 신호 n초 전".
- New views that are not built yet show a simple "곧 만들어요" card.
- Update `adminPage.test.tsx` for the new tabs and the old-URL mapping.

## Phase D1 — 오늘 (home)

Uses data that exists today.

- **Worker:** add `adminMetrics` handler → returns
  `{ families, parents, children, activeParents7d, photosToday, photosByHourToday[24], reactionsToday, signups7d[7], northStar: { families, total, series7d[7] }, at }`.
  - *Family* = a parent (patient) with at least one active membership.
  - *Active parent* = at least one memo in the last 7 days.
  - **North star "하루를 나눈 가족 (7일)"** = families with ≥1 memo **and** ≥1 reaction (any kind, from `reactions`) in the last 7 days ÷ all families. Goal line 80% (store the goal in `admin_config/dashboard.northStarGoal`, default 0.8).
  - Hours use Asia/Seoul.
- **Screen** (match mockup order):
  1. Header: date (`10월 23일 목요일 · 아침 브리핑`) + `좋은 아침이에요` + segmented `7일 | 30일`.
  2. Story card: one sentence built from real numbers — `어제 부모님 {n}분이 사진 {n}장을 보냈고, 가족이 {n}번 마음을 전했어요.` + three chips (지금 처리할 일 n · 메모 서버 상태 · 결제 준비 중 while `PAYMENTS_LIVE` is false).
  3. North-star card (dark `--ink` card, orange line, dashed goal line).
  4. KPI strip ×5 with sparklines: 함께하는 가족, 사진 보낸 부모님, 오늘 사진, 하트·글 답장, 신규 가입. Green for up, red for down.
  5. Two columns: 처리할 일 (top 4, from D2; until D2 ships, show the existing `personFlags` list) | 메모 서버 card + 이번 달 돈 card (until D5/D6, show "결제 준비 중" and costs "입력 전").
  6. 오늘 시간대별 사진 bars (5시–22시), busiest hour in `--accent`.
- Sparkline/bar components go in `pages/admin/charts.tsx` (plain SVG, no chart library).

## Phase D2 — 할 일 (inbox)

- **Worker:** `adminInbox` handler returns items `{ id, rule, when: 'now'|'day'|'wk', category, title, sub, why, rows[], targets[] }`. Rules (each one a pure function with a test):

  | rule | when | condition |
  |---|---|---|
  | `quietParent` | now | parent sent photos on ≥5 of the previous 7 days, and 0 photos in the last 72h |
  | `workerDown` | now | `system/worker.lastSeen` older than 4 min, or `modelUp == false` |
  | `pushDown` | now | `system/worker.push`: the last failed push is newer than the last one that got through | 시스템 |
  | `memoSlow` | now | worker in-memory p50 memo time > 30s for the last 15 min (see D7) |
  | `unpaired` | day | family signed up > 24h ago and the parent has no active device |
  | `noGuardian` | day | parent with no guardian membership (existing `personFlags`) |
  | `familyLimit` | wk | family at its plan's `familyMembers` limit (Plus candidate) |
  | `costOverBudget` | wk | `admin_config/dashboard.costs[month].firebaseUSD` > `budgetUSD` |
  | `disabledAccount` | wk | account disabled (existing flag) |

- Store review, deletion requests by email, and App Review status are **not** connected. Show them in the rules card as `연결 필요`. Do not create items for them.
- **Screen:** list grouped 지금 / 오늘 / 이번 주 with colored stripe (danger / accent / line) + detail pane (crumb, title, why, rows table, actions). On ≤900px the detail opens below the list.
- **Actions in this phase are safe only:** `열기` (open person or filtered family list), `내일 다시 보기` (snooze 24h), `해결됨` (hide until the condition clears and comes back). Save state in `admin_config/dashboard.inbox[itemId] = { state, until, at }`.
- **Do not** build "send notification to family" here. That is Phase D10 and needs the owner's approval of the exact message.
- Nav badge = open item count. Bottom card: "할 일은 이렇게 골라요" listing the rules above in plain Korean.

## Phase D3 — 성장 (journey)

- **Worker:** `adminGrowth` handler for the last 30 days:
  - Funnel stages: 가입 (child accounts created) → 부모님 휴대폰 연결 (parent has an active device) → 첫 사진 → 가족 첫 반응 → 7일 계속 사용 (photos on ≥4 of first 7 days) → 유료 전환 (striped "결제 준비 중" while payments are off). **설치** is not available yet: show the row as `연결 필요` (App Store Connect / Play Console come in a later phase).
  - Highlight the stage with the biggest drop (red %) and generate the callout sentence from it.
  - Weekly cohorts (signup week × weeks 0–4, % of parents with ≥1 photo that week); orange cells, alpha by value.
  - Sources: check whether users/pairings already record how someone arrived (install referrer pair code, invite link). If they do, show the bars. If not, show `아직 기록 안 함` and list it in the report as a follow-up. Do not guess.
- 90-day trend chart: 활동 부모님 (orange area) + 누적 가족 (dashed `--muted`), y-axis ticks, 4 date labels, end values labeled.

## Phase D4 — 가족 (table)

- Merge today's 부모님 and 가족 tabs into one table, one row per family (parent): 가족 · 부모님 · 가족 수 · 플랜 · 휴대폰 · 마지막 사진 · 상태 pill.
- Filter chips: 전체 · 3일 사진 없음 · 휴대폰 미연결 · 가족 한도 · 차단, + a `kind` toggle (부모님/가족 people view) so nothing from the old tabs is lost. Search by name/email.
- Row → existing `PersonDetail` (`?uid=`), unchanged. Keep every existing admin action (delete, unlink, plan, disable) where it is.
- Table scrolls sideways inside its card on phones; the page never scrolls sideways.

## Phase D5 — 매출

- Banner: `결제 준비 중` while the `payments` flag is off; with it on, D12's real cards sit above the calculator.
- **Real now:** plan mix from people (`plan.tier`), shown as a stacked bar.
- **Calculator** (assumptions, saved in `admin_config/dashboard.revenue`): price per Basic/Plus/Family (₩, VAT included) × paying families → monthly revenue − VAT (÷11) − store fee 15% − monthly costs (from D6) = 남는 돈 (green/red). Unit test the math.
- **업그레이드 계기:** count what is already logged (e.g. `plan.change`, and `familyLimit` from D2). Anything not logged (retention notice seen, voice card tap) shows `아직 기록 안 함`. Adding new event logging is out of scope here.
- When payments go live later, the same cards switch to real MRR; leave a `TODO(payments)` at that seam only.

## Phase D6 — 비용

- AI cost: real, from `admin_totals`/`admin_daily` `geminiUSD` (Ollama = $0; say so).
- Firebase: monthly manual entry (`$` per month + budget, default budget $5) in `admin_config/dashboard.costs`, with a small "입력" form. Breakdown rows (Storage, Firestore, Hosting, 기타) are optional manual fields. Note in the UI: `Firebase 청구 내보내기(BigQuery)를 연결하면 자동으로 채워져요`.
- Fixed costs list (editable): Apple 개발자 $99/년, Google Play $25(1회), Mac mini 전기, exchange rate (default ₩1,400/$).
- 가족 1곳당 비용 = monthly total ÷ families.

## Phase D7 — 시스템

- Live from `system/worker` (`onSnapshot`): status, last beat age, `modelUp`, `waiting`.
- **Worker in-memory history** (no new writes): ring buffers of the last 60 heartbeats and the last 500 memo durations (time from memo `createdAt` to ready). Measure timing in the memo handler **without changing its behaviour**. Expose via `adminMetrics.system`: `beats60[]`, `memoP50`, `memoP90`, `fail24h`. After a worker restart the history starts empty; say so in the UI.
- Cards: 메모 서버 · 메모 시간 (p50, p90) · 실패율 24h · 최근 60분 신호 (60 cells: green ok / orange slow / red missed) · 오늘 시간대별 사진 · 앱 상태 (platform split from `devices.platform`; push delivery and crash-free are `연결 필요`).

## Phase D8 — 기능 스위치

- List all 14 `PLAN_FLAGS` from `worker/src/plans.ts` with Korean names: reactions 하트·반응 · familyPhotos 가족 사진 보내기 · pushFamily 가족 푸시 알림 · trailMap 다녀온 곳 지도 · memoV2 메모 v2 · memoWeather 메모에 날씨 · cloudMemo 클라우드 AI 메모 · usageCaps 하루 AI 메모 한도 · retentionJob 보관 기간 정리 · planSheet 플랜 안내 화면 · digest 하루 요약 · emailDigest 이메일 요약 · messengerFree 무료 메신저 요약 · voiceReplies 음성 답장.
- Toggle → worker handler `adminSetFlag { flag, on }` → updates `admin_config/plans.flags.<flag>` + writes `admin_log` (`flag.set`, add to `ACTION_KO` as `기능 스위치 변경`).
- **Risky flags need an in-page confirm step** (the page cannot use `confirm()`/`prompt()` reliably; build it into the UI, like `confirmTyped`): `retentionJob` (deletes photos past retention), `cloudMemo` (costs money), `usageCaps`. Show what will happen in one sentence before the owner confirms.
- Under the list: last 10 flag changes from `admin_log`.

## Phase D9 — Polish + full QA

- Loading skeletons for every card (no layout jump), error card when the worker is down (`서버(Mac mini)가 응답하지 않아요…`), empty states everywhere.
- "새로고침" button (top right) → `refresh: true` on worker handlers; show "n분 전 기준".
- Run §Q on every view.

## Later (do NOT start; listed so the code leaves room)

- D10 — 안부 알림 보내기 from the inbox (exact message approved by the owner first).
- D11 — Traffic (built 2026-10-26): 설치 from App Store Connect Sales Reports and the Play Console installs bucket (`worker/src/traffic/`, read inside `adminGrowth`, kept in `admin_config/traffic`; env in `~/daylie-secrets/simple/worker.env`: `ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH ASC_VENDOR_NUMBER [ASC_APP_ID]`, `PLAY_REPORTS_BUCKET PLAY_PACKAGE_NAME` + the worker's service account invited in Play Console; check with `npm run traffic-probe`). 어디서 들어왔나 from the app's own `users.arrival` stamp (platform + `?from=` / referrer, `app/src/lib/arrival.ts`), not Firebase Analytics (owner decision: no third-party analytics). A store without its env shows 연결 필요 with the names missing.
- D12 — Payments (built 2026-10-27): worker handler `adminRevenue` (request type added to the `requests` allow-list, owner-approved) reads every store purchase on file (`planPayments/{payerUid}` + the parent's `users.plan`), asks RevenueCat's v1 subscriber API about each (store, sandbox, trial, cancellation, card trouble, refund; `REVENUECAT_SECRET_KEY`), and RevenueCat's v2 project overview (`REVENUECAT_V2_KEY` + `REVENUECAT_PROJECT_ID`, optional) for MRR / active subscriptions / 28-day revenue in the stores' settled prices. 매출 with payments on: five figures (유료 가족, 정가 MRR, 새 결제 30일, 해지·환불 30일, 결제 문제), the real waterfall (list price × paying families − VAT − 15% − 비용), the RevenueCat 기준 card, and the 구독 현황 table; the calculator stays underneath as a what-if. Arithmetic in `worker/src/revenue.ts`. Sandbox purchases are listed but never counted as revenue; a row RevenueCat has not confirmed says 확인 전. 성장's 유료 전환 row counts the window's families a store subscription pays for.
- D13 — (built 2026-10-27) **Store reviews**: worker handler `adminReviews` (allow-list, owner-approved) reads App Store customer reviews (App Store Connect API with an App Manager key: `ASC_REVIEWS_KEY_ID`, `ASC_REVIEWS_KEY_PATH`, plus `ASC_ISSUER_ID`, `ASC_APP_ID`) and Google Play reviews (Android Publisher API as the worker's service account: `PLAY_PACKAGE_NAME`, `GOOGLE_APPLICATION_CREDENTIALS`; the API must be enabled on the Firebase project; Google only returns the last week's reviews). 오늘 shows the 30-day summary and the newest reviews; a store without its env says 연결 필요. **CEO morning push**: `worker/src/handlers/morning.ts` sends "Daylie 아침 요약" to the admin account's phones at 08:00 Seoul (once per day, remembered in `admin_config/dashboard.morning`; catches up until 12:00), behind the `ceoMorningPush` switch in 기능 스위치. Wording in `morningText`. **Crashlytics**: not in the apps (owner decision 2026-10-27: not added now); 시스템 says Crashlytics 미설치.

---

## §Q — UI QA (run after every phase)

**Q.1 Rules:** nothing clipped or overlapping; long Korean wraps (`word-break: keep-all; overflow-wrap: anywhere`); no horizontal page scroll (tables scroll inside their card); text ≥13px (labels) and ≥15px (body); touch targets ≥44px; sibling cards same padding/radius/height logic; tokens only; every card has loading, empty, and error states; numbers use `tabular-nums`.

**Q.2 Viewports:** 1440×900, 1280×800, iPad 820×1180, iPhone 15 393×852, Galaxy S24 360×780, and 393×852 at **130% text**.

**Q.3 Prompt to run after each phase:**
```
Run the UI QA pass in docs/admin/DAYLIE_ADMIN_DASHBOARD.md §Q for Phase D<n>.
1. Capture every view this phase touched at all six Q.2 viewports (extend e2e/shot-kit.mjs for /admin with the emulator admin user; seed demo data with e2e/demo-seed.mjs). Save to docs/admin/shots/D<n>/.
2. Open each screenshot and check Q.1 line by line. Compare with docs/admin/admin-hq-mockup.html for layout and spacing.
3. grep: rg -n "#[0-9A-Fa-f]{6}" app/src --glob '!styles.css' must add nothing new; confirm no change to firestore.rules or storage.rules (git diff --stat).
4. Confirm no screen shows a hard-coded or sample number: every value comes from a handler or Firestore, or shows the 연결 필요 / 아직 기록 안 함 state.
5. Fix every finding in this phase's files only, re-capture, repeat until clean.
6. Report as a table: view × viewport → OK / what was fixed. Then STOP.
```
