// The hosted web app of this edition (VITE_PUBLIC_URL), without a trailing
// slash. Links that leave the phone — invites, pairing — point here: the
// native apps run on capacitor://localhost / https://localhost, which mean
// nothing on the recipient's phone.
export const PUBLIC_ORIGIN = (
  (import.meta.env.VITE_PUBLIC_URL as string | undefined) || 'https://trackbyphoto.web.app'
).replace(/\/+$/, '')
