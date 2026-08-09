import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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

export default function Layout({ userEmail, children }: { userEmail: string; children: ReactNode }) {
  // Mejlvyn behöver hela bredden för lista + läsruta
  const bred = useLocation().pathname.startsWith('/mejl')
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
          {navItems.map((item) => (
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
          <NavLink
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
          </NavLink>
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

      {/* Toppbar (mobil) */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xl">🪐</span>
          <span className="font-bold">Hubben</span>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="text-xs text-muted">Logga ut</button>
      </header>

      {/* Innehåll */}
      <main
        className={`min-w-0 flex-1 px-4 pb-24 pt-16 md:pb-10 md:pt-8 ${
          bred ? 'md:ml-16 md:px-5' : 'md:ml-60 md:px-8'
        }`}
      >
        <div className={`mx-auto ${bred ? 'max-w-none' : 'max-w-6xl'}`}>{children}</div>
      </main>

      {/* Bottennav (mobil) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-border bg-surface/90 px-2 py-2 backdrop-blur-xl md:hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-2.5 py-1 text-[10px] ${isActive ? 'text-accent-soft' : 'text-muted'}`}
          >
            <span className="text-base" aria-hidden>{item.emoji}</span>
            {item.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>

      <CommandPalette />
    </div>
  )
}
