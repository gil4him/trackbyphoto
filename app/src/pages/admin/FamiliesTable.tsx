// 가족 — one row per family (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D4): the
// parent, who looks after them, a status pill (third, so a phone sees it
// without scrolling the table), plan, phone and photos, with
// the chips 전체 · 3일 사진 없음 · 휴대폰 미연결 · 가족 한도 · 차단, a search and
// a sort. A row opens the person (PersonDetail, unchanged), where every
// admin action stays. The table scrolls sideways inside its card.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fmtAgo, familyCount, type AdminPerson, type FamilyFilter } from '../../lib/admin'
import { FILTERS, FILTER_KO, SORT_KO, familyRows, filterRows, sortRows, type FamilySort } from '../../lib/adminFamilies'
import { fmtN } from '../../lib/adminToday'
import { TIER_NAME } from '../../lib/plan'
import { loadPlans } from '../../lib/plans'
import type { Plans } from '../../types'

export function FamiliesTable({ people, loading, failed = false, filter, onFilter, onOpen, switcher }: {
  people: AdminPerson[]
  loading: boolean
  /** The people list could not be read: say so, not "nobody yet". */
  failed?: boolean
  filter: FamilyFilter
  onFilter: (f: FamilyFilter) => void
  onOpen: (uid: string) => void
  /** 가족별 | 가족 계정, beside the title. */
  switcher?: ReactNode
}) {
  const [plans, setPlans] = useState<Plans | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FamilySort>('status')

  useEffect(() => {
    let cancelled = false
    loadPlans().then((p) => { if (!cancelled) setPlans(p) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => familyRows(people, plans), [people, plans])
  const shown = useMemo(() => sortRows(filterRows(rows, people, filter, query), sort), [rows, people, filter, query, sort])
  const parents = rows.length
  const members = people.filter((p) => p.kind === 'child' && !p.isAdmin).length

  return (
    <div className="hq-families">
      <div className="hq-vhead">
        <div className="hq-vhead-t">
          <small>{loading && !people.length ? '불러오는 중' : failed ? '목록 없음' : `부모님 ${fmtN(parents)}분 · 가족 ${fmtN(members)}명`}</small>
          <h1>{(loading && !people.length) || failed ? '가족' : `가족 ${fmtN(familyCount(people))}곳`}</h1>
        </div>
        {switcher}
      </div>

      <div className="hq-filters" role="group" aria-label="필터">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => onFilter(f)}>
            {`${FILTER_KO[f]} ${fmtN(rows.filter((r) => r.flags.has(f)).length)}`}
          </button>
        ))}
        <div className="hq-filters-end">
          <input className="hq-search" type="search" placeholder="이름, 이메일, uid로 찾기" aria-label="가족 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="hq-select" value={sort} onChange={(e) => setSort(e.target.value as FamilySort)} aria-label="정렬">
            {(Object.keys(SORT_KO) as FamilySort[]).map((k) => <option key={k} value={k}>{`${SORT_KO[k]}순`}</option>)}
          </select>
        </div>
      </div>

      <section className="hq-card" aria-busy={loading && !people.length}>
        {loading && !people.length ? <div className="hq-skel" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div>
          : failed ? <div className="hq-empty">목록을 불러오지 못했어요. 서버가 돌아오면 새로고침해 주세요.</div>
            : parents === 0 ? <div className="hq-empty">아직 등록된 부모님이 없어요.</div>
            : shown.length === 0 ? <div className="hq-empty">맞는 가족이 없어요.</div>
              : (
                <div className="hq-tbl">
                  <table>
                    <thead>
                      <tr><th>가족</th><th>부모님</th><th>상태</th><th>가족 수</th><th>플랜</th><th>휴대폰</th><th>사진</th><th>마지막 사진</th><th>등록</th></tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.uid} tabIndex={0} onClick={() => onOpen(r.uid)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.uid) } }}
                          aria-label={`${r.family} ${r.parent} 열기`}>
                          <td><b>{r.family}</b></td>
                          <td>{r.parent}</td>
                          <td><span className={`hq-tag t-${r.status.tone}`}>{r.status.label}</span></td>
                          <td className="num">{r.limit !== null ? `${r.familyCount}/${r.limit}` : r.familyCount}<span className="muted">{` · 대표 ${r.guardians}`}</span></td>
                          <td><span className={`hq-plan${r.explicitPlan ? '' : ' dim'}`}>{TIER_NAME[r.tier]}</span></td>
                          <td>{r.phone}</td>
                          <td className="num">{fmtN(r.photos)}</td>
                          <td className="num" title={r.lastPhotoAt ?? ''}>{fmtAgo(r.lastPhotoAt)}</td>
                          <td className="num" title={r.createdAt ?? ''}>{fmtAgo(r.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </section>
      <p className="hq-note">행을 누르면 사람 상세로 가요. 휴대폰 연결 해제, 플랜 변경, 차단, 삭제는 거기서 해요.</p>
    </div>
  )
}
