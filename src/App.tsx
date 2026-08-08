import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
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
import { Spinner } from './components/ui'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>
  if (!session) return <Login />
  if (session.user.user_metadata?.must_change_password === true) return <ChangePassword />

  return (
    <Layout userEmail={session.user.email ?? ''}>
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
