import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ColorPicker } from '../../components/ColorPicker'
import { Sheet } from '../../components/Sheet'
import { Button, Field, FormError } from '../../components/ui'
import { db } from '../../db'
import type { Category, EntryType } from '../../db/types'
import { monthOf, today } from '../../lib/dates'
import { CategoryIcon, categoryIconKeys, tint } from '../../lib/icons'
import { useLive } from '../../lib/useLive'
import { deleteRecord, saveRecord } from '../../sync'
import { isDuplicateName } from '../accounts/rules'

// Categorias (design "07 · Categorias"): listas de despesas e receitas e edição em folha.
export function CategoriesPage() {
  const cats = useLive(() => db.categories.filter((c) => !c.deleted_at).toArray(), [])
  const txs = useLive(() => db.transactions.filter((t) => !t.deleted_at).toArray(), [])
  const [editing, setEditing] = useState<{ category?: Category; type: EntryType } | null>(null)

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

  const sections: { type: EntryType; title: string; tone: string; arrow: string }[] = [
    { type: 'expense', title: 'Despesas', tone: 'bg-expense-soft text-expense', arrow: 'M7 17 17 7M8 7h9v9' },
    { type: 'income', title: 'Receitas', tone: 'bg-income-soft text-income', arrow: 'M17 7 7 17M16 17H7V8' },
  ]

  return (
    <main className="flex flex-col gap-5 px-4 pb-24">
      <header className="flex items-center justify-between pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <Link to="/mais" aria-label="Voltar" className="grid size-11 place-items-center rounded-field">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <h1 className="text-[17px] font-extrabold">Categorias</h1>
        <button onClick={() => setEditing({ type: 'expense' })} aria-label="Nova categoria" className="grid size-11 place-items-center rounded-field bg-cobalt text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </header>

      {cats === undefined ? (
        <p role="status" className="py-10 text-center text-sm text-ink-3">Carregando…</p>
      ) : (
        sections.map((s) => {
          const list = cats.filter((c) => c.type === s.type).sort((a, b) => a.sort_order - b.sort_order)
          return (
            <section key={s.type} className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-[15px] font-extrabold">
                  <span aria-hidden="true" className={`grid size-6 place-items-center rounded-lg ${s.tone}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={s.arrow} /></svg>
                  </span>
                  {s.title}
                </h2>
                <span className="text-[13px] font-semibold text-ink-2">{list.length} {list.length === 1 ? 'categoria' : 'categorias'}</span>
              </div>
              <ul className="divide-y divide-line rounded-card border border-line bg-surface px-4">
                {list.map((c) => {
                  const n = uses.inMonth.get(c.id) ?? 0
                  return (
                    <li key={c.id}>
                      <button onClick={() => setEditing({ category: c, type: c.type })} className="flex w-full items-center gap-3 py-3 text-left">
                        <span className="grid size-11 shrink-0 place-items-center rounded-[14px]" style={tint(c.color)}>
                          <CategoryIcon name={c.icon} />
                        </span>
                        <span className="flex flex-1 flex-col gap-0.5">
                          <span className="text-[15px] font-bold">{c.name}</span>
                          <span className="text-xs font-semibold text-ink-3">{n ? `${n} ${n === 1 ? 'transação' : 'transações'} neste mês` : 'Sem uso neste mês'}</span>
                        </span>
                        <span aria-hidden="true" className="size-3.5 rounded-full" style={{ background: c.color }} />
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-3" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                      </button>
                    </li>
                  )
                })}
                {list.length === 0 && <li className="py-6 text-center text-sm text-ink-3">Nenhuma categoria.</li>}
              </ul>
            </section>
          )
        })
      )}

      {editing && (
        <CategorySheet
          existing={editing.category}
          initialType={editing.type}
          all={cats ?? []}
          uses={editing.category ? (uses.all.get(editing.category.id) ?? 0) : 0}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  )
}

function CategorySheet({ existing, initialType, all, uses, onClose }: { existing?: Category; initialType: EntryType; all: Category[]; uses: number; onClose: () => void }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<EntryType>(existing?.type ?? initialType)
  const [icon, setIcon] = useState(existing?.icon ?? 'tag')
  const [color, setColor] = useState(existing?.color ?? '#2446D8')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

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

  async function remove() {
    if (!existing) return
    await deleteRecord('categories', existing.id)
    onClose()
  }

  return (
    <Sheet title={existing ? 'Editar categoria' : 'Nova categoria'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <span className="mb-0.5 grid size-[52px] shrink-0 place-items-center rounded-2xl" style={tint(color)}>
            <CategoryIcon name={icon} size={24} />
          </span>
          <div className="flex-1">
            <Field label="Nome" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        {!existing && (
          <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-1 rounded-field bg-bg p-1">
            {(['expense', 'income'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} className={`h-10 rounded-[10px] text-sm font-extrabold ${type === t ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
                {t === 'expense' ? 'Despesa' : 'Receita'}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-ink-2">Ícone</span>
          <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-6 gap-2">
            {categoryIconKeys.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={k} onClick={() => setIcon(k)} className={`grid size-11 place-items-center rounded-xl border ${icon === k ? 'border-cobalt bg-cobalt-soft text-cobalt' : 'border-line text-ink-2'}`}>
                <CategoryIcon name={k} />
              </button>
            ))}
          </div>
        </div>
        <ColorPicker value={color} onChange={setColor} />
        {error && <FormError>{error}</FormError>}
        <Button type="submit">{existing ? 'Salvar alterações' : 'Criar categoria'}</Button>
      </form>

      {existing &&
        (uses > 0 ? (
          <p className="rounded-field bg-bg px-3.5 py-3 text-sm text-ink-2">
            Esta categoria está em {uses} {uses === 1 ? 'transação' : 'transações'}. Para excluí-la, troque a categoria dessas transações antes.
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-2">
            <button onClick={() => void remove()} className="h-12 rounded-2xl bg-error text-base font-extrabold text-white">Sim, excluir categoria</button>
            <button onClick={() => setConfirming(false)} className="h-12 rounded-2xl bg-bg text-base font-extrabold">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="h-12 rounded-2xl border-[1.5px] border-error/40 text-base font-extrabold text-error">Excluir categoria</button>
        ))}
    </Sheet>
  )
}
