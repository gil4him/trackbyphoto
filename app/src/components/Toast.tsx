import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastMsg { id: number; title: string; subtitle?: string }
interface ToastCtx { show: (title: string, subtitle?: string) => void }

const Ctx = createContext<ToastCtx | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const idRef = useRef(0)

  const show = useCallback((title: string, subtitle?: string) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, title, subtitle }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast show">
            {t.title}
            {t.subtitle && <small>{t.subtitle}</small>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast must be used inside <ToastProvider>')
  return c
}
