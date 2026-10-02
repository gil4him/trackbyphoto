# TrackByPhoto Mac mini worker

Runs all of TrackByPhoto's server work on the Mac mini. There are no Cloud Functions.

| Firestore listener | Replaces | What it does |
|---|---|---|
| `memos` where `status == 'pending'` | `onPhotoUploaded` | Writes the photo memo with the local Ollama vision model (`gemma4:e4b`), notifies caregivers, and bumps the dashboard counters |
| `requests` where `status == 'pending'` | every HTTPS callable | Handles invites, accepting invites, revoking access, role changes, name sync, `regenerateMemo` and the backfills |
| `users` (all changes) | `onUserSettingsChanged` | Writes a settings-change audit log entry and notifies the elder |

The worker only makes outbound connections. Ollama stays on `localhost`. When the Mac mini is offline, memos stay "메모 작성 중…" and requests time out on the client with "서버가 잠시 오프라인이에요". When the worker comes back, it processes everything that queued while it was down.

## One-time setup

1. **Service account** (least privilege, not Editor):

   ```sh
   gcloud iam service-accounts create trackbyphoto-worker --project trackbyphoto-app \
     --display-name "TrackByPhoto Mac mini worker"
   SA=trackbyphoto-worker@trackbyphoto-app.iam.gserviceaccount.com
   gcloud projects add-iam-policy-binding trackbyphoto-app \
     --member "serviceAccount:$SA" --role roles/datastore.user
   gcloud storage buckets add-iam-policy-binding gs://trackbyphoto-app.firebasestorage.app \
     --member "serviceAccount:$SA" --role roles/storage.objectAdmin
   mkdir -p ~/.trackbyphoto
   gcloud iam service-accounts keys create ~/.trackbyphoto/sa-key.json --iam-account "$SA"
   chmod 600 ~/.trackbyphoto/sa-key.json
   ```

   The key lives only in `~/.trackbyphoto/`. Never commit it.

2. **Optional settings** go in `~/.trackbyphoto/worker.env`:

   ```sh
   KAKAO_REST_KEY=...          # better Korean place names (else OpenStreetMap)
   # OLLAMA_MODEL=gemma4:e4b   # default model when admin_config doesn't pick one
   ```

3. **Install** the worker as a launchd agent. It starts at login and restarts automatically if it exits:

   ```sh
   cd worker && ./scripts/install.sh
   tail -f ~/Library/Logs/trackbyphoto-worker.log
   ```

   To update, re-run `install.sh` after pulling. To remove, run `./scripts/install.sh uninstall`.

## Development

```sh
npm test                                   # handler + pipeline tests on the Firestore emulator (needs Java)
npm run probe -- photo.jpg [model] [HH:MM] [place]   # try the memo prompt on a photo, no Firebase
```

To run the worker against the local emulators (no key needed):

```sh
firebase emulators:start --only firestore,storage,auth --project demo-trackbyphoto
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
GCLOUD_PROJECT=demo-trackbyphoto FIREBASE_STORAGE_BUCKET=demo-trackbyphoto.appspot.com \
  npm run dev
```

## Adding a model

1. Run `ollama pull <model>`. The model must support vision (check with `ollama show <model>`).
2. Add it to `LOCAL_MODELS` in `src/llm/ollama.ts`.
3. Add it to `MODELS` in `app/src/pages/SuperAdmin.tsx`.
4. Pick it on `/superadmin`. The worker switches within about a minute.
