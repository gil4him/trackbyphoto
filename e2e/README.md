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
| `E2E_SNAP=1` | keep pictures of a few screens in `e2e/.tmp/shots` |

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
10. Registering a second parent under a name already in use is stopped.
11. A registration can be cancelled on the link step, leaving nothing behind.
12. 설정 → 함께 보는 가족 lists the same people as the switcher.
13. A parent one registered can be deleted from that list.
14. A family member sends the parent a photo with a line; it reaches the
    parent's home screen as a lit card.
15. The parent opens it, sees the photo, and answers with ❤️; the sender sees
    the answer and is told.
16. The 대표 가족 can switch family photos off for that parent, and on again.
17. An account removed outside the app drops out of the lists, and the
    worker withdraws the link to it.
18. The parent's phone opens with no connection and still knows whose it is.
19. A slow connection never replaces someone's settings with defaults.

## What it cannot cover

The installed iPhone and Android apps, a push actually arriving, the real
camera, the home-screen icon, Google's own sign-in screen (the family
account is created in the Auth emulator and its session put where the SDK
keeps it), and iPhone Safari.

Failures leave a screenshot and the page text of every browser in
`e2e/.tmp/shots`, and the worker's log in `e2e/.tmp/worker.log`.
