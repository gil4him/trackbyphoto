// 부모님 / 가족 — everyone of one kind, searchable, one row each.

import { useMemo, useState } from 'react'
import {
  KIND_KO, PROVIDER_KO, fmtAgo, matchesQuery, sortPeople,
  type AdminPerson, type PeopleSort, type PersonKind,
} from '../../lib/admin'
import { TIER_NAME } from '../../lib/plan'
import { Empty, Flags } from './ui'

const SORT_KO: Record<PeopleSort, string> = { recent: '최근 활동', created: '가입일', name: '이름' }

export function PeopleTab({ kind, people, loading, onOpen }: {
  kind: PersonKind
  people: AdminPerson[]
  loading: boolean
  onOpen: (uid: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PeopleSort>('recent')
  const [onlyFlagged, setOnlyFlagged] = useState(false)

  const rows = useMemo(() => {
    const ofKind = people.filter((p) => p.kind === kind && matchesQuery(p, query))
    const flagged = onlyFlagged
      ? ofKind.filter((p) => p.disabled || (kind === 'parent' ? p.links.guardians === 0 || p.devices.active === 0 : p.links.active === 0 && !p.isAdmin))
      : ofKind
    return sortPeople(flagged, sort)
  }, [people, kind, query, sort, onlyFlagged])

  const total = people.filter((p) => p.kind === kind).length

  return (
    <div className="admin-people">
      <div className="admin-toolbar">
        <input
          type="search"
          className="admin-search"
          placeholder={kind === 'parent' ? '이름 또는 uid 검색' : '이름, 이메일 또는 uid 검색'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="admin-select" value={sort} onChange={(e) => setSort(e.target.value as PeopleSort)} aria-label="정렬">
          {(Object.keys(SORT_KO) as PeopleSort[]).map((k) => <option key={k} value={k}>{SORT_KO[k]}순</option>)}
        </select>
        <label className="admin-check">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          확인 필요만
        </label>
        <span className="muted admin-count">{`${rows.length} / ${total}명`}</span>
      </div>

      {loading && people.length === 0 ? (
        <Empty>불러오는 중…</Empty>
      ) : rows.length === 0 ? (
        <Empty>{total === 0 ? `아직 ${KIND_KO[kind]} 계정이 없어요.` : '검색 결과가 없어요.'}</Empty>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table admin-people-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>{kind === 'parent' ? '휴대폰' : '로그인'}</th>
                <th>{kind === 'parent' ? '가족' : '부모님'}</th>
                <th>요금제</th>
                <th>사진</th>
                <th>{kind === 'parent' ? '마지막 사진' : '마지막 로그인'}</th>
                <th>가입</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.uid} className="admin-row-link" onClick={() => onOpen(p.uid)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.uid) }}>
                  <td>
                    <div className="admin-cell-name">{p.name}</div>
                    <div className="admin-cell-sub">{p.email ?? p.uid.slice(0, 10) + '…'}</div>
                  </td>
                  <td>
                    {kind === 'parent'
                      ? (p.devices.active > 0 ? `연결 ${p.devices.active}대` : <span className="muted">없음</span>)
                      : (p.providers.map((v) => PROVIDER_KO[v] ?? v).join(', ') || <span className="muted">—</span>)}
                  </td>
                  <td>
                    {kind === 'parent'
                      ? <>{p.links.active}명 <span className="muted">(대표 {p.links.guardians})</span></>
                      : <>{p.links.active}명 <span className="muted">(대표 {p.links.guardians})</span></>}
                  </td>
                  <td>{p.plan.explicit ? TIER_NAME[p.plan.tier] : <span className="muted">{TIER_NAME.free}</span>}</td>
                  <td>{p.memos.count.toLocaleString('ko-KR')}</td>
                  <td title={kind === 'parent' ? p.memos.lastAt ?? '' : p.lastSignInAt ?? ''}>
                    {fmtAgo(kind === 'parent' ? p.memos.lastAt : p.lastSignInAt)}
                  </td>
                  <td title={p.createdAt ?? ''}>{fmtAgo(p.createdAt)}</td>
                  <td><div className="admin-flags"><Flags person={p} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
