// 대시보드 — how many people, what needs attention, what the admin did lately.

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../../firebase'
import { actionLabel, personFlags, summarize, type AdminLogRow, type AdminPerson, type AdminTab } from '../../lib/admin'
import { fmtDate, fmtTime } from '../../util'
import { Empty, PersonChip, Section, Stat } from './ui'

interface DailyDoc { id: string; memos?: number }

const DAY_MS = 24 * 3600 * 1000

export function OverviewTab({ people, loading, onOpen, onTab }: {
  people: AdminPerson[]
  loading: boolean
  onOpen: (uid: string) => void
  onTab: (tab: AdminTab) => void
}) {
  const [daily, setDaily] = useState<DailyDoc[]>([])
  const [log, setLog] = useState<AdminLogRow[]>([])

  // Photos today / this week, from the worker's daily rollups.
  useEffect(() => {
    let cancelled = false
    getDocs(query(collection(db, 'admin_daily'), orderBy('date', 'desc'), limit(7)))
      .then((snap) => { if (!cancelled) setDaily(snap.docs.map((d) => ({ ...(d.data() as DailyDoc), id: d.id }))) })
      .catch((err) => console.error('[admin] daily read', err))
    return () => { cancelled = true }
  }, [])

  // What the admin did, live — the only record that outlives a deleted account.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'admin_log'), orderBy('timestamp', 'desc'), limit(20)),
      (snap) => setLog(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminLogRow, 'id'>) }))),
      (err) => console.error('[admin] log subscribe', err),
    )
    return () => unsub()
  }, [])

  // Fixed for this mount: "recent" doesn't need to tick.
  const [now] = useState(() => Date.now())
  const parents = people.filter((p) => p.kind === 'parent')
  const children = people.filter((p) => p.kind === 'child' && !p.isAdmin)
  const phones = parents.reduce((n, p) => n + p.devices.active, 0)
  const activeChildren = children.filter((p) => p.lastSignInAt && now - new Date(p.lastSignInAt).getTime() < 7 * DAY_MS).length
  const activeParents = parents.filter((p) => p.memos.lastAt && now - new Date(p.memos.lastAt).getTime() < 7 * DAY_MS).length
  const todayKey = new Date(now).toISOString().slice(0, 10)
  const today = daily.find((d) => d.id === todayKey)?.memos ?? 0
  const week = daily.reduce((s, d) => s + (d.memos ?? 0), 0)

  const attention = useMemo(() => people.filter((p) => personFlags(p).some((f) => f.tone !== 'info')), [people])
  const newest = useMemo(
    () => [...people].filter((p) => !p.isAdmin).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).slice(0, 6),
    [people],
  )

  const dash = loading && people.length === 0 ? '…' : undefined

  return (
    <div>
      <section className="admin-grid">
        <Stat label="부모님" value={dash ?? parents.length} sub={`최근 7일 사진 있음 ${activeParents}명`} onClick={() => onTab('parents')} />
        <Stat label="가족" value={dash ?? children.length} sub={`최근 7일 로그인 ${activeChildren}명`} onClick={() => onTab('children')} />
        <Stat label="연결된 휴대폰" value={dash ?? phones} sub={`${parents.filter((p) => p.devices.active === 0).length}명 미연결`} />
        <Stat label="오늘 사진" value={today} sub={`최근 7일 ${week}장`} />
        <Stat label="확인 필요" value={dash ?? attention.length} sub="대표 가족 없음 · 휴대폰 미연결 · 차단" />
      </section>

      <div className="admin-two-col">
        <Section title="확인 필요">
          {attention.length === 0
            ? <Empty>모두 정상이에요.</Empty>
            : <div className="admin-chips">{attention.slice(0, 12).map((p) => <PersonChip key={p.uid} person={p} onOpen={onOpen} />)}</div>}
        </Section>

        <Section title="최근 가입">
          {newest.length === 0
            ? <Empty>아직 아무도 없어요.</Empty>
            : <div className="admin-chips">{newest.map((p) => <PersonChip key={p.uid} person={p} onOpen={onOpen} />)}</div>}
        </Section>
      </div>

      <Section title="관리자 작업 기록">
        {log.length === 0 ? <Empty>아직 기록이 없어요.</Empty> : (
          <table className="admin-table">
            <thead><tr><th>시각</th><th>작업</th><th>대상</th><th>내용</th></tr></thead>
            <tbody>
              {log.map((r) => {
                const when = r.timestamp?.toDate?.()
                return (
                  <tr key={r.id}>
                    <td className="nowrap">{when ? `${fmtDate(when)} ${fmtTime(when)}` : '—'}</td>
                    <td className="nowrap">{actionLabel(r.action)}</td>
                    <td>
                      <button type="button" className="admin-linkbtn" onClick={() => onOpen(r.targetUid)}>{r.targetName || r.targetUid}</button>
                    </td>
                    <td className="muted admin-details">{summarize(r.details)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}
