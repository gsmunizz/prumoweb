import { useMemo, useState } from 'react'
import { db } from '../../db'
import type { Category, EntryType } from '../../db/types'
import { IconEdit, IconPlus, IconTrash, PageHead, SectionNav, Segmented, SidePanel, TabletSheet, ghostButton, primaryButton, widePage } from '../../components/wide'
import { monthLabel, monthOf, today } from '../../lib/dates'
import { CategoryIcon, categoryIconKeys, tint } from '../../lib/icons'
import { palette } from '../../lib/palette'
import { useLive } from '../../lib/useLive'
import { deleteRecord, saveRecord } from '../../sync'
import { isDuplicateName } from '../accounts/rules'

type Editing = { kind: 'new' } | { kind: 'edit'; category: Category } | { kind: 'delete'; category: Category }

// Categorias no tablet (lista, abas e folha de 640px) e no desktop (lista com painel lateral).
// Designs "Tablet · Categorias" e "Desktop · Categorias".
export function CategoriesWide({ variant }: { variant: 'tablet' | 'desktop' }) {
  const desktop = variant === 'desktop'
  const cats = useLive(() => db.categories.filter((c) => !c.deleted_at).toArray(), [])
  const txs = useLive(() => db.transactions.filter((t) => !t.deleted_at).toArray(), [])
  const [tab, setTab] = useState<EntryType>('expense')
  const [editing, setEditing] = useState<Editing | null>(null)

  const month = monthOf(today())
  const uses = useMemo(() => {
    const all = new Map<string, number>()
    const inMonth = new Map<string, number>()
    for (const t of txs ?? []) {
      if (!t.category_id) continue
      all.set(t.category_id, (all.get(t.category_id) ?? 0) + 1)
      if (t.date.startsWith(month)) inMonth.set(t.category_id, (inMonth.get(t.category_id) ?? 0) + 1)
    }
    return { all, inMonth }
  }, [txs, month])

  const list = (cats ?? []).filter((c) => c.type === tab).sort((a, b) => a.sort_order - b.sort_order)
  const selectedId = editing && editing.kind !== 'new' ? editing.category.id : null
  const close = () => setEditing(null)
  const panelTitle = editing?.kind === 'new' ? 'Nova categoria' : editing?.kind === 'edit' ? 'Editar categoria' : 'Excluir categoria'
  const monthName = monthLabel(month).split(' ')[0]!.toLowerCase()

  const form = editing && editing.kind !== 'delete' && (
    <CategoryForm
      key={editing.kind === 'edit' ? editing.category.id : 'new'}
      existing={editing.kind === 'edit' ? editing.category : undefined}
      initialType={tab}
      all={cats ?? []}
      onClose={close}
    />
  )

  const confirm = editing?.kind === 'delete' && (() => {
    const n = uses.all.get(editing.category.id) ?? 0
    if (n > 0) {
      return (
        <div className="flex flex-col gap-4">
          <p className="rounded-field bg-bg px-3.5 py-3 text-sm leading-normal text-ink-2">
            <strong className="text-ink">{editing.category.name}</strong> está em {n} {n === 1 ? 'transação' : 'transações'}. Para excluí-la, troque a categoria dessas transações antes.
          </p>
          <button onClick={close} className={`${ghostButton} h-[52px]`}>
            Entendi
          </button>
        </div>
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-normal text-ink-2">
          Excluir <strong className="text-ink">{editing.category.name}</strong> remove a categoria de todos os seus aparelhos. Esta ação não pode ser desfeita.
        </p>
        <div className="flex gap-2.5">
          <button onClick={close} className={`${ghostButton} h-[52px] flex-1`}>
            Manter
          </button>
          <button
            onClick={async () => {
              await deleteRecord('categories', editing.category.id)
              close()
            }}
            className="h-[52px] flex-1 rounded-[14px] bg-error text-[15px] font-extrabold text-white"
          >
            Sim, excluir
          </button>
        </div>
      </div>
    )
  })()

  return (
    <main className={widePage}>
      <PageHead
        size={desktop ? 28 : 26}
        title="Categorias"
        subtitle={desktop ? 'Organize como você classifica receitas e despesas' : 'Como você classifica receitas e despesas'}
        action={
          <button onClick={() => setEditing({ kind: 'new' })} className={`${primaryButton} h-12 ${desktop ? 'px-5' : 'px-[18px]'}`}>
            <IconPlus />
            {desktop ? 'Nova categoria' : 'Nova'}
          </button>
        }
      />
      {!desktop && <SectionNav current="categorias" />}
      <Segmented
        label="Tipo de categoria"
        value={tab}
        onChange={(v) => {
          setTab(v)
          setEditing(null)
        }}
        options={[
          { value: 'expense', label: 'Despesas' },
          { value: 'income', label: 'Receitas' },
        ]}
      />

      <div className={desktop ? 'flex flex-wrap items-start gap-6' : 'contents'}>
        <section className="min-w-0 flex-[3_1_460px] overflow-hidden rounded-card border border-line bg-surface">
          {cats === undefined ? (
            <p role="status" className="py-10 text-center text-sm text-ink-3">
              Carregando…
            </p>
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">Nenhuma categoria.</p>
          ) : (
            <ul>
              {list.map((c, i) => {
                const n = uses.inMonth.get(c.id) ?? 0
                return (
                  <li key={c.id} className={`flex items-center gap-3.5 ${desktop ? 'py-2.5 pl-5 pr-4' : 'py-2 pl-[18px] pr-3'} ${i ? 'border-t border-line' : ''} ${selectedId === c.id ? 'bg-cobalt-soft/40' : ''}`}>
                    <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={tint(c.color)}>
                      <CategoryIcon name={c.icon} size={22} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-extrabold">{c.name}</span>
                      <span className="text-[13px] font-semibold text-ink-3">
                        {n} {n === 1 ? 'transação' : 'transações'} em {monthName}
                      </span>
                    </span>
                    <button onClick={() => setEditing({ kind: 'edit', category: c })} aria-label={`Editar ${c.name}`} className="grid size-11 place-items-center rounded-xl text-ink-2">
                      <IconEdit />
                    </button>
                    <button onClick={() => setEditing({ kind: 'delete', category: c })} aria-label={`Excluir ${c.name}`} className="grid size-11 place-items-center rounded-xl text-error">
                      <IconTrash />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {desktop && editing && (
          <SidePanel title={panelTitle} onClose={close}>
            {form}
            {confirm}
          </SidePanel>
        )}
      </div>

      {!desktop && editing && (
        <TabletSheet title={panelTitle} onClose={close}>
          {form}
          {confirm}
        </TabletSheet>
      )}
    </main>
  )
}

function CategoryForm({ existing, initialType, all, onClose }: { existing?: Category; initialType: EntryType; all: Category[]; onClose: () => void }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? 'tag')
  const [color, setColor] = useState(existing?.color ?? '#2446D8')
  const [error, setError] = useState<string | null>(null)
  const type = existing?.type ?? initialType

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Dê um nome para a categoria.')
    if (isDuplicateName(n, all.filter((c) => c.type === type), existing?.id)) return setError('Já existe uma categoria com esse nome neste tipo.')
    const now = new Date().toISOString()
    await saveRecord('categories', {
      ...(existing ?? { created_at: now, deleted_at: null, sort_order: Math.max(-1, ...all.map((c) => c.sort_order)) + 1 }),
      id: existing?.id ?? crypto.randomUUID(),
      updated_at: now,
      name: n,
      type,
      icon,
      color,
    } as Category)
    onClose()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl bg-bg px-4 py-3.5">
        <span className="grid size-12 place-items-center rounded-[15px]" style={tint(color)}>
          <CategoryIcon name={icon} size={24} />
        </span>
        <span className="text-base font-extrabold">{name.trim() || 'Nova categoria'}</span>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-extrabold">
        Nome
        <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Pets" className="h-12 rounded-[14px] border border-line bg-surface px-3.5 text-[15px] font-medium outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30" />
      </label>
      <div role="radiogroup" aria-label="Cor" className="flex flex-col gap-2">
        <span className="text-[13px] font-extrabold">Cor</span>
        <div className="flex flex-wrap gap-2.5">
          {palette.map((w) => {
            const on = w.color.toLowerCase() === color.toLowerCase()
            return (
              <button key={w.color} type="button" role="radio" aria-checked={on} aria-label={w.name} onClick={() => setColor(w.color)} className="grid size-11 place-items-center rounded-full" style={{ border: on ? '2px solid var(--color-cobalt)' : '1px solid var(--color-line)', background: `color-mix(in srgb, ${w.color} 12%, transparent)` }}>
                <span className="size-[22px] rounded-full" style={{ background: w.color }} />
              </button>
            )
          })}
        </div>
      </div>
      <div role="radiogroup" aria-label="Ícone" className="flex flex-col gap-2">
        <span className="text-[13px] font-extrabold">Ícone</span>
        <div className="flex flex-wrap gap-2">
          {categoryIconKeys.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={k} onClick={() => setIcon(k)} className={`grid size-11 place-items-center rounded-xl border ${icon === k ? 'border-cobalt bg-cobalt-soft text-cobalt' : 'border-line text-ink-2'}`}>
              <CategoryIcon name={k} />
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-field bg-error-soft px-3.5 py-3 text-sm font-semibold text-error">
          {error}
        </p>
      )}
      <div className="flex gap-2.5 pt-1">
        <button type="button" onClick={onClose} className={`${ghostButton} h-[52px] flex-1`}>
          Cancelar
        </button>
        <button type="submit" className={`${primaryButton} h-[52px] flex-1`}>
          Salvar categoria
        </button>
      </div>
    </form>
  )
}
