import { afterEach, describe, expect, it } from 'vitest'
import { PrumoDB, wipeLocalData } from './index'
import type { Transaction } from './types'

const now = '2026-10-28T12:00:00.000Z'

function expense(id: string, date: string): Transaction {
  return {
    id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    type: 'expense',
    amount_cents: 1990,
    description: 'Café',
    date,
    account_id: 'acc-1',
    category_id: 'cat-1',
    notes: null,
    transfer_id: null,
    investment_movement_id: null,
  }
}

describe('PrumoDB', () => {
  const db = new PrumoDB('prumo-test')
  afterEach(() => db.delete().then(() => db.open()))

  it('consulta transações por período pelo índice de data', async () => {
    await db.transactions.bulkPut([expense('a', '2026-10-01'), expense('b', '2026-10-15'), expense('c', '2026-11-01')])
    const october = await db.transactions.where('date').between('2026-10-01', '2026-10-31', true, true).toArray()
    expect(october.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('mantém a fila de saída na ordem de inserção', async () => {
    for (const id of ['x', 'y', 'z']) {
      await db.outbox.add({ op_id: `op-${id}`, entity: 'transactions', id, updated_at: now, data: {} })
    }
    const ops = await db.outbox.orderBy('seq').toArray()
    expect(ops.map((o) => o.id)).toEqual(['x', 'y', 'z'])
  })

  it('apaga tudo no logout', async () => {
    await db.transactions.put(expense('a', '2026-10-01'))
    await wipeLocalData(db)
    expect(await db.transactions.count()).toBe(0)
  })
})
