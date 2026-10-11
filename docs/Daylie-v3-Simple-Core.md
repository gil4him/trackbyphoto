# Daylie v3 — Simple Core (2026-10-09, rev 5)

**One sentence:** 딸과 엄마가 연결되고, 엄마가 찍은 사진으로 딸이 엄마의 오늘을 안다.
**Rule:** 엄마 앱 = 카메라. 아이콘을 누르면 바로 뷰파인더.

## 0. 분리 전략 (전체 모델 보존)
- **Code:** `main` = 전체 모델, tag `v2-full`, 그대로 보존. `simple-core` branch = 이 문서 버전.
- **Backend:** simple-core는 **별도 Firebase 프로젝트** 사용. 표시 이름 `daylie-simple`, **실제 project ID = `daylie-simple-4df13`** (project number 99411030280). 사용자·사진·DB·worker가 main(`trackbyphoto-app`)과 완전히 분리됨. (Supabase 이전은 검토 후 보류 — v4에서 재검토.)
- 기능 숨기기: 빌드 설정 `VITE_EDITION=simple` (`isSimple()`), 프로젝트 선택: `.env.simple` + `.firebaserc` alias `simple` → `daylie-simple-4df13`.
- Web 주소: `https://dayliesimple.web.app` (Hosting site `dayliesimple`) · Storage bucket: `daylie-simple-4df13.firebasestorage.app`
- Mac mini worker: 같은 코드, **두 번째 launchd 인스턴스** `com.daylie.worker.simple` 가 `~/daylie-secrets/simple/daylie-simple-sa.json` 서비스 계정으로 실행. Ollama 공유 (AI 비용 0).
- 비용: Blaze 요금제 + **예산 알림 $5**. 베타 규모 → 사실상 $0.
- App Store/Play: bundle ID `com.zymer.daylie` 하나 → 스토어 베타 빌드 = simple edition + daylie-simple 설정.

### Secrets 상태 (Mac mini `~/daylie-secrets/simple/`, repo 밖)
| 파일 | 상태 |
|---|---|
| `GoogleService-Info.plist` | ✅ bundle `com.zymer.daylie`, project `daylie-simple-4df13` |
| `daylie-simple-sa.json` | ✅ service account, project `daylie-simple-4df13` |
| `google-services.json` | ✅ package `com.zymer.daylie`, app `1:99411030280:android:e6a78be9c297f2b971fcbd` (잘못 등록된 앱은 삭제함) |
| `web-config.txt` | ✅ Web app `1:99411030280:web:d8ee58f615f002b871fcbd` + `.env.simple` 형식 값 포함 |

## 1. 연결 흐름 (확정안)

### A. 같이 있을 때 (기본 — 가장 쉬움)
1. 딸: 자기 폰에 앱 설치 → 로그인 → `엄마 연결하기` → QR 화면
2. 딸이 엄마 폰에 앱 설치 (또는 엄마가 `받기`)
3. 엄마: 앱 열기 → 카메라가 바로 켜짐 → 딸의 QR을 비추면 **자동 연결** (탭 0번)
4. 엄마: `네, 지은이에게 보여줄게요` 한 번 → 끝

### B. 떨어져 있을 때 (보조)
1. 딸: `엄마 연결하기` → `카카오톡으로 보내기` (링크 `/pair?c=CODE`)
2. 엄마: 링크 탭 → 앱 없으면 스토어 → 설치
3. 연결 코드는 링크 페이지(redirect-shim)가 클립보드에 넣어두고, 첫 실행 시 앱이 읽음 (iOS "붙여넣기 허용" 1회)
4. 실패 시: 카톡 메시지 문구 = "설치 후 이 링크를 한 번 더 눌러주세요" → universal link로 앱이 열리며 연결

엄마가 누르는 것: `받기` · `열기` · `네` (+ iOS 카메라 권한 `허용` 1회)

## 2. 엄마 앱 (ElderApp) — 화면은 단 하나
- 앱 실행/복귀 시 즉시 **in-app 뷰파인더** (system camera modal 금지 — "사진 사용" 확인 탭이 생김)
- 하단 중앙 큰 셔터 (≥ 96px), 그 외 버튼 없음
- 셔터 → 진동 + 1.5초 `지은이에게 보냈어요 ♥` → 다시 뷰파인더
- 딸의 하트/한마디: 뷰파인더 상단에 말풍선으로 떠 있다가 탭하면 사라짐
- 모서리 작은 `내 사진` 버튼(오늘 찍은 사진 보기)만 허용
- 가격·제한·경고·설정 없음

> **2026-10-10 변경 (Shawn):** §3·§4는 대체됨. 자녀 앱 = TrackByPhoto 전체 가족 앱(본인 사진, 나↔엄마 전환, 다녀온 곳, 물어보기, 가족 관리/초대, 전체 설정, 가족 사진 보내기). 부모 앱 = 카메라 + 내 사진(전체 기록) + 하트/한마디 + 가족이 보낸 사진. "simple" = 부모 쪽 단순화 + 별도 백엔드. 알림: 사진마다 + 저녁 사진 수. 첫 화면: 로그인 + 큰 '부모님 휴대폰이에요'.

## 3. 딸 앱 — 3가지만 (대체됨)
1. 오늘 엄마 사진 타임라인 (시간 · 장소명 · AI 한 문장)
2. 사진마다 ♥ / 한마디
3. 하루 1회 알림 `오늘 엄마 사진 n장` + 저녁까지 0장이면 `오늘 아직 사진이 없어요`

## 4. simple-core에서 숨기는 것 (코드는 남김) (대체됨 — 플래그로 결정)
`trailMap`(다녀온 곳) · `planSheet` · `voiceReplies` · `digest` 이메일/메신저 · 주간/월간 · Ask 탭 · 가족 여러 명 UI
→ 위치정보법 숙제는 trailMap과 함께 미룸. 사진 메모의 장소명은 유지.

## 5. 동의 — 1장으로 압축
`가족에게 오늘 하루를 보여드릴까요?` / `내가 찍은 사진과 찍은 곳을 {이름}에게 보여드려요.` / [네, 보여줄게요] / `자세한 내용 보기`

## 6. 데이터 모델 원칙
UI 문구는 "엄마/딸", 코드·DB는 `patient / caregiver` 중립 유지 (아빠–아들, 할머니–손녀 확장 대비).

## 7. Shawn이 직접 할 일 — Firebase 콘솔
1. ✅ 프로젝트 생성 (`daylie-simple-4df13`)
2. ✅ Blaze (예산 알림 $5 — 확인 필요)
3. ✅ Authentication → Google / Apple은 스토어 제출 전에
4. ✅ Firestore
5. ✅ Storage (`daylie-simple-4df13.firebasestorage.app`)
6. ✅ 앱 등록: iOS / Android / Web
7. ✅ 서비스 계정 키
8. ✅ `~/daylie-secrets/simple/` 4개 파일 완료

## 8. Claude Code 단계 (요약)
0) Branch + separate backend (main = full, tag v2-full, simple-core branch; VITE_EDITION/isSimple; .env.simple; build:full/build:simple; .firebaserc aliases; config/full|simple native configs + native:full/native:simple; VITE_PUBLIC_URL; deploy rules/indexes/storage to simple; seed admin_config plans flags; second launchd worker com.daylie.worker.simple)
1) Camera-first ElderApp (@capacitor-community/camera-preview, shutter ≥96px, outbox upload, 1.5s overlay, reaction bubble, 내 사진)
2) QR pairing from the camera + 엄마 연결하기 QR/카카오톡 share + redirect-shim clipboard + Universal/App Links
3) One-screen consent
4) Hide non-core features when isSimple(); daily "오늘 엄마 사진 n장" and evening "오늘 아직 사진이 없어요" notices
5) Deploy simple web build to daylie-simple-4df13 only (`firebase deploy -P simple --only hosting:app`)

Rules: elder UI Korean, Nanum Gothic, touch targets ≥60px, no prices/limits/warnings on elder screens; DB names neutral (patient/caregiver); small commits; after each step build:simple, build:full, npm test.

## 9. 나중에 합치기
simple-core가 검증되면 → main으로 merge. `VITE_EDITION` + 프로젝트별 env 덕분에 한 코드베이스에서 "심플판"과 "전체판"을 각각 다른 백엔드로 빌드 가능 (예: 무료=심플, 유료=전체). 백엔드를 하나로 합칠지는 그때 결정.
