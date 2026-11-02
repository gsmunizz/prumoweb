import type { ISODate, Transaction } from '../../db/types'
import { monthLabel, monthOf, monthRange, shiftMonth } from '../../lib/dates'

export type TypeFilter = 'all' | 'income' | 'expense'

// Período: um mês (o padrão é o corrente), os três últimos meses ou um intervalo livre.
export type Period = { kind: 'month'; month: string } | { kind: '3m' } | { kind: 'custom'; from: ISODate; to: ISODate }

export interface Filters {
  type: TypeFilter
  period: Period
  categories: string[]
  accounts: string[]
  // Em centavos; null = sem limite.
  min: number | null
  max: number | null
  search: string
}

export const defaultFilters = (now: ISODate): Filters => ({
  type: 'all',
  period: { kind: 'month', month: monthOf(now) },
  categories: [],
  accounts: [],
  min: null,
  max: null,
  search: '',
})

// Intervalo [de, até] do período, inclusive.
export function rangeOf(period: Period, now: ISODate): [ISODate, ISODate] {
  if (period.kind === 'month') return monthRange(period.month)
  if (period.kind === '3m') return [`${shiftMonth(monthOf(now), -2)}-01`, `${monthOf(now)}-31`]
  return [period.from, period.to]
}

export function periodLabel(period: Period): string {
  if (period.kind === 'month') return monthLabel(period.month)
  if (period.kind === '3m') return `Últimos 3 meses`
  const fmt = (d: ISODate) => d.split('-').reverse().join('/')
  return `${fmt(period.from)} a ${fmt(period.to)}`
}

// Quantos filtros do painel estão fora do padrão (o tipo fica nas abas da tela).
export function activeCount(f: Filters, now: ISODate): number {
  const isDefaultPeriod = f.period.kind === 'month' && f.period.month === monthOf(now)
  return [!isDefaultPeriod, f.categories.length > 0, f.accounts.length > 0, f.min !== null || f.max !== null].filter(Boolean).length
}

export function applyFilters(list: Transaction[], f: Filters): Transaction[] {
  const q = f.search.trim().toLocaleLowerCase('pt-BR')
  return list.filter((t) => {
    if (f.type !== 'all' && t.type !== f.type) return false
    if (f.categories.length && !(t.category_id && f.categories.includes(t.category_id))) return false
    if (f.accounts.length && !f.accounts.includes(t.account_id)) return false
    if (f.min !== null && t.amount_cents < f.min) return false
    if (f.max !== null && t.amount_cents > f.max) return false
    return !q || (t.description ?? '').toLocaleLowerCase('pt-BR').includes(q)
  })
}
