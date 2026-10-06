// Plain links to files in Storage, for <img src> with no auth header: the
// Firebase download URL, which bypasses Storage rules when its token matches
// one in the file's metadata (the web SDK's uploads carry one; the worker
// mints one otherwise).

import { getStorage } from 'firebase-admin/storage'

export async function downloadLink(photoPath: string): Promise<string | null> {
  const bucket = getStorage().bucket()
  const file = bucket.file(photoPath)
  const [exists] = await file.exists()
  if (!exists) return null
  const [meta] = await file.getMetadata()
  let token = (meta.metadata as Record<string, string> | undefined)?.firebaseStorageDownloadTokens?.split(',')[0]
  if (!token) {
    token = crypto.randomUUID()
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
  }
  // Against the local emulator (tests), a link the browser can actually open.
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const origin = host ? `http://${host.replace(/^https?:\/\//, '')}` : 'https://firebasestorage.googleapis.com'
  return `${origin}/v0/b/${bucket.name}/o/${encodeURIComponent(photoPath)}?alt=media&token=${token}`
}
