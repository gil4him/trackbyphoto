import { useEffect, useRef, useState } from 'react'
import type { UserSettings } from '../types'
import { useToast } from './Toast'
import { SectLab } from './SectLab'
import { isWorkerOffline, WORKER_OFFLINE_MESSAGE } from '../lib/worker'
import { searchAddress, type AddressCandidate } from '../lib/location'
import { AUTO_SEARCH_MS, autoSearchable } from '../lib/homePlaces'

type Home = NonNullable<UserSettings['home']>

interface Props {
  home: UserSettings['home']
  /** Whose home it is: the worker names places in their language. */
  patientUid: string
  onChange: (home: Home | null) => void
  /** The section label; the simple edition's parent section shows a sub-label instead. */
  heading?: 'section' | 'sub'
}

/**
 * 설정 → 집 위치: one address box. It shows the saved address; typing looks
 * the places up as you pause, and tapping one saves it. Emptying the box
 * clears the home, so the app goes back to guessing it from the photos.
 */
export function HomePicker({ home, patientUid, onChange, heading = 'section' }: Props) {
  const toast = useToast()

  // While the box has focus it holds what is being typed; otherwise it shows
  // the saved address, so a save elsewhere never fights the typing.
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [found, setFound] = useState<AddressCandidate[] | null>(null)
  // Only the newest search may show its answer: an older, slower one would
  // otherwise replace what matches the text now in the box.
  const seq = useRef(0)
  const shown = editing ? query : (home?.label ?? '')

  const find = async (auto = false) => {
    const q = query.trim()
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
    setQuery(q)
    // Too short to look up: drop the old answer and any search still out.
    if (!autoSearchable(q)) { seq.current++; setSearching(false); setFound(null) }
  }
  // Look the places up once typing pauses.
  useEffect(() => {
    if (!editing || !autoSearchable(query)) return
    const t = setTimeout(() => { void find(true) }, AUTO_SEARCH_MS)
    return () => clearTimeout(t)
    // find reads query, the only input that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, editing])

  const pick = (c: AddressCandidate) => {
    seq.current++
    onChange(c)
    setFound(null)
    setSearching(false)
    setEditing(false)
    toast.show('집 위치를 저장했어요')
  }
  const onFocus = () => { setQuery(home?.label ?? ''); setEditing(true) }
  const onBlur = () => {
    // Leaving the box empty forgets the home; leaving typed text that was
    // never picked keeps the saved one.
    if (home && !query.trim()) { onChange(null); toast.show('집 위치를 지웠어요', '사진을 가장 자주 찍는 곳을 집으로 봐요') }
    seq.current++
    setSearching(false)
    setEditing(false)
    setFound(null)
  }

  const info = '집에서 멀리 있을 때 찍은 사진은 여행·출장으로 기록해요. 비워 두면 사진을 가장 자주 찍는 곳을 집으로 봐요. 주소나 건물 이름을 적으면 찾아 드리고, 앞으로 찍는 사진부터 적용돼요.'
  return (
    <>
      {heading === 'section'
        ? <SectLab info={info}>집 위치</SectLab>
        : <div className="sub-lab">집 위치</div>}
      <div className="home-search">
        <input
          value={shown}
          maxLength={100}
          placeholder="예: 서초대로 1, 350 5th Ave New York"
          aria-label="주소나 건물 이름"
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void find() }}
        />
      </div>
      {editing && searching && !found && <div className="help">찾는 중…</div>}
      {editing && found && (found.length === 0
        ? <div className="help">찾은 곳이 없어요. 다르게 적어 보세요.</div>
        : (
          <div className="name-chips">
            {/* onMouseDown: a tap must land before the box blurs and drops the list. */}
            {found.map((c) => (
              <button key={`${c.lat},${c.lng}`} className="name-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>{c.label}</button>
            ))}
          </div>
        ))}
    </>
  )
}
