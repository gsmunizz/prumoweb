import { db as defaultDb, type PrumoDB } from '../db'
import type { EntityName, Instant, OutboxOp, SyncedRecord } from '../db/types'
import { ApiError, apiFetch } from '../lib/api'

// Motor de sync (SYN-*): a interface escreve só no IndexedDB; o push leva a fila de saída
// à API e o pull traz as mudanças de outros aparelhos. Last-write-wins por updated_at.

export const ENTITIES: EntityName[] = [
  'profile',
  'accounts',
  'categories',
  'transactions',
  'investments',
  'investment_movements',
  'investment_snapshots',
]

const PUSH_BATCH = 500
const PULL_PAGE = 1000

interface PushResult {
  op_id: string
  status: 'applied' | 'stale' | 'rejected'
  code?: string
  details?: unknown
  current?: Record<string, unknown> & { id: string }
}

interface PullResponse {
  changes: Record<string, (SyncedRecord & Record<string, unknown>)[]>
  next_since: number
  has_more: boolean
}

type Table = ReturnType<PrumoDB['table']>

export interface SyncOptions {
  database?: PrumoDB
  now?: () => Date
}

export class SyncEngine {
  private readonly db: PrumoDB
  private readonly now: () => Date
  private running: Promise<void> | null = null
  private again = false

  constructor({ database = defaultDb, now = () => new Date() }: SyncOptions = {}) {
    this.db = database
    this.now = now
  }

  // Grava o registro e a operação na mesma transação: ou os dois, ou nenhum (SYN-02).
  async write(entity: EntityName, record: SyncedRecord): Promise<void> {
    const table = this.db.table(entity) as Table
    await this.db.transaction('rw', table, this.db.outbox, async () => {
      await table.put(record)
      await this.db.outbox.add({
        op_id: crypto.randomUUID(),
        entity,
        id: record.id,
        updated_at: record.updated_at,
        data: toWire(record),
      })
    })
  }

  // Exclusão lógica: o registro continua no banco, com deleted_at, até o servidor expurgar.
  async remove(entity: EntityName, id: string): Promise<void> {
    const table = this.db.table(entity) as Table
    const current = (await table.get(id)) as SyncedRecord | undefined
    if (!current || current.deleted_at) return
    const at = this.now().toISOString() as Instant
    await this.write(entity, { ...current, deleted_at: at, updated_at: at })
  }

  pendingCount(): Promise<number> {
    return this.db.outbox.filter((op) => !op.rejected).count()
  }

  // Um ciclo completo: envia a fila e depois puxa. Chamadas durante um ciclo pedem um novo
  // logo em seguida, em vez de rodar em paralelo.
  sync(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.push()
          await this.pull()
        } while (this.again)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  async push(): Promise<void> {
    for (;;) {
      const ops = await this.db.outbox.orderBy('seq').filter((op) => !op.rejected).limit(PUSH_BATCH).toArray()
      if (ops.length === 0) return

      const res = await apiFetch<{ results: PushResult[] }>('/sync/push', {
        method: 'POST',
        body: JSON.stringify({
          device_id: await this.deviceId(),
          ops: ops.map(({ op_id, entity, id, updated_at, data }) => ({ op_id, entity, id, updated_at, data })),
        }),
      })
      await this.applyResults(ops, res.results)
      if (ops.length < PUSH_BATCH) return
    }
  }

  private async applyResults(ops: OutboxOp[], results: PushResult[]): Promise<void> {
    const byOp = new Map(results.map((r) => [r.op_id, r]))
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const op of ops) {
        const r = byOp.get(op.op_id)
        if (!r) continue // o servidor não chegou a ela; segue na fila
        if (r.status === 'rejected') {
          // Fica na fila marcada, para a interface mostrar o problema; não trava as demais (SYN-04).
          await this.db.outbox.update(op.seq!, { rejected: { code: r.code ?? 'REJECTED', details: r.details } })
          continue
        }
        await this.db.outbox.delete(op.seq!)
        // stale: a versão do servidor é mais nova; ela substitui a local.
        if (r.status === 'stale' && r.current) await this.db.table(op.entity).put(r.current)
      }
    })
  }

  async pull(): Promise<void> {
    for (;;) {
      const since = ((await this.db.meta.get('cursor'))?.value as number | undefined) ?? 0
      let page: PullResponse
      try {
        page = await apiFetch<PullResponse>(`/sync/pull?since=${since}&limit=${PULL_PAGE}`)
      } catch (e) {
        if (e instanceof ApiError && e.code === 'SYNC_RESET_REQUIRED') {
          // O servidor já expurgou o que o cursor precisa (SYN-09): refaz a base a partir do zero.
          await this.resetData()
          continue
        }
        throw e
      }
      await this.applyPage(page)
      if (!page.has_more) return
    }
  }

  private async applyPage(page: PullResponse): Promise<void> {
    await this.db.transaction('rw', this.db.tables, async () => {
      // Registros com alteração local ainda não enviada não são sobrescritos: o push decide.
      // Operações recusadas não contam: a versão do servidor passa a valer para o registro.
      const queued = await this.db.outbox.filter((op) => !op.rejected).toArray()
      const pending = new Set(queued.map((op) => `${op.entity}/${op.id}`))
      for (const entity of ENTITIES) {
        const table = this.db.table(entity)
        const rows = (page.changes[entity] ?? []).filter((r) => !pending.has(`${entity}/${r.id}`))
        if (rows.length) await table.bulkPut(rows)
      }
      await this.db.meta.put({ key: 'cursor', value: page.next_since })
      await this.db.meta.put({ key: 'last_synced_at', value: this.now().toISOString() })
    })
  }

  // Apaga os dados sincronizados (mantém a fila de saída) e zera o cursor.
  async resetData(): Promise<void> {
    await this.db.transaction('rw', this.db.tables, async () => {
      for (const entity of ENTITIES) await this.db.table(entity).clear()
      await this.db.meta.put({ key: 'cursor', value: 0 })
    })
  }

  async lastSyncedAt(): Promise<Instant | null> {
    return ((await this.db.meta.get('last_synced_at'))?.value as Instant | undefined) ?? null
  }

  private async deviceId(): Promise<string> {
    const found = (await this.db.meta.get('device_id'))?.value as string | undefined
    if (found) return found
    const id = crypto.randomUUID()
    await this.db.meta.put({ key: 'device_id', value: id })
    return id
  }
}

// O campo data da operação é o registro inteiro, sem o que o servidor é quem define.
function toWire(record: SyncedRecord): Record<string, unknown> {
  const { server_version: _ignored, ...rest } = record
  void _ignored
  return rest
}
