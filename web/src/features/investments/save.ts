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
  if (input.account_id) entries.push(['transactions', linkedTransaction(movement, investment.name, now, newId())])
  entries.push(['investment_snapshots', await buildSnapshot(undefined, investment.id, input.today, input.current, now)])
  return entries
}

// Com conta, o movimento gera a movimentação interna ligada: aporte vira despesa, resgate vira
// receita, mesmo valor e data, sem categoria (INV-15).
function linkedTransaction(movement: InvestmentMovement, assetName: string, now: Instant, id: UUID): Transaction {
  return {
    created_at: now,
    updated_at: now,
    deleted_at: null,
    id,
    type: movement.type === 'aporte' ? 'expense' : 'income',
    amount_cents: movement.amount_cents,
    description: `${movement.type === 'aporte' ? 'Aporte em' : 'Resgate de'} ${assetName}`,
    date: movement.date,
    account_id: movement.account_id!,
    category_id: null,
    notes: null,
    transfer_id: null,
    investment_movement_id: movement.id,
  }
}

export interface MovementInput {
  investment: Investment
  type: 'aporte' | 'resgate'
  quantity: bigint
  amount: number
  date: ISODate
  account_id: UUID | null
}

// Aporte ou resgate num ativo existente; a ordem é movimento e depois a transação ligada.
export function buildMovement(input: MovementInput, now: Instant, newId: () => UUID = () => crypto.randomUUID()): [EntityName, SyncedRecord][] {
  const movement: InvestmentMovement = {
    created_at: now,
    updated_at: now,
    deleted_at: null,
    id: newId(),
    investment_id: input.investment.id,
    type: input.type,
    date: input.date,
    quantity: quantityToWire(input.quantity),
    amount_cents: input.amount,
    account_id: input.account_id,
  }
  const entries: [EntityName, SyncedRecord][] = [['investment_movements', movement]]
  if (input.account_id) entries.push(['transactions', linkedTransaction(movement, input.investment.name, now, newId())])
  return entries
}

// Excluir um movimento exclui junto a transação de conta ligada (INV-15).
export function buildMovementRemoval(movement: InvestmentMovement, linked: Transaction[], now: Instant): [EntityName, SyncedRecord][] {
  const gone = { deleted_at: now, updated_at: now }
  return [...linked.filter((t) => !t.deleted_at).map((t): [EntityName, SyncedRecord] => ['transactions', { ...t, ...gone }]), ['investment_movements', { ...movement, ...gone }]]
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
