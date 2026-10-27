import type { GeoLang } from './types'
import { lang } from './lib/lang'

// Dates and times in the screens' language. Korean stays hand-made (exactly
// as before); English goes through Intl.
const EN_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const EN_TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const EN_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const EN_MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
const EN_MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export function fmtDate(d: Date): string {
  if (lang === 'en') return EN_DATE.format(d)
  const m = d.getMonth() + 1, day = d.getDate()
  const wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${m}월 ${day}일 (${wk})`
}

export function fmtTime(d: Date): string {
  if (lang === 'en') return EN_TIME.format(d)
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h < 12 ? '오전' : '오후'
  h = h % 12; if (h === 0) h = 12
  return `${ampm} ${h}:${m}`
}

/** The language a new account starts in: the one its screens are in
 *  (lib/lang.ts), so a family reading Korean screens gets Korean place names
 *  and diaries, and an English one English. 설정 → 언어 can switch it. */
export function deviceGeoLang(): GeoLang {
  return lang
}

export function greeting(name: string): string {
  const hr = new Date().getHours()
  if (lang === 'en') return `${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${name}`
  const g = hr < 11 ? '좋은 아침이에요' : hr < 18 ? '좋은 오후예요' : '편안한 저녁이에요'
  return `${g}, ${name}님`
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}

// Apple-Mail-style section label for a date: 오늘 / 어제 / weekday within the
// past week / explicit date (with year only when it's not the current year).
export function relativeDateLabel(d: Date): string {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const now = new Date()
  const diffDays = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86_400_000)
  if (lang === 'en') {
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays >= 2 && diffDays <= 6) return EN_WEEKDAY.format(d)
    return (d.getFullYear() === now.getFullYear() ? EN_MONTH_DAY : EN_MONTH_DAY_YEAR).format(d)
  }
  if (diffDays === 0) return '오늘'
  if (diffDays === 1) return '어제'
  if (diffDays >= 2 && diffDays <= 6) {
    return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()] + '요일'
  }
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** A day's heading in the photo lists: 오늘 · 10월 24일 (토), 어제 · 10월 23일 (금),
 *  then the date alone (with the year when it isn't this year). */
export function dayHeading(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(now) - start(d)) / 86_400_000)
  if (lang === 'en') {
    const date = `${EN_DATE.format(d)}${d.getFullYear() === now.getFullYear() ? '' : `, ${d.getFullYear()}`}`
    return diff === 0 ? `Today · ${date}` : diff === 1 ? `Yesterday · ${date}` : date
  }
  const date = `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}년 `}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`
  return diff === 0 ? `오늘 · ${date}` : diff === 1 ? `어제 · ${date}` : date
}

/** The day a picked date lands on: that day if it has photos, else the
 *  nearest earlier one, else the oldest. `days` are newest first. */
export function landingDay(days: Date[], picked: Date): Date | null {
  if (days.length === 0) return null
  const end = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate() + 1).getTime()
  return days.find((d) => d.getTime() < end) ?? days[days.length - 1]
}


/** `2026-10-24`: a day as a date field's value. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
