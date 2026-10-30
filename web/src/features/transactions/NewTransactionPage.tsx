import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from '@tanstack/react-router'
import type { EntryType, Transaction } from '../../db/types'
import { today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { db } from '../../db'
import { useSession } from '../../lib/session'
import { useLive } from '../../lib/useLive'
import { saveRecord } from '../../sync'
import { activeAccounts, activeCategories } from './queries'
import { isInternal } from './summary'

const MAX_DIGITS = 9
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫']

export const NewTransactionPage = () => <TransactionForm />

// Edição: mesma tela do lançamento, preenchida com o registro existente.
export function EditTransactionPage() {
  const { id = '' } = useParams({ strict: false })
  const session = useSession()
  const navigate = useNavigate()
  // null = não existe (ou foi excluída); undefined = ainda carregando.
  const found = useLive(async () => (await db.transactions.get(id)) ?? null, [id])
  if (session.status === 'anonymous') return <Navigate to="/login" replace />
  if (found === undefined) {
    return (
      <p role="status" className="grid min-h-dvh place-items-center text-sm text-ink-3">
        Carregando…
      </p>
    )
  }
  if (found === null || found.deleted_at || isInternal(found)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-base font-extrabold">{found && isInternal(found) ? 'Esta movimentação não pode ser editada aqui' : 'Transação não encontrada'}</p>
        <button onClick={() => void navigate({ to: '/transacoes' })} className="h-12 rounded-2xl bg-cobalt px-6 font-extrabold text-white">
          Voltar às transações
        </button>
      </main>
    )
  }
  return <TransactionForm existing={found} />
}

// Lançamento rápido (design "03 · Nova transação"): só valor e categoria são obrigatórios;
// conta e data já vêm preenchidas.
function TransactionForm({ existing }: { existing?: Transaction }) {
  const session = useSession()
  const navigate = useNavigate()
  const accounts = useLive(activeAccounts, [])
  const allCategories = useLive(activeCategories, [])

  const [type, setType] = useState<EntryType>(existing?.type ?? 'expense')
  const [digits, setDigits] = useState(existing ? String(existing.amount_cents) : '')
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? null)
  const [accountId, setAccountId] = useState<string | null>(existing?.account_id ?? null)
  const [date, setDate] = useState(() => existing?.date ?? today())
  const [description, setDescription] = useState(existing?.description ?? '')
  const [notes, setNotes] = useState<string | null>(existing?.notes ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const categories = useMemo(() => (allCategories ?? []).filter((c) => c.type === type), [allCategories, type])
  const cents = Number(digits || '0')
  const expense = type === 'expense'

  // A conta padrão é a primeira da lista (Carteira, criada no cadastro).
  useEffect(() => {
    if (!accountId && accounts?.length) setAccountId(accounts[0]!.id)
  }, [accounts, accountId])

  if (session.status === 'anonymous') return <Navigate to="/login" replace />

  function press(k: string) {
    setError(null)
    setDigits((d) => {
      if (k === '⌫') return d.slice(0, -1)
      const next = (d + k).replace(/^0+/, '')
      return next.length > MAX_DIGITS ? d : next
    })
  }

  async function save() {
    if (cents <= 0) return setError('Informe um valor maior que zero.')
    if (!categoryId) return setError('Escolha uma categoria.')
    if (!accountId) return setError('Nenhuma conta disponível. Aguarde a sincronização ou crie uma conta.')
    setSaving(true)
    const now = new Date().toISOString()
    const record: Transaction = {
      ...(existing ?? { transfer_id: null, investment_movement_id: null }),
      id: existing?.id ?? crypto.randomUUID(),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
      type,
      amount_cents: cents,
      description: description.trim() || null,
      date,
      account_id: accountId,
      category_id: categoryId,
      notes: notes?.trim() || null,
    }
    try {
      await saveRecord('transactions', record)
      await navigate(existing ? { to: '/transacoes/$id', params: { id: existing.id } } : { to: '/transacoes' })
    } catch {
      setError('Não foi possível salvar neste aparelho. Tente de novo.')
      setSaving(false)
    }
  }

  const amountColor = cents === 0 ? 'text-ink-3' : expense ? 'text-expense' : 'text-income'

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-surface">
      <header className="flex items-center justify-between px-3 pb-1 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <button onClick={() => void navigate(existing ? { to: '/transacoes/$id', params: { id: existing.id } } : { to: '/transacoes' })} aria-label="Fechar" className="grid size-11 place-items-center rounded-[14px]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <h1 className="text-base font-extrabold">{existing ? 'Editar transação' : 'Nova transação'}</h1>
        <span className="w-11" />
      </header>

      <div className="px-5 pt-1">
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-2 gap-1 rounded-field bg-bg p-1">
          {(['expense', 'income'] as const).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={type === t}
              onClick={() => {
                setType(t)
                setCategoryId(null)
              }}
              className={`h-10 rounded-[10px] text-sm font-extrabold ${type === t ? `bg-surface shadow-card ${t === 'expense' ? 'text-expense' : 'text-income'}` : 'text-ink-2'}`}
            >
              {t === 'expense' ? 'Despesa' : 'Receita'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 px-5 pb-2.5 pt-[18px]">
        <span className="text-[13px] font-bold text-ink-2">Valor da {expense ? 'despesa' : 'receita'}</span>
        <output aria-live="polite" className={`text-[46px] font-extrabold leading-[1.1] tracking-tight ${amountColor}`}>
          {formatCents(cents)}
        </output>
      </div>

      <div role="radiogroup" aria-label="Categoria" className="flex gap-2 overflow-x-auto px-5 pb-3 pt-1.5">
        {categories.map((c) => {
          const on = c.id === categoryId
          return (
            <button key={c.id} role="radio" aria-checked={on} onClick={() => (setCategoryId(c.id), setError(null))} className="flex w-[70px] shrink-0 flex-col items-center gap-1.5">
              <span className="grid size-12 place-items-center rounded-2xl outline-offset-2" style={{ ...tint(c.color), outline: on ? `2px solid ${c.color}` : 'none' }}>
                <CategoryIcon name={c.icon} size={22} />
              </span>
              <span className={`whitespace-nowrap text-[11px] ${on ? 'font-extrabold' : 'font-semibold'}`}>{c.name}</span>
            </button>
          )
        })}
        {allCategories !== undefined && categories.length === 0 && <p className="text-sm text-ink-3">Nenhuma categoria ainda. Aguarde a sincronização.</p>}
      </div>

      <div className="flex flex-col gap-2 px-5">
        <input
          aria-label="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={120}
          placeholder="Descrição (opcional)"
          className="h-12 rounded-field border border-line bg-surface px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            aria-label="Data"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-12 min-w-0 rounded-field border border-line bg-surface px-3 text-sm font-bold"
          />
          <select
            aria-label="Conta"
            value={accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-12 min-w-0 rounded-field border border-line bg-surface px-3 text-sm font-bold"
          >
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {notes === null ? (
          <button onClick={() => setNotes('')} className="h-9 self-start text-sm font-bold text-cobalt">
            + Adicionar observação
          </button>
        ) : (
          <textarea
            aria-label="Observação"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Observação"
            className="rounded-field border border-line bg-surface px-3.5 py-3 text-[15px] outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30"
          />
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2.5 rounded-t-3xl bg-bg px-3 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5">
        {error && (
          <p role="alert" className="rounded-field bg-error-soft px-3.5 py-2.5 text-sm font-semibold text-error">
            {error}
          </p>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {keys.map((k) => (
            <button key={k} onClick={() => press(k)} aria-label={k === '⌫' ? 'Apagar' : k} className="h-[50px] rounded-[14px] bg-surface text-[22px] font-bold shadow-card">
              {k}
            </button>
          ))}
        </div>
        <button
          onClick={() => void save()}
          disabled={saving}
          className={`flex h-14 items-center justify-center gap-2 rounded-2xl text-base font-extrabold text-white disabled:opacity-60 ${expense ? 'bg-cobalt' : 'bg-income'}`}
        >
          {existing ? 'Salvar alterações' : `Salvar ${expense ? 'despesa' : 'receita'}`}
        </button>
      </div>
    </div>
  )
}
