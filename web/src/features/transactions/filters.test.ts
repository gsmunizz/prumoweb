import { describe, expect, it } from 'vitest'
import type { Transaction } from '../../db/types'
import { activeCount, applyFilters, defaultFilters, periodLabel, rangeOf } from './filters'

const base = { created_at: '', updated_at: '', deleted_at: null, notes: null, transfer_id: null, investment_movement_id: null }
const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ ...base, id, date: '2026-10-05', type: 'expense', amount_cents: 1000, account_id: 'a1', category_id: 'c1', description: id, ...extra })

const now = '2026-10-31'

describe('rangeOf', () => {
  it('mês, três meses e intervalo livre', () => {
    expect(rangeOf({ kind: 'month', month: '2026-09' }, now)).toEqual(['2026-09-01', '2026-09-31'])
    expect(rangeOf({ kind: '3m' }, now)).toEqual(['2026-08-01', '2026-10-31'])
    expect(rangeOf({ kind: 'custom', from: '2026-01-10', to: '2026-02-03' }, now)).toEqual(['2026-01-10', '2026-02-03'])
  })
  it('rotula o intervalo em dia/mês/ano', () => {
    expect(periodLabel({ kind: 'custom', from: '2026-01-10', to: '2026-02-03' })).toBe('10/01/2026 a 03/02/2026')
  })
})

describe('applyFilters', () => {
  const list = [
    tx('mercado', { amount_cents: 5000, category_id: 'c2' }),
    tx('salario', { type: 'income', amount_cents: 900000, account_id: 'a2', category_id: 'c3' }),
    tx('uber', { amount_cents: 2000, account_id: 'a2' }),
  ]
  const ids = (f: Partial<ReturnType<typeof defaultFilters>>) => applyFilters(list, { ...defaultFilters(now), ...f }).map((t) => t.id)

  it('sem filtros mostra tudo', () => expect(ids({})).toEqual(['mercado', 'salario', 'uber']))
  it('tipo, categoria e conta', () => {
    expect(ids({ type: 'income' })).toEqual(['salario'])
    expect(ids({ categories: ['c2', 'c3'] })).toEqual(['mercado', 'salario'])
    expect(ids({ accounts: ['a2'] })).toEqual(['salario', 'uber'])
  })
  it('faixa de valor inclusiva', () => {
    expect(ids({ min: 2000, max: 5000 })).toEqual(['mercado', 'uber'])
    expect(ids({ min: 6000 })).toEqual(['salario'])
  })
  it('busca ignora caixa', () => expect(ids({ search: 'UBE' })).toEqual(['uber']))
})

describe('activeCount', () => {
  it('conta só o que foge do padrão', () => {
    const f = defaultFilters(now)
    expect(activeCount(f, now)).toBe(0)
    expect(activeCount({ ...f, type: 'income', search: 'x' }, now)).toBe(0)
    expect(activeCount({ ...f, period: { kind: '3m' }, accounts: ['a1'], max: 100 }, now)).toBe(3)
    expect(activeCount({ ...f, period: { kind: 'month', month: '2026-09' } }, now)).toBe(1)
  })
})
