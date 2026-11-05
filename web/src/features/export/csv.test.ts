import { describe, expect, it } from 'vitest'
import type { Account, Category, Transaction } from '../../db/types'
import { buildCsv, csvField, reais } from './csv'

const base = { created_at: '2026-10-01T10:00:00Z', updated_at: '', deleted_at: null, notes: null, transfer_id: null, investment_movement_id: null }
const tx = (id: string, extra: Partial<Transaction>): Transaction => ({ ...base, id, date: '2026-10-05', type: 'expense', amount_cents: 1000, account_id: 'a1', category_id: 'c1', description: id, ...extra })
const acc: Account[] = [{ ...base, id: 'a1', name: 'Nubank', type: 'digital', initial_balance_cents: 0, color: '#000', icon: null, archived: false, sort_order: 0 }]
const cat: Category[] = [{ ...base, id: 'c1', name: 'Mercado', type: 'expense', icon: 'tag', color: '#000', sort_order: 0 }]

describe('csv', () => {
  it('campos com separador, aspas ou quebra vão entre aspas', () => {
    expect(csvField('a;b')).toBe('"a;b"')
    expect(csvField('diz "oi"')).toBe('"diz ""oi"""')
    expect(csvField('simples')).toBe('simples')
  })
  it('valor com vírgula decimal e sinal', () => {
    expect(reais(12345)).toBe('123,45')
    expect(reais(7)).toBe('0,07')
    expect(reais(-250)).toBe('-2,50')
  })
  it('gera cabeçalho, uma linha por transação e marca as internas', () => {
    const txs = [tx('2', { date: '2026-10-07', type: 'income', amount_cents: 99000, category_id: null }), tx('1', { description: 'Feira; orgânica', amount_cents: 4850 }), tx('3', { transfer_id: 't' }), tx('x', { deleted_at: 'z' })]
    const out = buildCsv(txs, acc, cat).replace('﻿', '').split('\r\n').filter(Boolean)
    expect(out[0]).toBe('data;tipo;descrição;categoria;conta;valor;movimento interno')
    expect(out.slice(1)).toEqual(['2026-10-05;despesa;"Feira; orgânica";Mercado;Nubank;48,50;não', '2026-10-05;despesa;3;Mercado;Nubank;10,00;sim', '2026-10-07;receita;2;;Nubank;990,00;não'])
  })
  it('começa com BOM para o Excel reconhecer o UTF-8', () => {
    expect(buildCsv([], acc, cat).charCodeAt(0)).toBe(0xfeff)
  })
})
