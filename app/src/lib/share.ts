// Share helpers — bridge from a caregiver tap to the right messaging app.
//
// Three flavors, all surface a *prefilled draft* and require the caregiver to
// hit Send themselves (so this works as consent: no silent auto-sends):
//
//   WhatsApp — `wa.me/<phone>?text=` deep link, recipient pre-bound.
//   SMS      — `sms:<phone>?body=` deep link, recipient pre-bound.
//   Kakao    — Kakao Share SDK; the OS share sheet lets the caregiver pick
//              which friend or chat room to send to (Kakao does not expose
//              "open chat with phone X" to non-business apps).
//
// When we move to production we expect Kakao Notification Talk (알림톡) to
// replace the share sheet for true server→user push — at that point the
// recipient *will* be bound to a specific phone, and these per-row buttons
// stop being the primary delivery path.

import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'
import { Share } from '@capacitor/share'
import type { Memo } from '../types'
import { fmtTime, isSameDay } from '../util'
import { PUBLIC_ORIGIN } from './publicUrl'
import { isSimple } from './edition'
import { inAnyStore } from './storeLinks'
import { honorific } from './people'
import { lang, tr } from './lang'

// ────────────────────────────────────────────────────────────────────────────
// Phone formatting
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strip everything that isn't a digit. UI accepts "010-1234-5678", "010 1234
 * 5678", "+82 10 1234 5678" — we normalize down to bare digits first.
 */
function digitsOnly(phone: string): string {
  return phone.replace(/\D+/g, '')
}

/**
 * Convert a Korean local number to E.164 for wa.me. wa.me requires the
 * country code with no leading '+'. Examples:
 *   "010-1234-5678" → "821012345678"
 *   "01012345678"   → "821012345678"
 *   "+82 10 1234 5678" → "821012345678"
 *   "0212345678"    → "8221234567" (landlines also work)
 * If the phone is already in international format we leave it alone.
 */
export function formatPhoneE164(phone: string): string {
  const d = digitsOnly(phone)
  if (!d) return ''
  if (d.startsWith('82')) return d
  if (d.startsWith('0'))  return '82' + d.slice(1)
  return d
}

// ────────────────────────────────────────────────────────────────────────────
// Daily summary
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the short text that gets sent in the messenger. Format mirrors the
 * prototype's KakaoTalk preview bubble: title line + activity bullets. Keep
 * under ~280 chars so SMS doesn't split.
 *
 *   [엄마의 하루] 오늘의 기록
 *   오늘 4건의 일상이 기록되었어요.
 *   · 오전 9:10 산책 — 한강공원
 *   · 오후 12:30 점심 식사 — 자택
 *   …
 *
 * Returns an empty string if nothing was recorded today, so callers can hide
 * the buttons rather than send a confusing empty message.
 */
export function buildDailySummary(memos: Memo[], patientName: string): string {
  const today = new Date()
  const items = memos
    .filter((m) => m.status === 'ready' && isSameDay(m.takenAt.toDate(), today))
    .slice()
    .sort((a, b) => a.takenAt.toMillis() - b.takenAt.toMillis())
  if (items.length === 0) return ''
  const lines = [
    tr(`[${patientName}의 하루] 오늘의 기록`, `[${patientName}'s day] Today`),
    tr(`오늘 ${items.length}건의 일상이 기록되었어요.`, `${items.length} moment${items.length === 1 ? '' : 's'} recorded today.`),
    ...items.slice(0, 6).map((m) => {
      const t = fmtTime(m.takenAt.toDate())
      const act = m.activity || tr('기록', 'Photo')
      const place = m.place ? ` — ${m.place}` : ''
      return `· ${t} ${act}${place}`
    }),
  ]
  if (items.length > 6) lines.push(tr(`외 ${items.length - 6}건 더`, `and ${items.length - 6} more`))
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// WhatsApp + SMS deep links
// ────────────────────────────────────────────────────────────────────────────

/**
 * Open a WhatsApp chat with the given recipient, prefilled with `text`.
 * wa.me handles desktop + mobile + iOS/Android transparently — on phones it
 * launches the WhatsApp app; on desktop it routes to web.whatsapp.com.
 */
export function openWhatsApp(phone: string, text: string): void {
  const e164 = formatPhoneE164(phone)
  if (!e164) return
  const url = `https://wa.me/${e164}?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Open the OS SMS composer with the given recipient + body. The body=
 * parameter works on iOS (uses `&body=` despite the syntax originally being
 * `sms:N?body=…` — Apple accepts both) and on most Android dialers.
 */
export function openSMS(phone: string, text: string): void {
  const d = digitsOnly(phone)
  if (!d) return
  // We use the phone as-typed (with hyphens stripped) so the native dialer
  // resolves it against the user's contacts when possible.
  const url = `sms:${d}?body=${encodeURIComponent(text)}`
  window.location.href = url
}

// ────────────────────────────────────────────────────────────────────────────
// Kakao Share SDK
// ────────────────────────────────────────────────────────────────────────────

interface KakaoShareSDK {
  init: (key: string) => void
  isInitialized: () => boolean
  Share: {
    sendDefault: (opts: Record<string, unknown>) => void
  }
}
declare global { interface Window { Kakao?: KakaoShareSDK } }

// We pin to a specific SDK version so a Kakao-side push doesn't silently
// change behavior. We deliberately skip SRI: Kakao bumps these files in
// place often enough that hard-coded hashes break in production. Source is
// over HTTPS from kakaocdn.net.
//
// We pull the full bundle (`kakao.min.js`, ~50 KB) rather than the modular
// `kakao.share.min.js` — Kakao only publishes the full bundle at this
// versioned path; the share-only file 404s. Still loads on demand, only
// when the user taps the Kakao button.
const KAKAO_SDK_SRC = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js'

let sdkPromise: Promise<KakaoShareSDK> | null = null

/**
 * Load the Kakao JavaScript SDK on demand (no need to ship 100 KB to every
 * page just because /settings *might* use it). Returns the initialized SDK
 * or throws if the key is missing.
 */
async function loadKakaoSDK(): Promise<KakaoShareSDK> {
  const key = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined
  if (!key) {
    throw new Error('VITE_KAKAO_JS_KEY is not set — register the app at developers.kakao.com and add the JS key to .env.local')
  }
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<KakaoShareSDK>((resolve, reject) => {
    if (window.Kakao?.isInitialized()) return resolve(window.Kakao)
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${KAKAO_SDK_SRC}"]`)
    const ready = () => {
      const sdk = window.Kakao
      if (!sdk) return reject(new Error('Kakao SDK loaded but window.Kakao is undefined'))
      if (!sdk.isInitialized()) sdk.init(key)
      resolve(sdk)
    }
    if (existing) {
      existing.addEventListener('load', ready, { once: true })
      existing.addEventListener('error', () => reject(new Error('Kakao SDK failed to load')), { once: true })
      return
    }
    const s = document.createElement('script')
    s.src = KAKAO_SDK_SRC
    s.async = true
    s.onload = ready
    s.onerror = () => reject(new Error('Kakao SDK failed to load'))
    document.head.appendChild(s)
  })
  return sdkPromise
}

/**
 * Open the KakaoTalk share sheet with a text message + a link back to the app.
 * The caregiver picks which friend or chat room to send to — Kakao does not
 * let third-party apps pre-bind a phone-number recipient.
 *
 * `linkUrl` should match the "사이트 도메인" you registered on Kakao
 * Developers. In our case that's https://trackbyphoto.web.app.
 */
export async function shareToKakao(text: string, linkUrl: string): Promise<void> {
  const sdk = await loadKakaoSDK()
  sdk.Share.sendDefault({
    objectType: 'text',
    text,
    link: {
      mobileWebUrl: linkUrl,
      webUrl: linkUrl,
    },
    buttonTitle: tr('앱에서 보기', 'Open in the app'),
  })
}

/** True when the env was built with a Kakao JS key, so the UI can hide the
 *  button cleanly in environments where Kakao isn't wired up yet. */
export function isKakaoConfigured(): boolean {
  return Boolean(import.meta.env.VITE_KAKAO_JS_KEY)
}

// ────────────────────────────────────────────────────────────────────────────
// 가족초대 — invite link delivery
// ────────────────────────────────────────────────────────────────────────────

// Always the hosted web app of this edition; the link opens in the
// recipient's browser.
export function inviteLink(code: string): string {
  return `${PUBLIC_ORIGIN}/accept?code=${code}`
}

export function buildInviteMessage(patientName: string, code: string): string {
  if (lang === 'en') {
    const name = patientName.trim() || 'Your family'
    return `[Daylie] ${name} invited you to join the family.\nTap the link below to join (good for 24 hours)\n${inviteLink(code)}`
  }
  const who = patientName.trim() || '가족'
  return `[Daylie] ${who}님이 가족으로 초대했어요.\n아래 링크를 눌러 참여해주세요 (24시간 유효)\n${inviteLink(code)}`
}

/**
 * 카카오톡으로 초대. On the website the Kakao SDK opens KakaoTalk's friend
 * picker directly. The native apps can't use it (Kakao only accepts
 * registered web domains, and a WebView origin can't be registered), so they
 * open the OS share sheet, where KakaoTalk is one tap away. Returns 'copied'
 * when neither is available and the message went to the clipboard instead.
 */
export async function shareInviteToKakao(patientName: string, code: string): Promise<'shared' | 'copied'> {
  const text = buildInviteMessage(patientName, code)
  // English accounts never use KakaoTalk: the phone's own share sheet (SMS,
  // iMessage, mail) carries the invitation.
  if (lang !== 'en' && !Capacitor.isNativePlatform() && isKakaoConfigured()) {
    try {
      await shareToKakao(text, inviteLink(code))
      return 'shared'
    } catch (err) {
      console.warn('[invite] Kakao SDK share failed, using the share sheet', err)
    }
  }
  if ((await Share.canShare()).value) {
    try {
      await Share.share({ title: tr('Daylie 가족초대', 'Daylie family invitation'), text, dialogTitle: tr('카카오톡으로 초대', 'Send the invitation') })
    } catch {
      // The user closed the sheet without picking an app; nothing to do.
    }
    return 'shared'
  }
  await navigator.clipboard.writeText(text)
  return 'copied'
}

/** 전화번호로 초대: open the SMS composer with the invite prefilled. */
export function sendInviteSMS(phone: string, patientName: string, code: string): void {
  openSMS(phone, buildInviteMessage(patientName, code))
}

// ────────────────────────────────────────────────────────────────────────────
// 부모님 휴대폰 연결 — pairing link delivery
// ────────────────────────────────────────────────────────────────────────────

export function buildPairMessage(patientName: string, url: string, code: string, hours: number): string {
  if (lang === 'en') {
    const name = honorific(patientName.trim()) || 'your parent'
    const spaced = `${code.slice(0, 4)} ${code.slice(4)}`
    const valid = `good for ${hours} hour${hours === 1 ? '' : 's'}`
    if (isSimple() && !inAnyStore()) {
      // Before the store release the link connects the phone in its browser.
      return [
        `[Daylie] Let's connect ${name}'s phone.`,
        `Tap the link below, then tap 'Connect'. (${valid})`,
        url,
        '',
        `Link code: ${spaced}`,
      ].join('\n')
    }
    if (isSimple()) {
      return [
        `[Daylie] Let's connect ${name}'s phone.`,
        `Tap the link below to install the Daylie app. (${valid})`,
        url,
        'After installing, tap this link once more.',
        '',
        `Link code: ${spaced}`,
        "(Or open the app, tap 'Enter code' and type it in.)",
      ].join('\n')
    }
    return [
      `[Daylie] Let's connect ${name}'s phone.`,
      `Tap the link below, then tap 'Connect'. (${valid})`,
      url,
      `In the app, enter the code ${spaced}.`,
    ].join('\n')
  }
  const who = patientName.trim() || '부모님'
  if (isSimple() && !inAnyStore()) {
    // Before the store release the link connects the phone in its browser.
    return [
      `[Daylie] ${honorific(who)} 휴대폰을 연결해요.`,
      `아래 링크를 누르고 '연결하기'를 눌러주세요. (${hours}시간 유효)`,
      url,
      '',
      `연결 코드: ${code.slice(0, 4)} ${code.slice(4)}`,
    ].join('\n')
  }
  if (isSimple()) {
    // The simple edition is an app from the store: the link page installs it,
    // and a second tap of the same link opens the app and connects.
    return [
      `[Daylie] ${honorific(who)} 휴대폰을 연결해요.`,
      `아래 링크를 눌러 Daylie 앱을 설치해 주세요. (${hours}시간 유효)`,
      url,
      '설치 후 이 링크를 한 번 더 눌러주세요.',
      '',
      `연결 코드: ${code.slice(0, 4)} ${code.slice(4)}`,
      "(직접 넣을 때는 앱에서 '코드 입력'을 눌러 주세요)",
    ].join('\n')
  }
  return [
    `[Daylie] ${honorific(who)} 휴대폰을 연결해요.`,
    `아래 링크를 누르고 '연결하기'를 눌러주세요. (${hours}시간 유효)`,
    url,
    `앱에서는 코드 ${code.slice(0, 4)} ${code.slice(4)} 를 입력하세요.`,
  ].join('\n')
}

/** 링크 복사하기: put the pairing message (link, steps, code) on the clipboard,
 *  to paste into any messenger. The app writes through the native clipboard. */
export async function copyPairMessage(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await Clipboard.write({ string: text })
  else await navigator.clipboard.writeText(text)
}

/** Send the pairing link through KakaoTalk (same paths as 가족초대).
 *  English accounts skip Kakao and use the phone's share sheet (SMS, iMessage). */
export async function sharePairToKakao(text: string, url: string): Promise<'shared' | 'copied'> {
  // English accounts never use KakaoTalk: the phone's own share sheet (SMS,
  // iMessage) carries the link.
  if (lang !== 'en' && !Capacitor.isNativePlatform() && isKakaoConfigured()) {
    try {
      await shareToKakao(text, url)
      return 'shared'
    } catch (err) {
      console.warn('[pair] Kakao SDK share failed, using the share sheet', err)
    }
  }
  if ((await Share.canShare()).value) {
    try {
      await Share.share({ title: tr('Daylie 휴대폰 연결', 'Connect a phone to Daylie'), text, dialogTitle: tr('카카오톡으로 보내기', 'Send the link') })
    } catch {
      // Sheet closed without picking an app.
    }
    return 'shared'
  }
  await navigator.clipboard.writeText(text)
  return 'copied'
}

// ────────────────────────────────────────────────────────────────────────────
// 부모님 앱 업데이트 — the store link, for a phone that can't get the notice
// ────────────────────────────────────────────────────────────────────────────

export function buildStoreLinkMessage(patientName: string, url: string): string {
  if (lang === 'en') {
    const name = honorific(patientName.trim()) || 'your parent'
    return `[Daylie] Please update the Daylie app on ${name}'s phone.\n${url}`
  }
  const who = patientName.trim() || '부모님'
  return `[Daylie] ${honorific(who)} 휴대폰의 Daylie 앱을 업데이트해 주세요.\n${url}`
}

/** 링크 보내기: the store link through KakaoTalk or the share sheet (same
 *  paths as the pairing link); 'copied' when it went to the clipboard. */
export async function shareStoreLink(patientName: string, url: string): Promise<'shared' | 'copied'> {
  const text = buildStoreLinkMessage(patientName, url)
  if (lang !== 'en' && !Capacitor.isNativePlatform() && isKakaoConfigured()) {
    try {
      await shareToKakao(text, url)
      return 'shared'
    } catch (err) {
      console.warn('[update] Kakao SDK share failed, using the share sheet', err)
    }
  }
  if ((await Share.canShare()).value) {
    try {
      await Share.share({ title: tr('Daylie 앱 업데이트', 'Update the Daylie app'), text, dialogTitle: tr('링크 보내기', 'Send the link') })
    } catch {
      // Sheet closed without picking an app.
    }
    return 'shared'
  }
  await copyPairMessage(text)
  return 'copied'
}
