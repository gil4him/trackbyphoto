// 할 일 — the 운영실 inbox (docs/admin/DAYLIE_ADMIN_DASHBOARD.md D2): what the
// worker's rules found, grouped 지금 / 오늘 / 이번 주, with one item open on the
// right (below the list on a phone). Actions are safe only: 열기, 내일 다시
// 보기, 해결됨. Nothing here sends anything to a family.

import { useEffect, useRef, useState } from 'react'
import { RULE_GUIDE, SKIP_KO, WHEN_KO, checkInLine, groupByWhen, openTarget, sendCheckIn, setItemState, type Inbox, type InboxItem } from '../../lib/adminInbox'
import { useToast } from '../../components/Toast'

const STRIPE = { now: 's-now', day: 's-day', wk: 's-wk' } as const

export function InboxView({ inbox, error, onDone, onOpenPerson, onGo }: {
  inbox: Inbox | null
  error: string | null
  /** An item was snoozed or resolved: take it off the list. */
  onDone: (id: string) => void
  onOpenPerson: (uid: string) => void
  onGo: (to: Exclude<ReturnType<typeof openTarget>, { uid: string }>) => void
}) {
  const toast = useToast()
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmSend, setConfirmSend] = useState<string | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const items = inbox?.items ?? []
  const item = items.find((i) => i.id === selected) ?? items[0] ?? null

  // On a phone the detail sits under the list: bring it into view when picked.
  useEffect(() => {
    if (selected && window.matchMedia?.('(max-width: 900px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected])

  const act = async (it: InboxItem, state: 'snoozed' | 'resolved') => {
    setBusy(true)
    try {
      await setItemState(it.id, state)
      onDone(it.id)
      setSelected(null)
      toast.show(state === 'snoozed' ? '내일 다시 보여드려요' : '해결됨으로 옮겼어요', state === 'resolved' ? '같은 일이 다시 생기면 다시 보여드려요' : undefined)
    } catch (err) {
      console.error('[admin] inbox state', err)
      toast.show('저장하지 못했어요', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const send = async (it: InboxItem) => {
    setBusy(true)
    try {
      const r = await sendCheckIn(it.targets.map((t) => t.uid))
      const people = r.sent.reduce((n, x) => n + x.recipients, 0)
      const why = [...new Set(r.skipped.map((x) => SKIP_KO[x.reason]))].join(' · ')
      if (r.sent.length) {
        toast.show(`부모님 ${r.sent.length}분의 가족 ${people}명에게 보냈어요`, why ? `보내지 않음: ${why}` : undefined)
        await setItemState(it.id, 'snoozed')
        onDone(it.id)
        setSelected(null)
      } else {
        toast.show('보내지 않았어요', why)
      }
    } catch (err) {
      console.error('[admin] check-in', err)
      toast.show('보내지 못했어요', (err as Error).message)
    } finally {
      setBusy(false)
      setConfirmSend(null)
    }
  }

  const open = (it: InboxItem) => {
    const to = openTarget(it)
    if ('uid' in to) onOpenPerson(to.uid)
    else onGo(to)
  }

  return (
    <div className="hq-inbox-view">
      <div className="hq-vhead">
        <div className="hq-vhead-t">
          <small>숫자가 아니라 할 일로 보여드려요</small>
          <h1>{inbox ? `처리할 일 ${items.length}` : '처리할 일'}</h1>
        </div>
        {inbox && inbox.hidden > 0 && <span className="hq-tag t-dim">{`미뤄 두거나 해결한 일 ${inbox.hidden}`}</span>}
      </div>

      {error && !inbox && <div className="hq-card hq-err" role="alert">{error}</div>}
      {error && inbox && <div className="admin-error">{error}</div>}

      {!(error && !inbox) && <div className="hq-ibx">
        <section className="hq-card" aria-busy={!inbox}>
          {!inbox ? <Lines n={5} />
            : items.length === 0 ? <div className="hq-empty">처리할 일이 없어요. 오늘은 여기까지!</div>
              : (
                <div className="hq-inbox" role="listbox" aria-label="처리할 일">
                  {groupByWhen(items).map((g) => (
                    <div key={g.when} role="group" aria-label={WHEN_KO[g.when]}>
                      <div className="hq-grp">{WHEN_KO[g.when]}</div>
                      {g.items.map((it) => (
                        <button key={it.id} type="button" role="option" className="hq-it" aria-selected={item?.id === it.id} onClick={() => setSelected(it.id)}>
                          <span className={`stripe ${STRIPE[it.when]}`} aria-hidden="true" />
                          <span className="tx"><b>{it.title}</b><small>{it.sub}</small></span>
                          <span className="cat">{it.category}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
        </section>

        <section className="hq-card hq-detail" ref={detailRef} aria-live="polite" aria-busy={!inbox}>
          {!inbox ? <Lines n={6} />
            : !item ? <div className="hq-empty">모두 처리했어요.</div>
              : (
                <>
                  <div className="hq-crumb"><span className={`stripe-dot ${STRIPE[item.when]}`} aria-hidden="true" />{`${WHEN_KO[item.when]} · ${item.category}`}</div>
                  <h2>{item.title}</h2>
                  <p className="hq-why">{item.why}</p>
                  {item.rows.length > 0 && (
                    <div className="hq-who">
                      {item.rows.map((r, i) => (
                        <div key={i}><b>{r.name}</b><span>{r.fact}</span><span className="num">{r.value}</span></div>
                      ))}
                    </div>
                  )}
                  {item.rule === 'quietParent' && confirmSend === item.id && (
                    <div className="hq-ask" role="alertdialog" aria-labelledby="send-t" aria-describedby="send-d">
                      <b id="send-t">{`부모님 ${item.targets.length}분의 가족 모두에게 이렇게 보내요`}</b>
                      <p id="send-d" className="hq-quote">{checkInLine(item.rows[0]?.name ?? '')}</p>
                      <p className="hq-note">앱 알림 목록과 푸시로 가요. 부모님마다 3일에 한 번만 보낼 수 있어요.</p>
                      <div className="hq-acts">
                        <button type="button" className="hq-btn pri" disabled={busy} onClick={() => void send(item)}>{busy ? '보내는 중…' : '보내기'}</button>
                        <button type="button" className="hq-btn" disabled={busy} onClick={() => setConfirmSend(null)}>취소</button>
                      </div>
                    </div>
                  )}
                  <div className="hq-acts">
                    {item.rule === 'quietParent' && confirmSend !== item.id && (
                      <button type="button" className="hq-btn pri" disabled={busy} onClick={() => setConfirmSend(item.id)}>안부 알림 보내기</button>
                    )}
                    <button type="button" className={`hq-btn${item.rule === 'quietParent' ? '' : ' pri'}`} onClick={() => open(item)}>{item.targets.length > 1 ? '목록 열기' : '열기'}</button>
                    <button type="button" className="hq-btn" disabled={busy} onClick={() => void act(item, 'snoozed')}>내일 다시 보기</button>
                    <button type="button" className="hq-btn" disabled={busy} onClick={() => void act(item, 'resolved')}>해결됨</button>
                  </div>
                </>
              )}
        </section>
      </div>}

      <section className="hq-card">
        <h3>할 일은 이렇게 골라요</h3>
        <div className="hq-rules">
          {RULE_GUIDE.map((r) => (
            <div key={r.title} className={r.when === 'off' ? 'off' : undefined}>
              <b><i className={r.when === 'off' ? 'i-off' : STRIPE[r.when]} aria-hidden="true" />{r.title}</b>
              {r.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Lines({ n }: { n: number }) {
  return <div className="hq-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div>
}
