import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { Transaction } from '../../db/types'
import { formatDay, monthLabel, shiftMonth, monthOf, today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { useLive } from '../../lib/useLive'
import { activeAccounts, activeCategories, transactionsOfMonth } from './queries'
import { groupByDay, isInternal, summarize } from './summary'

type Tab = 'all' | 'income' | 'expense'
const tabs: [Tab, string][] = [
  ['all', 'Todas'],
  ['income', 'Receitas'],
  ['expense', 'Despesas'],
]

const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${formatCents(Math.abs(cents))}`

export function TransactionsPage() {
  const [month, setMonth] = useState(() => monthOf(today()))
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')

  const list = useLive(() => transactionsOfMonth(month), [month])
  const accounts = useLive(activeAccounts, [])
  const categories = useLive(activeCategories, [])

  const accountName = useMemo(() => new Map(accounts?.map((a) => [a.id, a.name])), [accounts])
  const categoryById = useMemo(() => new Map(categories?.map((c) => [c.id, c])), [categories])

  const visible = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR')
    return (list ?? []).filter((t) => (tab === 'all' || t.type === tab) && (!q || (t.description ?? '').toLocaleLowerCase('pt-BR').includes(q)))
  }, [list, tab, search])

  const totals = summarize(visible)
  const groups = groupByDay(visible)

  return (
    <main className="flex flex-col pb-24">
      <header className="flex items-center justify-between px-4 pb-3 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <h1 className="text-[26px] font-extrabold tracking-tight">Transações</h1>
      </header>

      <div className="px-4 pb-3">
        <label htmlFor="busca" className="sr-only">
          Buscar por descrição
        </label>
        <input
          id="busca"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por descrição"
          className="h-12 w-full rounded-field border border-line bg-surface px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30"
        />
      </div>

      <div role="tablist" aria-label="Tipo de transação" className="flex gap-2 px-4 pb-3">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-10 rounded-full border px-4 text-sm font-bold ${tab === key ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 pb-3">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior" className="grid size-11 place-items-center rounded-field border border-line bg-surface">
          ‹
        </button>
        <span className="text-[15px] font-extrabold">{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês" className="grid size-11 place-items-center rounded-field border border-line bg-surface">
          ›
        </button>
      </div>

      <section aria-label="Totais do período" className="mx-4 mb-2 grid grid-cols-2 rounded-[18px] border border-line bg-surface">
        <div className="flex flex-col gap-0.5 border-r border-line px-4 py-3.5">
          <span className="text-xs font-semibold text-ink-2">Entradas</span>
          <span className="text-[17px] font-extrabold text-income">+{formatCents(totals.income)}</span>
        </div>
        <div className="flex flex-col gap-0.5 px-4 py-3.5">
          <span className="text-xs font-semibold text-ink-2">Saídas</span>
          <span className="text-[17px] font-extrabold text-expense">−{formatCents(totals.expense)}</span>
        </div>
      </section>

      <div className="flex flex-col px-4">
        {list === undefined ? (
          <p role="status" className="py-10 text-center text-sm text-ink-3">
            Carregando…
          </p>
        ) : groups.length === 0 ? (
          <Empty filtered={(list?.length ?? 0) > 0} />
        ) : (
          groups.map((g) => (
            <section key={g.date} aria-label={formatDay(g.date)} className="flex flex-col">
              <div className="flex items-center justify-between px-1 pb-2 pt-[18px]">
                <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-2">{formatDay(g.date)}</h2>
                <span className="text-[13px] font-bold text-ink-2">{signed(g.net)}</span>
              </div>
              <ul className="divide-y divide-line rounded-[18px] border border-line bg-surface px-4">
                {g.items.map((t) => (
                  <Row key={t.id} t={t} category={t.category_id ? categoryById.get(t.category_id) : undefined} account={accountName.get(t.account_id)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <Link
        to="/transacoes/nova"
        aria-label="Nova transação"
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-5 z-10 grid size-[60px] place-items-center rounded-[20px] bg-cobalt text-white shadow-fab"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </main>
  )
}

function Row({ t, category, account }: { t: Transaction; category?: { name: string; icon: string; color: string }; account?: string }) {
  const income = t.type === 'income'
  const internal = isInternal(t)
  const title = t.description || category?.name || (internal ? 'Movimentação interna' : 'Sem descrição')
  return (
    <li>
      <Link to="/transacoes/$id" params={{ id: t.id }} className="flex min-h-11 items-center gap-3 py-3">
        <span className="relative grid size-11 shrink-0 place-items-center rounded-[14px]" style={tint(category?.color ?? '#667085')}>
          <CategoryIcon name={category?.icon} />
          {/* O sentido não depende só da cor: o selo traz a seta de entrada ou saída. */}
          <span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full border-2 border-surface text-white ${income ? 'bg-income' : 'bg-expense'}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={income ? 'M17 7 7 17M16 17H7V8' : 'M7 17 17 7M8 7h9v9'} />
            </svg>
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold">{title}</span>
          <span className="truncate text-[13px] font-medium text-ink-3">{[category?.name, account].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5">
          <span className={`text-[15px] font-extrabold ${income && !internal ? 'text-income' : 'text-ink'}`}>
            {income ? '+' : '−'}
            {formatCents(t.amount_cents)}
          </span>
          <span className="text-xs text-ink-3">{income ? 'Receita' : 'Despesa'}</span>
        </span>
      </Link>
    </li>
  )
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-base font-extrabold">{filtered ? 'Nada encontrado' : 'Nenhuma transação neste mês'}</p>
      <p className="max-w-64 text-sm text-ink-2">
        {filtered ? 'Ajuste a busca ou o tipo para ver mais resultados.' : 'Toque no botão + para lançar sua primeira receita ou despesa.'}
      </p>
    </div>
  )
}
