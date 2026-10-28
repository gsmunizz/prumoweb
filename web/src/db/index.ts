import Dexie, { type EntityTable } from 'dexie'
import type {
  Account,
  Category,
  Investment,
  InvestmentMovement,
  InvestmentSnapshot,
  OutboxOp,
  Profile,
  Transaction,
} from './types'

// Banco local do app (local-first): a interface lê e escreve só aqui,
// e a sincronização leva a fila (outbox) para a API em segundo plano.
export class PrumoDB extends Dexie {
  profile!: EntityTable<Profile, 'id'>
  accounts!: EntityTable<Account, 'id'>
  categories!: EntityTable<Category, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  investments!: EntityTable<Investment, 'id'>
  investment_movements!: EntityTable<InvestmentMovement, 'id'>
  investment_snapshots!: EntityTable<InvestmentSnapshot, 'id'>
  outbox!: EntityTable<OutboxOp, 'seq'>
  meta!: EntityTable<{ key: string; value: unknown }, 'key'>

  constructor(name = 'prumo') {
    super(name)
    this.version(1).stores({
      profile: 'id',
      accounts: 'id, sort_order',
      categories: 'id, type, sort_order',
      transactions: 'id, date, account_id, category_id, transfer_id, [date+account_id]',
      investments: 'id, asset_class',
      investment_movements: 'id, investment_id, date',
      investment_snapshots: 'id, investment_id, [investment_id+date]',
      outbox: '++seq, op_id, entity, id',
      meta: 'key',
    })
  }
}

export const db = new PrumoDB()

// Logout e troca de usuário apagam o banco local (AUT-19, SYN-10).
export async function wipeLocalData(database: PrumoDB = db): Promise<void> {
  await database.delete()
  await database.open()
}
