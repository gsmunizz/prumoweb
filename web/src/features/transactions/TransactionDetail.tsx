import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { db } from '../../db'
import type { Account, Category, Transaction } from '../../db/types'
import { formatDay } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { useLive } from '../../lib/useLive'
import { deleteRecord } from '../../sync'
import { TransactionsPage } from './TransactionsPage'
import { isInternal } from './summary'

const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const stamp = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function fullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const text = longDate.format(new Date(y, m - 1, d))
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Detalhes (design "08 · Detalhes da transação"): folha sobre a lista, com editar e excluir.
export function TransactionDetailPage() {
  return (
    <>
      <TransactionsPage />
      <DetailSheet />
    </>
  )
}

function DetailSheet() {
  const { id = '' } = useParams({ strict: false })
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const data = useLive(async () => {
    const t = (await db.transactions.get(id)) ?? null
    if (!t || t.deleted_at) return { t: null, account: undefined, category: undefined }
    return { t, account: await db.accounts.get(t.account_id), category: t.category_id ? await db.categories.get(t.category_id) : undefined }
  }, [id])

  const close = () => void navigate({ to: '/transacoes' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (confirming ? setConfirming(false) : close())
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirming])

  if (data === undefined) return null
  const { t, account, category } = data

  async function remove() {
    setBusy(true)
    await deleteRecord('transactions', id)
    close()
  }

  return (
    <div className="fixed inset-0 z-20">
      <button aria-label="Fechar detalhes" onClick={close} className="absolute inset-0 bg-ink/50" />
      <section role="dialog" aria-modal="true" aria-labelledby="det-t" className="absolute inset-x-0 bottom-0 mx-auto flex max-w-md flex-col gap-5 rounded-t-[28px] bg-surface px-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5">
        <div aria-hidden="true" className="mx-auto h-[5px] w-10 rounded-full bg-line" />
        {t === null ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <h2 id="det-t" className="text-lg font-extrabold">Transação não encontrada</h2>
            <p className="text-sm text-ink-2">Ela pode ter sido excluída em outro aparelho.</p>
            <button onClick={close} className="h-12 rounded-2xl bg-cobalt px-6 font-extrabold text-white">Voltar</button>
          </div>
        ) : (
          <Body t={t} account={account} category={category} onDelete={() => setConfirming(true)} />
        )}
      </section>

      {confirming && t && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-ink/55 p-5">
          <section role="alertdialog" aria-modal="true" aria-labelledby="del-t" aria-describedby="del-d" className="flex w-full max-w-sm flex-col items-center gap-3.5 rounded-[28px] bg-surface px-[22px] pb-[22px] pt-7 shadow-sheet">
            <span aria-hidden="true" className="grid size-[60px] place-items-center rounded-full bg-error-soft text-error">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
              </svg>
            </span>
            <h2 id="del-t" className="text-xl font-extrabold">Excluir esta transação?</h2>
            <p id="del-d" className="text-center text-sm leading-relaxed text-ink-2">
              {t.description || category?.name || 'Esta transação'} · {formatCents(t.amount_cents)}. O saldo da conta <strong className="text-ink">{account?.name ?? ''}</strong> será ajustado em{' '}
              <strong className="text-ink">
                {t.type === 'expense' ? '+' : '−'}
                {formatCents(t.amount_cents)}
              </strong>
              . A exclusão vale em todos os seus aparelhos.
            </p>
            <div className="mt-1.5 flex w-full flex-col gap-2">
              <button onClick={() => void remove()} disabled={busy} className="h-[54px] rounded-2xl bg-error text-base font-extrabold text-white disabled:opacity-60">
                Sim, excluir transação
              </button>
              <button onClick={() => setConfirming(false)} className="h-[54px] rounded-2xl bg-bg text-base font-extrabold">
                Cancelar
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Body({ t, account, category, onDelete }: { t: Transaction; account?: Account; category?: Category; onDelete: () => void }) {
  const income = t.type === 'income'
  const internal = isInternal(t)
  return (
    <>
      <div className="flex flex-col items-center gap-2.5 pt-1">
        <span className="grid size-[60px] place-items-center rounded-[20px]" style={tint(category?.color ?? '#667085')}>
          <CategoryIcon name={category?.icon} size={28} />
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold ${income ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={income ? 'M17 7 7 17M16 17H7V8' : 'M7 17 17 7M8 7h9v9'} />
          </svg>
          {income ? 'Receita' : 'Despesa'}
        </span>
        <h2 id="det-t" className="text-center text-[17px] font-bold text-ink-2">{t.description || category?.name || 'Sem descrição'}</h2>
        <div className="text-[38px] font-extrabold tracking-tight">
          {income ? '+' : '−'}
          {formatCents(t.amount_cents)}
        </div>
      </div>

      <dl className="rounded-[18px] bg-bg px-4 py-1">
        <Row label="Categoria">
          {category ? (
            <>
              <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: category.color }} />
              {category.name}
            </>
          ) : (
            'Sem categoria'
          )}
        </Row>
        <Row label="Data">{fullDate(t.date) || formatDay(t.date)}</Row>
        <Row label="Conta">{account?.name ?? '—'}</Row>
        {t.notes && (
          <div className="flex flex-col gap-1.5 py-3.5">
            <dt className="text-sm font-semibold text-ink-2">Observação</dt>
            <dd className="text-[15px] leading-normal">{t.notes}</dd>
          </div>
        )}
      </dl>

      {internal ? (
        <p className="rounded-field bg-bg px-3.5 py-3 text-center text-sm text-ink-2">Transferências e aportes são gerenciados em suas próprias telas, que chegam em breve.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={onDelete} className="flex h-[54px] items-center justify-center gap-2 rounded-2xl border-[1.5px] border-error/40 text-base font-extrabold text-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            Excluir
          </button>
          <Link to="/transacoes/$id/editar" params={{ id: t.id }} className="flex h-[54px] items-center justify-center gap-2 rounded-2xl bg-cobalt text-base font-extrabold text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
            </svg>
            Editar
          </Link>
        </div>
      )}
      <span className="text-center text-xs text-ink-3">Criada em {stamp.format(new Date(t.created_at))}</span>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-3.5 last:border-b-0">
      <dt className="text-sm font-semibold text-ink-2">{label}</dt>
      <dd className="flex items-center gap-2 text-right text-[15px] font-bold">{children}</dd>
    </div>
  )
}
