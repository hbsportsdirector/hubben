import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import Habits from './pages/Habits'
import Calendar from './pages/Calendar'
import Notes from './pages/Notes'
import Links from './pages/Links'
import Economy from './pages/Economy'
import Training from './pages/Training'
import WeeklyReview from './pages/WeeklyReview'
import Settings from './pages/Settings'
import Mail from './pages/Mail'
import Gallring from './pages/Gallring'
import Boka from './pages/Boka'
import Bokningar from './pages/Bokningar'
import Drive from './pages/Drive'
import Felvakt from './components/Felvakt'
import { Spinner } from './components/ui'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const plats = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Bokningssidan ligger FÖRE inloggningsspärren — den är till för andra
  // människor, som varken har eller ska ha ett konto här. Den läser ingenting
  // direkt ur databasen; allt går via två funktioner som bara lämnar ut
  // mötets namn och de lediga tiderna. Se Boka.tsx.
  //
  // Två adresser leder hit. /b/ är den korta man kan säga i telefon, /boka/
  // den ursprungliga med den långa token. Den gamla slutar aldrig gälla bara
  // för att en kortare tillkommit — någon kan redan ha fått den.
  if (plats.pathname.startsWith('/boka/') || plats.pathname.startsWith('/b/')) {
    return (
      <Routes>
        <Route path="/boka/:token" element={<Boka />} />
        <Route path="/b/:token" element={<Boka />} />
      </Routes>
    )
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>
  if (!session) return <Login />
  if (session.user.user_metadata?.must_change_password === true) return <ChangePassword />

  return (
    <Layout userEmail={session.user.email ?? ''}>
      {/* Utanför Routes: ett fel ska synas oavsett vilken sida man står på */}
      <Felvakt />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/uppgifter" element={<Tasks />} />
        <Route path="/vanor" element={<Habits />} />
        <Route path="/kalender" element={<Calendar />} />
        <Route path="/anteckningar" element={<Notes />} />
        <Route path="/lankar" element={<Links />} />
        <Route path="/ekonomi" element={<Economy />} />
        <Route path="/traning" element={<Training />} />
        <Route path="/vecka" element={<WeeklyReview />} />
        <Route path="/installningar" element={<Settings />} />
        <Route path="/mejl" element={<Mail />} />
        <Route path="/gallring" element={<Gallring />} />
        <Route path="/bokningar" element={<Bokningar />} />
        <Route path="/drive" element={<Drive />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
