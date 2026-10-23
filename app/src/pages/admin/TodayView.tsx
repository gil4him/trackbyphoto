// 오늘 — the 운영실 home (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D1): yesterday
// in one sentence, the north star, five KPIs, what needs a look, the memo
// server and money, and today's photos by hour. Every number comes from the
// worker (adminMetrics), system/worker or the people list; what isn't
// connected yet says so.

import { useEffect, useState } from 'react'
import { beatAgo, type AdminPerson, type AdminTab } from '../../lib/admin'
import { adminMetrics, attention, briefing, busiestHour, fmtN, kpis, story, type AdminMetrics, type Range } from '../../lib/adminToday'
import { loadPlans } from '../../lib/plans'
import { WorkerError } from '../../lib/worker'
import type { WorkerBeatView } from '../../hooks/useWorkerStatus'
import { HourBars, Sparkline } from './charts'

const WORKER_KO = { ok: '정상', down: '멈춤', unknown: '확인 중' } as const

export function TodayView({ people, peopleLoading, worker, refreshKey, onOpen, onGo }: {
  people: AdminPerson[]
  peopleLoading: boolean
  worker: WorkerBeatView
  /** Bumped by 새로고침: ask the worker again, past its 5-minute cache. */
  refreshKey: number
  onOpen: (uid: string) => void
  onGo: (tab: AdminTab) => void
}) {
  const [range, setRange] = useState<Range>(7)
  const [state, setState] = useState<{ key: number; m: AdminMetrics | null; error: string | null }>({ key: -1, m: null, error: null })
  const [paymentsOn, setPaymentsOn] = useState<boolean | null>(null)
  const loading = state.key !== refreshKey

  useEffect(() => {
    let cancelled = false
    adminMetrics(refreshKey > 0).then(
      (m) => { if (!cancelled) setState({ key: refreshKey, m, error: null }) },
      (err) => {
        if (cancelled) return
        console.error('[admin] metrics', err)
        setState((cur) => ({ key: refreshKey, m: cur.m, error: err instanceof WorkerError && err.code === 'unavailable'
          ? '서버(Mac mini)가 응답하지 않아요. 서버가 돌아오면 숫자가 채워져요.'
          : `숫자를 불러오지 못했어요: ${(err as Error).message}` }))
      },
    )
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => {
    let cancelled = false
    loadPlans().then((p) => { if (!cancelled) setPaymentsOn(p?.flags?.payments === true) })
    return () => { cancelled = true }
  }, [])

  const { line, greeting } = briefing()
  const m = state.m
  const todo = attention(people)
  const busiest = m ? busiestHour(m.photosByHourToday) : null

  return (
    <div className="hq-today">
      <div className="hq-vhead">
        <div className="hq-vhead-t">
          <small>{line}</small>
          <h1>{greeting}</h1>
        </div>
        <div className="hq-seg" role="group" aria-label="기간">
          {([7, 30] as const).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{`${r}일`}</button>
          ))}
        </div>
      </div>

      {state.error && !m && <div className="hq-card hq-err" role="alert">{state.error}</div>}
      {state.error && m && <div className="admin-error">{state.error} 아래는 {clock(m.at)} 기준 숫자예요.</div>}

      <div className="hq-hero">
        <section className="hq-card hq-story" aria-busy={!m}>
          {m ? (
            <p className="hq-big">
              {story(m.yesterday).map((part, i) => typeof part === 'string' ? part : <em key={i} className="num">{part.n}</em>)}
            </p>
          ) : <Skeleton lines={2} big />}
          <div className="hq-chips">
            {peopleLoading ? <span className="hq-tag t-dim">처리할 일 …</span>
              : todo.length ? <span className="hq-tag t-bad">{`처리할 일 ${todo.length}`}</span>
                : <span className="hq-tag t-good">처리할 일 없음</span>}
            <span className={`hq-tag ${worker.status === 'ok' ? 't-good' : worker.status === 'down' ? 't-bad' : 't-dim'}`}>
              <span className={`hq-dot small ${worker.status}`} aria-hidden="true" />{`메모 서버 ${WORKER_KO[worker.status]}`}
            </span>
            {paymentsOn === false && <span className="hq-tag t-acc">결제 준비 중</span>}
            {paymentsOn === true && <span className="hq-tag t-good">결제 켜짐</span>}
          </div>
        </section>

        <section className="hq-north" aria-busy={!m}>
          <small>북극성 지표 · 하루를 나눈 가족 (7일)</small>
          {m ? (
            <>
              <div className="hq-north-v num">
                {fmtN(m.northStar.families)} <span>/ {fmtN(m.northStar.total)} 가족{m.northStar.total ? ` · ${Math.round(m.northStar.families / m.northStar.total * 100)}%` : ''}</span>
              </div>
              {m.northStar.total && m.days.slice(-range).filter((d) => d.northStar !== null).length < 2 ? (
                <p>추세는 가족이 생긴 지 이틀째부터 보여요.</p>
              ) : m.northStar.total ? (
                <Sparkline values={m.days.slice(-range).map((d) => d.northStar === null ? null : d.northStar * 100)} tone="accent" height={56} goal={m.northStar.goal * 100} strong
                  label={`최근 ${range}일 하루를 나눈 가족 비율`} />
              ) : <p>아직 함께하는 가족이 없어요.</p>}
              <div className="hq-north-goal"><span>사진 1장 + 가족 반응 1번이 있는 가족</span><span className="num">목표 {Math.round(m.northStar.goal * 100)}%</span></div>
            </>
          ) : <Skeleton lines={3} dark />}
        </section>
      </div>

      <section className="hq-kpis" aria-label="핵심 숫자" aria-busy={!m}>
        {m ? kpis(m, range).map((k) => (
          <div key={k.key} className="hq-kpi">
            <span className="k">{k.label}</span>
            <span className="v num">{fmtN(k.value)}</span>
            <span className={`d ${k.trend}`}>{k.delta}</span>
            <Sparkline values={k.series} tone={k.trend === 'down' ? 'danger' : k.trend === 'up' ? 'good' : 'muted'} />
          </div>
        )) : Array.from({ length: 5 }, (_, i) => <div key={i} className="hq-kpi"><Skeleton lines={3} /></div>)}
      </section>

      <div className="hq-g2">
        <section className="hq-card">
          <h3>처리할 일 <button type="button" className="hq-link" onClick={() => onGo('families')}>모두 보기 ›</button></h3>
          {peopleLoading ? <Skeleton lines={4} />
            : todo.length === 0 ? <div className="hq-empty">처리할 일이 없어요. 오늘은 여기까지!</div>
              : (
                <div className="hq-inbox">
                  {todo.slice(0, 4).map(({ person, flags }) => (
                    <button key={person.uid} type="button" className="hq-it" onClick={() => onOpen(person.uid)}>
                      <span className={`stripe ${flags.some((f) => f.tone === 'bad') ? 's-now' : 's-day'}`} aria-hidden="true" />
                      <span className="tx"><b>{person.name}</b><small>{flags.map((f) => f.label).join(' · ')}</small></span>
                      <span className="cat">{person.kind === 'parent' ? '부모님' : '가족'}</span>
                    </button>
                  ))}
                </div>
              )}
        </section>
        <div className="hq-stack">
          <section className="hq-card">
            <h3>메모 서버 <button type="button" className="hq-link" onClick={() => onGo('system')}>자세히 ›</button></h3>
            <div className="hq-rows">
              <div><span>Mac mini 워커</span><span className="hq-st"><span className={`hq-dot ${worker.status}`} aria-hidden="true" />{`${WORKER_KO[worker.status]} · ${beatAgo(worker.lastSeenMs, worker.now).replace('마지막 신호 ', '')}`}</span></div>
              <div><span>AI 모델</span><b>{worker.modelUp == null ? '확인 중' : worker.modelUp ? '응답 중' : '응답 없음'}</b></div>
              <div><span>대기 중인 사진</span><b className="num">{worker.waiting == null ? '확인 중' : `${fmtN(worker.waiting)}장`}</b></div>
            </div>
          </section>
          <section className="hq-card">
            <h3>이번 달 돈 <button type="button" className="hq-link" onClick={() => onGo('revenue')}>자세히 ›</button></h3>
            <div className="hq-rows">
              <div><span>매출</span>{paymentsOn ? <span className="hq-tag t-dim">연결 필요</span> : <span className="hq-tag t-acc">결제 준비 중</span>}</div>
              <div><span>운영 비용</span><span className="hq-tag t-dim">입력 전</span></div>
            </div>
            <p className="hq-note">결제가 켜지고 비용을 입력하면 여기서 한 달에 남는 돈을 보여드려요.</p>
          </section>
        </div>
      </div>

      <section className="hq-card" aria-busy={!m}>
        <h3>오늘 시간대별 사진 {busiest !== null && <small>{busiest}시에 가장 몰려요</small>}</h3>
        {!m ? <Skeleton lines={4} />
          : m.photosToday === 0 ? <div className="hq-empty">오늘은 아직 사진이 없어요.</div>
            : <HourBars byHour={m.photosByHourToday} busiest={busiest} />}
      </section>

      {m && !loading && <p className="hq-note num">{clock(m.at)} 기준 · 서버가 5분 동안 같은 숫자를 보여드리고, 새로고침하면 다시 세요.</p>}
    </div>
  )
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })

function Skeleton({ lines, big = false, dark = false }: { lines: number; big?: boolean; dark?: boolean }) {
  return (
    <div className={`hq-skel${big ? ' big' : ''}${dark ? ' dark' : ''}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} />)}
    </div>
  )
}
