# End-to-end check of the website

One browser plays a family member, a second (phone-sized, separate storage)
plays a parent's linked phone. They talk to the Firebase emulators and to the
real worker code, run as a child process against those emulators. Nothing
touches production: the project id is `demo-trackbyphoto`, which the Firebase
tools never send to a real project, and the worker is started without a key.

```sh
cd e2e
npm test
```

Needs Node 20+, Java (for the emulators), `firebase-tools` and Google Chrome
(`CHROME_PATH` if it is not in the usual place). About four minutes, two of
them the dead-upload step.

| Setting | What it does |
|---|---|
| `E2E_SKIP_STALL=1` | skip the two-minute dead-upload step |
| `E2E_REAL_LLM=1` | write memos with the local Ollama model instead of the stand-in |
| `E2E_HEADFUL=1` | watch it in a visible browser |
| `E2E_SITE_DIR=<dir>` | check an already-built site (for example an older commit) |

## What it covers

1. A family member registers a parent and gets a link for the parent's phone.
2. The parent's phone opens the link, taps 연결하기 and lands on the
   two-button screen (no tabs, no settings, no prompts).
3. A photo from the parent reaches the family with its written note.
4. A photo taken with no connection waits on the phone and goes by itself
   when the connection returns.
5. An upload that neither finishes nor fails is given up on and retried
   without restarting the app, and does not hold up the photo behind it.
6. A heart and a comment from the family light up the parent's 가족 소식
   card; the parent answers with a ready-made reply; the family sees it.
7. 알림 offers only what is switched on.
8. The daily summary is written, announced and opens from 알림.
9. 설정 shows what is switched on and nothing that is not.
10. The parent's phone opens with no connection and still knows whose it is.
11. A slow connection never replaces someone's settings with defaults.

## What it cannot cover

The installed iPhone and Android apps, a push actually arriving, the real
camera, the home-screen icon, Google's own sign-in screen (the family
account is created in the Auth emulator and its session put where the SDK
keeps it), iPhone Safari, and photos themselves showing (the worker's photo
links point at the real storage host, which has no such bucket).

Failures leave a screenshot and the page text of every browser in
`e2e/.tmp/shots`, and the worker's log in `e2e/.tmp/worker.log`.
