import { useMemo, useState } from 'react'
import { db } from '../../db'
import type { Account, AccountType } from '../../db/types'
import { IconEdit, IconTrash, IconPlus, PageHead, SectionNav, SidePanel, TabletSheet, ghostButton, primaryButton, widePage } from '../../components/wide'
import { monthLabel, monthOf, today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents, parseReaisToCents } from '../../lib/money'
import { palette } from '../../lib/palette'
import { useLive } from '../../lib/useLive'
import { deleteRecord, saveRecord } from '../../sync'
import { accountTypes, canArchive, canDelete, isDuplicateName, summarizeAccounts, typeIcon, typeLabel } from './rules'

type Editing = { kind: 'new' } | { kind: 'edit'; account: Account } | { kind: 'delete'; account: Account; uses: number }

// Contas e carteiras no tablet (cartões em duas colunas e formulário em folha de 640px) e no desktop
// (grade de cartões com painel lateral). Designs "Tablet · Contas e carteiras" e "Desktop · Contas e carteiras".
export function AccountsWide({ variant }: { variant: 'tablet' | 'desktop' }) {
  const desktop = variant === 'desktop'
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
  const month = monthOf(today())
  const monthCount = (txs ?? []).filter((t) => t.date.startsWith(month)).length

  async function toggleArchive(a: Account) {
    const verdict = canArchive(a, accounts ?? [])
    setMenu(null)
    if (!verdict.ok) return setNotice(verdict.reason)
    await saveRecord('accounts', { ...a, archived: !a.archived, updated_at: new Date().toISOString() })
  }

  function askDelete(a: Account, uses: number) {
    const verdict = canDelete(a, accounts ?? [], uses)
    setMenu(null)
    if (!verdict.ok) return setNotice(verdict.reason)
    setEditing({ kind: 'delete', account: a, uses })
  }

  const close = () => setEditing(null)
  const selectedId = editing && editing.kind !== 'new' ? editing.account.id : null

  const addButton = (
    <button
      onClick={() => setEditing({ kind: 'new' })}
      className={`${primaryButton} ${desktop ? 'h-12 px-5' : 'h-12 px-[18px]'}`}
    >
      <IconPlus />
      {desktop ? 'Adicionar conta' : 'Adicionar'}
    </button>
  )

  const form = editing && editing.kind !== 'delete' && <AccountForm key={editing.kind === 'edit' ? editing.account.id : 'new'} existing={editing.kind === 'edit' ? editing.account : undefined} all={accounts ?? []} onClose={close} />
  const confirm = editing?.kind === 'delete' && (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] leading-normal text-ink-2">
        Excluir <strong className="text-ink">{editing.account.name}</strong> remove a conta. Ela não tem lançamentos e será removida de todos os seus aparelhos. Esta ação não pode ser desfeita.
      </p>
      <div className="flex gap-2.5">
        <button onClick={close} className={`${ghostButton} h-[52px] flex-1`}>
          Manter conta
        </button>
        <button
          onClick={async () => {
            await deleteRecord('accounts', editing.account.id)
            close()
          }}
          className="h-[52px] flex-1 rounded-[14px] bg-error text-[15px] font-extrabold text-white"
        >
          Sim, excluir
        </button>
      </div>
    </div>
  )
  const panelTitle = editing?.kind === 'new' ? 'Nova conta' : editing?.kind === 'edit' ? 'Editar conta' : 'Excluir conta'

  const cards = (list: typeof active) => (
    <ul className={desktop ? 'grid min-w-0 flex-[3_1_480px] grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4' : 'grid grid-cols-2 gap-3.5'}>
      {list.map((r) => {
        const a = r.account
        return (
          <li
            key={a.id}
            className={`relative flex flex-col rounded-card bg-surface ${desktop ? 'gap-3.5 p-5' : 'gap-3 p-[18px]'} ${selectedId === a.id ? 'border-[1.5px] border-cobalt' : 'border border-line'} ${a.archived ? 'opacity-70' : ''}`}
          >
            <div className="flex items-center gap-3">
              <span className={`grid shrink-0 place-items-center ${desktop ? 'size-11 rounded-[14px]' : 'size-[42px] rounded-[13px]'}`} style={tint(a.color)}>
                <CategoryIcon name={a.icon ?? typeIcon(a.type)} size={22} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate font-extrabold ${desktop ? 'text-base' : 'text-[15px]'}`}>{a.name}</span>
                <span className={`font-semibold text-ink-3 ${desktop ? 'text-[13px]' : 'text-xs'}`}>{typeLabel(a.type)}</span>
              </span>
              {desktop && (
                <button onClick={() => setMenu(menu === a.id ? null : a.id)} aria-label={`Ações da conta ${a.name}`} aria-expanded={menu === a.id} className="grid size-11 place-items-center rounded-xl text-ink-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5h.01M12 12h.01M12 19h.01" />
                  </svg>
                </button>
              )}
            </div>
            <span className={`font-extrabold tracking-tight ${desktop ? 'text-[26px]' : 'text-2xl'}`}>{formatCents(r.balance)}</span>
            <div className="flex items-center justify-between">
              <span className={`font-semibold text-ink-3 ${desktop ? 'text-[13px]' : 'text-xs'}`}>
                {r.uses} {r.uses === 1 ? 'transação' : 'transações'}
              </span>
              {!desktop && (
                <div className="flex">
                  <button onClick={() => setEditing({ kind: 'edit', account: a })} aria-label={`Editar ${a.name}`} className="grid size-11 place-items-center rounded-xl text-ink-2">
                    <IconEdit />
                  </button>
                  <button onClick={() => askDelete(a, r.uses)} aria-label={`Excluir ${a.name}`} className="grid size-11 place-items-center rounded-xl text-error">
                    <IconTrash />
                  </button>
                </div>
              )}
            </div>
            {desktop && menu === a.id && (
              <div role="menu" className="absolute right-4 top-16 z-10 flex w-[180px] flex-col rounded-[14px] border border-line bg-surface p-1.5 shadow-sheet">
                <button role="menuitem" onClick={() => (setMenu(null), setEditing({ kind: 'edit', account: a }))} className="h-11 rounded-[10px] px-3 text-left text-sm font-bold">
                  Editar conta
                </button>
                <button role="menuitem" onClick={() => void toggleArchive(a)} className="h-11 rounded-[10px] px-3 text-left text-sm font-bold">
                  {a.archived ? 'Reativar conta' : 'Arquivar conta'}
                </button>
                <button role="menuitem" onClick={() => askDelete(a, r.uses)} className="h-11 rounded-[10px] px-3 text-left text-sm font-bold text-error">
                  Excluir conta
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )

  return (
    <main className={widePage}>
      <PageHead
        size={desktop ? 28 : 26}
        title="Contas e carteiras"
        subtitle={`Saldo somado de ${active.length} ${active.length === 1 ? 'conta' : 'contas'}`}
        action={addButton}
      />
      {!desktop && <SectionNav current="contas" />}

      {notice && (
        <div role="alert" className="flex items-start gap-3 rounded-field bg-warning-soft px-3.5 py-3 text-sm font-semibold text-warning">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dispensar aviso" className="font-extrabold">
            ✕
          </button>
        </div>
      )}

      {rows === null ? (
        <p role="status" className="py-10 text-center text-sm text-ink-3">
          Carregando…
        </p>
      ) : (
        <>
          <section className={`flex rounded-card bg-cobalt text-white ${desktop ? 'flex-wrap items-center justify-between gap-4 px-7 py-6' : 'flex-col gap-1 px-[26px] py-[22px]'}`}>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold opacity-85">Saldo total</span>
              <span className={`font-extrabold ${desktop ? 'text-[40px] tracking-[-1.2px]' : 'text-[38px] tracking-[-1.2px]'}`}>{formatCents(total)}</span>
            </div>
            {desktop && (
              <span className="rounded-full bg-white/15 px-3.5 py-2 text-sm font-bold">
                {monthCount} {monthCount === 1 ? 'transação' : 'transações'} em {monthLabel(month).split(' ')[0]!.toLowerCase()}
              </span>
            )}
          </section>

          {active.length === 0 && <p className="py-6 text-center text-sm text-ink-3">Nenhuma conta ainda. Use o botão para criar.</p>}
          <div className={desktop ? 'flex flex-wrap items-start gap-6' : 'contents'}>
            {cards(active)}
            {desktop && editing && (
              <SidePanel title={panelTitle} onClose={close}>
                {form}
                {confirm}
              </SidePanel>
            )}
          </div>

          {archived.length > 0 && (
            <section aria-label="Contas arquivadas" className="flex flex-col gap-2.5">
              <h2 className="px-1 text-[13px] font-bold uppercase tracking-wide text-ink-2">Arquivadas</h2>
              {cards(archived)}
            </section>
          )}
        </>
      )}

      {!desktop && editing && (
        <TabletSheet title={panelTitle} onClose={close}>
          {form}
          {confirm}
        </TabletSheet>
      )}
    </main>
  )
}

function AccountForm({ existing, all, onClose }: { existing?: Account; all: Account[]; onClose: () => void }) {
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

  const input = 'h-12 rounded-[14px] border border-line bg-surface px-3.5 text-[15px] font-medium outline-none placeholder:text-ink-3 focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30'
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] font-extrabold">
        Nome da conta
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Banco Inter" className={input} />
      </label>
      <div role="radiogroup" aria-label="Tipo de conta" className="flex flex-col gap-2">
        <span className="text-[13px] font-extrabold">Tipo</span>
        <div className="flex flex-wrap gap-2">
          {accountTypes.map((t) => {
            const on = t.value === type
            return (
              <button key={t.value} type="button" role="radio" aria-checked={on} onClick={() => setType(t.value)} className={`h-10 rounded-full px-3.5 text-sm font-bold ${on ? 'border-[1.5px] border-cobalt bg-cobalt-soft text-cobalt-strong' : 'border border-line bg-surface text-ink-2'}`}>
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-extrabold">
        Saldo inicial
        <input value={balance} inputMode="decimal" onChange={(e) => setBalance(e.target.value)} placeholder="R$ 0,00" className={input} />
      </label>
      <div role="radiogroup" aria-label="Cor" className="flex flex-col gap-2">
        <span className="text-[13px] font-extrabold">Cor</span>
        <div className="flex flex-wrap gap-2.5">
          {palette.map((w) => {
            const on = w.color.toLowerCase() === color.toLowerCase()
            return (
              <button key={w.color} type="button" role="radio" aria-checked={on} aria-label={w.name} onClick={() => setColor(w.color)} className="grid size-11 place-items-center rounded-full" style={{ border: on ? '2px solid var(--color-cobalt)' : '1px solid var(--color-line)' }}>
                <span className="size-[22px] rounded-full" style={{ background: w.color }} />
              </button>
            )
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="rounded-field bg-error-soft px-3.5 py-3 text-sm font-semibold text-error">
          {error}
        </p>
      )}
      <div className="flex gap-2.5 pt-1">
        <button type="button" onClick={onClose} className={`${ghostButton} h-[52px] flex-1`}>
          Cancelar
        </button>
        <button type="submit" className={`${primaryButton} h-[52px] flex-1`}>
          {existing ? 'Salvar conta' : 'Criar conta'}
        </button>
      </div>
    </form>
  )
}
