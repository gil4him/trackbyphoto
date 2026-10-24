// 비용 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D6): this month's Firebase bill
// (entered by hand until the BigQuery export is connected), AI memos (real,
// from the worker's counters), the fixed costs, and what a family costs a
// month. Nothing here is a sample: what is not entered says 입력 전.

import { useEffect, useState } from 'react'
import { familyCount, type AdminPerson } from '../../lib/admin'
import { budgetShare, costSummary, perFamily, seoulMonth, usd, type FixedCost } from '../../lib/adminCosts'
import { loadMonthCosts, saveFirebaseEntry, saveFixed } from '../../lib/adminCostsData'
import { won } from '../../lib/adminRevenue'
import { fmtN } from '../../lib/adminToday'
import { loadPlans } from '../../lib/plans'
import { useToast } from '../../components/Toast'

const PERIOD_KO = { year: '/년', month: '/월', once: '(한 번)' } as const
const PARTS = [['storageUSD', '사진 저장 (Storage)'], ['firestoreUSD', 'Firestore'], ['hostingUSD', 'Hosting'], ['otherUSD', '기타']] as const
type PartKey = (typeof PARTS)[number][0]

export function CostsView({ people, peopleLoading, peopleFailed = false, refreshKey = 0 }: { people: AdminPerson[]; peopleLoading: boolean; peopleFailed?: boolean; refreshKey?: number }) {
  const toast = useToast()
  const month = seoulMonth()
  const [data, setData] = useState<{ dashboard: Record<string, unknown> | null; aiUSD: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cloudMemo, setCloudMemo] = useState<boolean | null>(null)
  const [fbForm, setFbForm] = useState<Record<string, string> | null>(null)
  const [fixedForm, setFixedForm] = useState<{ fx: string; items: (FixedCost & { text: string })[] } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadMonthCosts(month).then(
      (d) => { if (!cancelled) setData(d) },
      (err) => { if (!cancelled) { console.error('[admin] costs', err); setError(`비용을 불러오지 못했어요: ${(err as Error).message}`) } },
    )
    loadPlans().then((p) => { if (!cancelled) setCloudMemo(p?.flags?.cloudMemo === true) })
    return () => { cancelled = true }
  }, [month, refreshKey])

  const s = data && costSummary(data.dashboard, month, data.aiUSD)
  const families = familyCount(people)
  const each = s ? perFamily(s.totalKRW, families) : null
  const [y, m] = month.split('-').map(Number)
  const n = (v: string | undefined) => { const t = (v ?? '').trim(); return t === '' || Number.isNaN(Number(t)) ? null : Math.max(0, Number(t)) }

  const openFb = () => s && setFbForm({
    firebaseUSD: s.entry.firebaseUSD?.toString() ?? '', budgetUSD: String(s.entry.budgetUSD),
    storageUSD: s.entry.parts.storage?.toString() ?? '', firestoreUSD: s.entry.parts.firestore?.toString() ?? '',
    hostingUSD: s.entry.parts.hosting?.toString() ?? '', otherUSD: s.entry.parts.other?.toString() ?? '',
  })
  const saveFb = async () => {
    if (!fbForm || !data) return
    setBusy(true)
    try {
      const e = {
        firebaseUSD: n(fbForm.firebaseUSD), budgetUSD: n(fbForm.budgetUSD) ?? 5,
        storageUSD: n(fbForm.storageUSD), firestoreUSD: n(fbForm.firestoreUSD), hostingUSD: n(fbForm.hostingUSD), otherUSD: n(fbForm.otherUSD),
      }
      await saveFirebaseEntry(month, e)
      const costs = { ...((data.dashboard?.costs ?? {}) as Record<string, unknown>), [month]: e }
      setData({ ...data, dashboard: { ...(data.dashboard ?? {}), costs } })
      setFbForm(null)
      toast.show('Firebase 비용을 저장했어요')
    } catch (err) {
      toast.show('저장하지 못했어요', (err as Error).message)
    } finally { setBusy(false) }
  }

  const openFixed = () => s && setFixedForm({ fx: String(s.fx), items: s.fixed.map((f) => ({ ...f, text: f.amount?.toString() ?? '' })) })
  const saveFixedForm = async () => {
    if (!fixedForm || !data) return
    setBusy(true)
    try {
      const fixed = fixedForm.items.map(({ id, label, currency, period, text }) => ({ id, label, currency, period, amount: n(text) }))
      const fx = n(fixedForm.fx) || 1400
      await saveFixed(fixed, fx)
      setData({ ...data, dashboard: { ...(data.dashboard ?? {}), fixed, fx } })
      setFixedForm(null)
      toast.show('고정 비용을 저장했어요')
    } catch (err) {
      toast.show('저장하지 못했어요', (err as Error).message)
    } finally { setBusy(false) }
  }

  const known = s ? PARTS.filter(([k]) => s.entry.parts[k.replace('USD', '') as 'storage'] !== null) : []
  const maxPart = s ? Math.max(0, ...known.map(([k]) => s.entry.parts[k.replace('USD', '') as 'storage'] ?? 0)) : 0

  return (
    <div className="hq-costs">
      <div className="hq-vhead">
        <div className="hq-vhead-t">
          <small>{`${m}월 1일 ~ 오늘 · ${y}년`}</small>
          <h1>비용</h1>
        </div>
      </div>
      {error && <div className="hq-card hq-err" role="alert">{error}</div>}

      <div className="hq-g3">
        <section className="hq-card" aria-busy={!s}>
          <h3>Firebase {s && !fbForm && <button type="button" className="hq-link" onClick={openFb}>입력 ›</button>}</h3>
          {!s ? <Lines n={3} /> : fbForm ? (
            <div className="hq-form">
              <label><span>이번 달 청구액 ($)</span><input inputMode="decimal" value={fbForm.firebaseUSD} onChange={(e) => setFbForm({ ...fbForm, firebaseUSD: e.target.value })} /></label>
              <label><span>예산 ($)</span><input inputMode="decimal" value={fbForm.budgetUSD} onChange={(e) => setFbForm({ ...fbForm, budgetUSD: e.target.value })} /></label>
              <details>
                <summary>어디에 쓰였는지 (선택)</summary>
                {PARTS.map(([k, label]) => (
                  <label key={k}><span>{`${label} ($)`}</span><input inputMode="decimal" value={fbForm[k as PartKey]} onChange={(e) => setFbForm({ ...fbForm, [k]: e.target.value })} /></label>
                ))}
              </details>
              <div className="hq-acts">
                <button type="button" className="hq-btn pri" disabled={busy} onClick={() => void saveFb()}>저장</button>
                <button type="button" className="hq-btn" disabled={busy} onClick={() => setFbForm(null)}>취소</button>
              </div>
            </div>
          ) : s.entry.firebaseUSD === null ? (
            <>
              <p className="hq-big-n"><span className="hq-tag t-dim">입력 전</span></p>
              <p className="hq-note">{`Firebase 콘솔의 ${m}월 청구액을 넣어 주세요. 예산은 $${s.entry.budgetUSD}이에요.`}</p>
            </>
          ) : (
            <>
              <p className="hq-big-n num">{usd(s.entry.firebaseUSD)}</p>
              <div className="hq-meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, budgetShare(s.entry.firebaseUSD, s.entry.budgetUSD))}%` }} className={s.entry.firebaseUSD > s.entry.budgetUSD ? 'over' : ''} />
              </div>
              <p className="hq-note">{`예산 $${s.entry.budgetUSD}의 ${budgetShare(s.entry.firebaseUSD, s.entry.budgetUSD)}%${s.entry.firebaseUSD > s.entry.budgetUSD ? ' · 예산을 넘었어요' : ''}`}</p>
            </>
          )}
        </section>

        <section className="hq-card" aria-busy={!s}>
          <h3>AI 메모 <small>이번 달 · 실제</small></h3>
          {!s ? <Lines n={3} /> : (
            <>
              <p className="hq-big-n num">{usd(s.aiUSD)}</p>
              <p className="hq-note">{`클라우드 AI(Gemini)로 쓴 메모의 비용이에요. Mac mini의 Ollama로 쓴 메모는 $0이에요. 클라우드 AI 메모 스위치는 ${cloudMemo === null ? '확인 중' : cloudMemo ? '켜져 있어요' : '꺼져 있어요'}.`}</p>
            </>
          )}
        </section>

        <section className="hq-card" aria-busy={!s || (peopleLoading && !people.length)}>
          <h3>가족 1곳당 <small>한 달</small></h3>
          {!s || (peopleLoading && !people.length) ? <Lines n={3} /> : peopleFailed ? (
            <><p className="hq-big-n">—</p><p className="hq-note">가족 목록을 불러오지 못해서 나눌 수 없어요.</p></>
          ) : each === null ? (
            <>
              <p className="hq-big-n">—</p>
              <p className="hq-note">아직 함께하는 가족이 없어요.</p>
            </>
          ) : (
            <>
              <p className="hq-big-n num">{won(each)}</p>
              <p className="hq-note num">{`이번 달 비용 ${won(s.totalKRW)} ÷ 가족 ${fmtN(families)}곳${s.missing.length ? ` · ${s.missing.join(', ')} 입력 전` : ''}`}</p>
            </>
          )}
        </section>
      </div>

      <div className="hq-g2e">
        <section className="hq-card" aria-busy={!s}>
          <h3>Firebase 어디에 쓰였나</h3>
          {!s ? <Lines n={4} /> : known.length === 0 ? (
            <div className="hq-empty">Firebase 입력에서 나눠서 넣으면 여기에 보여요.</div>
          ) : (
            <div className="hq-src">
              {known.map(([k, label]) => {
                const v = s.entry.parts[k.replace('USD', '') as 'storage'] ?? 0
                return <div key={k}><span>{label}</span><span className="bar muted-bar" style={{ width: `${maxPart ? Math.max(4, Math.round((v / maxPart) * 100)) : 0}%` }} /><b className="num">{usd(v)}</b></div>
              })}
            </div>
          )}
          <p className="hq-note">Firebase 청구 내보내기(BigQuery)를 연결하면 자동으로 채워져요.</p>
        </section>

        <section className="hq-card" aria-busy={!s}>
          <h3>고정 비용 <small>한 달로 나눈 값</small>{s && !fixedForm && <button type="button" className="hq-link" onClick={openFixed}>입력 ›</button>}</h3>
          {!s ? <Lines n={5} /> : fixedForm ? (
            <div className="hq-form">
              {fixedForm.items.map((f, i) => (
                <label key={f.id}><span>{`${f.label} (${f.currency === 'USD' ? '$' : '₩'}${PERIOD_KO[f.period]})`}</span>
                  <input inputMode="decimal" value={f.text} onChange={(e) => setFixedForm({ ...fixedForm, items: fixedForm.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                </label>
              ))}
              <label><span>환율 (₩/$)</span><input inputMode="numeric" value={fixedForm.fx} onChange={(e) => setFixedForm({ ...fixedForm, fx: e.target.value })} /></label>
              <div className="hq-acts">
                <button type="button" className="hq-btn pri" disabled={busy} onClick={() => void saveFixedForm()}>저장</button>
                <button type="button" className="hq-btn" disabled={busy} onClick={() => setFixedForm(null)}>취소</button>
              </div>
            </div>
          ) : (
            <>
              <div className="hq-rows">
                {s.fixed.map((f) => (
                  <div key={f.id}>
                    <span>{`${f.label}${f.amount !== null ? ` (${f.currency === 'USD' ? `$${f.amount}` : won(f.amount)}${PERIOD_KO[f.period]})` : ''}`}</span>
                    {f.monthlyKRW === null ? <span className="hq-tag t-dim">입력 전</span> : <b className="num">{won(f.monthlyKRW)}</b>}
                  </div>
                ))}
                <div><span>Firebase</span>{s.firebaseKRW === null ? <span className="hq-tag t-dim">입력 전</span> : <b className="num">{won(s.firebaseKRW)}</b>}</div>
                <div><span>AI 메모</span><b className="num">{won(s.aiKRW)}</b></div>
                <div className="total"><span>합계</span><b className="num">{won(s.totalKRW)}</b></div>
              </div>
              <p className="hq-note num">{`환율 ₩${s.fx.toLocaleString('ko-KR')}/$${s.missing.length ? ` · 합계에서 빠진 것: ${s.missing.join(', ')}` : ''}`}</p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Lines({ n }: { n: number }) {
  return <div className="hq-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div>
}
