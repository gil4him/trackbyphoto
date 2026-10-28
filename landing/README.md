# Daylie 랜딩 페이지 — www.daylieai.com

`public/` 안의 정적 파일이 사이트 전부입니다.

| 주소 | 파일 | 언어 |
|---|---|---|
| `/` | `public/index.html` | 한국어 |
| `/en/` | `public/en/index.html` | English |

브라우저 언어가 한국어가 아닌 첫 방문자는 `/`에서 `/en/`으로 자동 이동하고, 헤더의 **English / 한국어** 버튼으로 고른 언어는 그 브라우저에 기억됩니다. 두 페이지는 `hreflang`으로 서로 연결돼 있어 검색엔진도 언어별로 보여 줍니다.
빌드 과정이 없고, Firebase Hosting 사이트 `daylieai` (프로젝트 `daylie-simple-4df13`)에 올립니다.
앱(`dayliesimple`)과는 별도 Hosting 사이트라서 앱 배포에 영향을 주지 않습니다.

## 처음 한 번만 (Shawn)

터미널에서 이 폴더로 이동한 뒤:

```bash
cd /Volumes/Seagate_Por/1_Daylie_AI/landing
firebase login            # 이미 로그인돼 있으면 생략
firebase hosting:sites:create daylieai
```

> `daylieai` 이름이 이미 다른 사람 것이라 실패하면 `daylieai-web` 같은 다른 이름으로 만들고,
> `firebase.json`의 `"site": "daylieai"` 도 같은 이름으로 바꿔 주세요.

## 배포 (내용이 바뀔 때마다)

```bash
cd /Volumes/Seagate_Por/1_Daylie_AI/landing
firebase deploy --only hosting
```

끝나면 `https://daylieai.web.app` 에서 먼저 확인할 수 있습니다.

## 도메인 연결 (처음 한 번만)

1. Firebase 콘솔 → 프로젝트 `daylie-simple` → **Hosting** → 사이트 `daylieai` → **맞춤 도메인 추가**
2. `daylieai.com` 을 입력하고 **"www.daylieai.com 으로 리디렉션"** 을 켜거나, `www.daylieai.com` 을 먼저 추가합니다.
3. Firebase가 보여주는 레코드를 **도메인을 산 곳(등록 대행사)의 DNS 설정**에 그대로 넣습니다.
   - 소유 확인용 `TXT` 레코드 1개
   - `daylieai.com` → `A` 레코드 (Firebase가 알려주는 IP)
   - `www` → `A` 레코드 또는 `CNAME` (Firebase가 알려주는 값)
4. 보통 몇 분~몇 시간 뒤 **"연결됨"** 으로 바뀌고 SSL 인증서는 자동으로 발급됩니다.

## 짧은 주소

`firebase.json`의 redirects 덕분에 아래 주소를 홍보물에 쓸 수 있습니다.

| 주소 | 가는 곳 |
|---|---|
| `www.daylieai.com/ios` | App Store |
| `www.daylieai.com/android` | Google Play |
| `www.daylieai.com/app` | 웹 앱 (dayliesimple.web.app) |
| `www.daylieai.com/privacy` · `/terms` · `/delete-account` | 법적 페이지 (앱 사이트로 넘김) |

## 스크린샷 교체

한국어: `public/assets/*.jpg` ← `app/fastlane/screenshots/ko/69-*.png` (iPhone 6.9", 1320×2868)
영어: `public/assets/en/*.jpg` ← `app/fastlane/screenshots/en-US/*.png (iPhone 6.9", gitignored; 현재는 1_Daylie_AI-local/us-wt 워크트리에 있음)` (1320×2868)
모두 600px 폭 JPG로 줄인 것입니다. 앱 UI가 바뀌면 같은 이름으로 다시 만들어 넣고 배포하면 됩니다.

| 파일 | 원본 |
|---|---|
| parent-sent.jpg | 69-2-sent.png |
| parent-reply.jpg | 69-3-message.png |
| parent-my-photos.jpg | 69-4-records.png |
| family-photo-detail.jpg | 69-5-detail.png |
| family-my-day.jpg | 69-6-myday.png |
| family-parent-day.jpg | 69-7-parent-day.png |
| family-pair-qr.jpg | 69-8-qr.png |
