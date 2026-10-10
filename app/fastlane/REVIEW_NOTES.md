# 심사 안내 / Review notes — 오늘하루 (com.zymer.daylie, simple edition)

What to paste where, for the two stores. **No credentials live in this file.**
The demo account's email and password go only into the store consoles:

- **App Store Connect** → the version's *App Review Information* → *Sign-in
  required* → **User name / Password**. (`fastlane/metadata/review_information/`
  holds the notes text only; `demo_user.txt` / `demo_password.txt` are
  gitignored, so you may create them locally if you'd rather let `deliver` fill
  those fields — they will never be committed.)
- **Google Play Console** → *Policy and programs → App content → App access* →
  *All or some functionality is restricted* → add one instruction set with the
  demo login.

The same prose, ready to paste, is in
`fastlane/metadata/review_information/notes.txt` (uploaded as the App Review
notes by `release_ios`).

---

## 1. 이 앱은 휴대폰 두 대가 짝을 이룹니다 / The app is a pair of phones

**한국어**

1. **가족(자녀) 휴대폰** — Google 또는 Apple로 로그인합니다. 부모님을 등록하고,
   부모님이 찍은 사진을 날짜별로 보고, 하트와 한마디를 남기고, 부모님께 사진을
   보냅니다.
2. **부모님 휴대폰** — 계정을 만들지 않습니다. 가족이 보여주는 QR을 비추거나
   가족이 보낸 링크를 한 번 누르면 연결되고, 그 뒤로는 앱이 **사진 찍는 화면만**
   보여줍니다.

**English**

1. **Family (adult child) phone** — signs in with Google or Apple; registers a
   parent, sees the parent's photos by day with time and place, leaves a heart or
   a one-line comment, sends photos to the parent.
2. **Parent's phone** — never creates an account. It is linked once (QR or a
   tapped link) and from then on the app shows **only a camera viewfinder**.

## 2. 카메라 화면만 보이는 것은 의도된 설계입니다 / Camera-only is intentional

**한국어** 부모님 휴대폰에는 메뉴, 목록, 설정, 로그아웃이 없습니다. 미완성
화면이 아니라, 어르신이 큰 버튼 하나만 누르면 사진이 가족에게 가도록 일부러
그렇게 만든 화면입니다. 버튼을 누르면 "가족에게 보냈어요"가 1.5초 보이고 다시
사진 찍는 화면으로 돌아갑니다. 왼쪽 아래 **내 사진**으로 본인이 찍은 사진을
볼 수 있고, 가족이 하트·한마디·사진을 보내면 화면 위에 작은 알림이 떠오릅니다.

**English** The parent's phone has no menus, no lists, no settings and no
sign-out. This is not an unfinished screen — it is the product: an elderly
parent presses one large button and the photo reaches the family. After a tap
the screen says "가족에게 보냈어요" ("sent to your family") for 1.5 s and returns
to the viewfinder. A small **내 사진** ("my photos") button at the bottom-left
shows their own photos, and a bubble appears at the top when the family sends a
heart, a comment or a photo.

## 3. 심사용 계정 / The demo account

**한국어** 콘솔의 로그인 정보 칸에 적어 둔 계정은 **가족(자녀) 쪽 계정**입니다.
이 계정에는 이미 데모 부모님이 연결되어 있고 예시 사진이 들어 있으므로, 로그인
한 번으로 사진 목록, 사진 상세(시간·장소·자동 메모), 하트와 한마디, "부모님께
사진 보내기"를 모두 확인할 수 있습니다. **휴대폰 두 대는 필요하지 않습니다.**

부모님 화면을 직접 보시려면: 로그인 화면에서 **"부모님 휴대폰이에요"** → 하단
**"코드 입력"** → 가족 계정의 *설정 → 부모님*에서 만든 8자리 연결 코드를 입력.

**English** The account in the console's sign-in fields is a **family (adult
child) account**. It is already linked to a demo parent and already holds sample
photos, so one sign-in is enough to review the photo list, a photo's detail page
(time, place, the automatically written memo), hearts and comments, and "send a
photo to the parent". **A second device is not needed.**

To see the parent's side: sign-in screen → **"부모님 휴대폰이에요"** ("this is my
parent's phone") → **"코드 입력"** ("enter code") → type the 8-character pairing
code generated in the family account under *Settings → 부모님*.

## 4. 권한 / Permissions

| 권한 | 왜 필요한가 / Why |
|---|---|
| 카메라 / Camera | 사진을 찍고, 연결할 때 QR을 읽습니다. Taking the photo; reading the pairing QR. |
| 위치(앱 사용 중) / Location (when in use) | 사진을 찍은 곳의 **이름**만 남깁니다. 거부해도 앱은 정상 동작합니다. 상시·백그라운드 위치는 요청하지 않습니다. Only to label a photo with a place name; denying it is fine; no background/always location. |
| 사진 / Photos | 찍은 사진을 휴대폰 사진 앱에도 저장하고, 가족이 보낼 사진을 고릅니다. Saving the capture to the phone's library; picking a photo to send. |
| 알림 / Notifications | **가족 휴대폰만** 사용합니다. 부모님 휴대폰은 푸시를 등록하지 않습니다. Family phone only; the parent's phone never registers for push. |
| 클립보드 1회 읽기 / One clipboard read | 첫 실행 때 가족이 보낸 연결 코드를 찾기 위해서입니다 (iOS는 붙여넣기 허용을 한 번 묻습니다). On first launch only, to pick up the pairing code (iOS asks once). |

## 5. 건강·의료 기능은 없습니다 / No health or medical features

**한국어** 이 앱은 가족이 사진을 나누는 앱입니다. 건강, 질병, 복약, 안전 감시에
관한 기능이 없고 그런 주장도 하지 않습니다. 사진이 자동으로 분류될 때 장소
종류로 "병원"이 쓰일 수 있지만, 이는 장소 이름표일 뿐 건강 기능이 아닙니다.

**English** This is a family photo-sharing app. It has no health, medical,
medication or safety-monitoring features and makes no such claims. A photo's
auto-detected *activity* label can be a place type such as "병원" (hospital), but
that is a place label, not a health feature.

## 6. 데이터 / Data

**한국어** 사진과 메모는 연결된 가족만 볼 수 있습니다. 가족 휴대폰에서 언제든
연결을 끊을 수 있고, 보관 기간을 30일 / 90일 / 계속 중에서 고를 수 있습니다.
부모님 휴대폰에서 연결 후 한 번, "가족에게 오늘 하루를 보여드릴까요?" 동의
화면이 나오고 그 동의 기록이 저장됩니다.

**English** Photos and memos are visible only to the linked family. The family
can unlink the parent's phone at any time and choose a retention period of 30
days / 90 days / forever. Right after linking, the parent's phone shows one
plain-language consent screen and the acceptance is recorded.

개인정보처리방침 / Privacy policy: https://dayliesimple.web.app/privacy
이용약관 / Terms: https://dayliesimple.web.app/terms
