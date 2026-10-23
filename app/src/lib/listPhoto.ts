// Lists show the small copy of a photo (worker thumbs.ts) and only a
// photo's own page loads the full one. Photos from before thumbnails, or
// whose thumbnail failed, fall back to the full photo.

export function listPhoto(p: { thumbUrl?: string; photoUrl?: string }): string {
  return p.thumbUrl || p.photoUrl || ''
}
