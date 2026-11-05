import { describe, expect, it } from 'vitest'
import type { Investment, InvestmentMovement, InvestmentSnapshot } from '../../db/types'
import { breaksPosition, buildAssets, currentValue, distribution, evolution, formatQuantity, monthGain, parseQuantity, positionOf, quantityToWire, totalsOf } from './rules'

const base = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null }
const inv = (id: string, asset_class: Investment['asset_class'] = 'acoes'): Investment => ({ ...base, id, name: id, asset_class, ticker: null, account_id: null, notes: null })
const mov = (id: string, investment_id: string, type: 'aporte' | 'resgate', date: string, quantity: string, amount_cents: number): InvestmentMovement => ({ ...base, id, investment_id, type, date, quantity, amount_cents, account_id: null })
const snap = (investment_id: string, date: string, value_cents: number): InvestmentSnapshot => ({ ...base, id: `${investment_id}${date}`, investment_id, date, value_cents })

describe('quantidade', () => {
  it('lê vírgula ou ponto, até 8 casas, só maior que zero', () => {
    expect(parseQuantity('1,82')).toBe(182_000_000n)
    expect(parseQuantity('0.0112')).toBe(1_120_000n)
    expect(parseQuantity('0')).toBeNull()
    expect(parseQuantity('1,123456789')).toBeNull()
    expect(parseQuantity('abc')).toBeNull()
    expect(parseQuantity('-1')).toBeNull()
  })
  it('formata sem zeros à direita', () => {
    expect(quantityToWire(182_000_000n)).toBe('1.82')
    expect(quantityToWire(100_000_000n)).toBe('1')
    expect(formatQuantity(1_120_000n)).toBe('0,0112')
  })
})

describe('positionOf', () => {
  it('soma aportes e resgata pelo custo médio, arredondando o centavo', () => {
    const m = [mov('1', 'a', 'aporte', '2026-01-10', '100', 10000), mov('2', 'a', 'aporte', '2026-02-10', '50', 6000), mov('3', 'a', 'resgate', '2026-03-10', '30', 9999)]
    // 150 cotas por 16000; resgatar 30 tira 16000 × 30/150 = 3200.
    expect(positionOf(m)).toEqual({ quantity: 12_000_000_000n, invested: 12800 })
    expect(positionOf(m, '2026-02-01')).toEqual({ quantity: 10_000_000_000n, invested: 10000 })
  })
  it('resgate total zera a posição', () => {
    const m = [mov('1', 'a', 'aporte', '2026-01-10', '1', 5000), mov('2', 'a', 'resgate', '2026-02-10', '1', 5300)]
    expect(positionOf(m)).toEqual({ quantity: 0n, invested: 0 })
  })
  it('ignora movimentos excluídos', () => {
    expect(positionOf([{ ...mov('1', 'a', 'aporte', '2026-01-10', '1', 5000), deleted_at: 'x' }])).toEqual({ quantity: 0n, invested: 0 })
  })
})

describe('currentValue', () => {
  it('usa o snapshot mais recente até a data', () => {
    const s = [snap('a', '2026-01-01', 100), snap('a', '2026-03-01', 300), snap('a', '2026-02-01', 200)]
    expect(currentValue(s)).toBe(300)
    expect(currentValue(s, '2026-02-15')).toBe(200)
    expect(currentValue(s, '2025-12-31')).toBeNull()
  })
})

describe('totais, distribuição e evolução', () => {
  const investments = [inv('a', 'acoes'), inv('b', 'renda_fixa'), inv('c', 'fiis')]
  const movements = [mov('1', 'a', 'aporte', '2026-01-10', '10', 10000), mov('2', 'b', 'aporte', '2026-02-10', '1', 30000), mov('3', 'c', 'aporte', '2026-01-10', '1', 5000), mov('4', 'c', 'resgate', '2026-02-20', '1', 5500)]
  const snapshots = [snap('a', '2026-01-10', 10000), snap('a', '2026-03-05', 12000), snap('b', '2026-02-10', 30000), snap('b', '2026-03-05', 33000), snap('c', '2026-02-20', 0)]
  const assets = buildAssets(investments, movements, snapshots)

  it('só posições abertas entram nos totais (INV-24)', () => {
    expect(totalsOf(assets)).toEqual({ invested: 40000, current: 45000, gain: 5000, pct: 12.5 })
  })
  it('distribui pelo valor atual', () => {
    const d = distribution(assets)
    expect(d.map((s) => [s.asset_class, s.cents])).toEqual([['renda_fixa', 33000], ['acoes', 12000]])
    expect(d[0]!.pct).toBeCloseTo(73.33, 1)
  })
  it('evolução repete o último snapshot até o próximo', () => {
    const pts = evolution(investments, movements, snapshots, '2026-03-20', 3)
    expect(pts.map((p) => [p.date, p.value, p.invested])).toEqual([
      ['2026-01-31', 10000, 15000],
      ['2026-02-28', 40000, 40000],
      ['2026-03-20', 45000, 40000],
    ])
  })
  it('rendimento do mês desconta os aportes do mês', () => {
    const more = [...movements, mov('5', 'a', 'aporte', '2026-03-10', '5', 6000)]
    const snaps = [...snapshots, snap('a', '2026-03-10', 18000)]
    // Fim de fevereiro: 40000. Agora: 18000 + 33000 = 51000. Aporte líquido do mês: 6000.
    expect(monthGain(investments, more, snaps, '2026-03-20')).toEqual({ cents: 5000, pct: 12.5 })
  })
  it('ativo excluído some dos totais', () => {
    const gone = buildAssets([{ ...investments[0]!, deleted_at: 'x' }, ...investments.slice(1)], movements, snapshots)
    expect(totalsOf(gone).current).toBe(33000)
  })
})

describe('breaksPosition', () => {
  const m = [mov('1', 'a', 'aporte', '2026-01-10', '10', 1000), mov('2', 'a', 'resgate', '2026-03-10', '4', 500)]
  it('resgate maior que a posição numa data quebra (INV-13)', () => {
    expect(breaksPosition(m, mov('3', 'a', 'resgate', '2026-02-01', '7', 0))).toBe(true)
    expect(breaksPosition(m, mov('3', 'a', 'resgate', '2026-02-01', '6', 0))).toBe(false)
  })
  it('um resgate posterior não vale para uma data anterior', () => {
    expect(breaksPosition(m, mov('3', 'a', 'resgate', '2026-01-05', '1', 0))).toBe(true)
  })
  it('remover um aporte que sustenta resgates quebra a posição', () => {
    expect(breaksPosition(m, undefined, '1')).toBe(true)
    expect(breaksPosition(m, undefined, '2')).toBe(false)
  })
})
