import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../../db/types'
import { balance, expensesByCategory, lastMonths, monthStats, topExpenses, variation } from './stats'

const base = { created_at: '', updated_at: '', deleted_at: null, description: null, notes: null, transfer_id: null, investment_movement_id: null }
const tx = (id: string, date: string, type: 'income' | 'expense', cents: number, extra: Partial<Transaction> = {}): Transaction => ({ ...base, id, date, type, amount_cents: cents, account_id: 'a1', category_id: 'c1', ...extra })
const acc = (id: string, initial: number, archived = false): Account => ({ ...base, id, name: id, type: 'corrente', initial_balance_cents: initial, color: '#000', icon: null, archived, sort_order: 0 })
const cat = (id: string, name: string, color = '#111'): Category => ({ ...base, id, name, type: 'expense', icon: 'tag', color, sort_order: 0 })

describe('balance', () => {
  it('soma saldo inicial e lançamentos até a data, só de contas ativas', () => {
    const accounts = [acc('a1', 1000), acc('a2', 500, true)]
    const txs = [tx('1', '2026-10-01', 'income', 300), tx('2', '2026-10-02', 'expense', 100), tx('3', '2026-11-01', 'income', 999), tx('4', '2026-10-02', 'income', 700, { account_id: 'a2' })]
    expect(balance(accounts, txs, '2026-10-30')).toBe(1200)
  })
  it('conta as pernas de transferência (o dinheiro muda de conta)', () => {
    const accounts = [acc('a1', 1000), acc('a2', 0)]
    const txs = [tx('1', '2026-10-01', 'expense', 400, { transfer_id: 't' }), tx('2', '2026-10-01', 'income', 400, { transfer_id: 't', account_id: 'a2' })]
    expect(balance(accounts, txs, '2026-10-30')).toBe(1000)
  })
})

describe('monthStats', () => {
  it('ignora transferências e outros meses', () => {
    const txs = [tx('1', '2026-10-01', 'income', 1000), tx('2', '2026-10-03', 'expense', 400), tx('3', '2026-10-03', 'expense', 50, { transfer_id: 't' }), tx('4', '2026-09-03', 'expense', 70)]
    expect(monthStats(txs, '2026-10')).toEqual({ income: 1000, expense: 400, net: 600 })
  })
})

describe('variation', () => {
  it('calcula a variação e devolve null sem base', () => {
    expect(variation(120, 100)).toBe(20)
    expect(variation(50, 0)).toBeNull()
  })
})

describe('expensesByCategory', () => {
  it('ordena, agrupa o excedente em Outros e fecha em 100%', () => {
    const cats = [cat('c1', 'A'), cat('c2', 'B'), cat('c3', 'C')]
    const txs = [tx('1', '2026-10-01', 'expense', 500, { category_id: 'c1' }), tx('2', '2026-10-01', 'expense', 300, { category_id: 'c2' }), tx('3', '2026-10-01', 'expense', 200, { category_id: 'c3' })]
    const out = expensesByCategory(txs, cats, '2026-10', 2)
    expect(out.map((s) => s.name)).toEqual(['A', 'Outros'])
    expect(out.reduce((n, s) => n + s.pct, 0)).toBeCloseTo(100)
    expect(out[1]!.cents).toBe(500)
  })
})

describe('topExpenses e lastMonths', () => {
  it('lista os maiores gastos do mês', () => {
    const txs = [tx('1', '2026-10-01', 'expense', 10), tx('2', '2026-10-02', 'expense', 90), tx('3', '2026-10-03', 'expense', 50)]
    expect(topExpenses(txs, '2026-10', 2).map((t) => t.id)).toEqual(['2', '3'])
  })
  it('gera seis meses terminando no atual', () => {
    const s = lastMonths([tx('1', '2026-10-01', 'income', 5)], '2026-10')
    expect(s.map((p) => p.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(s[5]!.income).toBe(5)
  })
})
