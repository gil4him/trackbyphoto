# simple/ — everything that exists only for the simple edition (Daylie)

Daylie ships in two editions from one codebase:

| | full (TrackByPhoto) | simple (Daylie) |
|---|---|---|
| Firebase project | `trackbyphoto-app` | `daylie-simple-4df13` |
| Web site | trackbyphoto.web.app | dayliesimple.web.app |
| Web build | `npm run build:full` | `npm run build:simple` |
| Native config | `npm run native:full` (`config/full/`) | `npm run native:simple` (`simple/app/`) |
| Worker | `com.trackbyphoto.worker` | `com.daylie.worker.simple` (`EDITION=simple`) |
| Firebase CLI | `--project trackbyphoto-app` | `--project simple --account gil4him@gmail.com` |

**The source is shared.** `app/src` and `worker/src` are one app and one
worker; the simple edition is the same code with `isSimple()` (client, from
`VITE_EDITION`) and `edition()` (worker, from `EDITION`) branches. Do not
copy source into this folder — fix a bug once, in `app/` or `worker/`.

This folder holds only what is *specific* to the simple edition:

```
simple/
  README.md                        this file
  Daylie-v3-Simple-Core.md         the product spec
  app/
    .env.simple                    Vite env for `--mode simple` (app/vite.config.ts
                                   sets envDir here; app/.env.local does not apply)
    GoogleService-Info.plist       the simple project's iOS Firebase config
    google-services.json           the simple project's Android Firebase config
    legal/                         개인정보처리방침 · 이용약관 · 계정 삭제 pages (simple site only)
    well-known/                    /.well-known App Links files (simple site only)
  worker/
    install-simple.sh              installs the shared worker as the simple launchd agent
    com.daylie.worker.simple.plist launchd template for that agent
```

The full edition's counterparts stay where they were: `app/.env.production`,
`config/full/`, `worker/launchd/com.trackbyphoto.worker.plist`,
`worker/scripts/install.sh`. The full site ships no legal or well-known files.

## Deploying the simple site

Both builds write `app/dist/`, so build simple **immediately before** the
deploy and never after a full build:

```sh
cd app && npm run build:simple && cd .. \
  && grep -l daylie-simple-4df13 app/dist/assets/*.js >/dev/null \
  && firebase deploy --project simple --account gil4him@gmail.com --only hosting:app
```

Rules, indexes and storage rules are shared files; deploy them to the simple
project with the same `--project simple --account gil4him@gmail.com`.

## The simple worker

```sh
simple/worker/install-simple.sh            # build worker/, copy to ~/daylie-worker-simple, (re)start
simple/worker/install-simple.sh uninstall
```

It needs `~/daylie-secrets/simple/worker.env` (with `EDITION=simple`,
`APP_URL=https://dayliesimple.web.app`, the service-account path, bucket and
state dir) and the service-account key beside it. Re-run the script after any
change under `worker/` — the agent runs a copy.

## Native apps

`npm run native:simple` copies the two Firebase configs from here into the
iOS and Android projects and strips the microphone permission. The committed
state of those native files is **full**: run `npm run native:full` before
committing.
