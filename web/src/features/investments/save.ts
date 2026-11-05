import type { AssetClass, EntityName, Investment, InvestmentMovement, InvestmentSnapshot, ISODate, Instant, SyncedRecord, Transaction, UUID } from '../../db/types'
import { snapshotId } from '../../sync/ids'
import { quantityToWire } from './rules'

export interface NewAssetInput {
  name: string
  asset_class: AssetClass
  ticker: string
  quantity: bigint
  // Em centavos: o que foi pago e o valor de hoje.
  invested: number
  current: number
  date: ISODate
  today: ISODate
  account_id: UUID | null
}

// Cadastrar um ativo cria junto o primeiro aporte e o primeiro snapshot (INV-05). Com conta, o
// aporte gera a despesa interna ligada (INV-15). A ordem importa: a API confere o grupo ao fim
// do lote, e cada registro referencia o anterior.
export async function buildNewAsset(input: NewAssetInput, now: Instant, newId: () => UUID = () => crypto.randomUUID()): Promise<[EntityName, SyncedRecord][]> {
  const base = { created_at: now, updated_at: now, deleted_at: null }
  const investment: Investment = {
    ...base,
    id: newId(),
    name: input.name.trim(),
    asset_class: input.asset_class,
    ticker: input.ticker.trim() ? input.ticker.trim().toUpperCase() : null,
    account_id: input.account_id,
    notes: null,
  }
  const movement: InvestmentMovement = {
    ...base,
    id: newId(),
    investment_id: investment.id,
    type: 'aporte',
    date: input.date,
    quantity: quantityToWire(input.quantity),
    amount_cents: input.invested,
    account_id: input.account_id,
  }
  const entries: [EntityName, SyncedRecord][] = [
    ['investments', investment],
    ['investment_movements', movement],
  ]
  if (input.account_id) {
    const tx: Transaction = {
      ...base,
      id: newId(),
      type: 'expense',
      amount_cents: input.invested,
      description: `Aporte em ${investment.name}`,
      date: input.date,
      account_id: input.account_id,
      category_id: null,
      notes: null,
      transfer_id: null,
      investment_movement_id: movement.id,
    }
    entries.push(['transactions', tx])
  }
  entries.push(['investment_snapshots', await buildSnapshot(undefined, investment.id, input.today, input.current, now)])
  return entries
}

// Um snapshot por ativo por dia, com id determinístico (INV-21): atualizar no mesmo dia troca
// o valor do registro existente.
export async function buildSnapshot(existing: InvestmentSnapshot | undefined, investmentId: UUID, date: ISODate, valueCents: number, now: Instant): Promise<InvestmentSnapshot> {
  return {
    ...(existing ?? { created_at: now, deleted_at: null }),
    id: existing?.id ?? (await snapshotId(investmentId, date)),
    investment_id: investmentId,
    date,
    value_cents: valueCents,
    updated_at: now,
  }
}
