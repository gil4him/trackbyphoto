export function fmtDate(d: Date): string {
  const m = d.getMonth() + 1, day = d.getDate()
  const wk = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${m}월 ${day}일 (${wk})`
}

export function fmtTime(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h < 12 ? '오전' : '오후'
  h = h % 12; if (h === 0) h = 12
  return `${ampm} ${h}:${m}`
}

export function greeting(name: string): string {
  const hr = new Date().getHours()
  const g = hr < 11 ? '좋은 아침이에요' : hr < 18 ? '좋은 오후예요' : '편안한 저녁이에요'
  return `${g}, ${name}님`
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}
