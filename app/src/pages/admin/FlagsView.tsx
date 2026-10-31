// 기능 스위치 (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D8): every rollout flag in
// admin_config/plans. A switch goes through the worker (adminSetFlag), which
// writes the change and an admin_log row. The risky ones ask first, right on
// the page, saying what will happen. Under the list: the last 10 changes.

import { Fragment, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from '../../firebase'
import { FLAGS, flagChanges, setFlag, type FlagChange, type FlagInfo } from '../../lib/adminFlags'
import type { AdminLogRow } from '../../lib/admin'
import { WorkerError } from '../../lib/worker'
import { useToast } from '../../components/Toast'

/** `refreshKey`: bumped by 새로고침; read the switches and the log again. */
const isOn = (f: FlagInfo, flags: Record<string, boolean>) => flags[f.key] ?? f.defaultOn === true

export function FlagsView({ refreshKey = 0 }: { refreshKey?: number }) {
  const toast = useToast()
  const [flags, setFlags] = useState<Record<string, boolean> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<FlagChange[] | null>(null)
  const [asking, setAsking] = useState<{ f: FlagInfo; on: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const loadLog = () => getDocs(query(collection(db, 'admin_log'), orderBy('timestamp', 'desc'), limit(200))).then(
    (snap) => setLog(flagChanges(snap.docs.map((d) => d.data() as Omit<AdminLogRow, 'id'>))),
    (err) => { console.error('[admin] flag log', err); setLog([]) },
  )

  useEffect(() => {
    let cancelled = false
    // Read fresh (not the app's once-per-start copy): this page changes it.
    getDoc(doc(db, 'admin_config', 'plans')).then(
      (snap) => { if (!cancelled) setFlags((snap.get('flags') as Record<string, boolean> | undefined) ?? {}) },
      (err) => { if (!cancelled) { console.error('[admin] plans', err); setError('스위치 상태를 읽지 못했어요.') } },
    )
    void loadLog()
    return () => { cancelled = true }
  }, [refreshKey])

  const flip = async (f: FlagInfo, on: boolean) => {
    setBusy(f.key)
    setAsking(null)
    try {
      await setFlag(f.key, on)
      setFlags((cur) => ({ ...(cur ?? {}), [f.key]: on }))
      toast.show(`${f.name} ${on ? '켰어요' : '껐어요'}`, '워커는 바로, 앱은 다음에 열 때 반영돼요')
      void loadLog()
    } catch (err) {
      console.error('[admin] set flag', err)
      toast.show('바꾸지 못했어요', err instanceof WorkerError && err.code === 'unavailable' ? '서버(Mac mini)가 응답하지 않아요' : (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const tap = (f: FlagInfo) => {
    if (!flags) return
    const on = !isOn(f, flags)
    if (f.confirm) setAsking({ f, on })
    else void flip(f, on)
  }

  return (
    <div className="hq-flags-view">
      <div className="hq-vhead">
        <div className="hq-vhead-t"><small>admin_config/plans · 워커는 바로, 앱은 다음에 열 때 반영돼요</small><h1>기능 스위치</h1></div>
      </div>
      {error && <div className="hq-card hq-err" role="alert">{error}</div>}

      <section className="hq-card" aria-busy={!flags}>
        {!flags ? <div className="hq-skel" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <span key={i} />)}</div> : (
          <div className="hq-flags">
            {FLAGS.map((f) => (
              <Fragment key={f.key}>
              <div className="hq-flag">
                <div>
                  <b>{f.name}{f.confirm && <span className="hq-tag t-acc">확인 후 변경</span>}</b>
                  <code>{f.key}</code>
                  {f.note && <small>{f.note}</small>}
                </div>
                <button type="button" className="hq-sw" role="switch" aria-checked={isOn(f, flags)} aria-label={f.name}
                  disabled={busy !== null || asking !== null} onClick={() => tap(f)} />
              </div>
              {/* The second look, right under the switch that was tapped. */}
              {asking?.f.key === f.key && (
                <div className="hq-ask" role="alertdialog" aria-labelledby="ask-t" aria-describedby="ask-d" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
                  <b id="ask-t">{`${f.name} ${asking.on ? '켤까요?' : '끌까요?'}`}</b>
                  <p id="ask-d">{asking.on ? f.confirm!.on : f.confirm!.off}</p>
                  <div className="hq-acts">
                    <button type="button" className={`hq-btn ${asking.on && f.key === 'retentionJob' ? 'danger' : 'pri'}`} onClick={() => void flip(f, asking.on)}>{asking.on ? '켜기' : '끄기'}</button>
                    <button type="button" className="hq-btn" onClick={() => setAsking(null)}>취소</button>
                  </div>
                </div>
              )}
              </Fragment>
            ))}
          </div>
        )}
      </section>

      <section className="hq-card">
        <h3>최근 바꾼 기록 <small>admin_log · 최근 10건</small></h3>
        {log === null ? <div className="hq-skel" aria-hidden="true"><span /><span /><span /></div>
          : log.length === 0 ? <div className="hq-empty">아직 바꾼 기록이 없어요.</div> : (
            <div className="hq-rows">
              {log.map((c, i) => (
                <div key={i}><span>{`${c.name} ${c.to ? '켬' : '끔'}`}</span><span className="muted num">{c.at ? c.at.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</span></div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
