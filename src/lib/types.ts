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

export interface HubSavingsGoal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
  created_at: string
}
