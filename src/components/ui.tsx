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

export function Modal({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode
  /** Knapprad som ska stå still. Se kommentaren nedanför. */
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    // Två saker gjorde att knappraden längst ner i rutan — Spara — inte gick
    // att nå på telefonen.
    //
    // 90vh: på iOS räknar vh på fönstret med adressfältet bortdolt, alltså
    // högre än det som faktiskt syns. Rutan fick ta 90 % av något större än
    // skärmen, och nederkanten hamnade utanför. dvh mäter det som syns just
    // nu och krymper när adressfältet glider fram.
    //
    // Bottennavet ligger på samma z-nivå och ritas efter, alltså ovanpå.
    // Marginalen nertill håller undan det. Utan den låg Spara bakom navet
    // även när rutan i övrigt fick plats.
    <div
      className="fixed inset-0 z-50 flex h-[100dvh] items-start justify-center overflow-y-auto p-4 pb-[calc(5.9rem+env(safe-area-inset-bottom))] md:pb-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      {/* items-start + my-auto i stallet for items-center: rutan centreras
          fortfarande nar det finns plats, men blir den nagon gang hogre an
          fonstret gar den att rulla fram. Med items-center klipps ett for
          hogt barn i BADA andar och nederkanten blir omojlig att na - det ar
          en gammal egenhet i flexbox, inte nagot man kan rulla sig ur. */}
      {/* Taket mats mot FONSTRET, inte mot foraldern.
          max-h-full ar max-height: 100%, och en procentsats loser bara ut om
          foralderns hojd ar bestamd. Hos mig gjorde den det; hos Per gjorde
          den inte det, och rutan blev 1543 px hog i ett 1138 px fonster med
          knappraden en bra bit nedanfor skarmkanten. Vilken lank i kedjan som
          brast gick inte att se harifran - darfor beror taket nu inte pa
          kedjan alls. Uppmatt: 578 px i ett 610 px fonster, som ett absolut
          pixelvarde. */}
      <div className="relative z-10 my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex shrink-0 items-center justify-between px-6 pb-4 pt-6">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-card-hover hover:text-ink" aria-label="Stäng">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        {/* Bara innehållet rullar, rubriken står kvar.

            Knappraden låg förut sist i innehållet, alltså inne i det som
            rullar. I en lång ruta — kalenderns har nio fält — hamnade Spara
            nedanför kanten, och ingenting visade att det gick att rulla. Det
            såg ut som att knappen inte fanns. Skickas den in som footer
            ligger den utanför rullningen och syns alltid. */}
        <div className={`min-h-0 flex-1 overflow-y-auto px-6 ${footer ? 'pb-4' : 'pb-6'}`}>{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border px-6 py-4">{footer}</div>
        )}
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
