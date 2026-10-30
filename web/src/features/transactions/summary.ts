import type { Transaction } from '../../db/types'

// Totais do período. Transferências entre contas e movimentos de investimento não são
// receita nem despesa (TRX-12, INV-15) e ficam fora das somas.
export function isInternal(t: Transaction): boolean {
  return t.transfer_id !== null || t.investment_movement_id !== null
}

export function summarize(list: Transaction[]): { income: number; expense: number } {
  let income = 0
  let expense = 0
  for (const t of list) {
    if (isInternal(t)) continue
    if (t.type === 'income') income += t.amount_cents
    else expense += t.amount_cents
  }
  return { income, expense }
}

export interface DayGroup {
  date: string
  items: Transaction[]
  net: number
}

// Agrupa por dia, do mais recente ao mais antigo; dentro do dia, o lançado por último primeiro.
export function groupByDay(list: Transaction[]): DayGroup[] {
  const sorted = [...list].sort((a, b) => (a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date)))
  const groups: DayGroup[] = []
  for (const t of sorted) {
    let g = groups[groups.length - 1]
    if (!g || g.date !== t.date) {
      g = { date: t.date, items: [], net: 0 }
      groups.push(g)
    }
    g.items.push(t)
    if (!isInternal(t)) g.net += t.type === 'income' ? t.amount_cents : -t.amount_cents
  }
  return groups
}
