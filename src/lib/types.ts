export interface HubProject {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
}

export interface HubTask {
  id: string
  user_id: string
  project_id: string | null
  title: string
  notes: string | null
  priority: 1 | 2 | 3
  due_date: string | null
  done: boolean
  completed_at: string | null
  sort_order: number
  created_at: string
}

export interface HubGoal {
  id: string
  user_id: string
  title: string
  description: string | null
  target_date: string | null
  progress: number
  created_at: string
}

export interface HubHabit {
  id: string
  user_id: string
  name: string
  emoji: string
  color: string
  target_per_week: number
  archived: boolean
  created_at: string
}

export interface HubHabitLog {
  id: string
  habit_id: string
  user_id: string
  log_date: string
}

export interface HubEvent {
  id: string
  user_id: string
  title: string
  description: string | null
  location: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  color: string
  created_at: string
}

export interface HubNote {
  id: string
  user_id: string
  title: string
  content: string
  pinned: boolean
  tags: string[]
  created_at: string
  updated_at: string
}

export interface HubLink {
  id: string
  user_id: string
  title: string
  url: string
  category: string
  created_at: string
}

export interface HubTransaction {
  id: string
  user_id: string
  kind: 'income' | 'expense'
  amount: number
  category: string
  description: string | null
  tx_date: string
  created_at: string
}

export interface HubBudget {
  id: string
  user_id: string
  category: string
  monthly_limit: number
}

export interface HubWorkout {
  id: string
  user_id: string
  workout_date: string
  kind: string
  duration_min: number
  intensity: 1 | 2 | 3 | 4 | 5
  notes: string | null
  created_at: string
}

export interface HubWeeklyReview {
  id: string
  user_id: string
  week_start: string
  focus: string
  priorities: string[]
  wins: string
  carried_over: string
  completed_at: string | null
  created_at: string
}

export interface HubMailAccount {
  id: string
  user_id: string
  email: string
  label: string
  provider: 'imap' | 'gmail' | 'outlook'
  imap_host: string | null
  imap_port: number
  smtp_host: string | null
  smtp_port: number
  color: string
  active: boolean
  signature: string
  secret_id: string | null
  last_checked_at: string | null
  last_error: string | null
  sort_order: number
  created_at: string
}

export interface HubStock {
  id: string
  user_id: string
  symbol: string
  label: string | null
  sort_order: number
  created_at: string
}

export interface MarketQuote {
  symbol: string
  name?: string
  currency?: string
  price?: number
  prevClose?: number
  spark?: number[]
  error?: boolean
}

export interface HubSavingsGoal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
  created_at: string
}
