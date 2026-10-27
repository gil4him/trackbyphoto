// 오늘 — the 운영실 home (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D1): yesterday
// in one sentence, the north star, five KPIs, what needs a look, the memo
// server and money, and today's photos by hour. Every number comes from the
// worker (adminMetrics), system/worker or the people list; what isn't
// connected yet says so.

import { useEffect, useState } from 'react'
import { beatAgo, type AdminTab } from '../../lib/admin'
import { adminMetrics, briefing, busiestHour, fmtN, kpis, story, type AdminMetrics, type Range } from '../../lib/adminToday'
import { loadPlans } from '../../lib/plans'
import { WorkerError } from '../../lib/worker'
import type { WorkerBeatView } from '../../hooks/useWorkerStatus'
import { HourBars, Sparkline } from './charts'
import { topItems, type Inbox } from '../../lib/adminInbox'
import { costSummary, seoulMonth, type CostSummary } from '../../lib/adminCosts'
import { loadMonthCosts } from '../../lib/adminCostsData'
import { adminRevenue, won, type AdminRevenue } from '../../lib/adminRevenue'
import { adminReviews, reviewAgo, reviewLine, stars, summaryLine, STORE_KO, type AdminReviews } from '../../lib/adminReviews'

const WORKER_KO = { ok: '정상', down: '멈춤', unknown: '확인 중' } as const

export function TodayView({ inbox, inboxError, worker, refreshKey, onGo }: {
  /** 할 일 from the worker; null while it loads. */
  inbox: Inbox | null
  inboxError: string | null
  worker: WorkerBeatView
  /** Bumped by 새로고침: ask the worker again, past its 5-minute cache. */
  refreshKey: number
  onGo: (tab: AdminTab) => void
}) {
  const [range, setRange] = useState<Range>(7)
  const [state, setState] = useState<{ key: number; m: AdminMetrics | null; error: string | null }>({ key: -1, m: null, error: null })
  const [paymentsOn, setPaymentsOn] = useState<boolean | null>(null)
  const [costs, setCosts] = useState<CostSummary | null>(null)
  /** 스토어 리뷰 (D13) and this month's real revenue (D12); kept across a failed refresh. */
  const [reviews, setReviews] = useState<{ r: AdminReviews | null; error: string | null }>({ r: null, error: null })
  const [revenue, setRevenue] = useState<AdminRevenue | null>(null)
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
    // The month's costs as 비용 adds them up.
    const month = seoulMonth()
    loadMonthCosts(month).then(
      (d) => { if (!cancelled) setCosts(costSummary(d.dashboard, month, d.aiUSD)) },
      (err) => console.error('[admin] costs', err),
    )
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => {
    let cancelled = false
    adminReviews(refreshKey > 0).then(
      (r) => { if (!cancelled) setReviews({ r, error: null }) },
      (err) => {
        if (cancelled) return
        console.error('[admin] reviews', err)
        setReviews((cur) => ({ r: cur.r, error: err instanceof WorkerError && err.code === 'unavailable' ? '서버가 응답하지 않아요.' : `리뷰를 불러오지 못했어요: ${(err as Error).message}` }))
      },
    )
    return () => { cancelled = true }
  }, [refreshKey])

  useEffect(() => {
    if (!paymentsOn) return
    let cancelled = false
    adminRevenue(refreshKey > 0).then((r) => { if (!cancelled) setRevenue(r) }, (err) => console.error('[admin] revenue', err))
    return () => { cancelled = true }
  }, [paymentsOn, refreshKey])

  const { line, greeting } = briefing()
  const m = state.m
  // The worker did not answer and there is nothing older to show: the error
  // card says so, and the cards that need its numbers step aside.
  const failed = !!state.error && !m
  const nowCount = inbox?.items.filter((i) => i.when === 'now').length ?? 0
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

      {!failed && <div className="hq-hero">
        <section className="hq-card hq-story" aria-busy={!m}>
          {m ? (
            <p className="hq-big">
              {story(m.yesterday).map((part, i) => typeof part === 'string' ? part : <em key={i} className="num">{part.n}</em>)}
            </p>
          ) : <Skeleton lines={2} big />}
          <div className="hq-chips">
            {!inbox ? <span className="hq-tag t-dim">{inboxError ? '처리할 일 확인 불가' : '처리할 일 …'}</span>
              : nowCount ? <span className="hq-tag t-bad">{`지금 처리할 일 ${nowCount}`}</span>
                : <span className="hq-tag t-good">지금 처리할 일 없음</span>}
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
      </div>}

      {!failed && <section className="hq-kpis" aria-label="핵심 숫자" aria-busy={!m}>
        {m ? kpis(m, range).map((k) => (
          <div key={k.key} className="hq-kpi">
            <span className="k">{k.label}</span>
            <span className="v num">{fmtN(k.value)}</span>
            <span className={`d ${k.trend}`}>{k.delta}</span>
            <Sparkline values={k.series} tone={k.trend === 'down' ? 'danger' : k.trend === 'up' ? 'good' : 'muted'} />
          </div>
        )) : Array.from({ length: 5 }, (_, i) => <div key={i} className="hq-kpi"><Skeleton lines={3} /></div>)}
      </section>}

      <div className="hq-g2">
        <section className="hq-card">
          <h3>처리할 일 <button type="button" className="hq-link" onClick={() => onGo('inbox')}>모두 보기 ›</button></h3>
          {!inbox ? (inboxError ? <div className="hq-empty">{inboxError}</div> : <Skeleton lines={4} />)
            : inbox.items.length === 0 ? <div className="hq-empty">처리할 일이 없어요. 오늘은 여기까지!</div>
              : (
                <div className="hq-inbox">
                  {topItems(inbox.items, 4).map((it) => (
                    <button key={it.id} type="button" className="hq-it" onClick={() => onGo('inbox')}>
                      <span className={`stripe ${it.when === 'now' ? 's-now' : it.when === 'day' ? 's-day' : 's-wk'}`} aria-hidden="true" />
                      <span className="tx"><b>{it.title}</b><small>{it.sub}</small></span>
                      <span className="cat">{it.category}</span>
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
              <div><span>{paymentsOn ? '정가 매출' : '매출'}</span>{!paymentsOn ? <span className="hq-tag t-acc">결제 준비 중</span>
                : !revenue ? <span className="hq-tag t-dim">…</span>
                  : revenue.summary.mrrKRW === null ? <span className="hq-tag t-dim">가격 없음</span>
                    : <b className="num">{`${won(revenue.summary.mrrKRW)} · 유료 ${fmtN(revenue.summary.paying)}곳`}</b>}</div>
              <div><span>운영 비용</span>{costs ? <b className="num">{won(costs.totalKRW)}</b> : <span className="hq-tag t-dim">…</span>}</div>
            </div>
            <p className="hq-note">{costs?.missing.length ? `비용 중 ${costs.missing.join(', ')}은(는) 아직 입력 전이에요. ` : ''}{paymentsOn ? '남는 돈은 매출 화면에서 봐요.' : '결제가 켜지면 여기서 한 달에 남는 돈을 보여드려요.'}</p>
          </section>
        </div>
      </div>

      <section className="hq-card hq-reviews" aria-busy={!reviews.r && !reviews.error}>
        <h3>스토어 리뷰 <small>{reviews.r && (reviews.r.ios.state === 'ok' || reviews.r.android.state === 'ok') ? summaryLine(reviews.r.summary) : ''}</small></h3>
        {!reviews.r ? (reviews.error ? <div className="hq-empty">{reviews.error}</div> : <Skeleton lines={3} />) : (
          <>
            {reviews.r.reviews.length === 0
              ? <div className="hq-empty">{reviews.r.ios.state === 'ok' || reviews.r.android.state === 'ok' ? '아직 리뷰가 없어요.' : '스토어를 연결하면 리뷰가 여기 와요.'}</div>
              : (
                <div className="hq-rev-list">
                  {reviews.r.reviews.slice(0, 6).map((r) => (
                    <div key={r.id} className="hq-rev">
                      <span className="hq-rev-stars num" aria-label={`별 ${r.rating}개`}>{stars(r.rating)}</span>
                      <span className="hq-rev-tx"><b>{reviewLine(r)}</b><small>{[STORE_KO[r.store], r.author, reviewAgo(r.atMs), r.version ? `v${r.version}` : ''].filter(Boolean).join(' · ')}</small></span>
                      {!r.replied && <span className="hq-tag t-acc">답장 없음</span>}
                    </div>
                  ))}
                </div>
              )}
            <p className="hq-note hq-stores">
              <StoreNote name="App Store" s={reviews.r.ios} />
              <StoreNote name="Google Play" s={reviews.r.android} note="최근 1주 리뷰만 줘요" />
            </p>
          </>
        )}
      </section>

      {!failed && <section className="hq-card" aria-busy={!m}>
        <h3>오늘 시간대별 사진 {busiest !== null && <small>{busiest}시에 가장 몰려요</small>}</h3>
        {!m ? <Skeleton lines={4} />
          : m.photosToday === 0 ? <div className="hq-empty">오늘은 아직 사진이 없어요.</div>
            : <HourBars byHour={m.photosByHourToday} busiest={busiest} />}
      </section>}

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

/** One store under the reviews: connected (with Google's one-week limit), 연결 필요 with the names missing, or the error. */
function StoreNote({ name, s, note }: { name: string; s: AdminReviews['ios']; note?: string }) {
  return (
    <span className="hq-store">
      <b>{name}</b>
      {s.state === 'ok' && <i>{note ?? '연결됨'}</i>}
      {s.state === 'unconfigured' && <><span className="hq-tag t-dim">연결 필요</span><i>{s.missing.join(', ')}</i></>}
      {s.state === 'error' && <><span className="hq-tag t-bad">연결 오류</span><i>{s.error}</i></>}
    </span>
  )
}
