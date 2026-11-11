import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Segmented, widePage } from '../../components/wide'
import { db } from '../../db'
import { formatShort, monthLabel, monthOf, shiftMonth, today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { useSession } from '../../lib/session'
import { useLive } from '../../lib/useLive'
import { assetClasses, buildAssets, distribution, monthGain, totalsOf } from '../investments/rules'
import { activeCategories } from '../transactions/queries'
import { balance, balanceSeries, expensesByCategory, lastMonths, monthStats, topExpenses, variation, type BalancePoint, type SeriesRange } from './stats'

const pct = (v: number) => `${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${formatCents(Math.abs(cents))}`

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/)
  const letters = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : name.slice(0, 2)
  return letters.toUpperCase()
}

function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

// "R$ 22 mil" nos eixos do gráfico.
function compact(cents: number): string {
  const reais = cents / 100
  return Math.abs(reais) >= 1000 ? `R$ ${Math.round(reais / 1000)} mil` : `R$ ${Math.round(reais)}`
}

const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const monthShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function axisLabels(points: BalancePoint[], range: SeriesRange): string[] {
  const n = range === 'week' ? 7 : 5
  const picks = Array.from({ length: Math.min(n, points.length) }, (_, i) => points[Math.round((i * (points.length - 1)) / Math.max(1, Math.min(n, points.length) - 1))]!)
  return picks.map((p) => {
    const [y, m, d] = p.date.split('-').map(Number) as [number, number, number]
    if (range === 'week') return weekdays[new Date(y, m - 1, d).getDay()]!
    if (range === 'year') return monthShort[m - 1]!
    return formatShort(p.date)
  })
}

// Início do tablet ("Tablet · Dashboard") e do desktop ("Desktop · Dashboard").
export function DashboardWide({ variant }: { variant: 'tablet' | 'desktop' }) {
  const desktop = variant === 'desktop'
  const session = useSession()
  const navigate = useNavigate()
  const [month, setMonth] = useState(() => monthOf(today()))
  const [range, setRange] = useState<SeriesRange>('month')
  const [search, setSearch] = useState('')

  const accounts = useLive(() => db.accounts.filter((a) => !a.deleted_at).toArray(), [])
  const txs = useLive(() => db.transactions.filter((t) => !t.deleted_at).toArray(), [])
  const categories = useLive(activeCategories, [])
  const profile = useLive(() => db.profile.toCollection().first(), [])
  const invest = useLive(async () => {
    const [investments, movements, snapshots] = await Promise.all([db.investments.toArray(), db.investment_movements.toArray(), db.investment_snapshots.toArray()])
    return { investments, movements, snapshots }
  }, [])

  const now = today()
  const data = useMemo(() => {
    if (!accounts || !txs || !categories) return null
    const prev = monthStats(txs, shiftMonth(month, -1))
    const cur = monthStats(txs, month)
    const endOfMonth = `${month}-31`
    const until = now < endOfMonth ? now : endOfMonth
    return {
      cur,
      prev,
      total: balance(accounts, txs, until),
      opening: balance(accounts, txs, `${shiftMonth(month, -1)}-31`),
      accountCount: accounts.filter((a) => !a.archived).length,
      slices: expensesByCategory(txs, categories, month),
      top: topExpenses(txs, month),
      bars: lastMonths(txs, month),
      points: balanceSeries(accounts, txs, month, range, now),
    }
  }, [accounts, txs, categories, month, range, now])

  const portfolio = useMemo(() => {
    if (!invest) return null
    const assets = buildAssets(invest.investments, invest.movements, invest.snapshots)
    return { totals: totalsOf(assets), slices: distribution(assets), gain: monthGain(invest.investments, invest.movements, invest.snapshots, now) }
  }, [invest, now])

  const name = profile?.name?.split(' ')[0] ?? ''
  const initials = initialsOf(profile?.name ?? (session.status === 'authenticated' ? session.user.email : '?'))
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]))
  const monthName = monthLabel(month).split(' ')[0]!.toLowerCase()
  const prevName = monthLabel(shiftMonth(month, -1)).split(' ')[0]!.toLowerCase()

  const monthPill = (
    <div className="flex h-11 items-center rounded-xl border border-line bg-surface">
      <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Mês anterior" className="grid h-[42px] w-10 place-items-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className="px-1.5 text-sm font-extrabold">{monthLabel(month)}</span>
      <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Próximo mês" className="grid h-[42px] w-10 place-items-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
    </div>
  )

  const header = desktop ? (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-extrabold tracking-[-0.6px]">
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <span className="text-sm text-ink-3">Seu resumo financeiro de {monthLabel(month).replace(' ', ' de ').toLowerCase()}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ to: '/transacoes', search: { q: search.trim() || undefined } })
          }}
          className="flex h-11 w-[260px] max-w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="shrink-0 text-ink-3" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar transações" placeholder="Buscar transações" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" />
        </form>
        {monthPill}
        <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-cobalt-soft text-sm font-extrabold text-cobalt-strong">
          {initials}
        </span>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink-2">{greeting()},</span>
        <h1 className="text-[26px] font-extrabold tracking-[-0.5px]">{name || 'bem-vindo'}</h1>
      </div>
      {monthPill}
    </div>
  )

  if (data === null) return <WideSkeleton desktop={desktop} header={header} />

  const net = data.cur.net
  const netPct = data.opening > 0 ? (net / data.opening) * 100 : null
  const first = data.points[0]?.value ?? 0
  const last = data.points[data.points.length - 1]?.value ?? 0
  const rangeText = range === 'week' ? 'nesta semana' : range === 'year' ? 'no ano' : 'neste mês'

  const incomeChange = variation(data.cur.income, data.prev.income)
  const expenseChange = variation(data.cur.expense, data.prev.expense)
  const saved = data.cur.income > 0 ? (net / data.cur.income) * 100 : null

  const changeLine = (change: number | null, goodWhenUp: boolean) => {
    if (change === null) return <span className="text-xs font-bold text-ink-3">Sem mês anterior</span>
    const good = goodWhenUp ? change >= 0 : change <= 0
    return (
      <span className={`text-xs font-bold ${good ? 'text-income' : 'text-expense'}`}>
        {change >= 0 ? '↑' : '↓'} {pct(change)} vs. {prevName}
      </span>
    )
  }

  const hero = (
    <section aria-label="Saldo atual" className={desktop ? 'flex flex-col gap-2.5 rounded-card bg-[#2446d8] p-5 text-white' : 'flex items-end justify-between gap-4 rounded-3xl bg-[#2446d8] p-6 text-white'}>
      <div className="flex flex-col gap-2">
        <span className={`font-semibold text-[#dce3ff] ${desktop ? 'text-[13px]' : 'text-sm'}`}>
          Saldo atual{!desktop && ` · ${data.accountCount} ${data.accountCount === 1 ? 'conta' : 'contas'}`}
        </span>
        <span className={`font-extrabold ${desktop ? 'text-[30px] tracking-[-0.8px]' : 'text-[40px] tracking-[-1px]'}`}>{formatCents(data.total)}</span>
      </div>
      {desktop ? (
        netPct !== null && (
          <span className="flex items-center gap-2 text-xs text-[#dce3ff]">
            <span className={`rounded-full bg-white px-2 py-[3px] font-extrabold ${netPct >= 0 ? 'text-[#087a55]' : 'text-[#c2341b]'}`}>
              {netPct >= 0 ? '↗' : '↘'} {netPct >= 0 ? '+' : '−'}
              {pct(netPct)}
            </span>
            vs. {prevName}
          </span>
        )
      ) : (
        <div className="flex flex-col items-end gap-1.5">
          {netPct !== null && (
            <span className={`rounded-full bg-white px-3 py-1.5 text-sm font-extrabold ${netPct >= 0 ? 'text-[#087a55]' : 'text-[#c2341b]'}`}>
              {netPct >= 0 ? '↗ +' : '↘ −'}
              {pct(netPct)}
            </span>
          )}
          <span className="text-[13px] text-[#dce3ff]">
            {signed(net)} vs. {prevName}
          </span>
        </div>
      )}
    </section>
  )

  const statCard = (label: string, tone: 'income' | 'expense', value: number, change: number | null, goodWhenUp: boolean) => (
    <Link to="/transacoes" className={`flex flex-col gap-2 rounded-card border border-line bg-surface ${desktop ? 'gap-2.5 p-5' : 'p-[18px]'}`}>
      <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        {desktop && (
          <span aria-hidden="true" className={`grid size-7 place-items-center rounded-[9px] ${tone === 'income' ? 'bg-income-soft text-income' : 'bg-expense-soft text-expense'}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={tone === 'income' ? 'M17 7 7 17M16 17H7V8' : 'M7 17 17 7M8 7h9v9'} />
            </svg>
          </span>
        )}
        {label}
      </span>
      <span className={`font-extrabold tracking-tight ${desktop ? 'text-[26px]' : 'text-[22px]'}`}>{formatCents(value)}</span>
      {changeLine(change, goodWhenUp)}
    </Link>
  )

  const netCard = (
    <div className={`flex flex-col gap-2 rounded-card border border-line bg-surface ${desktop ? 'gap-2.5 p-5' : 'p-[18px]'}`}>
      <span className="text-[13px] font-semibold text-ink-2">Resultado líquido</span>
      <span className={`font-extrabold tracking-tight ${net >= 0 ? 'text-income' : 'text-expense'} ${desktop ? 'text-[26px]' : 'text-[22px]'}`}>{signed(net)}</span>
      {desktop && saved !== null && (
        <div className="flex h-1.5 overflow-hidden rounded-[3px] bg-ink/[0.06]">
          <div className={net >= 0 ? 'bg-income' : 'bg-expense'} style={{ width: `${Math.min(100, Math.abs(saved))}%` }} />
        </div>
      )}
      <span className="text-xs font-semibold text-ink-2">
        {saved === null ? 'Sem receitas no mês' : net >= 0 ? `${pct(saved)}${desktop ? ' da renda poupada' : ' poupado'}` : `Gastou ${pct(-saved)} além da renda`}
      </span>
    </div>
  )

  const evolution = (
    <section aria-labelledby="d-evo" className={`flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface ${desktop ? 'flex-[2_1_560px] px-6 py-[22px]' : 'p-[22px]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="d-evo" className="text-[17px] font-extrabold">
            Evolução do saldo
          </h2>
          <span className={`text-[13px] font-bold ${last - first >= 0 ? 'text-income' : 'text-expense'}`}>
            {last - first >= 0 ? '↑' : '↓'} {signed(last - first)} {rangeText}
          </span>
        </div>
        <Segmented
          size="sm"
          label="Período do gráfico"
          value={range}
          onChange={setRange}
          options={[
            { value: 'week', label: 'Semana' },
            { value: 'month', label: 'Mês' },
            { value: 'year', label: 'Ano' },
          ]}
        />
      </div>
      <BalanceChart points={data.points} tall={desktop} axis={desktop} labels={axisLabels(data.points, range)} />
    </section>
  )

  const categoriesCard = (
    <section aria-labelledby="d-cat" className={`flex min-w-0 flex-col rounded-card border border-line bg-surface ${desktop ? 'flex-[1_1_320px] gap-[18px] px-6 py-[22px]' : 'gap-4 p-5'}`}>
      <div className="flex items-center justify-between">
        <h2 id="d-cat" className={`font-extrabold ${desktop ? 'text-[17px]' : 'text-base'}`}>
          Gastos por categoria
        </h2>
        {desktop && (
          <Link to="/mais/categorias" className="text-[13px] font-bold text-cobalt">
            Ver todas
          </Link>
        )}
      </div>
      {data.slices.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-3">Nenhuma despesa neste mês.</p>
      ) : (
        <>
          <div className="relative flex justify-center">
            <Donut slices={data.slices} size={desktop ? 180 : 140} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`font-semibold text-ink-3 ${desktop ? 'text-xs' : 'text-[11px]'}`}>{desktop ? 'Despesas' : 'Total'}</span>
              <span className={`font-extrabold ${desktop ? 'text-xl' : 'text-[15px]'}`}>{desktop ? `R$ ${Math.round(data.cur.expense / 100).toLocaleString('pt-BR')}` : compact(data.cur.expense)}</span>
            </div>
          </div>
          <ul className={desktop ? 'flex flex-col gap-2.5' : 'grid grid-cols-2 gap-x-3.5 gap-y-2'}>
            {data.slices.map((s) => (
              <li key={s.name} className="flex items-center gap-2.5 text-[13px]">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate font-semibold text-ink-2">{s.name}</span>
                {desktop && <span className="font-semibold text-ink-2">{formatCents(s.cents)}</span>}
                <span className="w-12 text-right font-extrabold">{pct(s.pct)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )

  const topCard = (
    <section aria-labelledby="d-top" className={`flex min-w-0 flex-col gap-1.5 rounded-card border border-line bg-surface ${desktop ? 'flex-[1_1_380px] px-6 pb-2.5 pt-[22px]' : 'px-5 pb-2 pt-5'}`}>
      <div className="flex items-center justify-between">
        <h2 id="d-top" className={`font-extrabold ${desktop ? 'text-[17px]' : 'mb-1 text-base'}`}>
          Maiores gastos
        </h2>
        {desktop && (
          <Link to="/transacoes" className="text-[13px] font-bold text-cobalt">
            Ver todas
          </Link>
        )}
      </div>
      {data.top.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-3">Nada por aqui ainda.</p>
      ) : (
        <ul>
          {data.top.map((t, i) => {
            const c = t.category_id ? categoryById.get(t.category_id) : undefined
            return (
              <li key={t.id} className={`flex items-center gap-3 ${i ? 'border-t border-line' : ''} ${desktop ? 'py-[11px]' : 'py-2.5'}`}>
                <Link to="/transacoes/$id" params={{ id: t.id }} className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid size-[38px] shrink-0 place-items-center rounded-xl" style={tint(c?.color ?? '#667085')}>
                    <CategoryIcon name={c?.icon} size={18} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-sm font-bold">{t.description || c?.name || 'Sem descrição'}</span>
                    <span className="truncate text-xs text-ink-3">{[c?.name, formatShort(t.date)].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-sm font-extrabold">−{formatCents(t.amount_cents)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )

  const barsCard = (
    <section aria-labelledby="d-rxd" className="flex min-w-0 flex-[1_1_380px] flex-col gap-4 rounded-card border border-line bg-surface px-6 py-[22px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="d-rxd" className="text-[17px] font-extrabold">
          Receitas x despesas
        </h2>
        <div className="flex gap-3.5 text-xs font-semibold text-ink-2">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-income" />
            Receitas
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-expense" />
            Despesas
          </span>
        </div>
      </div>
      <MonthBars series={data.bars} />
    </section>
  )

  const investCard = (
    <Link to="/investimentos" className="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5 rounded-card bg-[#0f1729] px-6 py-[22px] text-white">
      <span className="text-sm font-semibold text-[#b3bdcf]">Investimentos</span>
      {portfolio && portfolio.slices.length > 0 ? (
        <>
          <span className="text-[28px] font-extrabold tracking-[-0.6px]">{formatCents(portfolio.totals.current)}</span>
          <span className="flex items-center gap-2 text-[13px] text-[#b3bdcf]">
            {portfolio.gain.pct !== null && (
              <span className={`rounded-full px-2 py-[3px] text-xs font-extrabold ${portfolio.gain.cents >= 0 ? 'bg-[#3dd6a0] text-[#062b1e]' : 'bg-[#ff8a73] text-[#3b0d03]'}`}>
                {portfolio.gain.pct >= 0 ? '+' : '−'}
                {Math.abs(portfolio.gain.pct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
              </span>
            )}
            no mês
          </span>
          <div role="img" aria-label="Distribuição da carteira por classe" className="mt-auto flex h-2.5 gap-0.5 overflow-hidden rounded-[5px]">
            {portfolio.slices.map((s) => (
              <span key={s.asset_class} style={{ width: `${s.pct}%`, background: assetClasses.find((c) => c.value === s.asset_class)?.color }} />
            ))}
          </div>
        </>
      ) : (
        <span className="text-sm text-[#b3bdcf]">Cadastre seus ativos para acompanhar o patrimônio.</span>
      )}
      <span className="text-[13px] font-extrabold text-[#a9b8ff]">Ver carteira →</span>
    </Link>
  )

  return (
    <main className={`${widePage} ${desktop ? 'gap-6' : ''}`}>
      {header}
      {desktop ? (
        <>
          <section aria-label="Indicadores do mês" className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
            {hero}
            {statCard('Receitas', 'income', data.cur.income, incomeChange, true)}
            {statCard('Despesas', 'expense', data.cur.expense, expenseChange, false)}
            {netCard}
          </section>
          <div className="flex flex-wrap gap-4">
            {evolution}
            {categoriesCard}
          </div>
          <div className="flex flex-wrap gap-4">
            {barsCard}
            {topCard}
            {investCard}
          </div>
        </>
      ) : (
        <>
          {hero}
          <section aria-label="Resumo do mês" className="grid grid-cols-3 gap-3.5">
            {statCard('Receitas', 'income', data.cur.income, incomeChange, true)}
            {statCard('Despesas', 'expense', data.cur.expense, expenseChange, false)}
            {netCard}
          </section>
          {evolution}
          <div className="grid grid-cols-2 gap-3.5">
            {categoriesCard}
            {topCard}
          </div>
        </>
      )}
      <span className="sr-only">{monthName}</span>
    </main>
  )
}

// Rosca de gastos: um arco por categoria sobre o círculo de raio 42 (circunferência ≈ 263,9).
function Donut({ slices, size }: { slices: { name: string; color: string; pct: number }[]; size: number }) {
  const C = 2 * Math.PI * 42
  let offset = 0
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Distribuição das despesas" className="-rotate-90">
      {slices.map((s) => {
        const len = (s.pct / 100) * C
        const el = <circle key={s.name} cx="50" cy="50" r="42" fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${Math.max(len - 1.6, 0)} ${C}`} strokeDashoffset={-offset} />
        offset += len
        return el
      })}
    </svg>
  )
}

function MonthBars({ series }: { series: { month: string; income: number; expense: number }[] }) {
  const max = Math.max(1, ...series.flatMap((p) => [p.income, p.expense]))
  return (
    <div>
      <div role="img" aria-label="Receitas e despesas dos últimos seis meses" className="grid h-[200px] grid-cols-6 items-end border-b border-line">
        {series.map((p) => (
          <div key={p.month} className="flex h-full items-end justify-center gap-[5px]">
            <div className="w-4 rounded-t bg-income" style={{ height: `${(p.income / max) * 100}%`, minHeight: p.income ? 2 : 0 }} />
            <div className="w-4 rounded-t bg-expense" style={{ height: `${(p.expense / max) * 100}%`, minHeight: p.expense ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-6 text-center text-xs font-semibold text-ink-3">
        {series.map((p) => (
          <span key={p.month}>{monthShort[Number(p.month.slice(5)) - 1]}</span>
        ))}
      </div>
    </div>
  )
}

// Linha do saldo com área suave; o eixo vertical (desktop) mostra o máximo, o meio e o mínimo.
function BalanceChart({ points, tall, axis, labels }: { points: BalancePoint[]; tall: boolean; axis: boolean; labels: string[] }) {
  const W = 1000
  const H = 100
  const values = points.map((p) => p.value)
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 1)
  const span = Math.max(1, max - min)
  const lo = min === 0 && Math.min(...values) >= 0 ? 0 : min - span * 0.1
  const hi = max + span * 0.1
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W)
  const y = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
  const lastPt = points.length - 1
  const height = tall ? 260 : 190
  const lastValue = points[lastPt]?.value ?? 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3">
        {axis && (
          <div className="flex shrink-0 flex-col justify-between text-right text-[11px] font-semibold text-ink-3" style={{ height, width: 64 }} aria-hidden="true">
            <span>{compact(hi)}</span>
            <span>{compact((hi + lo) / 2)}</span>
            <span>{compact(lo)}</span>
          </div>
        )}
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Gráfico de linha da evolução do saldo" className="block overflow-visible">
            <path d="M0 0H1000M0 50H1000M0 100H1000" stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" fill="none" />
            {pts.length > 1 && <path d={`M0,${H} L${pts.join(' L')} L${W},${H} Z`} fill="var(--color-cobalt)" fillOpacity="0.08" />}
            <polyline points={pts.join(' ')} fill="none" stroke="var(--color-cobalt)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {points.length > 0 && (
            <>
              <span aria-hidden="true" className="absolute size-3 rounded-full border-[3px] border-cobalt bg-surface" style={{ left: `${(x(lastPt) / W) * 100}%`, top: `${y(lastValue)}%`, margin: '-6px 0 0 -6px' }} />
              {tall && (
                <span aria-hidden="true" className="absolute whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-extrabold text-surface" style={{ left: `${(x(lastPt) / W) * 100}%`, top: `${y(lastValue)}%`, transform: 'translate(-100%, -130%)' }}>
                  {formatCents(lastValue)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="flex justify-between text-xs font-semibold text-ink-3" style={{ paddingLeft: axis ? 76 : 0 }}>
        {labels.map((l, i) => (
          <span key={`${l}${i}`}>{l}</span>
        ))}
      </div>
    </div>
  )
}

const Bone = ({ className }: { className: string }) => <div aria-hidden="true" className={`animate-pulse rounded-card bg-ink/[0.07] ${className}`} />

// Esqueleto do Início enquanto os dados do aparelho carregam ("Início · Skeleton").
function WideSkeleton({ desktop, header }: { desktop: boolean; header: ReactNode }) {
  return (
    <main className={`${widePage} ${desktop ? 'gap-6' : ''}`} aria-busy="true">
      {header}
      <span role="status" className="sr-only">
        Carregando…
      </span>
      {desktop ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} className="h-[130px]" />
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            <Bone className="h-[380px] flex-[2_1_560px]" />
            <Bone className="h-[380px] flex-[1_1_320px]" />
          </div>
        </>
      ) : (
        <>
          <Bone className="h-[120px]" />
          <div className="grid grid-cols-3 gap-3.5">
            {[0, 1, 2].map((i) => (
              <Bone key={i} className="h-[110px]" />
            ))}
          </div>
          <Bone className="h-[300px]" />
        </>
      )}
    </main>
  )
}
