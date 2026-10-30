import { db } from '../../db'
import type { Account, Category, Transaction } from '../../db/types'
import { monthRange } from '../../lib/dates'

// Consultas da interface. Registros excluídos (deleted_at) nunca aparecem.
export async function transactionsOfMonth(month: string): Promise<Transaction[]> {
  const [from, to] = monthRange(month)
  return db.transactions.where('date').between(from, to, true, true).filter((t) => !t.deleted_at).toArray()
}

export async function activeAccounts(): Promise<Account[]> {
  const list = await db.accounts.orderBy('sort_order').filter((a) => !a.deleted_at && !a.archived).toArray()
  return list
}

export async function activeCategories(): Promise<Category[]> {
  return db.categories.orderBy('sort_order').filter((c) => !c.deleted_at).toArray()
}
