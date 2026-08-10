import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRoll } from '../lib/roll'
import CommandPalette from './CommandPalette'

const navItems = [
  { to: '/', label: 'Översikt', emoji: '🪐' },
  { to: '/mejl', label: 'Mejl', emoji: '✉️' },
  { to: '/uppgifter', label: 'Uppgifter & Mål', emoji: '✅' },
  { to: '/vanor', label: 'Vanor', emoji: '🔁' },
  { to: '/traning', label: 'Träning', emoji: '💪' },
  { to: '/kalender', label: 'Kalender', emoji: '📅' },
  { to: '/anteckningar', label: 'Anteckningar', emoji: '📝' },
  { to: '/lankar', label: 'Länkar', emoji: '🔗' },
  { to: '/ekonomi', label: 'Ekonomi', emoji: '💰' },
  { to: '/vecka', label: 'Veckogranskning', emoji: '🧭' },
]

// Tio val fick plats i en sidledsscroll, men det som ligger utanför kanten
// hittar man aldrig. De fyra man faktiskt öppnar varje dag ligger framme,
// resten en tryckning bort.
const SNABBVAL = ['/', '/mejl', '/kalender', '/uppgifter']

// En assistent har bara fått mejlen, kalendern och uppgifterna. Att visa
// menyval som ändå bara ger en tom sida är sämre än att låta bli.
const FOR_DELEGAT = ['/mejl', '/kalender', '/uppgifter']

export default function Layout({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  const plats = useLocation()
  // Mejlvyn behöver hela bredden för lista + läsruta
  const bred = plats.pathname.startsWith('/mejl')
  const [merOppen, setMerOppen] = useState(false)
  const { arDelegat } = useRoll()

  const synliga = useMemo(
    () => (arDelegat ? navItems.filter((i) => FOR_DELEGAT.includes(i.to)) : navItems),
    [arDelegat],
  )
  const iSnabbraden = useMemo(() => synliga.filter((i) => SNABBVAL.includes(i.to)), [synliga])
  const iMerluckan = useMemo(() => synliga.filter((i) => !SNABBVAL.includes(i.to)), [synliga])

  // Luckan ska inte stå kvar öppen ovanpå sidan man just valde
  useEffect(() => { setMerOppen(false) }, [plats.pathname])

  // Översikten och Inställningar hör ägaren till. Skickar en assistent som
  // hamnat där vidare till inkorgen i stället för att visa en tom sida.
  const navigera = useNavigate()
  useEffect(() => {
    if (!arDelegat) return
    if (plats.pathname === '/' || plats.pathname.startsWith('/installningar')) {
      navigera('/mejl', { replace: true })
    }
  }, [arDelegat, plats.pathname, navigera])

  return (
    <div className="flex min-h-screen">
      {/* Sidomeny (desktop) — krymper till ikonrad i mejlvyn för att ge plats åt mappar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface/60 backdrop-blur-xl transition-[width] duration-200 md:flex ${
          bred ? 'w-16' : 'w-60'
        }`}
      >
        <div className={`flex items-center gap-2 py-6 ${bred ? 'justify-center px-0' : 'px-6'}`}>
          <span className="text-2xl">🪐</span>
          {!bred && <span className="text-xl font-bold tracking-tight">Hubben</span>}
        </div>
        <nav className={`flex-1 space-y-1 ${bred ? 'px-2' : 'px-3'}`}>
          {synliga.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={bred ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                  bred ? 'justify-center px-0' : 'px-3'
                } ${isActive ? 'bg-accent/15 text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'}`
              }
            >
              <span aria-hidden>{item.emoji}</span>
              {!bred && item.label}
            </NavLink>
          ))}
        </nav>
        <div className={`border-t border-border py-4 ${bred ? 'px-2' : 'px-4'}`}>
          {!arDelegat && <NavLink
            to="/installningar"
            title={bred ? 'Inställningar' : undefined}
            className={({ isActive }) =>
              `mb-3 flex items-center gap-2 rounded-xl py-2 text-sm font-medium transition-colors ${
                bred ? 'justify-center px-0' : 'px-3'
              } ${isActive ? 'bg-accent/15 text-accent-soft' : 'text-muted hover:bg-card-hover hover:text-ink'}`
            }
          >
            <span aria-hidden>⚙️</span>
            {!bred && 'Inställningar'}
          </NavLink>}
          {!bred && (
            <>
              <p className="mb-2 text-[10px] text-muted/70">Tips: <kbd className="rounded border border-border bg-surface px-1">Ctrl</kbd>+<kbd className="rounded border border-border bg-surface px-1">K</kbd> öppnar kommandopaletten</p>
              <p className="mb-2 truncate text-xs text-muted" title={userEmail}>{userEmail}</p>
            </>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            title={bred ? 'Logga ut' : undefined}
            className={`w-full rounded-xl border border-border py-2 text-xs font-medium text-muted transition-colors hover:bg-card-hover hover:text-ink ${bred ? 'px-0' : 'px-3'}`}
          >
            {bred ? '⏻' : 'Logga ut'}
          </button>
        </div>
      </aside>

      {/* Toppbar (mobil) — pt-safe håller den ur vägen för hak och statusrad */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-surface/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xl">🪐</span>
          <span className="font-bold">Hubben</span>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="text-xs text-muted">Logga ut</button>
      </header>

      {/* Innehåll */}
      <main
        className={`min-w-0 flex-1 px-4 pb-[max(6rem,calc(5rem+env(safe-area-inset-bottom)))] pt-[max(4rem,calc(3.5rem+env(safe-area-inset-top)))] md:pb-10 md:pt-8 ${
          bred ? 'md:ml-16 md:px-5' : 'md:ml-60 md:px-8'
        }`}
      >
        <div className={`mx-auto ${bred ? 'max-w-none' : 'max-w-6xl'}`}>{children}</div>
      </main>

      {/* Merluckan (mobil) */}
      {merOppen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMerOppen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-border bg-surface pb-[max(5.5rem,calc(4.75rem+env(safe-area-inset-bottom)))] pt-2 md:hidden">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
            <div className="grid grid-cols-3 gap-1 px-3">
              {iMerluckan.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-center text-[11px] leading-tight ${
                      isActive ? 'bg-accent/15 text-accent-soft' : 'text-muted active:bg-card-hover'
                    }`
                  }
                >
                  <span className="text-xl" aria-hidden>{item.emoji}</span>
                  {item.label}
                </NavLink>
              ))}
              {!arDelegat && (
                <NavLink
                  to="/installningar"
                  className={({ isActive }) =>
                    `flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-center text-[11px] leading-tight ${
                      isActive ? 'bg-accent/15 text-accent-soft' : 'text-muted active:bg-card-hover'
                    }`
                  }
                >
                  <span className="text-xl" aria-hidden>⚙️</span>
                  Inställningar
                </NavLink>
              )}
            </div>
            <p className="mt-3 px-5 text-[11px] text-muted/70">{userEmail}</p>
          </div>
        </>
      )}

      {/* Bottennav (mobil) */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-surface/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl md:hidden">
        {iSnabbraden.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] ${
                isActive ? 'text-accent-soft' : 'text-muted'
              }`
            }
          >
            <span className="text-lg" aria-hidden>{item.emoji}</span>
            {item.label.split(' ')[0]}
          </NavLink>
        ))}
        {(iMerluckan.length > 0 || !arDelegat) && <button
          onClick={() => setMerOppen((v) => !v)}
          aria-expanded={merOppen}
          className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] ${
            merOppen || iMerluckan.some((i) => plats.pathname.startsWith(i.to) && i.to !== '/')
              ? 'text-accent-soft' : 'text-muted'
          }`}
        >
          <span className="text-lg" aria-hidden>{merOppen ? '✕' : '⋯'}</span>
          Mer
        </button>}
      </nav>

      <CommandPalette />
    </div>
  )
}
