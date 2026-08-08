import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 shadow-[0_4px_24px_rgba(0,0,0,0.25)] ${className}`}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  )
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-accent hover:bg-accent-soft text-white',
    ghost: 'bg-transparent hover:bg-card-hover text-ink border border-border',
    danger: 'bg-transparent hover:bg-bad/10 text-bad border border-bad/40',
  }[variant]
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  )
}

const fieldCls =
  'w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/60 outline-none focus:border-accent transition-colors'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldCls} ${props.className ?? ''}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldCls} min-h-24 ${props.className ?? ''}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldCls} ${props.className ?? ''}`} />
}

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-muted">{children}</label>
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Stäng">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function ProgressBar({ value, color = 'var(--color-accent)', height = 8 }: { value: number; color?: string; height?: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clamped}%`, background: color }} />
    </div>
  )
}

export function EmptyState({ emoji, text }: { emoji: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="text-3xl">{emoji}</span>
      <p className="text-sm text-muted">{text}</p>
    </div>
  )
}

export function StatTile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <span className="text-2xl font-bold" style={accent ? { color: accent } : undefined}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Card>
  )
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  )
}
