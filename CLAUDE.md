# Daylie — rules for every Claude Code session

## Deploy & product decisions

### Memo tone: memory diary (CEO decision, final)
- Photo memos use the **memory diary** tone, not photo description. Memos are written by Gemini (`cloudMemo` ON); the local model is the fallback. The prompt is `worker/src/llm/prompt.ts` (default branch of `buildPrompt`).
- **memo** (title, 12–24 chars) = what the parent did + where. If a landmark, tourist spot or intentionally framed background is visible, its name comes first and the title ends with "!" ("불국사에 다녀오셨어요!"). No "!" otherwise.
- **scene** = one sentence (max 2, ≤50 chars) weaving 1–2 memory anchors with the action: real weather/temperature (WeatherKit, never guessed from the photo), weekday/holiday, part of day, a trip far from home, the flow from earlier photos today.
  - "맑고 따뜻한 일요일, 점심을 드시고 나와 일행과 기념사진을 남기셨어요."
  - "비가 내리는 쌀쌀한 월요일 아침, 우산을 쓰고 출근길에 나서셨어요."
- Never list or describe objects/background ("식탁 위에 물잔이 놓여 있어요", "뒤로 상점들이 보여요"). Never invent feelings ("맛있는", "즐거운", "예쁜"), nor feeling adverbs on the action ("편안하게", "여유롭게", "즐겁게", "맛있게"; stripped in code by `dropFeelingWords`). Code drops background/inventory sentences (except the first): `tidyScene` / `isBackgroundSentence`.
- The `memoDiary` mode (description-first diary) stays in the code for `scripts/memo-diary-compare.ts` only. The pipeline never uses it, whatever the flag says.
- **Changing the memo tone or any prompt requires the CEO's explicit approval in the current conversation.**

### Parents never log in (owner decision, 2026-10-22)
- A parent's phone is linked only by the family's QR/link (managed record, no Google/Apple account). Google/Apple/email sign-in is for family members. Adding a parent's own Google login was considered and declined.
- A link stays until a family member taps 연결 해제, removes the parent, or deletes the account. Signing out never unlinks.
- Simple edition: the sign-in note says "로그인은 가족용이에요. 부모님은 위의 ‘부모님 휴대폰이에요’를 눌러 주세요."; a signed-in account with no parent shows "부모님이신가요? 이 계정은 가족용이에요. 가족에게 받은 연결 링크로 들어오세요." with 부모님 휴대폰이에요 (signs out, opens the parent's way in).

### 운영실 (admin dashboard) — docs/admin/DAYLIE_ADMIN_DASHBOARD.md
- Built one phase at a time (D0, D1, …); stop and report after each.
- firestore.rules stays untouched except one owner-approved change (2026-10-24): `adminMetrics`, `adminInbox`, `adminGrowth`, `adminSetFlag` added to the `requests` type allow-list. The worker's requireAdmin is still the gate. A rules deploy is needed before these handlers answer in production.

### Deploying
- Never deploy uncommitted code. Order: commit → push to main (or merge the PR) → deploy from an up-to-date checkout of main, preferably a worktree from `origin/main`.
- `worker/scripts/install.sh` and `simple/worker/install-simple.sh` enforce this (`--check` runs the guard alone; `FORCE_DEPLOY=1` only in emergencies, and tell the user).
- Before deploying, read the running commit (`~/daylie-worker-simple/DEPLOYED`, `~/trackbyphoto-worker/DEPLOYED`) and make sure your checkout contains it: `git merge-base --is-ancestor <deployed> HEAD`. If not, stop and ask: someone else's work would be lost.
- After a deploy, verify from the worker log (`~/Library/Logs/daylie-worker-simple.log`, `~/Library/Logs/trackbyphoto-worker.log`) that the `[worker] starting` line shows the expected `deployedCommit` and features (e.g. `"weather":"WeatherKit"`), and tell the user what is running.
- Production deploys (workers, Firebase, store submissions) are run by the user unless they say otherwise.

### Subscription prices (CEO decision, 2026-10-22)
- Plans sold: Free, Plus, Family (Basic is not offered). Monthly auto-renewing store subscriptions, ids `daylie_plus_monthly` / `daylie_family_monthly` (Play base plan `monthly`), in App Store group "Daylie".
- Plus: ₩4,400 in Korea, $4.99 in the US. Family: ₩7,700 in Korea, $7.99 in the US. Same on both stores (Apple has no ₩4,900/₩7,900 price points). Other countries: the stores' automatic conversion.
- RevenueCat project "Daylie": entitlement ids `plus` / `family` (and an unused `basic`), offering `default`.
- Changing prices or plans requires the CEO's explicit approval in the current conversation.
- Where families pay (owner decision, 2026-10-23): the simple edition's 요금제 is in the payer's **own** Settings, one "부모님께 드리는 선물" row per parent they manage (대표 가족/관리자); it opens the plan sheet for that parent. Not on the parent's page.
- One phone per parent (owner decision, 2026-10-23): linking a new phone to a parent unlinks the phone linked before (worker `issueDevice`); the old phone shows 연결이 해제되었어요 and family get one notice saying so.
