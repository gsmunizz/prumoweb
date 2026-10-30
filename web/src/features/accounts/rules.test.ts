import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../db/types'
import { canArchive, canDelete, isDuplicateName, summarizeAccounts } from './rules'

const base = { created_at: '2026-10-01T00:00:00.000Z', updated_at: '', deleted_at: null }
const acc = (id: string, initial = 0, archived = false): Account => ({ ...base, id, name: id, type: 'corrente', initial_balance_cents: initial, color: '#000', icon: null, archived, sort_order: 0 })
const tx = (id: string, accountId: string, date: string, type: 'income' | 'expense', cents: number): Transaction => ({ ...base, id, date, type, amount_cents: cents, description: null, account_id: accountId, category_id: null, notes: null, transfer_id: null, investment_movement_id: null })

describe('summarizeAccounts', () => {
  it('calcula saldo até a data, usos e último lançamento', () => {
    const out = summarizeAccounts([acc('a', 1000)], [tx('1', 'a', '2026-10-01', 'income', 500), tx('2', 'a', '2026-10-05', 'expense', 200), tx('3', 'a', '2026-12-01', 'income', 999)], '2026-10-30')
    expect(out[0]).toMatchObject({ balance: 1300, uses: 3 })
    expect(out[0]!.last!.id).toBe('2')
  })
})

describe('regras de arquivar e excluir', () => {
  it('não deixa arquivar a última conta ativa', () => {
    expect(canArchive(acc('a'), [acc('a')]).ok).toBe(false)
    expect(canArchive(acc('a'), [acc('a'), acc('b')]).ok).toBe(true)
    expect(canArchive(acc('b', 0, true), [acc('a'), acc('b', 0, true)]).ok).toBe(true)
  })
  it('conta com lançamentos só pode ser arquivada', () => {
    const r = canDelete(acc('a'), [acc('a'), acc('b')], 3)
    expect(r.ok).toBe(false)
    expect(canDelete(acc('a'), [acc('a'), acc('b')], 0).ok).toBe(true)
  })
})

describe('isDuplicateName', () => {
  it('ignora caixa, espaços e o próprio registro', () => {
    const list = [{ id: '1', name: 'Nubank' }]
    expect(isDuplicateName('  nubank ', list)).toBe(true)
    expect(isDuplicateName('Nubank', list, '1')).toBe(false)
  })
})
