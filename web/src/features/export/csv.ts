import type { Account, Category, Transaction } from '../../db/types'
import { isInternal } from '../transactions/summary'

const HEADER = ['data', 'tipo', 'descrição', 'categoria', 'conta', 'valor', 'movimento interno']

// Campo CSV: entre aspas quando tem separador, aspa ou quebra de linha; aspas dobradas dentro.
export function csvField(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// Valor em reais com vírgula decimal, como o Excel em pt-BR espera.
export const reais = (cents: number) => `${Math.trunc(cents / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`.replace(/^(-?)/, cents < 0 ? '-' : '')

// Uma linha por transação, da mais antiga para a mais nova. Separador ";" e BOM para o Excel
// abrir com acentos certos. Excluídos ficam de fora; transferências e aportes aparecem marcados.
export function buildCsv(txs: Transaction[], accounts: Account[], categories: Category[]): string {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const rows = txs
    .filter((t) => !t.deleted_at)
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    .map((t) =>
      [
        t.date,
        t.type === 'income' ? 'receita' : 'despesa',
        t.description ?? '',
        t.category_id ? (categoryName.get(t.category_id) ?? '') : '',
        accountName.get(t.account_id) ?? '',
        reais(t.amount_cents),
        isInternal(t) ? 'sim' : 'não',
      ].map(csvField).join(';'),
    )
  return '﻿' + [HEADER.join(';'), ...rows].join('\r\n') + '\r\n'
}
