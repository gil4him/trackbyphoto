/** Which product this build is: the full model or the camera-first simple
 *  core (docs/Daylie-v3-Simple-Core.md). Set at build time by VITE_EDITION —
 *  `npm run build:simple` reads .env.simple; anything else is full. */
export type Edition = 'full' | 'simple'

export const EDITION: Edition =
  import.meta.env.VITE_EDITION === 'simple' ? 'simple' : 'full'

export function isSimple(): boolean {
  return EDITION === 'simple'
}
