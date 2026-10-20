import { useEffect, useRef, useState } from 'react'
import type { Memo, UserSettings } from '../types'
import { useToast } from './Toast'
import { SectLab } from './SectLab'
import { isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { getGeo, searchAddress, type AddressCandidate } from '../lib/location'
import { AUTO_SEARCH_MS, autoSearchable, recentPlacesOf } from '../lib/homePlaces'

type Home = NonNullable<UserSettings['home']>

interface Props {
  home: UserSettings['home']
  memos: Memo[]
  /** Whose home it is: the worker names places in their language. */
  patientUid: string
  onChange: (home: Home | null) => void
  /** "지금 있는 곳을 집으로 설정": only on one's own phone. */
  allowCurrentLocation?: boolean
  /** The section label; the simple edition shows a sub-label instead. */
  heading?: 'section' | 'sub'
}

/**
 * 설정 → 집 위치: pick from places recent photos were taken (works for family
 * setting it up remotely), type an address and pick from what comes up as
 * you type, or use this phone's location on one's own account.
 */
export function HomePicker({ home, memos, patientUid, onChange, allowCurrentLocation = false, heading = 'section' }: Props) {
  const toast = useToast()
  const recentPlaces = recentPlacesOf(memos)

  const [locating, setLocating] = useState(false)
  const useCurrentAsHome = async () => {
    setLocating(true)
    const geo = await getGeo()
    setLocating(false)
    if (!geo) { toast.show('위치를 확인하지 못했어요', '위치 권한을 확인해 주세요'); return }
    onChange({ ...geo, label: '직접 설정한 위치' })
    toast.show('집 위치를 저장했어요')
  }

  const [homeQuery, setHomeQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<AddressCandidate[] | null>(null)
  // Only the newest search may show its answer: an older, slower one would
  // otherwise replace what matches the text now in the box.
  const seq = useRef(0)
  const findHome = async (auto = false) => {
    const q = homeQuery.trim()
    if (!q) return
    const mine = ++seq.current
    setSearching(true)
    try {
      const got = await searchAddress(q, patientUid, auto)
      if (mine === seq.current) setFound(got)
    } catch (err) {
      console.error('[home] address search failed', err)
      // Typing on is the usual answer to a failed lookup while typing; only
      // a search someone asked for says so.
      if (mine === seq.current && !auto) {
        toast.show('주소를 찾지 못했어요', isWorkerOffline(err) ? WORKER_OFFLINE_MESSAGE : '잠시 후 다시 시도해 주세요')
      }
    } finally {
      if (mine === seq.current) setSearching(false)
    }
  }
  const onType = (q: string) => {
    setHomeQuery(q)
    // Too short to look up: drop the old answer and any search still out.
    if (!autoSearchable(q)) { seq.current++; setSearching(false); setFound(null) }
  }
  // Look the places up once typing pauses.
  useEffect(() => {
    if (!autoSearchable(homeQuery)) return
    const t = setTimeout(() => { void findHome(true) }, AUTO_SEARCH_MS)
    return () => clearTimeout(t)
    // findHome reads homeQuery, the only input that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeQuery])
  const pickHome = (c: AddressCandidate) => {
    seq.current++
    onChange(c)
    setFound(null)
    setHomeQuery('')
    setSearching(false)
    toast.show('집 위치를 저장했어요')
  }

  const info = '집에서 멀리 있을 때 찍은 사진은 여행·출장으로 기록해요. 정하지 않으면 사진을 가장 자주 찍는 곳을 집으로 봐요. 주소나 건물 이름으로 찾을 수도 있고, 앞으로 찍는 사진부터 적용돼요.'
  return (
    <>
      {heading === 'section'
        ? <SectLab info={info}>집 위치</SectLab>
        : <div className="sub-lab">집 위치</div>}
      <div className="row">
        <div className="who">
          <b>{home ? home.label : '자동으로 추정해요'}</b>
        </div>
        {home && <button className="signout-btn" onClick={() => onChange(null)}>지우기</button>}
      </div>
      {recentPlaces.length > 0 && (
        <>
          <div className="help">최근 사진을 찍은 곳 중에 집이 있으면 골라 주세요.</div>
          <div className="name-chips">
            {recentPlaces.map((p) => (
              <button
                key={p.label}
                className={`name-chip ${home?.label === p.label ? 'on' : ''}`}
                onClick={() => onChange(p)}
              >{p.label}</button>
            ))}
          </div>
        </>
      )}
      <div className="home-search">
        <input
          value={homeQuery}
          maxLength={100}
          placeholder="예: 서초대로 1, 350 5th Ave New York"
          aria-label="주소나 건물 이름"
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void findHome() }}
        />
        <button className="signout-btn" disabled={searching || !homeQuery.trim()} onClick={() => void findHome()}>
          {searching ? '찾는 중…' : '주소로 찾기'}
        </button>
      </div>
      {found && (found.length === 0
        ? <div className="help">찾은 곳이 없어요. 다르게 적어 보세요.</div>
        : (
          <div className="name-chips">
            {found.map((c) => (
              <button key={`${c.lat},${c.lng}`} className="name-chip" onClick={() => pickHome(c)}>{c.label}</button>
            ))}
          </div>
        ))}
      {allowCurrentLocation && (
        <button className="linkbtn" disabled={locating} onClick={useCurrentAsHome}>
          <span>{locating ? '위치 확인 중…' : '지금 있는 곳을 집으로 설정'}</span>
          <span aria-hidden="true">→</span>
        </button>
      )}
    </>
  )
}
