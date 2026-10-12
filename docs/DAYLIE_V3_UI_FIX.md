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
- Day headers (`어제`, `토요일`) 15/700 muted; `다녀온 곳 ›` link hidden in simple.
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

## Definition of done (every phase)
- `npm run build:simple`, `npm run build:full`, `npm test` green; no new hard-coded hex outside `styles.css :root` (grep).
- Elder screens unchanged in behaviour; no price/limit/warning text anywhere on them.
- Screenshots saved to `docs/v3-ui/A<n>-*.png` for review.
