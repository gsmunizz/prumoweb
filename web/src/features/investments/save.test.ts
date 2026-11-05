import { describe, expect, it } from 'vitest'
import { snapshotId } from '../../sync/ids'

import { buildMovement, buildMovementRemoval, buildNewAsset, buildSnapshot } from './save'

const now = '2026-11-05T12:00:00.000Z'
const input = { name: ' Tesouro IPCA+ ', asset_class: 'renda_fixa' as const, ticker: 'td', quantity: 182_000_000n, invested: 10000, current: 10500, date: '2026-11-01', today: '2026-11-05', account_id: null }

describe('buildNewAsset', () => {
  let n = 0
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  it('sem conta: ativo, aporte e snapshot, nessa ordem', async () => {
    n = 0
    const e = await buildNewAsset(input, now, ids)
    expect(e.map(([name]) => name)).toEqual(['investments', 'investment_movements', 'investment_snapshots'])
    expect(e[0]![1]).toMatchObject({ name: 'Tesouro IPCA+', ticker: 'TD', account_id: null })
    expect(e[1]![1]).toMatchObject({ type: 'aporte', quantity: '1.82', amount_cents: 10000, date: '2026-11-01' })
    expect(e[2]![1]).toMatchObject({ id: await snapshotId(e[0]![1].id, '2026-11-05'), value_cents: 10500, date: '2026-11-05' })
  })
  it('com conta: gera a despesa interna ligada ao aporte, sem categoria (INV-15)', async () => {
    n = 0
    const e = await buildNewAsset({ ...input, account_id: 'acc' }, now, ids)
    expect(e.map(([name]) => name)).toEqual(['investments', 'investment_movements', 'transactions', 'investment_snapshots'])
    expect(e[2]![1]).toMatchObject({ type: 'expense', amount_cents: 10000, date: '2026-11-01', account_id: 'acc', category_id: null, transfer_id: null, investment_movement_id: e[1]![1].id })
    expect(e[1]![1]).toMatchObject({ account_id: 'acc' })
  })
})

describe('buildSnapshot', () => {
  it('no mesmo dia reaproveita o registro', async () => {
    const first = await buildSnapshot(undefined, 'inv', '2026-11-05', 100, now)
    const again = await buildSnapshot(first, 'inv', '2026-11-05', 250, '2026-11-05T18:00:00.000Z')
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ value_cents: 250, created_at: now })
  })
})

describe('buildMovement', () => {
  const investment = { id: 'inv', name: 'PETR4', asset_class: 'acoes' as const, ticker: 'PETR4', account_id: null, notes: null, created_at: '', updated_at: '', deleted_at: null }
  let n = 0
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  it('resgate com conta gera receita interna ligada, mesmo valor e data (INV-15)', async () => {
    n = 0
    const e = buildMovement({ investment, type: 'resgate', quantity: 100_000_000n, amount: 3300, date: '2026-11-02', account_id: 'acc' }, now, ids)
    expect(e.map(([name]) => name)).toEqual(['investment_movements', 'transactions'])
    expect(e[1]![1]).toMatchObject({ type: 'income', amount_cents: 3300, date: '2026-11-02', account_id: 'acc', category_id: null, investment_movement_id: e[0]![1].id })
  })
  it('aporte sem conta não gera transação', () => {
    n = 0
    const e = buildMovement({ investment, type: 'aporte', quantity: 100_000_000n, amount: 3300, date: '2026-11-02', account_id: null }, now, ids)
    expect(e.map(([name]) => name)).toEqual(['investment_movements'])
  })
  it('excluir movimento remove também a transação ligada', () => {
    const mv = { id: 'm', investment_id: 'inv', type: 'aporte' as const, date: '2026-11-02', quantity: '1', amount_cents: 3300, account_id: 'acc', created_at: '', updated_at: '', deleted_at: null }
    const tx = { id: 't', type: 'expense' as const, amount_cents: 3300, date: '2026-11-02', account_id: 'acc', category_id: null, description: null, notes: null, transfer_id: null, investment_movement_id: 'm', created_at: '', updated_at: '', deleted_at: null }
    const e = buildMovementRemoval(mv, [tx], now)
    expect(e.map(([name, r]) => [name, r.id, r.deleted_at])).toEqual([
      ['transactions', 't', now],
      ['investment_movements', 'm', now],
    ])
  })
})
