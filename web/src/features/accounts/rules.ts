import type { Account, AccountType, Transaction } from '../../db/types'

export const accountTypes: { value: AccountType; label: string; icon: string }[] = [
  { value: 'corrente', label: 'Conta corrente', icon: 'bank' },
  { value: 'digital', label: 'Conta digital', icon: 'smartphone' },
  { value: 'poupanca', label: 'Conta poupança', icon: 'piggy' },
  { value: 'carteira', label: 'Dinheiro em espécie', icon: 'wallet' },
  { value: 'corretora', label: 'Corretora · saldo em conta', icon: 'trending-up' },
  { value: 'cartao_credito', label: 'Cartão de crédito', icon: 'credit-card' },
]

export const typeLabel = (t: AccountType) => accountTypes.find((x) => x.value === t)?.label ?? t
export const typeIcon = (t: AccountType) => accountTypes.find((x) => x.value === t)?.icon ?? 'wallet'

export interface AccountSummary {
  account: Account
  balance: number
  uses: number
  last: Transaction | null
}

// Saldo, quantidade de lançamentos e último lançamento (até hoje) de cada conta.
export function summarizeAccounts(accounts: Account[], txs: Transaction[], until: string): AccountSummary[] {
  return accounts.map((account) => {
    let balance = account.initial_balance_cents
    let uses = 0
    let last: Transaction | null = null
    for (const t of txs) {
      if (t.account_id !== account.id) continue
      uses++
      if (t.date <= until) balance += t.type === 'income' ? t.amount_cents : -t.amount_cents
      if (t.date <= until && (!last || t.date > last.date || (t.date === last.date && t.created_at > last.created_at))) last = t
    }
    return { account, balance, uses, last }
  })
}

export type Blocked = { ok: true } | { ok: false; reason: string }

// Regras só do cliente (a API só garante a integridade): a última conta ativa fica, e conta
// com lançamentos não é excluída, só arquivada (ACCOUNT_IN_USE).
export function canArchive(account: Account, accounts: Account[]): Blocked {
  const active = accounts.filter((a) => !a.archived && !a.deleted_at)
  if (!account.archived && active.length <= 1) return { ok: false, reason: 'É preciso manter ao menos uma conta ativa.' }
  return { ok: true }
}

export function canDelete(account: Account, accounts: Account[], uses: number): Blocked {
  if (uses > 0) return { ok: false, reason: `Esta conta tem ${uses} ${uses === 1 ? 'lançamento' : 'lançamentos'}. Arquive-a para escondê-la sem perder o histórico.` }
  return canArchive({ ...account, archived: false }, accounts)
}

export function isDuplicateName(name: string, others: { id: string; name: string }[], selfId?: string): boolean {
  const n = name.trim().toLocaleLowerCase('pt-BR')
  return others.some((o) => o.id !== selfId && o.name.trim().toLocaleLowerCase('pt-BR') === n)
}
