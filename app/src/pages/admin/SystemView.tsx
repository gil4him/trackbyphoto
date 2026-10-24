// 시스템 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D7): the memo server live from
// system/worker, memo times and the last hour of beats from the worker's
// memory (empty after a restart, and the page says so), the day's failures,
// today's photos by hour, and which phones are linked. Push delivery and
// crash-free users are not connected yet.

import { useEffect, useState } from 'react'
import { beatAgo, type AdminPerson } from '../../lib/admin'
import { adminMetrics, busiestHour, fmtN, type AdminMetrics } from '../../lib/adminToday'
import { failRate, platformSplit, restartedMinutesAgo, secs } from '../../lib/adminSystem'
import { loadPlans } from '../../lib/plans'
import { WorkerError } from '../../lib/worker'
import type { WorkerBeatView } from '../../hooks/useWorkerStatus'
import { HourBars } from './charts'

const STATUS_KO = { ok: '정상', down: '멈춤', unknown: '확인 중' } as const
const CELL_KO = { ok: '정상', slow: '느림', miss: '신호 없음', none: '기록 없음' } as const

export function SystemView({ worker, people, refreshKey }: { worker: WorkerBeatView; people: AdminPerson[]; refreshKey: number }) {
  const [m, setM] = useState<AdminMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [retention, setRetention] = useState<boolean | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // The strip and memo times come from the worker's memory: ask again every minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    let cancelled = false
    adminMetrics(refreshKey > 0 && tick === 0).then(
      (x) => { if (!cancelled) { setM(x); setError(null); setNow(Date.now()) } },
      (err) => {
        if (cancelled) return
        console.error('[admin] system', err)
        setError(err instanceof WorkerError && err.code === 'unavailable'
          ? '서버(Mac mini)가 응답하지 않아요. 아래 기록은 서버가 돌아오면 다시 채워져요.'
          : `불러오지 못했어요: ${(err as Error).message}`)
      },
    )
    return () => { cancelled = true }
  }, [refreshKey, tick])
  useEffect(() => {
    let cancelled = false
    loadPlans().then((p) => { if (!cancelled) setRetention(p?.flags?.retentionJob === true) })
    return () => { cancelled = true }
  }, [])

  const sys = m?.system
  const rate = sys ? failRate(sys.fail24h) : null
  const restarted = sys ? restartedMinutesAgo(sys.startedAt, now) : null
  const phones = platformSplit(people)
  const busiest = m ? busiestHour(m.photosByHourToday) : null

  return (
    <div className="hq-system">
      <div className="hq-vhead">
        <div className="hq-vhead-t"><small>실시간</small><h1>시스템</h1></div>
      </div>
      {error && <div className="hq-card hq-err" role="alert">{error}</div>}

      <div className="hq-g3">
        <section className="hq-card">
          <h3>메모 서버</h3>
          <span className="hq-st"><span className={`hq-dot ${worker.status}`} aria-hidden="true" />{STATUS_KO[worker.status]}</span>
          <div className="hq-rows hq-rows-tight">
            <div><span>마지막 신호</span><b className="num">{beatAgo(worker.lastSeenMs, worker.now).replace('마지막 신호 ', '')}</b></div>
            <div><span>AI 모델</span><b>{worker.modelUp == null ? '확인 중' : worker.modelUp ? '응답 중' : '응답 없음'}</b></div>
            <div><span>대기 중인 사진</span><b className="num">{worker.waiting == null ? '확인 중' : `${fmtN(worker.waiting)}장`}</b></div>
          </div>
        </section>

        <section className="hq-card" aria-busy={!sys && !error}>
          <h3>메모 시간 <small>사진이 올라와서 메모가 될 때까지</small></h3>
          {!sys ? <Lines n={3} /> : sys.memoP50 === null ? (
            <><p className="hq-big-n">—</p><p className="hq-note">서버가 다시 시작한 뒤 아직 쓴 메모가 없어요.</p></>
          ) : (
            <>
              <p className="hq-big-n num">{secs(sys.memoP50)}</p>
              <p className="hq-note num">{`중간값 · 느린 10%는 ${secs(sys.memoP90 ?? sys.memoP50)} · 최근 메모 ${fmtN(sys.memoCount)}장 기준`}</p>
            </>
          )}
        </section>

        <section className="hq-card" aria-busy={!sys && !error}>
          <h3>실패율 <small>24시간</small></h3>
          {!sys ? <Lines n={3} /> : rate === null ? (
            <><p className="hq-big-n">—</p><p className="hq-note">최근 24시간에 올라온 사진이 없어요.</p></>
          ) : (
            <>
              <p className={`hq-big-n num${sys.fail24h.failed ? ' bad' : ''}`}>{`${rate}%`}</p>
              <p className="hq-note num">{`사진 ${fmtN(sys.fail24h.total)}장 중 ${fmtN(sys.fail24h.failed)}장이 메모를 못 받았어요`}</p>
            </>
          )}
        </section>
      </div>

      <section className="hq-card" aria-busy={!sys && !error}>
        <h3>최근 60분 신호 <small>1분마다 한 칸</small></h3>
        {!sys ? <Lines n={2} /> : (
          <>
            <div className="hq-beats" role="img" aria-label={`최근 60분: 정상 ${sys.beats60.filter((c) => c === 'ok').length}분, 느림 ${sys.beats60.filter((c) => c === 'slow').length}분, 신호 없음 ${sys.beats60.filter((c) => c === 'miss').length}분`}>
              {sys.beats60.map((c, i) => <i key={i} className={c} title={`${60 - i}분 전 · ${CELL_KO[c]}`} />)}
            </div>
            <div className="hq-scale"><span>60분 전</span><span>지금</span></div>
            <div className="hq-legend hq-beat-legend">
              <span><i className="ok" />정상</span><span><i className="slow" />느림 (AI 응답 없음 · 5장 이상 대기)</span><span><i className="miss" />신호 없음</span><span><i className="none" />기록 없음</span>
            </div>
            <p className="hq-note">
              {restarted !== null ? `서버가 ${restarted ? `${restarted}분 전에` : '방금'} 다시 시작해서 그 전 기록은 없어요. ` : ''}
              이 기록과 메모 시간은 서버 메모리에만 있어서, 다시 시작하면 처음부터 쌓여요.
            </p>
          </>
        )}
      </section>

      <div className="hq-g2e">
        <section className="hq-card" aria-busy={!m && !error}>
          <h3>오늘 시간대별 사진 {busiest !== null && <small>{`${busiest}시에 가장 몰려요`}</small>}</h3>
          {!m ? <Lines n={4} /> : m.photosToday === 0 ? <div className="hq-empty">오늘은 아직 사진이 없어요.</div>
            : <HourBars byHour={m.photosByHourToday} busiest={busiest} />}
        </section>

        <section className="hq-card">
          <h3>앱 상태</h3>
          <div className="hq-rows">
            <div><span>푸시 전달률</span><span className="hq-tag t-dim">연결 필요</span></div>
            <div><span>크래시 없는 사용자</span><span className="hq-tag t-dim">Crashlytics 연결 필요</span></div>
            <div><span>보관 기간 정리</span><span className={`hq-tag ${retention ? 't-good' : 't-dim'}`}>{retention === null ? '확인 중' : retention ? '스위치 켜짐' : '스위치 꺼짐'}</span></div>
          </div>
          <h3 className="hq-sub-h">연결된 부모님 휴대폰</h3>
          {phones.length === 0 ? <div className="hq-empty">연결된 휴대폰이 없어요.</div> : (
            <div className="hq-src">
              {phones.map((p) => (
                <div key={p.label}><span>{p.label}</span><span className="bar muted-bar" style={{ width: `${Math.max(4, p.pct)}%` }} /><b className="num">{`${fmtN(p.count)} · ${p.pct}%`}</b></div>
              ))}
            </div>
          )}
          <p className="hq-note">사용 중인 앱 버전은 아직 기록하지 않아요.</p>
        </section>
      </div>
    </div>
  )
}

function Lines({ n }: { n: number }) {
  return <div className="hq-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div>
}
