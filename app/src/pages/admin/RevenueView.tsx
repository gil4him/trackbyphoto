// 매출 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D5 + D12). With payments live
// the worker's adminRevenue brings the real rows: every store purchase, what
// RevenueCat says about it, the list-price MRR and RevenueCat's own overview.
// Under that stays the calculator over the owner's assumptions (saved in
// admin_config/dashboard.revenue). The plan mix and the upgrades are real;
// what is not recorded or not connected says so.

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, limit, query, serverTimestamp, setDoc, where, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import type { AdminPerson } from '../../lib/admin'
import { familyRows } from '../../lib/adminFamilies'
import {
  adminRevenue, dayText, overviewRows, paidTiers, planMix, revenue, startingAssumptions, upgrades, waterfall, won,
  STATUS_KO, STORE_KO, type AdminRevenue, type SubRow, type Waterfall,
} from '../../lib/adminRevenue'
import { costSummary, seoulMonth } from '../../lib/adminCosts'
import { loadMonthCosts } from '../../lib/adminCostsData'
import { fmtN } from '../../lib/adminToday'
import { TIER_NAME, TIERS } from '../../lib/plan'
import { loadPlans } from '../../lib/plans'
import { WorkerError } from '../../lib/worker'
import { useToast } from '../../components/Toast'
import type { Plans, PlanTier } from '../../types'

const MONTH_MS = 30 * 86_400_000

export function RevenueView({ people, peopleLoading, peopleFailed = false, refreshKey = 0 }: { people: AdminPerson[]; peopleLoading: boolean; peopleFailed?: boolean; refreshKey?: number }) {
  const toast = useToast()
  const [plans, setPlans] = useState<Plans | null | undefined>(undefined)
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null | undefined>(undefined)
  const [aiUSD, setAiUSD] = useState(0)
  /** Upgrades in the last 30 days, counted when the log is read. */
  const [upgraded, setUpgraded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ prices: Record<string, string>; families: Record<string, string> } | null>(null)
  const [saving, setSaving] = useState(false)
  /** The worker's real rows (payments live); kept across a failed refresh. */
  const [live, setLive] = useState<{ r: AdminRevenue | null; error: string | null }>({ r: null, error: null })

  useEffect(() => {
    let cancelled = false
    loadPlans().then((p) => { if (!cancelled) setPlans(p) })
    loadMonthCosts(seoulMonth()).then(
      (d) => { if (!cancelled) { setDashboard(d.dashboard); setAiUSD(d.aiUSD) } },
      (err) => { if (!cancelled) { console.error('[admin] dashboard read', err); setDashboard(null); setError('저장된 가정과 비용을 읽지 못했어요.') } },
    )
    getDocs(query(collection(db, 'auditLogs'), where('action', '==', 'plan.change'), limit(500))).then(
      (snap) => {
        if (cancelled) return
        const rows = snap.docs.map((d) => ({ details: d.get('details'), timestampMs: (d.get('timestamp') as Timestamp | undefined)?.toMillis?.() ?? null }))
        setUpgraded(upgrades(rows, Date.now() - MONTH_MS))
      },
      (err) => { if (!cancelled) { console.error('[admin] plan log', err); setUpgraded(0) } },
    )
    return () => { cancelled = true }
  }, [refreshKey])

  const paymentsOn = plans?.flags?.payments === true
  useEffect(() => {
    if (!paymentsOn) return
    let cancelled = false
    adminRevenue(refreshKey > 0).then(
      (r) => { if (!cancelled) setLive({ r, error: null }) },
      (err) => {
        if (cancelled) return
        console.error('[admin] revenue', err)
        setLive((cur) => ({ r: cur.r, error: err instanceof WorkerError && err.code === 'unavailable'
          ? '서버(Mac mini)가 응답하지 않아요. 서버가 돌아오면 결제 숫자가 채워져요.'
          : `결제 숫자를 불러오지 못했어요: ${(err as Error).message}` }))
      },
    )
    return () => { cancelled = true }
  }, [paymentsOn, refreshKey])

  const mix = useMemo(() => planMix(people), [people])
  const ready = plans !== undefined && dashboard !== undefined && !(peopleLoading && !people.length)
  const start = useMemo(() => (ready ? startingAssumptions(dashboard?.revenue, plans ?? null, mix) : null), [ready, dashboard, plans, mix])
  const tiers = paidTiers(plans ?? null)
  const fields = edit ?? (start && {
    prices: Object.fromEntries(tiers.map((t) => [t, String(start.prices[t] ?? 0)])),
    families: Object.fromEntries(tiers.map((t) => [t, String(start.families[t] ?? 0)])),
  })
  const parse = (v: string | undefined) => Math.max(0, Number((v ?? '').replace(/[^\d]/g, '')) || 0)
  const assumptions = fields && {
    prices: Object.fromEntries(tiers.map((t) => [t, parse(fields.prices[t])])) as Partial<Record<PlanTier, number>>,
    families: Object.fromEntries(tiers.map((t) => [t, parse(fields.families[t])])) as Partial<Record<PlanTier, number>>,
  }
  // The month's costs as 비용 adds them up (what is not entered is left out, and named).
  const costs = dashboard !== undefined ? costSummary(dashboard, seoulMonth(), aiUSD) : null
  const cost = costs ? costs.totalKRW : null
  const w = assumptions && revenue(assumptions, cost)
  const atLimit = useMemo(() => familyRows(people, plans ?? null).filter((r) => r.flags.has('limit')).length, [people, plans])
  const parents = TIERS.reduce((s, t) => s + mix[t], 0)
  // The plans on offer, plus any a parent is still on.
  const shownTiers = TIERS.filter((t) => t === 'free' || tiers.includes(t) || mix[t] > 0)

  const change = (kind: 'prices' | 'families', t: string, v: string) => fields && setEdit({ ...fields, [kind]: { ...fields[kind], [t]: v } })

  const save = async () => {
    if (!assumptions) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'admin_config', 'dashboard'), { revenue: { ...assumptions, savedAt: serverTimestamp() } }, { merge: true })
      setDashboard((d) => ({ ...(d ?? {}), revenue: assumptions }))
      setEdit(null)
      toast.show('가정을 저장했어요')
    } catch (err) {
      console.error('[admin] revenue save', err)
      toast.show('저장하지 못했어요', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const r = live.r
  const s = r?.summary
  const real: Waterfall | null = s && s.mrrKRW !== null && dashboard !== undefined ? waterfall(s.mrrKRW, cost) : null
  const tierText = s && Object.keys(s.byTier).length ? TIERS.filter((t) => s.byTier[t]).map((t) => `${TIER_NAME[t]} ${fmtN(s.byTier[t])}`).join(' · ') : ''

  return (
    <div className="hq-revenue">
      <div className="hq-vhead">
        <div className="hq-vhead-t">
          <small>{paymentsOn ? '스토어 결제 기록과 RevenueCat의 답을 그대로 센 숫자예요' : '결제가 켜지면 실제 숫자로 바뀌어요'}</small>
          <h1>매출</h1>
        </div>
      </div>

      {plans !== undefined && (paymentsOn ? (
        <div className="hq-banner">
          <span className="hq-tag t-good">결제 켜짐</span>
          <p>앱 안 구독은 Apple·Google 결제를 거쳐 RevenueCat으로 들어와요. 금액은 플랜 표의 정가(부가세 포함) 기준이고, 나라마다 다른 스토어 정산가는 RevenueCat 기준 카드에서 봐요.</p>
          {r?.store.state === 'unconfigured' && <span className="hq-tag t-dim">{`연결 필요 · ${r.store.missing.join(', ')}`}</span>}
          {r?.store.state === 'error' && <span className="hq-tag t-bad">{`연결 오류 · ${r.store.error ?? ''}`}</span>}
        </div>
      ) : (
        <div className="hq-banner"><span className="hq-tag t-acc">결제 준비 중</span><p>지금은 앱에서 결제가 꺼져 있어요. 아래 가격과 가족 수를 바꿔 보면 한 달에 얼마가 남는지 바로 계산돼요. 앱 안 구독은 Apple·Google 결제를 거치고, 소규모 사업자 수수료는 15%예요.</p></div>
      ))}
      {error && <div className="admin-error">{error}</div>}
      {paymentsOn && live.error && (r ? <div className="admin-error">{live.error}</div> : <div className="hq-card hq-err" role="alert">{live.error}</div>)}

      {paymentsOn && !(live.error && !r) && <>
        <section className="hq-kpis" aria-label="결제 숫자" aria-busy={!s}>
          {s ? ([
            { k: '유료 가족', v: fmtN(s.paying), d: tierText || '아직 없음', cls: 'flat' },
            { k: '이번 달 정가 매출', v: s.mrrKRW === null ? '가격 없음' : won(s.mrrKRW), d: s.trial ? `체험 ${fmtN(s.trial)}곳은 뺌` : '유료 가족 × 정가', cls: 'flat' },
            { k: '새 결제 (30일)', v: fmtN(s.new30d), d: s.sandbox ? `테스트 결제 ${fmtN(s.sandbox)}건은 뺌` : '처음 결제한 가족', cls: s.new30d ? 'up' : 'flat' },
            { k: '해지·환불 (30일)', v: fmtN(s.ended30d + s.refunded30d), d: s.refunded30d ? `환불 ${fmtN(s.refunded30d)}건` : '끝난 구독', cls: s.ended30d + s.refunded30d ? 'down' : 'flat' },
            { k: '결제 문제', v: fmtN(s.grace), d: s.cancelling ? `해지 예정 ${fmtN(s.cancelling)}곳` : '카드 문제로 스토어가 재시도 중', cls: s.grace ? 'down' : 'flat' },
          ]).map((k) => (
            <div key={k.k} className="hq-kpi"><span className="k">{k.k}</span><span className="v num">{k.v}</span><span className={`d ${k.cls}`}>{k.d}</span></div>
          )) : Array.from({ length: 5 }, (_, i) => <div key={i} className="hq-kpi"><Lines n={3} /></div>)}
        </section>

        <div className="hq-g2">
          <section className="hq-card" aria-busy={!s}>
            <h3>실제 매출로 남는 돈 <small>정가 기준, 이번 달</small></h3>
            {!s ? <Lines n={5} /> : s.mrrKRW === null ? <div className="hq-empty">플랜 표에 가격이 없어 계산할 수 없어요.</div> : s.paying === 0 ? <div className="hq-empty">아직 유료 가족이 없어요.</div> : real && (
              <div className="hq-wf">
                <div><span>월 매출</span><b className="num">{won(real.gross)}</b></div>
                <div><span>부가세 10%</span><b className="num neg">{`− ${won(real.vat)}`}</b></div>
                <div><span>Apple·Google 수수료 15%</span><b className="num neg">{`− ${won(real.fee)}`}</b></div>
                <div><span>운영 비용</span>{real.cost === null ? <span className="hq-tag t-dim">입력 전</span> : <b className="num neg">{`− ${won(real.cost)}`}</b>}</div>
                <div className="total"><span>남는 돈</span><b className={`num ${real.net >= 0 ? 'pos' : 'neg'}`}>{won(real.net)}</b></div>
                {real.cost === null ? <p className="hq-note">비용 화면에서 이번 달 비용을 넣으면 빼고 계산해요.</p>
                  : costs && costs.missing.length > 0 && <p className="hq-note">{`운영 비용은 비용 화면의 합계예요 · ${costs.missing.join(', ')} 입력 전`}</p>}
              </div>
            )}
          </section>

          <section className="hq-card" aria-busy={!r}>
            <h3>RevenueCat 기준 <small>스토어 정산가로 센 숫자</small></h3>
            {!r ? <Lines n={4} /> : r.overview.state === 'unconfigured' ? (
              <div className="hq-trig">
                <div><span>프로젝트 개요(MRR, 활성 구독, 28일 매출)</span><span className="hq-tag t-dim">연결 필요</span></div>
                <p className="hq-note">{`worker.env에 ${r.overview.missing.join(', ')}를 넣으면 채워져요. v2 API 키는 RevenueCat → Project settings → API keys에서 만들어요 (charts_metrics 읽기).`}</p>
              </div>
            ) : r.overview.state === 'error' ? (
              <div className="hq-trig"><div><span>프로젝트 개요</span><span className="hq-tag t-bad">연결 오류</span></div><p className="hq-note">{r.overview.error}</p></div>
            ) : r.overview.metrics.length === 0 ? <div className="hq-empty">RevenueCat이 아직 숫자를 주지 않았어요.</div> : (
              <div className="hq-trig">
                {overviewRows(r.overview.metrics).map((m) => <div key={m.id}><span>{m.label}</span><b className="num">{m.text}</b></div>)}
              </div>
            )}
          </section>
        </div>

        <section className="hq-card" aria-busy={!r}>
          <h3>구독 현황 <small>{r ? `스토어 결제 ${fmtN(r.rows.length)}건` : ''}</small></h3>
          {!r ? <Lines n={3} /> : r.rows.length === 0 ? <div className="hq-empty">아직 스토어 결제가 없어요.</div> : (
            <div className="hq-tbl hq-subs">
              <table>
                <thead><tr><th>부모님</th><th>플랜</th><th>스토어</th><th>상태</th><th>시작</th><th>다음 결제</th></tr></thead>
                <tbody>{r.rows.map((row) => <SubLine key={row.payerUid} row={row} />)}</tbody>
              </table>
            </div>
          )}
          {r && r.store.state !== 'ok' && r.rows.length > 0 && <p className="hq-note">스토어 확인 전인 줄은 우리 결제 기록만으로 보여요. 테스트 결제와 환불은 RevenueCat이 답해야 가려져요.</p>}
        </section>
      </>}

      <div className="hq-g2">
        <section className="hq-card" aria-busy={!fields}>
          <h3>가정으로 계산해 보기 <small>가격은 부가세 포함</small></h3>
          {!fields ? <Lines n={4} /> : (
            <div className="hq-calc">
              <div className="hq-calc-row h"><span>플랜</span><span className="price">월 가격 (₩)</span><span className="fam">유료 가족 수</span><span className="out">월 매출</span></div>
              {tiers.map((t) => (
                <div key={t} className="hq-calc-row">
                  <b>{TIER_NAME[t]}</b>
                  <input className="price" inputMode="numeric" aria-label={`${TIER_NAME[t]} 월 가격`} value={fields.prices[t] ?? ''} onChange={(e) => change('prices', t, e.target.value)} />
                  <input className="fam" inputMode="numeric" aria-label={`${TIER_NAME[t]} 유료 가족 수`} value={fields.families[t] ?? ''} onChange={(e) => change('families', t, e.target.value)} />
                  <span className="out num">{won(parse(fields.prices[t]) * parse(fields.families[t]))}</span>
                </div>
              ))}
              <div className="hq-calc-foot">
                <p className="hq-note">처음 값은 플랜 표의 가격과 지금 그 플랜에 있는 가족 수예요.</p>
                <button type="button" className="hq-btn" disabled={!edit || saving} onClick={() => void save()}>{saving ? '저장 중…' : '가정 저장'}</button>
              </div>
            </div>
          )}
        </section>

        <section className="hq-card" aria-busy={!w}>
          <h3>{paymentsOn ? '가정대로면 남는 돈' : '한 달에 남는 돈'} <small>부가세 포함 가격 기준</small></h3>
          {!w ? <Lines n={5} /> : (
            <div className="hq-wf">
              <div><span>월 매출</span><b className="num">{won(w.gross)}</b></div>
              <div><span>부가세 10%</span><b className="num neg">{`− ${won(w.vat)}`}</b></div>
              <div><span>Apple·Google 수수료 15%</span><b className="num neg">{`− ${won(w.fee)}`}</b></div>
              <div><span>운영 비용</span>{w.cost === null ? <span className="hq-tag t-dim">입력 전</span> : <b className="num neg">{`− ${won(w.cost)}`}</b>}</div>
              <div className="total"><span>남는 돈</span><b className={`num ${w.net >= 0 ? 'pos' : 'neg'}`}>{won(w.net)}</b></div>
              {w.cost === null ? <p className="hq-note">비용 화면에서 이번 달 비용을 넣으면 빼고 계산해요.</p>
                : costs && costs.missing.length > 0 && <p className="hq-note">{`운영 비용은 비용 화면의 합계예요 · ${costs.missing.join(', ')} 입력 전`}</p>}
            </div>
          )}
        </section>
      </div>

      <div className="hq-g2e">
        <section className="hq-card" aria-busy={!ready}>
          <h3>플랜별 가족 <small>지금 실제</small></h3>
          {!ready ? <Lines n={2} /> : peopleFailed ? <div className="hq-empty">가족 목록을 불러오지 못했어요.</div> : parents === 0 ? <div className="hq-empty">아직 등록된 부모님이 없어요.</div> : (
            <>
              <div className="hq-mix" role="img" aria-label={TIERS.map((t) => `${TIER_NAME[t]} ${mix[t]}`).join(', ')}>
                {TIERS.filter((t) => mix[t] > 0).map((t) => (
                  <span key={t} className={`m-${t}`} style={{ width: `${(mix[t] / parents) * 100}%` }}>{mix[t] / parents > 0.12 ? TIER_NAME[t] : ''}</span>
                ))}
              </div>
              <p className="hq-note num">{`${shownTiers.map((t) => `${TIER_NAME[t]} ${fmtN(mix[t])}`).join(' · ')} · 유료 ${Math.round(((parents - mix.free) / parents) * 100)}%`}</p>
            </>
          )}
        </section>

        <section className="hq-card">
          <h3>업그레이드 계기 <small>결제 전에도 셀 수 있는 것</small></h3>
          <div className="hq-trig">
            <div><span>더 큰 플랜으로 바꾼 가족 (30일)</span>{upgraded === null ? <span className="hq-tag t-dim">…</span> : <b className="num">{fmtN(upgraded)}</b>}</div>
            <div><span>가족 수 한도에 걸린 가족</span>{!ready ? <span className="hq-tag t-dim">…</span> : peopleFailed ? <span className="hq-tag t-dim">불러오지 못함</span> : <b className="num">{fmtN(atLimit)}</b>}</div>
            <div><span>“사진이 지워져요” 안내를 봄</span><span className="hq-tag t-dim">아직 기록 안 함</span></div>
            <div><span>음성 답장 카드를 누름</span><span className="hq-tag t-dim">아직 기록 안 함</span></div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Lines({ n }: { n: number }) {
  return <div className="hq-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div>
}

const STATUS_TAG: Record<SubRow['status'], string> = { active: 't-good', grace: 't-bad', cancelling: 't-acc', ended: 't-dim', refunded: 't-bad' }

/** One store purchase: the parent it pays for, the store's word on it, its dates. */
function SubLine({ row }: { row: SubRow }) {
  return (
    <tr>
      <td><b>{row.patientName || '(이름 없음)'}</b></td>
      <td>{TIER_NAME[row.tier as PlanTier] ?? row.tier}{row.priceKRW !== null && <span className="muted num">{` · ${won(row.priceKRW)}`}</span>}</td>
      <td>{row.store === null ? <span className="hq-tag t-dim">확인 전</span> : STORE_KO[row.store]}{row.sandbox && <span className="hq-tag t-dim">테스트</span>}{row.trial && <span className="hq-tag t-acc">체험</span>}</td>
      <td><span className={`hq-tag ${STATUS_TAG[row.status]}`}>{STATUS_KO[row.status]}</span></td>
      <td className="num">{dayText(row.since) || '—'}</td>
      <td className="num">{row.status === 'ended' || row.status === 'refunded' ? '—' : dayText(row.expiresAt) || '—'}</td>
    </tr>
  )
}
