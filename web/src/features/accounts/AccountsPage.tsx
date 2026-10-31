import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Sheet } from '../../components/Sheet'
import { Button, Field, FormError } from '../../components/ui'
import { ColorPicker } from '../../components/ColorPicker'
import { db } from '../../db'
import type { Account, AccountType } from '../../db/types'
import { formatDay, today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents, parseReaisToCents } from '../../lib/money'
import { useLive } from '../../lib/useLive'
import { deleteRecord, saveRecord } from '../../sync'
import { accountTypes, canArchive, canDelete, isDuplicateName, summarizeAccounts, typeIcon, typeLabel } from './rules'

type Editing = { kind: 'new' } | { kind: 'edit'; account: Account } | { kind: 'delete'; account: Account; uses: number }

// Contas e carteiras (design "06 · Contas e carteiras").
export function AccountsPage() {
  const accounts = useLive(() => db.accounts.filter((a) => !a.deleted_at).toArray(), [])
  const txs = useLive(() => db.transactions.filter((t) => !t.deleted_at).toArray(), [])
  const [menu, setMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const rows = useMemo(() => {
    if (!accounts || !txs) return null
    return summarizeAccounts([...accounts].sort((a, b) => a.sort_order - b.sort_order), txs, today())
  }, [accounts, txs])

  const active = rows?.filter((r) => !r.account.archived) ?? []
  const archived = rows?.filter((r) => r.account.archived) ?? []
  const total = active.reduce((n, r) => n + r.balance, 0)
  const positiveTotal = active.reduce((n, r) => n + Math.max(r.balance, 0), 0)

  async function toggleArchive(a: Account) {
    const verdict = canArchive(a, accounts ?? [])
    if (!verdict.ok) return setNotice(verdict.reason)
    await saveRecord('accounts', { ...a, archived: !a.archived, updated_at: new Date().toISOString() })
    setMenu(null)
  }

  function askDelete(a: Account, uses: number) {
    const verdict = canDelete(a, accounts ?? [], uses)
    setMenu(null)
    if (!verdict.ok) return setNotice(verdict.reason)
    setEditing({ kind: 'delete', account: a, uses })
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-24">
      <header className="flex items-center justify-between px-0 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <Link to="/mais" aria-label="Voltar" className="grid size-11 place-items-center rounded-field">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <h1 className="text-[17px] font-extrabold">Contas e carteiras</h1>
        <button onClick={() => setEditing({ kind: 'new' })} aria-label="Adicionar conta" className="grid size-11 place-items-center rounded-field bg-cobalt text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </header>

      {notice && (
        <div role="alert" className="flex items-start gap-3 rounded-field bg-warning-soft px-3.5 py-3 text-sm font-semibold text-warning">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dispensar aviso" className="font-extrabold">✕</button>
        </div>
      )}

      {rows === null ? (
        <p role="status" className="py-10 text-center text-sm text-ink-3">Carregando…</p>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-card border border-line bg-surface px-5 py-[18px]">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink-2">Saldo total em contas</span>
              <span className="text-[28px] font-extrabold tracking-tight">{formatCents(total)}</span>
            </div>
            {positiveTotal > 0 && (
              <div role="img" aria-label="Distribuição do saldo entre as contas" className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
                {active.filter((r) => r.balance > 0).map((r) => (
                  <span key={r.account.id} style={{ width: `${(r.balance / positiveTotal) * 100}%`, background: r.account.color }} />
                ))}
              </div>
            )}
          </section>

          {active.length === 0 && <p className="py-6 text-center text-sm text-ink-3">Nenhuma conta ainda. Toque em + para criar.</p>}
          <ul className="flex flex-col gap-2.5">
            {active.map((r) => (
              <AccountCard key={r.account.id} r={r} open={menu === r.account.id} onToggle={() => setMenu(menu === r.account.id ? null : r.account.id)}
                onEdit={() => (setMenu(null), setEditing({ kind: 'edit', account: r.account }))}
                onArchive={() => void toggleArchive(r.account)} onDelete={() => askDelete(r.account, r.uses)} />
            ))}
          </ul>

          {archived.length > 0 && (
            <section aria-label="Contas arquivadas" className="flex flex-col gap-2.5">
              <h2 className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-2">Arquivadas</h2>
              <ul className="flex flex-col gap-2.5">
                {archived.map((r) => (
                  <AccountCard key={r.account.id} r={r} open={menu === r.account.id} onToggle={() => setMenu(menu === r.account.id ? null : r.account.id)}
                    onEdit={() => (setMenu(null), setEditing({ kind: 'edit', account: r.account }))}
                    onArchive={() => void toggleArchive(r.account)} onDelete={() => askDelete(r.account, r.uses)} />
                ))}
              </ul>
            </section>
          )}

          <button onClick={() => setEditing({ kind: 'new' })} className="flex h-14 items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line text-[15px] font-extrabold text-cobalt">
            + Adicionar conta
          </button>
        </>
      )}

      {(editing?.kind === 'new' || editing?.kind === 'edit') && (
        <AccountSheet existing={editing.kind === 'edit' ? editing.account : undefined} all={accounts ?? []} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'delete' && (
        <Sheet title="Excluir esta conta?" onClose={() => setEditing(null)}>
          <p className="text-sm leading-relaxed text-ink-2">
            A conta <strong className="text-ink">{editing.account.name}</strong> não tem lançamentos e será removida de todos os seus aparelhos.
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={async () => {
                await deleteRecord('accounts', editing.account.id)
                setEditing(null)
              }}
              className="h-[54px] rounded-2xl bg-error text-base font-extrabold text-white"
            >
              Sim, excluir conta
            </button>
            <button onClick={() => setEditing(null)} className="h-[54px] rounded-2xl bg-bg text-base font-extrabold">Cancelar</button>
          </div>
        </Sheet>
      )}
    </main>
  )
}

function AccountCard({ r, open, onToggle, onEdit, onArchive, onDelete }: { r: ReturnType<typeof summarizeAccounts>[number]; open: boolean; onToggle: () => void; onEdit: () => void; onArchive: () => void; onDelete: () => void }) {
  const a = r.account
  return (
    <li className={`relative flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4 ${a.archived ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="grid size-[46px] shrink-0 place-items-center rounded-[15px]" style={tint(a.color)}>
          <CategoryIcon name={a.icon ?? typeIcon(a.type)} size={22} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-extrabold">{a.name}</span>
          <span className="text-[13px] font-semibold text-ink-2">{typeLabel(a.type)}</span>
        </span>
        <button onClick={onToggle} aria-label={`Ações da conta ${a.name}`} aria-expanded={open} className="grid size-11 place-items-center rounded-field text-ink-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5h.01M12 12h.01M12 19h.01" /></svg>
        </button>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-ink-2">Saldo</span>
          <span className="text-xl font-extrabold tracking-tight">{formatCents(r.balance)}</span>
        </span>
        <span className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-xs font-semibold text-ink-2">Última movimentação</span>
          <span className="text-[13px] font-bold text-ink-2">{r.last ? `${formatDay(r.last.date)}${r.last.description ? ` · ${r.last.description}` : ''}` : 'Sem movimentações'}</span>
        </span>
      </div>
      {open && (
        <div role="menu" className="absolute right-3.5 top-[62px] z-10 flex w-52 flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-sheet">
          <MenuItem onClick={onEdit}>Editar conta</MenuItem>
          <MenuItem onClick={onArchive}>{a.archived ? 'Reativar conta' : 'Arquivar conta'}</MenuItem>
          <MenuItem onClick={onDelete} danger>Excluir conta</MenuItem>
        </div>
      )}
    </li>
  )
}

function MenuItem({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button role="menuitem" onClick={onClick} className={`h-11 rounded-[10px] px-3 text-left text-[15px] font-bold ${danger ? 'text-error' : 'text-ink'}`}>
      {children}
    </button>
  )
}

function AccountSheet({ existing, all, onClose }: { existing?: Account; all: Account[]; onClose: () => void }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<AccountType>(existing?.type ?? 'corrente')
  const [balance, setBalance] = useState(existing ? (existing.initial_balance_cents / 100).toFixed(2).replace('.', ',') : '')
  const [color, setColor] = useState(existing?.color ?? '#2446D8')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Dê um nome para a conta.')
    if (isDuplicateName(n, all.filter((a) => !a.deleted_at), existing?.id)) return setError('Você já tem uma conta com esse nome.')
    const neg = balance.trim().startsWith('-')
    const cents = balance.trim() === '' ? 0 : parseReaisToCents(balance.replace(/^-/, ''))
    if (cents === null) return setError('Saldo inicial inválido. Use o formato 1.234,56.')
    const now = new Date().toISOString()
    await saveRecord('accounts', {
      ...(existing ?? { created_at: now, deleted_at: null, archived: false, sort_order: Math.max(-1, ...all.map((a) => a.sort_order)) + 1 }),
      id: existing?.id ?? crypto.randomUUID(),
      updated_at: now,
      name: n,
      type,
      initial_balance_cents: neg ? -cents : cents,
      color,
      icon: typeIcon(type),
    } as Account)
    onClose()
  }

  return (
    <Sheet title={existing ? 'Editar conta' : 'Nova conta'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank" />
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">Tipo</span>
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="h-12 rounded-field border border-line bg-surface px-3 text-[15px]">
            {accountTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <Field label="Saldo inicial" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0,00" hint="O saldo da conta antes dos lançamentos do app." />
        <ColorPicker value={color} onChange={setColor} />
        {error && <FormError>{error}</FormError>}
        <Button type="submit">{existing ? 'Salvar alterações' : 'Criar conta'}</Button>
      </form>
    </Sheet>
  )
}
