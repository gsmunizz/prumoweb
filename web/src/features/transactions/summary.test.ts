import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../db/types'
import { groupByDay, summarize } from './summary'

const base = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '', deleted_at: null, description: null, account_id: 'a', category_id: null, notes: null, transfer_id: null, investment_movement_id: null }
const tx = (id: string, date: string, type: 'income' | 'expense', cents: number, extra: Partial<Transaction> = {}): Transaction => ({ ...base, id, date, type, amount_cents: cents, ...extra })

describe('summarize', () => {
  it('soma receitas e despesas e ignora transferências e aportes', () => {
    const list = [tx('1', '2026-10-01', 'income', 1000), tx('2', '2026-10-02', 'expense', 300), tx('3', '2026-10-02', 'expense', 500, { transfer_id: 't' }), tx('4', '2026-10-03', 'expense', 700, { investment_movement_id: 'm' })]
    expect(summarize(list)).toEqual({ income: 1000, expense: 300 })
  })
})

describe('groupByDay', () => {
  it('agrupa do dia mais recente ao mais antigo com o saldo do dia', () => {
    const groups = groupByDay([tx('1', '2026-10-01', 'income', 1000), tx('2', '2026-10-02', 'expense', 300), tx('3', '2026-10-02', 'expense', 200)])
    expect(groups.map((g) => [g.date, g.items.length, g.net])).toEqual([
      ['2026-10-02', 2, -500],
      ['2026-10-01', 1, 1000],
    ])
  })
})
