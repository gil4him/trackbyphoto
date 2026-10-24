// 성장 — the journey (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D3): how the last 30
// days' sign-ups got from 가입 to using Daylie every day, where most of them
// stop, weekly cohorts, how families came in, and 90 days of activity. Every
// number comes from the worker (adminGrowth); what is not recorded says so.

import { useEffect, useState } from 'react'
import { adminGrowth, barWidth, dayLabel, weekLabel, yTicks, type AdminGrowth } from '../../lib/adminGrowth'
import { fmtN } from '../../lib/adminToday'
import { loadPlans } from '../../lib/plans'
import { WorkerError } from '../../lib/worker'
import { TrendChart } from './charts'

export function GrowthView({ refreshKey }: { refreshKey: number }) {
  const [state, setState] = useState<{ key: number; g: AdminGrowth | null; error: string | null }>({ key: -1, g: null, error: null })
  const [paymentsOn, setPaymentsOn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    adminGrowth(refreshKey > 0).then(
      (g) => { if (!cancelled) setState({ key: refreshKey, g, error: null }) },
      (err) => {
        if (cancelled) return
        console.error('[admin] growth', err)
        setState((cur) => ({ key: refreshKey, g: cur.g, error: err instanceof WorkerError && err.code === 'unavailable'
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

  const g = state.g
  // No answer and nothing older: the error card says so; the cards step aside.
  const failed = !!state.error && !g
  const signups = g?.funnel[0]?.count ?? 0
  const leakTo = g?.drop?.to

  return (
    <div className="hq-growth">
      <div className="hq-vhead">
        <div className="hq-vhead-t">
          <small>{g ? `최근 30일 · 가입한 가족 ${fmtN(signups)}곳을 따라가 봤어요` : '최근 30일'}</small>
          <h1>한 가족이 들어와 매일 쓰기까지</h1>
        </div>
      </div>

      {state.error && !g && <div className="hq-card hq-err" role="alert">{state.error}</div>}
      {state.error && g && <div className="admin-error">{state.error}</div>}

      {!failed && <>
      <section className="hq-card" aria-busy={!g}>
        <h3>여정 <small>단계마다 다음으로 넘어간 비율</small></h3>
        {!g ? <Lines n={6} /> : (
          <div className="hq-funnel">
            <div className="hq-fr off">
              <span className="lab">설치</span>
              <div className="track"><div className="fill" style={{ width: '100%' }}>연결 필요</div></div>
              <span className="pct" />
            </div>
            {g.funnel.map((s, i) => (
              <div key={s.key} className={`hq-fr${s.label === leakTo ? ' leak' : ''}`}>
                <span className="lab">{s.label}</span>
                <div className="track">{s.count ? <div className={`fill f${i} num`} style={{ width: `${barWidth(s.count, signups)}%` }}>{fmtN(s.count)}</div> : <span className="zero num">0</span>}</div>
                <span className="pct num">{s.rate === null ? '' : `→ ${Math.round(s.rate * 100)}%`}</span>
              </div>
            ))}
            <div className={`hq-fr ${paymentsOn ? 'off' : 'wait'}`}>
              <span className="lab">유료 전환</span>
              <div className="track"><div className="fill" style={{ width: '100%' }}>{paymentsOn ? '연결 필요' : '결제 준비 중'}</div></div>
              <span className="pct" />
            </div>
            {signups === 0 && <p className="hq-note">최근 30일에 가입한 가족이 없어요.</p>}
          </div>
        )}
      </section>

      {g?.drop && (
        <div className="hq-callout">
          <span className="big num">{`${g.drop.dropPct}%`}</span>
          <p><b>{`${g.drop.from} → ${g.drop.to}`}</b>{`에서 가장 많이 빠져요. ${fmtN(g.drop.of)}곳 중 ${fmtN(g.drop.lost)}곳이 ${g.drop.to}까지 가지 못했어요.`}</p>
        </div>
      )}

      <div className="hq-g2e">
        <section className="hq-card" aria-busy={!g}>
          <h3>가입 주별로 계속 쓰는 비율 <small>그 주에 등록한 부모님 중 사진을 보낸 분</small></h3>
          {!g ? <Lines n={5} /> : g.cohorts.every((c) => c.size === 0) ? <div className="hq-empty">최근 5주에 등록한 부모님이 없어요.</div> : (
            <div className="hq-cohort-wrap">
              <div className="hq-cohort" role="table" aria-label="가입 주별로 계속 쓰는 비율">
                <span role="columnheader" />
                {['첫 주', '1주 후', '2주 후', '3주 후', '4주 후'].map((h) => <span key={h} role="columnheader" className="h">{h}</span>)}
                {g.cohorts.map((c) => (
                  <div key={c.week} role="row" className="hq-cohort-row">
                    <span role="rowheader" className="r num">{`${weekLabel(c.week)} · ${fmtN(c.size)}분`}</span>
                    {c.pct.map((v, k) => (
                      <span key={k} role="cell" className={`cell num${v === null || c.size === 0 ? ' none' : ''}`}
                        style={v === null || c.size === 0 ? undefined : { background: `color-mix(in srgb, var(--accent) ${Math.round(12 + v * 0.7)}%, var(--surface))` }}>
                        {v === null || c.size === 0 ? '' : `${v}%`}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="hq-card" aria-busy={!g}>
          <h3>어디서 들어왔나 <small>{g ? `가입 ${fmtN(g.sources.total)}곳` : ''}</small></h3>
          {!g ? <Lines n={4} /> : g.sources.total === 0 ? <div className="hq-empty">최근 30일에 가입한 가족이 없어요.</div> : (
            <div className="hq-src">
              {([['가족 초대 링크', g.sources.invite], ['직접 가입', g.sources.direct], ['아직 부모님 없음', g.sources.none]] as const).map(([name, n]) => (
                <div key={name}>
                  <span>{name}</span>
                  <span className="bar" style={{ width: `${Math.max(n ? 4 : 0, Math.round((n / g.sources.total) * 100))}%` }} />
                  <b className="num">{`${fmtN(n)} · ${Math.round((n / g.sources.total) * 100)}%`}</b>
                </div>
              ))}
            </div>
          )}
          <p className="hq-note">App Store · Google Play · 테스터 페이지 · 웹 중 어디서 왔는지는 <span className="hq-tag t-dim">아직 기록 안 함</span></p>
        </section>
      </div>

      <section className="hq-card" aria-busy={!g}>
        <h3>
          가입과 활동 (90일)
          <span className="hq-legend"><span><i className="a" />활동 부모님</span><span><i className="l" />누적 가족</span></span>
        </h3>
        {!g ? <Lines n={6} /> : g.trend.dates.length === 0 ? <div className="hq-empty">아직 기록이 없어요.</div> : (
          <TrendChart
            dates={g.trend.dates}
            area={g.trend.activeParents}
            line={g.trend.families}
            ticks={yTicks(Math.max(...g.trend.activeParents, ...g.trend.families))}
            dateText={dayLabel}
            label={`90일 동안 활동 부모님 ${g.trend.activeParents.at(-1)}분, 누적 가족 ${g.trend.families.at(-1)}곳`}
          />
        )}
        <p className="hq-note">활동 부모님 = 최근 7일 안에 사진을 보낸 부모님 · 누적 가족 = 그날 함께하는 가족</p>
      </section>
      </>}
    </div>
  )
}

function Lines({ n }: { n: number }) {
  return <div className="hq-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div>
}
