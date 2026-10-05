// A parent's linked phone and its device record (users/{uid}/devices/{id}).

/**
 * What a snapshot of this phone's device record says: unlinked (true), still
 * linked (false), or nothing yet (null). With no connection, or a slow one,
 * the first answer comes from the phone's own empty cache and says "no such
 * record"; that is not the family unlinking the phone, so it is not believed
 * until the server has answered.
 */
export function unlinkedFrom(snap: { exists(): boolean; data(): { status?: unknown } | undefined; metadata: { fromCache: boolean } }): boolean | null {
  if (snap.exists() && snap.data()?.status === 'active') return false
  return snap.metadata.fromCache ? null : true
}
