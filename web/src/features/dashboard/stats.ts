import type { Account, Category, ISODate, Transaction } from '../../db/types'
import { shiftMonth } from '../../lib/dates'
import { isInternal } from '../transactions/summary'

const signedCents = (t: Transaction) => (t.type === 'income' ? t.amount_cents : -t.amount_cents)

// Saldo das contas ativas até a data: saldo inicial mais todos os lançamentos, inclusive as
// pernas de transferência e de aporte, porque movem dinheiro entre contas (TRX-12, INV-15).
export function balance(accounts: Account[], txs: Transaction[], until: ISODate): number {
  const ids = new Set(accounts.filter((a) => !a.archived).map((a) => a.id))
  let total = 0
  for (const a of accounts) if (ids.has(a.id)) total += a.initial_balance_cents
  for (const t of txs) if (ids.has(t.account_id) && t.date <= until) total += signedCents(t)
  return total
}

export interface MonthStats {
  income: number
  expense: number
  net: number
}

// Receitas e despesas do mês, sem transferências nem aportes.
export function monthStats(txs: Transaction[], month: string): MonthStats {
  let income = 0
  let expense = 0
  for (const t of txs) {
    if (!t.date.startsWith(month) || isInternal(t)) continue
    if (t.type === 'income') income += t.amount_cents
    else expense += t.amount_cents
  }
  return { income, expense, net: income - expense }
}

// Variação percentual de um valor sobre o anterior; null quando não há base de comparação.
export function variation(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null
}

export interface CategorySlice {
  name: string
  color: string
  cents: number
  pct: number
}

const OTHERS_COLOR = '#98A2B3'

// Despesas do mês por categoria: as `limit - 1` maiores e o resto agrupado em "Outros".
export function expensesByCategory(txs: Transaction[], categories: Category[], month: string, limit = 6): CategorySlice[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const sums = new Map<string, { name: string; color: string; cents: number }>()
  let total = 0
  for (const t of txs) {
    if (t.type !== 'expense' || !t.date.startsWith(month) || isInternal(t)) continue
    const cat = t.category_id ? byId.get(t.category_id) : undefined
    const key = cat?.id ?? 'none'
    const row = sums.get(key) ?? { name: cat?.name ?? 'Sem categoria', color: cat?.color ?? OTHERS_COLOR, cents: 0 }
    row.cents += t.amount_cents
    sums.set(key, row)
    total += t.amount_cents
  }
  const sorted = [...sums.values()].sort((a, b) => b.cents - a.cents)
  const head = sorted.slice(0, limit - 1)
  const rest = sorted.slice(limit - 1).reduce((n, r) => n + r.cents, 0)
  const slices = rest > 0 ? [...head, { name: 'Outros', color: OTHERS_COLOR, cents: rest }] : head
  return slices.map((s) => ({ ...s, pct: total ? (s.cents / total) * 100 : 0 }))
}

export function topExpenses(txs: Transaction[], month: string, n = 5): Transaction[] {
  return txs
    .filter((t) => t.type === 'expense' && t.date.startsWith(month) && !isInternal(t))
    .sort((a, b) => b.amount_cents - a.amount_cents)
    .slice(0, n)
}

export interface MonthPoint extends MonthStats {
  month: string
}

// Série dos últimos `count` meses terminando em `month`, do mais antigo ao mais novo.
export function lastMonths(txs: Transaction[], month: string, count = 6): MonthPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(month, i - (count - 1))
    return { month: m, ...monthStats(txs, m) }
  })
}
