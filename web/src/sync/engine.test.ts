import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrumoDB } from '../db'
import type { Account } from '../db/types'
import { SyncEngine } from './engine'

const t0 = '2026-10-30T12:00:00.000Z'

function account(id: string, name = 'Nubank', at = t0): Account {
  return {
    id,
    created_at: t0,
    updated_at: at,
    deleted_at: null,
    name,
    type: 'digital',
    initial_balance_cents: 0,
    color: '#2446D8',
    icon: null,
    archived: false,
    sort_order: 0,
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const emptyChanges = () => ({
  profile: [],
  accounts: [],
  categories: [],
  transactions: [],
  investments: [],
  investment_movements: [],
  investment_snapshots: [],
})

describe('SyncEngine', () => {
  const db = new PrumoDB('prumo-sync-test')
  const engine = new SyncEngine({ database: db, now: () => new Date(t0) })

  beforeEach(() => vi.unstubAllGlobals())
  afterEach(async () => {
    await db.delete()
    await db.open()
  })

  it('write grava o registro e a operação juntos', async () => {
    await engine.write('accounts', account('a1'))
    expect(await db.accounts.get('a1')).toMatchObject({ name: 'Nubank' })
    const [op] = await db.outbox.toArray()
    expect(op).toMatchObject({ entity: 'accounts', id: 'a1', updated_at: t0 })
    expect(op!.data).not.toHaveProperty('server_version')
  })

  it('remove faz exclusão lógica com deleted_at', async () => {
    await engine.write('accounts', account('a1'))
    await engine.remove('accounts', 'a1')
    expect((await db.accounts.get('a1'))!.deleted_at).toBe(t0)
    expect(await db.outbox.count()).toBe(2)
  })

  it('push remove as aplicadas, troca as stale pelo servidor e marca as recusadas', async () => {
    await engine.write('accounts', account('a1'))
    await engine.write('accounts', account('a2', 'Antigo'))
    await engine.write('accounts', account('a3'))
    const ops = await db.outbox.orderBy('seq').toArray()

    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        results: [
          { op_id: ops[0]!.op_id, status: 'applied' },
          { op_id: ops[1]!.op_id, status: 'stale', current: { ...account('a2', 'Do servidor'), server_version: 7 } },
          { op_id: ops[2]!.op_id, status: 'rejected', code: 'VALIDATION_FAILED' },
        ],
        server_time: t0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await engine.push()

    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(sent.ops).toHaveLength(3)
    expect(sent.device_id).toMatch(/^[0-9a-f-]{36}$/)
    expect((await db.accounts.get('a2'))!.name).toBe('Do servidor')
    const left = await db.outbox.toArray()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ id: 'a3', rejected: { code: 'VALIDATION_FAILED' } })
    expect(await engine.pendingCount()).toBe(0)
  })

  it('pull aplica as mudanças, guarda o cursor e não sobrescreve o que está na fila', async () => {
    await engine.write('accounts', account('local', 'Editada aqui'))
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        changes: {
          ...emptyChanges(),
          accounts: [
            { ...account('remota', 'Remota'), server_version: 3 },
            { ...account('local', 'Versão antiga do servidor'), server_version: 4 },
          ],
        },
        next_since: 4,
        has_more: false,
        server_time: t0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await engine.pull()

    expect((await db.accounts.get('remota'))!.name).toBe('Remota')
    expect((await db.accounts.get('local'))!.name).toBe('Editada aqui')
    expect((await db.meta.get('cursor'))!.value).toBe(4)
    expect(fetchMock.mock.calls[0]![0]).toContain('since=0')
  })

  it('pull segue as páginas até has_more acabar', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { changes: { ...emptyChanges(), accounts: [{ ...account('a1'), server_version: 1 }] }, next_since: 1, has_more: true, server_time: t0 }))
      .mockResolvedValueOnce(json(200, { changes: { ...emptyChanges(), accounts: [{ ...account('a2'), server_version: 2 }] }, next_since: 2, has_more: false, server_time: t0 }))
    vi.stubGlobal('fetch', fetchMock)
    await engine.pull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![0]).toContain('since=1')
    expect(await db.accounts.count()).toBe(2)
  })

  it('410 SYNC_RESET_REQUIRED apaga os dados, zera o cursor e puxa de novo', async () => {
    await db.accounts.put(account('velha'))
    await db.meta.put({ key: 'cursor', value: 50 })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(410, { error: { code: 'SYNC_RESET_REQUIRED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, { changes: { ...emptyChanges(), accounts: [{ ...account('nova'), server_version: 9 }] }, next_since: 9, has_more: false, server_time: t0 }))
    vi.stubGlobal('fetch', fetchMock)

    await engine.pull()

    expect(await db.accounts.get('velha')).toBeUndefined()
    expect(await db.accounts.get('nova')).toBeDefined()
    expect(fetchMock.mock.calls[1]![0]).toContain('since=0')
  })

  it('sync não roda em paralelo: pedido durante o ciclo gera só mais um', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        calls++
        return json(200, { changes: emptyChanges(), next_since: 0, has_more: false, server_time: t0 })
      }),
    )
    const a = engine.sync()
    const b = engine.sync()
    await Promise.all([a, b])
    expect(calls).toBe(2) // dois pulls (sem fila para push)
  })
})
