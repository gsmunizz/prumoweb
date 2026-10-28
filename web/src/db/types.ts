// Tipos dos registros sincronizados (SYN-01), no mesmo formato JSON da API:
// snake_case, dinheiro em centavos (*_cents), datas de negócio YYYY-MM-DD,
// instantes RFC 3339 em UTC e quantidades como string decimal.

export type UUID = string
export type ISODate = string
export type Instant = string

export interface SyncedRecord {
  id: UUID
  created_at: Instant
  updated_at: Instant
  deleted_at: Instant | null
  // Preenchido pelo servidor; ausente enquanto o registro só existe no aparelho.
  server_version?: number
}

export type Theme = 'light' | 'dark' | 'system'

export interface Profile extends SyncedRecord {
  name: string
  currency: 'BRL'
  timezone: string
  theme: Theme
}

export type AccountType = 'corrente' | 'poupanca' | 'carteira' | 'digital' | 'corretora' | 'cartao_credito'

export interface Account extends SyncedRecord {
  name: string
  type: AccountType
  initial_balance_cents: number
  color: string
  icon: string | null
  archived: boolean
  sort_order: number
}

export type EntryType = 'income' | 'expense'

export interface Category extends SyncedRecord {
  name: string
  type: EntryType
  icon: string
  color: string
  sort_order: number
}

export interface Transaction extends SyncedRecord {
  type: EntryType
  amount_cents: number
  description: string | null
  date: ISODate
  account_id: UUID
  category_id: UUID | null
  notes: string | null
  transfer_id: UUID | null
  investment_movement_id: UUID | null
}

export type AssetClass = 'renda_fixa' | 'acoes' | 'fiis' | 'etfs' | 'cripto' | 'outros'

export interface Investment extends SyncedRecord {
  name: string
  asset_class: AssetClass
  ticker: string | null
  account_id: UUID | null
  notes: string | null
}

export interface InvestmentMovement extends SyncedRecord {
  investment_id: UUID
  type: 'aporte' | 'resgate'
  date: ISODate
  quantity: string
  amount_cents: number
  account_id: UUID | null
}

export interface InvestmentSnapshot extends SyncedRecord {
  investment_id: UUID
  date: ISODate
  value_cents: number
}

export type EntityName =
  | 'profile'
  | 'accounts'
  | 'categories'
  | 'transactions'
  | 'investments'
  | 'investment_movements'
  | 'investment_snapshots'

// Operação na fila de saída, no formato do POST /v1/sync/push (SYN-02).
export interface OutboxOp {
  seq?: number
  op_id: UUID
  entity: EntityName
  id: UUID
  updated_at: Instant
  data: Record<string, unknown>
  // Preenchido quando o servidor recusa a operação (SYN-04).
  rejected?: { code: string; details?: unknown }
}
