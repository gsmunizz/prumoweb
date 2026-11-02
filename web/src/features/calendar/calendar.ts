import type { Category, ISODate, Transaction } from '../../db/types'
import { shiftMonth, toISODate } from '../../lib/dates'
import { isInternal } from '../transactions/summary'

// Gasto do dia acima de EXCEPTIONAL_FACTOR vezes a média do mês é "excepcional" (CAL-05).
export const EXCEPTIONAL_FACTOR = 2.5

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(y, m, 0).getDate()
}

// Soma as despesas por dia (AAAA-MM-DD). Receitas, transferências e aportes não entram.
export function expenseByDay(txs: Transaction[]): Map<ISODate, number> {
  const sums = new Map<ISODate, number>()
  for (const t of txs) {
    if (t.type !== 'expense' || isInternal(t)) continue
    sums.set(t.date, (sums.get(t.date) ?? 0) + t.amount_cents)
  }
  return sums
}

export interface MonthSummary {
  total: number
  average: number
  emptyDays: number
  // Dias que já valem para a média: o mês todo, ou até hoje no mês corrente; nenhum no futuro.
  elapsed: number
}

export function summarizeMonth(byDay: Map<ISODate, number>, month: string, now: ISODate): MonthSummary {
  const last = daysInMonth(month)
  const elapsed = month > now.slice(0, 7) ? 0 : month === now.slice(0, 7) ? Number(now.slice(8)) : last
  let total = 0
  let emptyDays = 0
  for (let d = 1; d <= elapsed; d++) {
    const cents = byDay.get(`${month}-${String(d).padStart(2, '0')}`) ?? 0
    total += cents
    if (cents === 0) emptyDays++
  }
  return { total, average: elapsed ? Math.round(total / elapsed) : 0, emptyDays, elapsed }
}

// 0 = sem gasto; 1 a 4 pela razão do gasto do dia sobre a média diária.
export type Level = 0 | 1 | 2 | 3 | 4

export function level(cents: number, average: number): Level {
  if (cents <= 0) return 0
  if (average <= 0) return 4
  const r = cents / average
  return r < 0.4 ? 1 : r < 1 ? 2 : r < 2 ? 3 : 4
}

export const isExceptional = (cents: number, average: number) => average > 0 && cents > average * EXCEPTIONAL_FACTOR

export interface DayCategory {
  name: string
  color: string
  cents: number
  pct: number
}

// As três maiores categorias de despesa do dia, com a parcela de cada uma no total.
export function dayCategories(txs: Transaction[], categories: Category[], limit = 3): DayCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const sums = new Map<string, DayCategory>()
  let total = 0
  for (const t of txs) {
    const cat = t.category_id ? byId.get(t.category_id) : undefined
    const key = cat?.id ?? 'none'
    const row = sums.get(key) ?? { name: cat?.name ?? 'Sem categoria', color: cat?.color ?? '#98A2B3', cents: 0, pct: 0 }
    row.cents += t.amount_cents
    sums.set(key, row)
    total += t.amount_cents
  }
  return [...sums.values()]
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit)
    .map((r) => ({ ...r, pct: total ? Math.round((r.cents / total) * 100) : 0 }))
}

export interface Cell {
  date: ISODate | null
  cents: number
}

// Mapa de calor das últimas `months` semanas completas: uma coluna por semana (domingo a
// sábado), do mais antigo ao mais novo, de modo que o último mês termine no fim da grade.
export function heatStrip(byDay: Map<ISODate, number>, month: string, months = 6): { cells: Cell[]; from: ISODate; to: ISODate } {
  const [fy, fm] = shiftMonth(month, -(months - 1)).split('-').map(Number) as [number, number]
  const start = new Date(fy, fm - 1, 1)
  const end = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0)
  const cells: Cell[] = []
  for (let i = 0; i < start.getDay(); i++) cells.push({ date: null, cents: 0 })
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = toISODate(d)
    cells.push({ date: iso, cents: byDay.get(iso) ?? 0 })
  }
  return { cells, from: toISODate(start), to: toISODate(end) }
}
