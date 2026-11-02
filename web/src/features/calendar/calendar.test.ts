import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../../db/types'
import { daysInMonth, dayCategories, expenseByDay, heatStrip, isExceptional, level, summarizeMonth } from './calendar'

const base = { created_at: '', updated_at: '', deleted_at: null, description: null, notes: null, transfer_id: null, investment_movement_id: null, account_id: 'a1' }
const tx = (id: string, date: string, cents: number, extra: Partial<Transaction> = {}): Transaction => ({ ...base, id, date, type: 'expense', amount_cents: cents, category_id: 'c1', ...extra })
const cat = (id: string, name: string): Category => ({ ...base, id, name, type: 'expense', icon: 'tag', color: '#111', sort_order: 0 })

describe('expenseByDay', () => {
  it('soma só despesas reais por dia', () => {
    const m = expenseByDay([tx('1', '2026-09-05', 100), tx('2', '2026-09-05', 50), tx('3', '2026-09-05', 900, { transfer_id: 't' }), tx('4', '2026-09-05', 700, { type: 'income' })])
    expect(m.get('2026-09-05')).toBe(150)
  })
})

describe('summarizeMonth', () => {
  const by = expenseByDay([tx('1', '2026-09-01', 3000), tx('2', '2026-09-03', 3000)])
  it('mês fechado usa todos os dias', () => {
    expect(summarizeMonth(by, '2026-09', '2026-10-15')).toEqual({ total: 6000, average: 200, emptyDays: 28, elapsed: 30 })
  })
  it('mês corrente conta só até hoje', () => {
    expect(summarizeMonth(by, '2026-09', '2026-09-10')).toEqual({ total: 6000, average: 600, emptyDays: 8, elapsed: 10 })
  })
  it('mês futuro não tem média', () => {
    expect(summarizeMonth(by, '2026-11', '2026-10-15')).toEqual({ total: 0, average: 0, emptyDays: 0, elapsed: 0 })
  })
})

describe('level', () => {
  it('escala pela média diária', () => {
    expect([0, 70, 200, 390, 900].map((c) => level(c, 210))).toEqual([0, 1, 2, 3, 4])
  })
  it('sem média, qualquer gasto é o nível máximo', () => {
    expect(level(10, 0)).toBe(4)
  })
  it('excepcional passa de 2,5 vezes a média', () => {
    expect(isExceptional(526, 210)).toBe(true)
    expect(isExceptional(525, 210)).toBe(false)
  })
})

describe('dayCategories', () => {
  it('ordena por valor e calcula a parcela', () => {
    const r = dayCategories([tx('1', 'd', 600, { category_id: 'a' }), tx('2', 'd', 300, { category_id: 'b' }), tx('3', 'd', 100, { category_id: 'b' })], [cat('a', 'A'), cat('b', 'B')])
    expect(r.map((c) => [c.name, c.pct])).toEqual([['A', 60], ['B', 40]])
  })
})

describe('heatStrip', () => {
  it('começa no domingo da semana do primeiro dia e termina no último dia do mês', () => {
    const { cells, from, to } = heatStrip(new Map([['2026-09-30', 5]]), '2026-09')
    expect(from).toBe('2026-04-01')
    expect(to).toBe('2026-09-30')
    // 1º de abril de 2026 é quarta: três células vazias antes.
    expect(cells.slice(0, 3).every((c) => c.date === null)).toBe(true)
    expect(cells[3]?.date).toBe('2026-04-01')
    expect(cells.at(-1)).toEqual({ date: '2026-09-30', cents: 5 })
  })
  it('daysInMonth respeita ano bissexto', () => {
    expect(daysInMonth('2028-02')).toBe(29)
    expect(daysInMonth('2026-02')).toBe(28)
  })
})
