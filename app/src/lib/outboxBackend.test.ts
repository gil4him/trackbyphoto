import { describe, it, expect, vi, beforeEach } from 'vitest'

// A stand-in for the SDK's upload task: the test moves bytes and ends it.
const task = vi.hoisted(() => ({
  listener: null as null | ((snap: { bytesTransferred: number }) => void),
  settle: null as null | { resolve: () => void; reject: (err: Error) => void },
  cancelled: false,
  sent: null as null | { path: string; size: number; contentType?: string },
}))

vi.mock('../firebase', () => ({ db: {}, storage: {} }))
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({ path }),
  uploadBytesResumable: (ref: { path: string }, bytes: Uint8Array, metadata: { contentType?: string }) => {
    task.sent = { path: ref.path, size: bytes.byteLength, contentType: metadata.contentType }
    const done = new Promise<void>((resolve, reject) => { task.settle = { resolve, reject } })
    return {
      on: (_event: string, next: (snap: { bytesTransferred: number }) => void) => { task.listener = next; return () => { task.listener = null } },
      cancel: () => { task.cancelled = true; task.settle?.reject(new Error('storage/canceled')); return true },
      then: done.then.bind(done),
    }
  },
}))

import { sendFile } from './outboxBackend'

const blob = new Blob(['0123456789'], { type: 'image/jpeg' })
const soon = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  task.listener = null
  task.settle = null
  task.cancelled = false
  task.sent = null
})

describe('sendFile', () => {
  it('uploads the bytes and tells the outbox each time some have moved', async () => {
    const watch = { progress: vi.fn(), signal: new AbortController().signal }
    const done = sendFile('photos/u1/a.jpg', blob, { contentType: 'image/jpeg' }, watch)
    await soon()
    expect(task.sent).toEqual({ path: 'photos/u1/a.jpg', size: 10, contentType: 'image/jpeg' })
    task.listener?.({ bytesTransferred: 0 })
    task.listener?.({ bytesTransferred: 0 }) // a state change with no bytes moved is not progress
    task.listener?.({ bytesTransferred: 6 })
    expect(watch.progress).toHaveBeenCalledTimes(2)
    task.settle?.resolve()
    await expect(done).resolves.toBeUndefined()
  })

  it('cancels the upload when the outbox gives up on it', async () => {
    const abort = new AbortController()
    const done = sendFile('photos/u1/a.jpg', blob, { contentType: 'image/jpeg' }, { progress: () => {}, signal: abort.signal })
    await soon()
    abort.abort()
    await expect(done).rejects.toThrow('storage/canceled')
    expect(task.cancelled).toBe(true)
  })

  it('fails by name on a file the phone can no longer read', async () => {
    const unreadable = { type: 'image/jpeg', arrayBuffer: async () => { throw new DOMException('gone', 'NotReadableError') } } as unknown as Blob
    await expect(sendFile('photos/u1/a.jpg', unreadable, {}, { progress: () => {}, signal: new AbortController().signal }))
      .rejects.toMatchObject({ name: 'NotReadableError' })
    expect(task.sent).toBeNull()
  })
})
