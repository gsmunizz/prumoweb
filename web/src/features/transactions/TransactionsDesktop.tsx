import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import type { Account, Category, Transaction } from '../../db/types'
import { IconPlus, PageHead, primaryButton } from '../../components/wide'
import { formatDay, monthLabel, shiftMonth } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { defaultFilters, periodLabel, type Filters, type TypeFilter } from './filters'
import { isInternal } from './summary'

const PAGE = 12
const tabs: [TypeFilter, string][] = [
  ['all', 'Todas'],
  ['income', 'Receitas'],
  ['expense', 'Despesas'],
]

// Transações no desktop (design "Desktop · Transações"): tabela com busca, abas, totais e paginação.
export function TransactionsDesktop({
  list,
  visible,
  filters,
  set,
  filterCount,
  onFilters,
  categories,
  accounts,
  totals,
  now,
}: {
  list: Transaction[] | undefined
  visible: Transaction[]
  filters: Filters
  set: (patch: Partial<Filters>) => void
  filterCount: number
  onFilters: () => void
  categories: Category[]
  accounts: Account[]
  totals: { income: number; expense: number }
  now: string
}) {
  const [page, setPage] = useState(0)
  const catById = new Map(categories.map((c) => [c.id, c]))
  const accById = new Map(accounts.map((a) => [a.id, a.name]))
  const pages = Math.max(1, Math.ceil(visible.length / PAGE))
  useEffect(() => setPage(0), [filters, list])
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE)
  const month = filters.period.kind === 'month' ? filters.period.month : null
  const net = totals.income - totals.expense

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-5 px-8 pb-10 pt-7">
      <PageHead
        title="Transações"
        subtitle={`${visible.length} ${visible.length === 1 ? 'transação' : 'transações'} · ${periodLabel(filters.period)}`}
        action={
          <Link to="/transacoes/nova" className={`${primaryButton} h-12 px-5`}>
            <IconPlus />
            Nova transação
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="busca-desktop">
          Buscar por descrição
        </label>
        <input
          id="busca-desktop"
          type="search"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Buscar por descrição"
          className="h-11 w-full max-w-sm rounded-field border border-line bg-surface px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30"
        />
        <div role="tablist" aria-label="Tipo de transação" className="flex gap-1 rounded-[14px] bg-ink/[0.06] p-1">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={filters.type === key}
              onClick={() => set({ type: key })}
              className={`h-9 rounded-[10px] px-4 text-sm font-extrabold ${filters.type === key ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {month ? (
          <div className="flex items-center gap-1">
            <button onClick={() => set({ period: { kind: 'month', month: shiftMonth(month, -1) } })} aria-label="Mês anterior" className="grid size-11 place-items-center rounded-field border border-line bg-surface">
              ‹
            </button>
            <span className="min-w-36 text-center text-sm font-extrabold">{monthLabel(month)}</span>
            <button onClick={() => set({ period: { kind: 'month', month: shiftMonth(month, 1) } })} aria-label="Próximo mês" className="grid size-11 place-items-center rounded-field border border-line bg-surface">
              ›
            </button>
          </div>
        ) : (
          <button onClick={() => set({ period: defaultFilters(now).period })} className="h-11 rounded-field border border-line bg-surface px-3.5 text-sm font-bold">
            {periodLabel(filters.period)} ✕
          </button>
        )}
        <button onClick={onFilters} className="relative ml-auto flex h-11 items-center gap-2 rounded-field border border-line bg-surface px-4 text-sm font-extrabold">
          Filtros
          {filterCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-cobalt px-1 text-[11px] text-white">{filterCount}</span>}
        </button>
      </div>

      <section className="overflow-hidden rounded-card border border-line bg-surface">
        {list === undefined ? (
          <p role="status" className="py-12 text-center text-sm text-ink-3">
            Carregando…
          </p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <p className="text-base font-extrabold">{list.length > 0 ? 'Nada encontrado' : 'Nenhuma transação neste período'}</p>
            <p className="max-w-72 text-sm text-ink-2">{list.length > 0 ? 'Ajuste a busca ou os filtros para ver mais resultados.' : 'Use “Nova transação” para lançar sua primeira receita ou despesa.'}</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs font-extrabold uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3">Descrição</th>
                <th className="px-3 py-3">Categoria</th>
                <th className="px-3 py-3">Conta</th>
                <th className="px-3 py-3">Data</th>
                <th className="px-5 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const c = t.category_id ? catById.get(t.category_id) : undefined
                const income = t.type === 'income'
                const internal = isInternal(t)
                const title = t.description || c?.name || (internal ? 'Movimentação interna' : 'Sem descrição')
                return (
                  <tr key={t.id} className="border-b border-line last:border-0 hover:bg-bg">
                    <td className="px-5 py-2.5">
                      <Link to="/transacoes/$id" params={{ id: t.id }} className="flex min-h-11 items-center gap-3 text-[15px] font-bold">
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={tint(c?.color ?? '#667085')}>
                          <CategoryIcon name={c?.icon} />
                        </span>
                        <span className="truncate">{title}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-ink-2">{c?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-ink-2">{accById.get(t.account_id) ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm font-semibold text-ink-2">{formatDay(t.date)}</td>
                    <td className={`px-5 py-2.5 text-right text-[15px] font-extrabold ${income && !internal ? 'text-income' : 'text-ink'}`}>
                      {income ? '+' : '−'}
                      {formatCents(t.amount_cents)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
          <span className="font-semibold text-ink-2">
            Entradas <b className="text-income">+{formatCents(totals.income)}</b> · Saídas <b className="text-expense">−{formatCents(totals.expense)}</b> · Saldo <b>{net >= 0 ? '+' : '−'}{formatCents(Math.abs(net))}</b>
          </span>
          <span className="flex items-center gap-2 font-semibold text-ink-2">
            Página {page + 1} de {pages}
            <button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior" className="grid size-10 place-items-center rounded-xl border border-line disabled:opacity-40">
              ‹
            </button>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Próxima página" className="grid size-10 place-items-center rounded-xl border border-line disabled:opacity-40">
              ›
            </button>
          </span>
        </div>
      </section>
    </main>
  )
}
