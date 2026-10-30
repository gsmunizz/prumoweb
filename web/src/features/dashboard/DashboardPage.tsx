import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { db } from '../../db'
import { formatDay, monthLabel, monthOf, shiftMonth, today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { useSession } from '../../lib/session'
import { useLive } from '../../lib/useLive'
import { activeCategories } from '../transactions/queries'
import { balance, expensesByCategory, lastMonths, monthStats, topExpenses, variation } from './stats'

const HIDE_KEY = 'prumo:hide-values'

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/)
  const letters = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : name.slice(0, 2)
  return letters.toUpperCase()
}

function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

const pct = (v: number) => `${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const signed = (cents: number, fmt: (c: number) => string) => `${cents >= 0 ? '+' : '−'}${fmt(Math.abs(cents))}`

// Início (design "01 · Início"): saldo, resumo do mês, gastos por categoria, maiores gastos
// e receitas x despesas. Gráfico de evolução do saldo e patrimônio investido entram depois.
export function DashboardPage() {
  const session = useSession()
  const [month, setMonth] = useState(() => monthOf(today()))
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })

  const accounts = useLive(() => db.accounts.filter((a) => !a.deleted_at).toArray(), [])
  const txs = useLive(() => db.transactions.filter((t) => !t.deleted_at).toArray(), [])
  const categories = useLive(activeCategories, [])
  const profile = useLive(() => db.profile.toCollection().first(), [])

  const data = useMemo(() => {
    if (!accounts || !txs || !categories) return null
    const prev = monthStats(txs, shiftMonth(month, -1))
    const cur = monthStats(txs, month)
    const endOfMonth = `${month}-31`
    const until = today() < endOfMonth ? today() : endOfMonth
    const opening = balance(accounts, txs, `${shiftMonth(month, -1)}-31`)
    return {
      cur,
      prev,
      total: balance(accounts, txs, until),
      opening,
      accountCount: accounts.filter((a) => !a.archived).length,
      slices: expensesByCategory(txs, categories, month),
      top: topExpenses(txs, month),
      series: lastMonths(txs, month),
    }
  }, [accounts, txs, categories, month])

  const fmt = (c: number) => (hidden ? 'R$ •••••' : formatCents(c))
  const name = profile?.name?.split(' ')[0] ?? ''
  const initials = initialsOf(profile?.name ?? (session.status === 'authenticated' ? session.user.email : '?'))
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))

  function toggleHidden() {
    const next = !hidden
    setHidden(next)
    try {
      localStorage.setItem(HIDE_KEY, next ? '1' : '0')
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-cobalt-soft text-[15px] font-extrabold text-cobalt-strong">
            {initials}
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-medium text-ink-2">{greeting()},</span>
            <span className="text-lg font-extrabold tracking-tight">{name || 'bem-vindo'}</span>
          </div>
        </div>
        <button onClick={toggleHidden} aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'} aria-pressed={hidden} className="grid size-11 place-items-center rounded-field text-ink-2">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
            {hidden && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </header>

      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior" className="grid size-11 place-items-center rounded-field border border-line bg-surface">
          ‹
        </button>
        <span className="text-[15px] font-bold">{monthLabel(month)}</span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês" className="grid size-11 place-items-center rounded-field border border-line bg-surface">
          ›
        </button>
      </div>

      {data === null ? (
        <p role="status" className="py-10 text-center text-sm text-ink-3">
          Carregando…
        </p>
      ) : (
        <>
          <section aria-label="Saldo atual" className="flex flex-col gap-3.5 rounded-3xl bg-[#2446d8] p-[22px] text-white">
            <div className="flex items-center justify-between text-[#dce3ff]">
              <span className="text-sm font-semibold">Saldo atual</span>
              <span className="text-xs font-semibold">{data.accountCount} {data.accountCount === 1 ? 'conta' : 'contas'}</span>
            </div>
            <div className="text-4xl font-extrabold leading-[1.1] tracking-tight">{fmt(data.total)}</div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#dce3ff]">
              <NetBadge net={data.cur.net} base={data.opening} />
              <span>
                {signed(data.cur.net, fmt)} em {monthLabel(month).split(' ')[0]!.toLowerCase()}
              </span>
            </div>
          </section>

          <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3">
            <SummaryCard label="Receitas" tone="income" value={fmt(data.cur.income)} change={variation(data.cur.income, data.prev.income)} goodWhenUp />
            <SummaryCard label="Despesas" tone="expense" value={fmt(data.cur.expense)} change={variation(data.cur.expense, data.prev.expense)} goodWhenUp={false} />
            <div className="col-span-2 flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-ink-2">Resultado líquido</span>
                  <span className={`text-[22px] font-extrabold tracking-tight ${data.cur.net >= 0 ? 'text-income' : 'text-expense'}`}>{signed(data.cur.net, fmt)}</span>
                </div>
                <span className={`rounded-full px-2.5 py-1.5 text-xs font-bold ${data.cur.net >= 0 ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`}>
                  {data.cur.net >= 0 ? 'Positivo' : 'Negativo'}
                </span>
              </div>
              {data.cur.income > 0 && (
                <p className="text-[13px] text-ink-2">
                  {data.cur.net >= 0 ? 'Você guardou ' : 'Você gastou além da renda: '}
                  <strong>{pct((data.cur.net / data.cur.income) * 100)}</strong> da sua renda este mês.
                </p>
              )}
            </div>
          </section>

          <Card title="Gastos por categoria" action={<Link to="/transacoes" className="text-[13px] font-bold text-cobalt">Ver transações</Link>}>
            {data.slices.length === 0 ? (
              <Muted>Nenhuma despesa neste mês.</Muted>
            ) : (
              <div className="flex items-center gap-4">
                <Donut slices={data.slices} />
                <ul className="flex min-w-0 flex-1 flex-col gap-2">
                  {data.slices.map((s) => (
                    <li key={s.name} className="flex items-center gap-2 text-[13px]">
                      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                      <span className="font-bold text-ink-2">{pct(s.pct)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card title="Maiores gastos" action={<Link to="/transacoes" className="text-[13px] font-bold text-cobalt">Ver tudo</Link>}>
            {data.top.length === 0 ? (
              <Muted>Nada por aqui ainda.</Muted>
            ) : (
              <ul className="divide-y divide-line">
                {data.top.map((t) => {
                  const c = t.category_id ? categoryById.get(t.category_id) : undefined
                  return (
                    <li key={t.id} className="flex min-h-11 items-center gap-3 py-2.5">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={tint(c?.color ?? '#667085')}>
                        <CategoryIcon name={c?.icon} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] font-bold">{t.description || c?.name || 'Sem descrição'}</span>
                        <span className="truncate text-[13px] text-ink-3">{[c?.name, formatDay(t.date)].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="text-[15px] font-extrabold">−{fmt(t.amount_cents)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card title="Receitas x despesas" action={<span className="text-xs text-ink-3">Últimos 6 meses</span>}>
            <Bars series={data.series} />
          </Card>
        </>
      )}

      <Link
        to="/transacoes/nova"
        aria-label="Nova transação"
        className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-5 z-10 grid size-[60px] place-items-center rounded-[20px] bg-cobalt text-white shadow-fab"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </main>
  )
}

function NetBadge({ net, base }: { net: number; base: number }) {
  const v = base > 0 ? (net / base) * 100 : null
  if (v === null) return null
  const up = v >= 0
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[13px] font-extrabold ${up ? 'text-[#087a55]' : 'text-[#c2341b]'}`}>
      {up ? '↑' : '↓'} {pct(v)}
    </span>
  )
}

function SummaryCard({ label, tone, value, change, goodWhenUp }: { label: string; tone: 'income' | 'expense'; value: string; change: number | null; goodWhenUp: boolean }) {
  const good = change === null ? true : goodWhenUp ? change >= 0 : change <= 0
  return (
    <Link to="/transacoes" className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4">
      <span aria-hidden="true" className={`grid size-9 place-items-center rounded-xl ${tone === 'income' ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={tone === 'income' ? 'M17 7 7 17M16 17H7V8' : 'M7 17 17 7M8 7h9v9'} />
        </svg>
      </span>
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <span className="text-xl font-extrabold tracking-tight">{value}</span>
      <span className={`text-xs font-bold ${change === null ? 'text-ink-3' : good ? 'text-income' : 'text-expense'}`}>
        {change === null ? 'Sem mês anterior' : `${change >= 0 ? '↑' : '↓'} ${pct(change)} vs. mês anterior`}
      </span>
    </Link>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => <p className="py-3 text-center text-sm text-ink-3">{children}</p>

// Rosca de gastos: um arco por categoria sobre o círculo de raio 42 (circunferência ≈ 263,9).
function Donut({ slices }: { slices: { name: string; color: string; pct: number }[] }) {
  const C = 2 * Math.PI * 42
  let offset = 0
  return (
    <svg width="116" height="116" viewBox="0 0 100 100" role="img" aria-label="Gastos por categoria" className="shrink-0 -rotate-90">
      {slices.map((s) => {
        const len = (s.pct / 100) * C
        const el = <circle key={s.name} cx="50" cy="50" r="42" fill="none" stroke={s.color} strokeWidth="14" strokeDasharray={`${Math.max(len - 1.6, 0)} ${C}`} strokeDashoffset={-offset} />
        offset += len
        return el
      })}
    </svg>
  )
}

function Bars({ series }: { series: { month: string; income: number; expense: number }[] }) {
  const max = Math.max(1, ...series.flatMap((p) => [p.income, p.expense]))
  const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs font-semibold text-ink-2">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-income" />Receitas</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-expense" />Despesas</span>
      </div>
      <div role="img" aria-label="Receitas e despesas dos últimos seis meses" className="flex h-32 items-end gap-2">
        {series.map((p) => (
          <div key={p.month} className="flex h-full flex-1 items-end justify-center gap-1">
            <div className="w-full max-w-4 rounded-t bg-income" style={{ height: `${(p.income / max) * 100}%`, minHeight: p.income ? 2 : 0 }} />
            <div className="w-full max-w-4 rounded-t bg-expense" style={{ height: `${(p.expense / max) * 100}%`, minHeight: p.expense ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2 text-[11px] font-semibold text-ink-3">
        {series.map((p) => (
          <span key={p.month} className="flex-1 text-center capitalize">{names[Number(p.month.slice(5)) - 1]}</span>
        ))}
      </div>
    </div>
  )
}
