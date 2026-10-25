# Daylie v3 — UI/UX Fix before store submission (2026-10-12)

> **How to use this file (instructions for Claude Code)**
> 1. Read this whole file, then `docs/Daylie-v3-Simple-Core.md` §2 and the 2026-10-10 change note. Do not write code yet.
> 2. Work **one phase at a time**, in order (A0 → A6). Each phase ends with `STOP & REPORT`:
>    `npm run build:simple && npm run build:full && npm test` green, commit (`v3 ui A<n>: <summary>`),
>    then report in 10 lines or less. Wait for "go" before the next phase.
> 3. Scope: **one design tone for both editions.** Tokens change globally (A0). Layout/behaviour changes
>    are for the simple edition unless a phase says otherwise; when a change is simple-only, gate it with `isSimple()`.
> 4. Never change: Firestore rules, the worker, pairing/consent logic, the elder camera's capture/upload path.
> 5. A decision that changes behaviour the user did not list here → ask. Visual details → choose, and note it under "Decisions" in `docs/v2-plan.md`.

---

## 0. Design tokens (the one source of truth)

Direction "동글동글" — mint ground, white cards, green-black text, the app icon's orange as the only accent.
Dark text on orange (5.1:1), never white text on orange (2.4:1). No gradients on UI (the icon keeps its own). Light theme only.

| token | value | use |
|---|---|---|
| `--ground` | `#EAF6F0` | page background (flat, no radial gradient) |
| `--surface` | `#FFFFFF` | cards, tab bar, sheets |
| `--surface-dim` | `#F4F8F6` | empty/disabled cards |
| `--ink` | `#2C3A33` | all text, icons |
| `--muted` | `#4F6A5E` | captions, eyebrows (4.5:1 on ground) |
| `--line` | `#CFE3D8` | 2px borders, dividers |
| `--accent` | `#FF8A1F` | primary buttons, hearts, active tab, shutter ring |
| `--accent-tint` | `#FFF0DC` | chips, highlighted cards, bubbles |
| `--accent-line` | `#FFD9A6` | border on tinted cards |
| `--accent-pressed` | `#F07A0E` | :active on primary buttons |
| `--good` | `#1F9D55` | success, "on" toggles |
| `--danger` | `#D93D42` | destructive confirm only |
| `--radius-card` | `20px` | cards, rows |
| `--radius-btn` | `22px` | buttons |
| font | **Nanum Gothic** 400/700/800 | both editions, self-hosted |

Type scale (family app): large title 34/800 · title 22/700 · body 17/400 · caption **15**/400 (13px is too small — never below 15px except tab labels 13px).
Elder screens: ≥ 26px body, 28px buttons, touch targets ≥ 60px.

---

## Phase A0 — Tokens, font, no blue caregiver mode (global)

Files: `app/src/styles.css`, `app/src/main.tsx`, `app/package.json`, `app/src/lib/font.ts`

1. `npm i @fontsource/nanum-gothic` and in `main.tsx` add
   `import '@fontsource/nanum-gothic/400.css'`, `/700.css`, `/800.css`.
   Replace the `font-family` stack on `html, body` with `'Nanum Gothic', 'Apple SD Gothic Neo', -apple-system, system-ui, sans-serif`.
   `lib/font.ts` (`ensureNanumGothic`) becomes a no-op kept for callers, or delete it and its calls.
2. Rewrite `:root` in `styles.css` with the table in §0. Keep the old names as aliases so nothing breaks:
   `--coral1: var(--accent); --coral2: var(--accent); --accent-2: var(--accent-tint); --accent-ink: var(--ink); --blue: var(--accent); --bg: var(--ground); --card: var(--surface); --ink-2: var(--muted); --ink-3: var(--muted); --shadow: 0 12px 28px -12px rgba(255,138,31,.35)`.
3. `body` background → `var(--ground)` flat. Remove every `radial-gradient` / `linear-gradient` used as a button or page background
   (`.capbtn`, `.askbtn`, `.cam-fab`, `.app.caregiver-mode`, photo-gradient fallbacks may stay). Primary buttons: `background: var(--accent); color: var(--ink)`.
4. **Delete the blue caregiver recolor** (`.app.caregiver-mode { --coral1 … }` and its button overrides). Viewing a parent's account is shown only by the
   existing account bar (name + `내 계정으로`), restyled: `background: var(--accent-tint); border-bottom: 2px solid var(--accent-line)`.
5. Grep for hard-coded hexes that still read as the old brand and map them: `#FF6B6B`, `#FF8A5B`, `#FFB088`, `#c2410c`/`#C2410C`, `#0A84FF`, `#5AB0F0`, `#FFF1E9`, `#FFD3BD`, `#FFFBF1`, `#E8F0FE`, `#1A3A8A`.
   Kakao share button keeps Kakao yellow. Apple sign-in button keeps black.
6. Captions: raise every `font-size: 12px/13px` in family screens to 15px (tab labels: 13px).

**STOP & REPORT** with screenshots: 홈 / 사진 / 알림 / 설정 (self) and 홈 while viewing a parent.

---

## Phase A1 — Family home: the parent's day as a timeline (simple only) — **option C, chosen 2026-10-12**

Files: `app/src/pages/Home.tsx`, `App.tsx`, `styles.css` (HOME section), `components/ConnectParentCard.tsx`, reuse `lib/memoViews.ts`

Today the home greets the child (`Shawn님, 안녕하세요 · 오늘 하루를 기록해요`) with a huge empty area and a big 사진 찍기 tile. In the simple edition the child opens the app to see the parent's day.

- If the account has **no parent yet**: `ConnectParentCard` is the only big element, centered; orange button `엄마 연결하기` (72px, dark text).
- If the account **has a parent** (default view = the first parent, not self):
  - Header: eyebrow `10월 4일 토요일` (15 muted), title `{parentName}의 하루` (34/800), caption `사진 9장 · 집에서 최대 2.0km` (15 muted; drop the distance part when home location is unknown).
  - Body: **a vertical timeline of today's memos, newest at the top.** Left rail 56px wide with the time `15:30` (15/800 muted, right-aligned); a 2px `var(--line)` vertical line with a 12px `var(--accent)` dot per item; right of it one compact card per memo:
    `[thumb 72×72 radius 12] [title 17/700, max 2 lines] [place · category · ♥ names · 💬 n — 15 muted]`. Card: `var(--surface)`, 2px `var(--line)`, radius 16, padding 10, min height 92px.
    Stored-only memo (`사진을 남겼어요`) renders exactly the same card. Tapping a card opens the existing `MemoDetail`.
  - Empty today → one dim card `오늘 아직 사진이 없어요` under the header, nothing else.
  - End of list: `어제 보기 ›` link (15/700 muted) → 사진 tab scrolled to yesterday.
  - The child's own capture lives only in the FAB (A2). Remove `.capbtn` and `.askbtn` from the simple home; no 지난 기록 물어보기 on the home.
  - The `내 계정 / 할아버지 / 할머니` switcher stays in the account bar (orange tint, see A0); `내 계정` shows the old self home unchanged.
- Remove the `min-height: calc(100svh - 200px)` centering on `.home` in simple; content starts under the header and scrolls.

**STOP & REPORT** (screenshots: no parent · parent with 9 photos · parent with 0 photos).

---

## Phase A2 — Tabs and the camera FAB (simple only)

Files: `components/Tabs.tsx`, `components/CameraFab.tsx`, `App.tsx`, `styles.css` (BOTTOM NAV)

- Simple edition tabs: **4** — `홈 · 사진 · 알림 · 설정`. Hide `물어보기` (Ask) with `isSimple()`; the Ask page stays reachable from the parent's 사진 header if it already is, else not at all.
- Tab bar: height 64px + safe area, `background: var(--surface)`, `border-top: 2px solid var(--line)`, icon 26px, label 13px/700, active = `var(--accent)` icon + `var(--ink)` label. Unread badge: orange dot only (no number) in simple.
- FAB (`.cam-fab`): 64px, flat `var(--accent)`, dark camera glyph, shadow from token. Show only when `isSelf` (own account) on 홈 and 사진. Never over a parent's view, never over 설정.

**STOP & REPORT**.

---

## Phase A3 — 사진 list and photo detail (both editions)

Files: `pages/Today.tsx`, `pages/MemoDetail.tsx`, `components/Reactions.tsx`, `components/TextReply.tsx`, `styles.css` (TODAY, MEMO DETAIL, v2 reactions)

- List row → card: thumbnail 88×88 radius 14 (was ~60), title 17/700, second line `place · time` 15 muted, right side `♥ 2 · 💬 1` in muted 15px.
- **Remove the ⊗ delete button from every row.** Delete moves into the detail page's `⋯` menu with a confirm sheet (`이 사진을 지울까요?` / `지우기` in `var(--danger)` / `취소`).
- Day headers (`어제`, `토요일`) 15/700 muted; `다녀온 곳 ›` link shown in both editions (restored 2026-10-12; the simple home also gets a 다녀온 곳 card).
- Reaction thread under a photo (this is where hearts and words live in option C, so give it room): family comment bubble `var(--accent-tint)` right-aligned; parent's heart/word bubble white with `var(--line)` left-aligned, both 17px.
  Composer: heart button 48px outline → filled orange when tapped; text field 48px tall placeholder `짧게 남겨 주세요 (60자)`; `보내기` orange with dark text, disabled = `var(--line)` bg + muted text.

**STOP & REPORT**.

---

## Phase A4 — Notifications (simple only)

Files: `pages/Notifications.tsx`, `components/NotificationList.tsx`, `components/PushNudge.tsx`, `styles.css`

- Move the `앱 알림` toggle to 설정 › 알림. The 알림 page is a list only.
- The top nudge `새 사진이 오면 알려드릴까요? 알림 켜기 ✕` shows **only on the 알림 tab**, only while push is off, dismiss remembered for 7 days.
- Rows: icon circle 48px (`var(--accent-tint)` for family events, `var(--surface-dim)` for system), text 17/700 when unread + orange dot, 17/400 when read, time 15 muted.
- System rows (`…휴대폰이 연결되었어요`) collapse into one muted group at the bottom `연결 기록 ›`.
- Row types kept in simple: 새 사진 · 하트/한마디 · 저녁 `오늘 {parent} 사진 n장` · `오늘 아직 사진이 없어요`.

**STOP & REPORT**.

---

## Phase A5 — Settings (simple only)

Files: `pages/Settings.tsx`, `components/SectLab.tsx`, `styles.css` (SETTINGS)

Order and only these sections in simple: `계정` · `부모님` (연결하기 / 함께 보는 가족) · `알림` (앱 알림 toggle from A4) · `도움말·약관` · `로그아웃` · `계정 삭제` (last, muted link, confirm sheet).
Hide in simple: `집 위치`, `표시되는 이름` (use the account name), plan/payment, voice, map provider. Family member `삭제` → `⋯` menu + confirm, never a red button inline.
Section eyebrows 15/700 muted; rows 56px tall; `ⓘ` explanations keep working.

**STOP & REPORT**.

---

## Phase A6 — Parent camera screen polish (simple)

Files: `pages/ElderCamera.tsx`, `components/ElderAsk.tsx`, `components/SimpleConsent.tsx`, `styles.css` (Simple edition sections)

Keep the structure (viewfinder, shutter, 내 사진, flip, bubble, overlay). Only:
- Shutter: 104px white ring stays (camera convention); add a 6px `var(--accent)` inner ring so it's clearly the brand.
- `내 사진` and flip buttons: ≥ 60×60, white 92% pill, dark text 22/700.
- Overlay `지은이에게 보냈어요 ♥`: 30/800 Nanum Gothic, dark card `rgba(44,58,51,.86)`, heart in `var(--accent)`.
- Bubble (heart / 한마디 / 가족 사진): white 94%, 2px `var(--accent-line)`, text 26/700, max 2 lines, tap-to-dismiss unchanged.
- Consent screen and `ElderAsk`: ground `var(--ground)`, title 30/800, body 24, buttons 72px orange with dark text; secondary `자세한 내용 보기` outline.
- Sign-in `부모님 휴대폰이에요`: 72px orange button, dark text, under the Google/Apple buttons with 24px gap.

**STOP & REPORT** with screenshots: viewfinder, overlay, bubble, consent, sign-in.

---

## Phase A9 — The parent's phone is one camera screen (simple only)

Files: `pages/ElderApp.tsx`, `pages/FamilyPhotoViewer.tsx`, `pages/ElderCamera.tsx`, `components/ElderAsk.tsx`, `lib/cameraPreview.ts`, `lib/idle.ts`, `hooks/useIdleReturn.ts`, `lib/textReplies.ts`, `styles.css` (Simple edition sections)

Do not change Firestore rules, the worker, pairing/consent, or the capture/upload path.

Principle: the parent does only 3 things — take a photo, see family photos, tap ❤️ 고마워요.

1. No "가족이 보낸 사진" list screen in the parent flow. Tapping the camera banner opens the newest unseen family photo in `FamilyPhotoViewer`; `다음 사진 ›` goes to the next one; after the last one, back to the camera automatically with a short toast `다 보셨어요 ♥`. When nothing is new, the banner `가족 사진 다시 보기` opens the newest photo the same way.
2. `FamilyPhotoViewer`: only `❤️ 고마워요` (primary, 72px) and `다음 사진 ›` (secondary). No top `‹ 처음으로` link. `글로 답장하기` opens one-tap phrase buttons (no keyboard). Phrases mode is the default for new simple accounts; family can still change it in 설정.
3. No `TextSizeFab` (가) on any parent screen; text size is set by family in 설정 only.
4. The flip-camera button stays as it is. The camera always starts with the back camera on app open/resume.
5. `내 사진` stays as it is (small pill, bottom-left).
6. Any parent screen other than the camera returns to the camera after 60 s without a touch.
7. Camera permission screen button `다음` → `카메라 켜기`.
8. Parent text: body ≥ 26px, buttons ≥ 28px / 72px tall, `word-break: keep-all`.

Decisions taken while building (D119): on the last photo the secondary button reads `처음으로 ›` and returns to the camera, so a photo already answered is never a dead end; the written reply on this screen is always the phrase panel, whatever the family chose; 가족 소식 keeps its own `‹ 처음으로`.

**STOP & REPORT** with screenshots: camera, banner, photo view, last photo → camera (toast), permission.

---

## Definition of done (every phase)
- `npm run build:simple`, `npm run build:full`, `npm test` green; no new hard-coded hex outside `styles.css :root` (grep).
- Elder screens unchanged in behaviour; no price/limit/warning text anywhere on them.
- Screenshots saved to `docs/v3-ui/A<n>-*.png` for review.

---
---

# Round 2 — after the 2026-10-20 review (Phases A10 → A13 + UI QA)

Same rules as the top of this file: one phase at a time, `STOP & REPORT`, same tone and colors (no new hex, no gradients),
simple edition unless stated. **Every phase ends with the UI QA pass in §Q below — a phase is not done until §Q passes.**

## Phase A10 — Child home: the family dashboard; the parent's day loses its buttons (simple only)

Files: `pages/Home.tsx`, `App.tsx`, `components/ConnectParentCard.tsx`, new `components/PatientCard.tsx`, `lib/people.ts`, `styles.css`

Home while on **내 계정** (`isSelf`):
- Keep the date eyebrow + `{name}님, 안녕하세요` (34/800). Under it, **one `PatientCard` per connected parent**, newest activity first:
  - Row 1: avatar circle 48 (`var(--accent-tint)`, initial), `{parentName}의 하루` 17/800, caption `사진 n장 · 마지막 오전 10:10` 15 muted, right `보기 ›` 15/700 muted.
  - Row 2: today's three newest thumbnails (square, radius 12, equal thirds). Zero today → one dim card line `오늘 아직 사진이 없어요 · 어제 사진 7장`.
  - Row 3 (only when something is unread for this viewer): pill `새 소식` (`var(--accent-tint)` + `var(--accent-line)`) + the newest item's title and time, one line, ellipsis.
  - **No action buttons on the card.** The whole card is one tap target → that parent's day (the timeline home).
- Under the cards: eyebrow `내 오늘 · 사진 n장` and a horizontal strip of the child's own photos today (52px squares) ending in a dashed `+` that opens the camera. Zero → the dashed `+` alone with `카메라 버튼으로 남겨요`.
- No parent connected → `ConnectParentCard` alone, as today.
- Remove the top notice banner (`엄마님이 새 사진을 올렸어요`) from the self home; the card's `새 소식` pill replaces it. Keep the banner on other tabs as is.

Parent's day (the timeline home while viewing a parent) — **no action buttons** (decided 2026-10-20):
- Hearts and words are given on each photo (MemoDetail), never from the day page.
- **Remove** the big `엄마님께 사진 보내기` button. The `보낸 사진` section at the end of the timeline gets a header row:
  eyebrow `보낸 사진 · n장` on the left, link `📷 사진 보내기 ›` (15/700, `var(--ink)`) on the right, which opens the existing family-photo send. Zero sent → the row alone with `아직 보낸 사진이 없어요`.

Honorific (both editions, `lib/people.ts`): when a parent's display name is one of 엄마 · 아빠 · 어머니 · 아버지 · 할머니 · 할아버지 (with or without a trailing 님), never append `님` again: `엄마가 새 사진을 올렸어요`, `엄마의 하루`, `엄마께 사진 보내기`. Other names keep `님`. Add a unit test.

**STOP & REPORT** (screenshots: self home with 1 parent, with 2 parents, with no parent; parent's day with the button row; the honorific test).

---

## Phase A11 — Parent camera: iPhone-camera layout (simple only) — revised 2026-10-20

Files: `pages/ElderCamera.tsx`, `styles.css` (Simple edition sections). Capture/upload path untouched. **The viewfinder itself and the app's colors do not change.**

- Bottom: a **solid black bar** (`#000`), height `200pt + env(safe-area-inset-bottom)`, exactly like the iPhone Camera app. The viewfinder ends where the bar starts (no overlap).
- Inside the bar, **three controls on ONE horizontal centre line**, `justify-content: space-between` in a centred row of width `min(100% − 52pt, 340pt)`:
  - Left — `내 사진`: a **76pt circle showing the parent's most recent photo** (`border-radius: 50%`, `object-fit: cover`; today's newest memo thumbnail, else the newest ever; none yet → `var(--surface-dim)` circle with a photos glyph), 2pt white border. All three controls are circles so the bar reads as one balanced row. Tap = 내 사진 as today.
  - Centre — shutter: 112pt white circle, 6pt `var(--accent)` inner ring, 3pt white outer halo. Unchanged behaviour.
  - Right — flip: 76pt circle `rgba(255,255,255,.22)` with a **44pt** white flip glyph (bigger than today). Unchanged behaviour.
  - Under each control a label 15/800 white: `내 사진` · `사진 찍기` · `전환` (labels sit on the black bar, no pill).
- Top overlays stay where they are but use one surface: news bubble `rgba(0,0,0,.62)` white text, orange icon circle 48, title 26/800, second line 22 at 85% white, radius 24, 1px border `rgba(255,255,255,.14)`; the re-view banner the same at `.42` with a white-20% icon circle; sent/seen toasts the same at `.78`. No mint or white pills over the viewfinder.
- Permission question (`ElderAsk`) and denied state: unchanged layout; their buttons keep the tokens.

**STOP & REPORT** (screenshots: viewfinder with bubble + banner, bottom bar on 360 and 430 widths, 내 사진 thumbnail with and without a photo).

---

## Phase A12 — Family photo viewer: full photo, one big button (simple only)

Files: `pages/FamilyPhotoViewer.tsx`, `styles.css`

- Top row (56pt): left `{sender}이 보냈어요` 24/800 muted; right **progress dots** (current = 20×8 orange pill, others 8px `var(--line)`), one per unseen photo in this run. 10+ photos → `1 / 12` text instead of dots.
- Photo: full content width, **its own aspect ratio** (`object-fit: cover` inside a box whose height = width × photo h/w, capped at 60vh; above the cap use `contain` on `var(--surface)` — never black bars). Radius 20.
- Under it: message 26/800 centred, max 2 lines; caption `오후 8:40 · 1 / 3` 20 muted.
- Actions, pinned above the safe area: `❤️ 고마워요` 72pt filled; under it one row of two equal outline buttons 56pt: `글로 답하기` · `다음 사진 ›` (last photo: `처음으로 ›`). `글로 답하기` (wording decided 2026-10-20; not 말로) opens the phrase panel (no keyboard), as today.
- Short screens (≤ 700pt tall): the photo cap drops to 44vh so the three actions always fit without scrolling.

**STOP & REPORT** (screenshots: 1/3, last photo, phrase panel open, on 360×780 and 430×932).

---

## Phase A13 — One memo row everywhere, map on the parent's day (both editions)

Files: new `components/MemoRow.tsx`, `pages/Home.tsx`, `pages/Today.tsx`, `pages/Trail.tsx`, `styles.css`

- `MemoRow` = thumbnail 52 (radius 10) · title 17/700 max 2 lines · meta 15 muted `장소 · 카테고리 · ♥ 이름 · 💬 n`. Card: `var(--surface)`, 1.5px `var(--line)`, radius 14, padding 8, min height 68. Optional `badge` (number 1…n, 20px orange circle at the thumbnail's top-left) and `time` (left rail label).
- Home (parent's day): the timeline keeps its rail (time 15/800 + line + dot) but every item is a `MemoRow` with `badge` = order of the day (1 = first photo).
- 사진 tab: date headers + `MemoRow` (no rail, no badge).
- 다녀온 곳: the same rows with `badge`, under the map; the list and the map pins share the numbers.
- The small map moves **onto the parent's day**, directly under the header caption (there is no button row): 150pt tall, radius 14, pins numbered, label pill `다녀온 곳 n ›` → opens the full 다녀온 곳 page. Home never loads map tiles until the box is on screen (lazy).
- Delete the three old card styles once nothing uses them.

**STOP & REPORT** (screenshots: home, 사진, 다녀온 곳 side by side on one width).

---

## §Q — UI QA pass (run at the end of EVERY phase; paste the prompt in §Q.3)

### Q.1 Rules that every screen must satisfy
- **Nothing cut off**: no text clipped or overflowing its box, no button past the screen edge, no content hidden under the tab bar / FAB / safe area. `word-break: keep-all; overflow-wrap: anywhere` on all Korean text; every fixed bar adds `env(safe-area-inset-*)`.
- **No horizontal scroll** on any page at any width below.
- **Sizes**: family text ≥ 15px (tab labels 13); parent text ≥ 26px; touch targets ≥ 48×48 (parent ≥ 60×60); buttons in one row are the same height and width.
- **Balance**: elements that are siblings share one shape, radius and size (three circles, two equal buttons, equal thumbnails); content is centred within the 480px column; gutters 16/24 consistent.
- **Tokens only**: no new hex outside `styles.css :root`; no gradients on UI; dark text on orange; contrast ≥ 4.5:1 for body, ≥ 3:1 for ≥ 24px.
- **States**: every list has an empty state; every primary button has a disabled state that still shows why.

### Q.2 Device matrix (use `e2e/shot-kit.mjs`; add the widths if missing)
| name | viewport | text scale |
|---|---|---|
| iPhone SE | 375 × 667 | 100% |
| Galaxy S24 | 360 × 780 | 100% |
| iPhone 15 | 393 × 852 | 100% and **130%** (iOS Larger Text) |
| Pixel 8 | 412 × 915 | 100% |
| iPhone 15 Pro Max | 430 × 932 | 100% |
| Parent phone, 큰 글자 | 393 × 852 | 설정 › 글자 크기 = 가장 크게 |

Every screen the phase touched is captured on every row above, light theme, Korean. Save as `docs/v3-ui/<phase>-<screen>-<width>[-L].png`.

### Q.3 The QA prompt (paste after each phase's "done")
```
Run the UI QA pass in docs/DAYLIE_V3_UI_FIX.md §Q for Phase <A1x>.
1. Capture every screen this phase touched on all six rows of the Q.2 device matrix with e2e/shot-kit.mjs
   (add missing widths and the 130% text-scale run if they are not there). Save to docs/v3-ui/.
2. Open each screenshot and check Q.1 line by line: clipped or overflowing text, anything under the tab bar,
   FAB or safe area, horizontal scroll, text below the minimum sizes, touch targets below 48 (parent 60),
   sibling elements with different shapes or sizes, new hex colors, missing empty/disabled states.
3. Also grep: `rg -n "#[0-9A-Fa-f]{6}" app/src --glob '!styles.css'` must add nothing new;
   `rg -n "gradient" app/src/styles.css` must show only the photo-placeholder gradients.
4. Fix every finding in this phase's files only, re-capture, and repeat until the matrix is clean.
5. Report as a table: screen × device → OK / what was fixed. Then STOP.
```

---

# Round 3 — after the 2026-10-24 review (Phase A14 + §Q)

Testers said the family app's 오늘 (내 하루) and 과거 feel busy, and the parent's 내 사진 is too small to read. Review page "Daylie 사진 목록 정리" compares the T1 screenshots (origin/main, 2026-10-24) with mockups.

## §R.1 Owner decisions (2026-10-25) — write these into CLAUDE.md

- **Sending photos to parents:** only from the **⋯ menu on one's own photo** (memo detail → ⋯ → `부모님께 보내기`). The `📷 부모님께 사진 보내기 ›` link on 내 하루 is removed, and with it the "pick a photo from the phone's gallery" path. The ⋯ flow gains an optional one-line message (see A14.3). A parent's day page still has no sending.
- **Parent's 내 사진 buttons:** `OWNER DECISION A14.7: BOTTOM BAR` — a fixed bottom bar with two labelled buttons (`날짜로 찾기`, `카메라`) replaces the two floating icons. *(If this line says `FLOATING` instead, keep the floating buttons, enlarged to 64/72pt, with bottom padding.)*
- Everything else in CLAUDE.md stays: parents woven into 내 하루/과거 and indented in the parent's colour; the family calendar FAB bottom-left on 과거; day headings `오늘 · 10월 24일 (토)` / `어제 · …` / date; past days morning first, today newest first; one phone per parent; memo tone.

## §R.2 Rules for this phase

Same as Rounds 1–2: same tone and colours, tokens from `styles.css :root` only, no new hex, no gradients, dark text on orange (never white on orange). Family touch targets ≥48pt; parent's phone body ≥26pt and buttons ≥60pt. On the parent's phone change **only 내 사진** (A14.7). Do not touch the camera capture/upload path, pairing/consent, `firestore.rules`, `storage.rules`, or the worker. One phase, §Q clean, commit, STOP & REPORT.

## Phase A14 — Calmer 내 하루 · 과거 · 엄마의 하루 (family) + the parent's 내 사진 (simple edition)

**A14.1 One white card per day** (`components/MemoRow.tsx`, `styles.css`)
- Each day's rows sit in **one** `var(--surface)` card (radius 20) with 1px `var(--line)` dividers. No per-row border, no per-row card, no tinted row background.
- `time` stays as a left column (46pt, 14/800 muted, tabular-nums). **Remove the rail line and the dot** (`.day-rail` line, `.day-dot`) on family pages.

**A14.2 Own photo row** (`MemoRow.tsx`, `lib/memoViews.ts`)
- Thumb 52 → **60pt** (radius 14). Title one line (ellipsis). Meta **one line = place name only** (no 동/구, no category). 동/구 and category stay on the memo detail page.
- Reactions `♥ n 💬 n` (13/800 muted, heart `var(--danger)`) at the **right end of the meta line**, hidden when 0. The unread dot (`memo-row-new`) sits in its own right column, never inside the text.
- Title fallback: generic `사진을 남겼어요` → `{place}에서` when a place exists.

**A14.3 내 하루: parent rows, sent rows, and sending** (`pages/MyDay.tsx`, `components/SentRow.tsx`, `pages/MemoDetail.tsx`, `App.tsx`)
- Parent rows (`ParentMemoRow`) and sent rows: keep the indent and the 3pt left edge in the parent's colour (`lib/parentColors.ts`). **Drop the tinted background.** Thumb **40pt** (radius 10), **one line**: parent name (800, in the parent colour's dark ink) + place. Sent row: `엄마에게 보냄` + status at the right end (`보냈어요` / `봤어요` / `❤️ 고마워요`).
- **Collapse:** 2+ photos of the same parent with no other row between them become one row `엄마 · 사진 n장` with stacked thumbs (2–3, offset 5/4pt) and `펼치기 ›` on the right; tap expands in place (reduced motion = instant). Unit-test the grouping in `lib/diary.ts`.
- Header: date eyebrow, `내 하루`, caption `내 사진 n장 · 엄마 n장` (each parent with photos today). **Remove the `📷 부모님께 사진 보내기 ›` link** and the `onSendPhoto` prop/gallery sheet behind it (delete the dead code and its tests; keep any part the ⋯ flow reuses).
- **Sending from ⋯ only:** on one's own photo, ⋯ → `부모님께 보내기` (exists today; sends only the photo). Update it to:
  1. Pick the parent(s) when more than one may receive it (as today).
  2. An **optional one-line message** field (max 60 characters, placeholder `한 줄 남기기 (선택)`), stored as the family photo's caption — the same field the removed gallery flow used.
  3. `보내기` button (accent, dark text, ≥48pt). After sending: toast `엄마에게 보냈어요`, and the sent row appears in 내 하루.
  4. A photo already sent to that parent shows `보냄` in the picker and cannot be sent twice (keep `fromMemoId`).
- **Discoverability:** 내 하루's empty state reads `오늘 아직 사진이 없어요` + a second muted line `찍은 사진은 ⋯ 에서 부모님께 보낼 수 있어요`. On one's own memo detail, the first time only, a small hint bubble points at ⋯: `여기서 부모님께 보낼 수 있어요` (dismiss on tap; remember in local settings).

**A14.4 과거** (`pages/Today.tsx`)
- Same card and row rules per day. `다녀온 곳 ›` only on days that have a parent photo with a place.
- The list's bottom padding = floating button height + 16pt + safe area, so the calendar FAB (left) and camera FAB (right) never cover the last row.

**A14.5 엄마의 하루** (`pages/Home.tsx`, `pages/Trail.tsx`, `lib/trail.ts`)
- Same card/row rules. **No number badges here**; numbers only on 다녀온 곳 (Trail).
- Consecutive photos at the same place (within `SAME_PLACE_M = 100` m) collapse into one row `{place} · 사진 n장`, tap to expand.
- Map (small and Trail): one pin per place (100 m rule), chip with visit numbers `1·5·9`; caption `사진 n장 · n곳 · 집에서 최대 n.nkm`; Trail caption `n곳 · m번 들름 · …`. Unit-test the merge (boundary, order, numbers).

**A14.6 Demo data** (`e2e/demo-seed.mjs`)
- Give the family member's own photos different scenes and times from the parent's, so review screenshots don't look doubled.

**A14.7 Parent's 내 사진** (`pages/ElderApp.tsx` records view, `styles.css`; parent's phone, this screen only)
- Today it reuses the family `MemoRow` (17/15pt), below the parent rules. Give it its own large card (`ElderRecordCard`):
  - Photo full card width, **3:2**, `object-fit: cover`, card radius 22, white card.
  - Under the photo **one line 22/700**: `오전 8:55 · 석촌호수` (time · place). No 동/구, category or AI title here; tapping the card opens the memo as today.
  - Family response as a **sentence** in an `--accent-tint` box, 20/800: `지민이 ❤️ 하고 글을 남겼어요` / `지민이 ❤️ 보냈어요` / `지민이 글을 남겼어요` (several people: `지민 외 1명이 …`). Unseen → a `새 소식` pill (accent background, dark text) in front, replacing the orange dot.
  - Received family photo: keep the owner's layout (indented right 40pt, `--accent-tint`, 5pt accent edge), same card size rules, `지민이 보냈어요` 22/800, then `오후 8:40 · ❤️ 고마워요 보냄` (show the caption line if the family wrote one).
- Day headings 22/800 muted; header title `내 사진` 26/800; `‹ 카메라` button height ≥60pt, 22/800.
- Buttons per §R.1:
  - `BOTTOM BAR`: a fixed white bar (top border `var(--line)`, padding 12/16pt + safe area) with two equal 64pt buttons, radius 20, 22/800: `날짜로 찾기` (white, 2pt `var(--line)` border, calendar glyph; opens the same date picker as `CalendarFab` and scrolls to that day) and `카메라` (accent, camera glyph; back to the camera). Remove the floating icons on this screen. The list ends above the bar.
  - `FLOATING`: keep both floating buttons, calendar 64pt and camera 72pt, list bottom padding = 72pt + 16pt + safe area.
- Idle return to the camera (`useIdleReturn`) and everything else on the parent's phone stay as they are.

**Tests:** MemoRow (one-line meta, reactions hidden at 0, title fallback, no rail), diary grouping (collapse rule), MyDay without the send link, ⋯ → 부모님께 보내기 with message (one parent, several parents, already sent), trail merge, 과거 bottom padding, ElderRecordCard (sentence for each reaction mix, 새 소식), the bottom bar's date jump.

**Screenshots for §Q:** `A14-myday`, `A14-myday-empty`, `A14-myday-expanded`, `A14-send-sheet`, `A14-detail-hint`, `A14-past`, `A14-past-bottom` (scrolled to the end), `A14-parent-day`, `A14-trail`, `A14-elder-records`, `A14-elder-records-bottom` × the Q.2 matrix (incl. 130% text, and the parent phone's 큰 글자).
