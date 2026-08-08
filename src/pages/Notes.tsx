import { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import { sv } from 'date-fns/locale'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { useNewParam } from '../lib/useNewParam'
import type { HubNote } from '../lib/types'
import { Card, Button, Input, Label, Modal, EmptyState, Spinner, Textarea } from '../components/ui'

export default function Notes() {
  const [notes, setNotes] = useState<HubNote[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editNote, setEditNote] = useState<HubNote | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('hub_notes').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false })
    setNotes(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useNewParam(() => { setEditNote(null); setModal(true) })

  async function togglePin(note: HubNote) {
    await supabase.from('hub_notes').update({ pinned: !note.pinned }).eq('id', note.id)
    load()
  }

  async function remove(id: string) {
    await supabase.from('hub_notes').delete().eq('id', id)
    load()
  }

  if (loading) return <Spinner />

  const q = search.toLowerCase()
  const visible = notes.filter((n) =>
    !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Anteckningar</h1>
        <Button onClick={() => { setEditNote(null); setModal(true) }}>+ Ny anteckning</Button>
      </div>

      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 Sök i anteckningar…" className="max-w-md" />

      {visible.length === 0 ? (
        <Card><EmptyState emoji="📝" text={search ? 'Inga träffar.' : 'Inga anteckningar än — skriv din första!'} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((note) => (
            <Card key={note.id} className="group flex cursor-pointer flex-col transition-colors hover:bg-card-hover" >
              <div onClick={() => { setEditNote(note); setModal(true) }} className="flex-1">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{note.pinned && '📌 '}{note.title || 'Utan titel'}</h3>
                </div>
                <p className="line-clamp-5 whitespace-pre-wrap text-sm text-muted">{note.content}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                <div className="flex flex-wrap gap-1">
                  {note.tags.map((t) => (
                    <span key={t} className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent-soft">#{t}</span>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted">{format(parseISO(note.updated_at), 'd MMM', { locale: sv })}</span>
                  <button onClick={(e) => { e.stopPropagation(); togglePin(note) }} className="p-1 text-xs opacity-0 transition-opacity group-hover:opacity-100" aria-label={note.pinned ? 'Lossa' : 'Fäst'}>
                    {note.pinned ? '📍' : '📌'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); remove(note.id) }} className="p-1 text-xs opacity-0 transition-opacity group-hover:opacity-100" aria-label="Ta bort">🗑️</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NoteModal open={modal} onClose={() => setModal(false)} note={editNote} onSaved={load} />
    </div>
  )
}

function NoteModal({ open, onClose, note, onSaved }: { open: boolean; onClose: () => void; note: HubNote | null; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')

  useEffect(() => {
    setTitle(note?.title ?? '')
    setContent(note?.content ?? '')
    setTags(note?.tags.join(', ') ?? '')
  }, [note, open])

  async function save() {
    if (!title.trim() && !content.trim()) return
    const tagList = tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    const payload = { title: title.trim(), content, tags: tagList, updated_at: new Date().toISOString() }
    if (note) {
      await supabase.from('hub_notes').update(payload).eq('id', note.id)
    } else {
      const userId = await getUserId()
      await supabase.from('hub_notes').insert({ ...payload, user_id: userId })
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={note ? 'Redigera anteckning' : 'Ny anteckning'}>
      <div className="space-y-4">
        <div>
          <Label>Titel</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rubrik" autoFocus />
        </div>
        <div>
          <Label>Innehåll</Label>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Skriv fritt…" className="min-h-48" />
        </div>
        <div>
          <Label>Taggar (kommaseparerade)</Label>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="idéer, jobb, recept…" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
