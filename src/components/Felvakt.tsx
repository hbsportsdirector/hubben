import { useEffect, useState } from 'react'

/** Fångar upp fel som annars aldrig hade synts.
 *
 *  Bakgrunden: en misslyckad databasskrivning vars `error` ingen läste gjorde
 *  ingenting alls — appen fortsatte som om det gått bra. Uppgiften som
 *  försvann och mejlet som såg flyttat ut men låg kvar var samma bugg två
 *  gånger. Skrivningarna kastar numera i stället (`.throwOnError()`), och det
 *  här är stället där kastet blir synligt.
 *
 *  Varför inte en React error boundary: den fångar bara fel under rendering.
 *  Nästan allt i Hubben händer i klickhanterare och await-kedjor, och där ser
 *  en boundary ingenting. `unhandledrejection` är det som faktiskt fångar dem.
 */
export default function Felvakt() {
  const [fel, setFel] = useState<string | null>(null)

  useEffect(() => {
    const text = (v: unknown): string => {
      if (typeof v === 'string') return v
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>
        // PostgrestError har message + hint; Error har message
        if (typeof o.message === 'string') {
          return o.message + (typeof o.hint === 'string' && o.hint ? ` (${o.hint})` : '')
        }
      }
      return String(v)
    }

    const paAvvisning = (e: PromiseRejectionEvent) => setFel(text(e.reason))
    const paFel = (e: ErrorEvent) => setFel(text(e.error ?? e.message))

    window.addEventListener('unhandledrejection', paAvvisning)
    window.addEventListener('error', paFel)
    return () => {
      window.removeEventListener('unhandledrejection', paAvvisning)
      window.removeEventListener('error', paFel)
    }
  }, [])

  if (!fel) return null

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-[max(3.75rem,calc(3.25rem+env(safe-area-inset-top)))] z-[80] flex justify-center px-3 md:top-4"
    >
      <div className="flex w-full max-w-lg items-start gap-3 rounded-2xl border border-bad/40 bg-card px-4 py-3 shadow-2xl">
        <span aria-hidden className="text-lg leading-none">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-bad">Något gick fel</p>
          {/* Hela meddelandet, inte en tillrättalagd version — det är det som
              gör att felet går att åtgärda i stället för att bara noteras. */}
          <p className="mt-0.5 break-words text-xs text-muted">{fel}</p>
        </div>
        <button
          onClick={() => setFel(null)}
          className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:text-ink"
          aria-label="Stäng"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
