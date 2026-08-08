import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getUserId } from '../lib/data'
import { useNewParam } from '../lib/useNewParam'
import type { HubLink } from '../lib/types'
import { Card, Button, Input, Label, Modal, EmptyState, Spinner, SectionTitle } from '../components/ui'

export default function Links() {
  const [links, setLinks] = useState<HubLink[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editLink, setEditLink] = useState<HubLink | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('hub_links').select('*').order('category').order('created_at')
    setLinks(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useNewParam(() => { setEditLink(null); setModal(true) })

  async function remove(id: string) {
    await supabase.from('hub_links').delete().eq('id', id)
    load()
  }

  if (loading) return <Spinner />

  const categories = [...new Set(links.map((l) => l.category))]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Länkar</h1>
        <Button onClick={() => { setEditLink(null); setModal(true) }}>+ Ny länk</Button>
      </div>

      {links.length === 0 ? (
        <Card><EmptyState emoji="🔗" text="Samla dina viktigaste länkar här — banken, jobbet, favoritsidorna." /></Card>
      ) : (
        categories.map((cat) => (
          <div key={cat}>
            <SectionTitle>{cat}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {links.filter((l) => l.category === cat).map((link) => (
                <Card key={link.id} className="group !p-4 transition-colors hover:bg-card-hover">
                  <div className="flex items-center gap-3">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(link.url))}&sz=64`}
                      alt=""
                      className="h-8 w-8 rounded-lg bg-surface p-1"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <a href={link.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-accent-soft">
                        {link.title}
                      </a>
                      <p className="truncate text-xs text-muted">{hostOf(link.url)}</p>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => { setEditLink(link); setModal(true) }} className="p-1 text-xs" aria-label="Redigera">✏️</button>
                      <button onClick={() => remove(link.id)} className="p-1 text-xs" aria-label="Ta bort">🗑️</button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      <LinkModal open={modal} onClose={() => setModal(false)} link={editLink} categories={categories} onSaved={load} />
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function LinkModal({ open, onClose, link, categories, onSaved }: {
  open: boolean; onClose: () => void; link: HubLink | null; categories: string[]; onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => {
    setTitle(link?.title ?? '')
    setUrl(link?.url ?? '')
    setCategory(link?.category ?? '')
  }, [link, open])

  async function save() {
    if (!title.trim() || !url.trim()) return
    let fullUrl = url.trim()
    if (!/^https?:\/\//.test(fullUrl)) fullUrl = `https://${fullUrl}`
    const payload = { title: title.trim(), url: fullUrl, category: category.trim() || 'Övrigt' }
    if (link) {
      await supabase.from('hub_links').update(payload).eq('id', link.id)
    } else {
      const userId = await getUserId()
      await supabase.from('hub_links').insert({ ...payload, user_id: userId })
    }
    onClose()
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} title={link ? 'Redigera länk' : 'Ny länk'}>
      <div className="space-y-4">
        <div>
          <Label>Titel</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. Swedbank" autoFocus />
        </div>
        <div>
          <Label>URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="swedbank.se" />
        </div>
        <div>
          <Label>Kategori</Label>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="T.ex. Ekonomi, Jobb, Nöje…" list="link-categories" />
          <datalist id="link-categories">
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Avbryt</Button>
          <Button onClick={save}>Spara</Button>
        </div>
      </div>
    </Modal>
  )
}
