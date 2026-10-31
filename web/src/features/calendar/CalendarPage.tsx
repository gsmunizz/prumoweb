import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { db } from '../../db'
import type { ISODate, Transaction } from '../../db/types'
import { monthLabel, monthOf, shiftMonth, today } from '../../lib/dates'
import { CategoryIcon, tint } from '../../lib/icons'
import { formatCents } from '../../lib/money'
import { useLive } from '../../lib/useLive'
import { activeCategories } from '../transactions/queries'
import { isInternal } from '../transactions/summary'
import { dayCategories, daysInMonth, expenseByDay, heatStrip, isExceptional, level, summarizeMonth, type Level } from './calendar'

// Classes literais para o Tailwind enxergá-las; a escala vem dos tokens --color-heat-*.
const heatBg: Record<Level, string> = { 0: 'bg-heat-0', 1: 'bg-heat-1', 2: 'bg-heat-2', 3: 'bg-heat-3', 4: 'bg-heat-4' }
const heatFg: Record<Level, string> = { 0: 'text-ink-3', 1: 'text-[#0f1729]', 2: 'text-[#0f1729]', 3: 'text-[#0f1729]', 4: 'text-white' }
const weekdayLetters = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const weekdayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const shortMonths = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const pad = (n: number) => String(n).padStart(2, '0')

function dayTitle(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${weekdayNames[new Date(y, m - 1, d).getDay()]}, ${d} de ${monthNames[m - 1]}`
}

export function CalendarPage() {
  const now = today()
  const [month, setMonth] = useState(() => monthOf(now))
  const [picked, setPicked] = useState<ISODate | null>(null)

  const strip = useMemo(() => heatStrip(new Map(), month), [month])
  // Uma consulta cobre o mês e os seis meses do mapa de calor.
  const txs = useLive(() => db.transactions.where('date').between(strip.from, strip.to, true, true).filter((t) => !t.deleted_at).toArray(), [strip.from, strip.to])
  const categories = useLive(activeCategories, [])

  const byDay = useMemo(() => expenseByDay(txs ?? []), [txs])
  const summary = useMemo(() => summarizeMonth(byDay, month, now), [byDay, month, now])
  const heat = useMemo(() => heatStrip(byDay, month), [byDay, month])

  // Dia aberto: o escolhido, senão hoje (no mês corrente) ou o dia 1.
  const selected: ISODate = picked && picked.startsWith(month) ? picked : month === monthOf(now) ? now : `${month}-01`
  const dayItems = useMemo(() => (txs ?? []).filter((t) => t.date === selected && t.type === 'expense' && !isInternal(t)).sort((a, b) => b.amount_cents - a.amount_cents), [txs, selected])
  const dayTotal = byDay.get(selected) ?? 0
  const cats = useMemo(() => dayCategories(dayItems, categories ?? []), [dayItems, categories])
  const categoryById = useMemo(() => new Map(categories?.map((c) => [c.id, c])), [categories])

  const total = daysInMonth(month)
  const firstWeekday = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).getDay()
  const unusual = isExceptional(dayTotal, summary.average)

  const go = (delta: number) => {
    setMonth(shiftMonth(month, delta))
    setPicked(null)
  }

  return (
    <main className="flex flex-col pb-28">
      <header className="flex items-center justify-between px-4 pb-3 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <h1 className="text-[26px] font-extrabold tracking-tight">Calendário</h1>
        <div className="flex items-center gap-0.5">
          <button onClick={() => go(-1)} aria-label="Mês anterior" className="grid size-11 place-items-center rounded-field">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span className="min-w-[104px] text-center text-[15px] font-extrabold">{monthLabel(month)}</span>
          <button onClick={() => go(1)} aria-label="Próximo mês" className="grid size-11 place-items-center rounded-field">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4">
        <section aria-label="Resumo do mês" className="grid grid-cols-3 rounded-card border border-line bg-surface">
          <Stat label="Total gasto" value={formatCents(summary.total)} />
          <Stat label="Média/dia" value={formatCents(summary.average)} />
          <Stat label="Dias sem gasto" value={`${summary.emptyDays} ${summary.emptyDays === 1 ? 'dia' : 'dias'}`} good last />
        </section>

        <section aria-labelledby="cal-t" className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-[18px]">
          <h2 id="cal-t" className="text-base font-extrabold">
            Intensidade de gastos
          </h2>
          <div aria-hidden="true" className="grid grid-cols-7 gap-1.5 text-center text-xs font-bold text-ink-3">
            {weekdayLetters.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          <div role="grid" aria-label={`${monthLabel(month)}`} className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {Array.from({ length: total }, (_, i) => {
              const n = i + 1
              const date = `${month}-${pad(n)}`
              const cents = byDay.get(date) ?? 0
              const lv = level(cents, summary.average)
              const exc = isExceptional(cents, summary.average)
              const on = date === selected
              return (
                <button
                  key={date}
                  onClick={() => setPicked(date)}
                  aria-pressed={on}
                  aria-label={`${n} de ${monthNames[Number(month.slice(5)) - 1]}, ${cents ? formatCents(cents) : 'sem gastos'}${exc ? ', gasto excepcional' : ''}`}
                  className={`relative min-h-10 aspect-square rounded-chip text-sm font-bold outline-offset-2 ${heatBg[lv]} ${heatFg[lv]} ${on ? 'outline outline-[2.5px] outline-ink' : ''} ${exc ? 'shadow-[inset_0_0_0_2px_#6b1d0b]' : ''}`}
                >
                  {n}
                  {exc && <span aria-hidden="true" className="absolute right-[5px] top-[5px] size-1.5 rounded-full bg-white" />}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs font-semibold text-ink-2">
            <div className="flex items-center gap-1">
              Menos
              {([0, 1, 2, 3, 4] as Level[]).map((l) => (
                <span key={l} aria-hidden="true" className={`size-3.5 rounded ${heatBg[l]}`} />
              ))}
              Mais
            </div>
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" className="size-3.5 rounded bg-heat-4 shadow-[0_0_0_2px_var(--color-surface),0_0_0_3.5px_var(--color-heat-4)]" />
              Excepcional
            </div>
          </div>
        </section>

        <section aria-labelledby="day-t" aria-live="polite" className="flex flex-col gap-4 rounded-card border border-line bg-surface px-4 py-[18px]">
          <div className="flex items-start justify-between gap-2">
            <h2 id="day-t" className="text-base font-extrabold">
              {dayTitle(selected)}
            </h2>
            {unusual && (
              <span className="whitespace-nowrap rounded-full bg-heat-1 px-2.5 py-[5px] text-xs font-extrabold text-[#8f2d12]">
                {(dayTotal / summary.average).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× a média
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-0.5 rounded-field bg-bg px-3.5 py-3">
              <span className="text-xs font-semibold text-ink-2">Total gasto</span>
              <span className="text-xl font-extrabold">{formatCents(dayTotal)}</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-field bg-bg px-3.5 py-3">
              <span className="text-xs font-semibold text-ink-2">Transações</span>
              <span className="text-xl font-extrabold">{dayItems.length}</span>
            </div>
          </div>
          {txs === undefined ? (
            <p role="status" className="text-center text-sm text-ink-3">
              Carregando…
            </p>
          ) : dayItems.length > 0 ? (
            <>
              <div className="flex flex-col gap-2.5">
                <h3 className="text-[13px] font-bold text-ink-2">Principais categorias</h3>
                {cats.map((c) => (
                  <div key={c.name} className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-[13px] font-bold">
                      <span>{c.name}</span>
                      <span>{c.pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-[3px] bg-bg">
                      <div className="h-full rounded-[3px]" style={{ width: `${c.pct}%`, background: c.color }} />
                    </div>
                  </div>
                ))}
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {dayItems.map((t) => (
                  <DayRow key={t.id} t={t} category={t.category_id ? categoryById.get(t.category_id) : undefined} />
                ))}
              </ul>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 pb-1 pt-3 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-income-soft text-income">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <span className="text-[15px] font-extrabold">Dia sem gastos</span>
              <span className="text-[13px] text-ink-2">Nenhuma despesa registrada neste dia.</span>
            </div>
          )}
        </section>

        <HeatStrip cells={heat.cells} average={summary.average} month={month} />
      </div>

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

function Stat({ label, value, good, last }: { label: string; value: string; good?: boolean; last?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-3.5 ${last ? '' : 'border-r border-line'}`}>
      <span className="text-xs font-semibold text-ink-2">{label}</span>
      <span className={`text-[15px] font-extrabold ${good ? 'text-income' : ''}`}>{value}</span>
    </div>
  )
}

function DayRow({ t, category }: { t: Transaction; category?: { name: string; icon: string; color: string } }) {
  return (
    <li>
      <Link to="/transacoes/$id" params={{ id: t.id }} className="flex min-h-11 items-center gap-3 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[13px]" style={tint(category?.color ?? '#667085')}>
          <CategoryIcon name={category?.icon} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-sm font-bold">{t.description || category?.name || 'Sem descrição'}</span>
          <span className="text-xs text-ink-3">{category?.name ?? 'Sem categoria'}</span>
        </span>
        <span className="text-sm font-extrabold">−{formatCents(t.amount_cents)}</span>
      </Link>
    </li>
  )
}

// Mapa de calor dos últimos seis meses: uma coluna por semana, domingo no topo.
function HeatStrip({ cells, average, month }: { cells: { date: ISODate | null; cents: number }[]; average: number; month: string }) {
  const first = Number(shiftMonth(month, -5).slice(5)) - 1
  const labels = Array.from({ length: 6 }, (_, i) => shortMonths[(first + i) % 12])
  // O mês corrente pode ter média zero; nesse caso a escala usa a média do período todo.
  const scale = useMemo(() => {
    if (average > 0) return average
    const spent = cells.filter((c) => c.cents > 0)
    return spent.length ? spent.reduce((n, c) => n + c.cents, 0) / spent.length : 0
  }, [cells, average])
  return (
    <section aria-labelledby="hm-t" className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-[18px]">
      <div className="flex items-center justify-between">
        <h2 id="hm-t" className="text-base font-extrabold">
          Últimos 6 meses
        </h2>
        <span className="text-xs font-semibold text-ink-3">
          {labels[0]} – {labels[5]}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div role="img" aria-label="Mapa de calor dos gastos diários dos últimos 6 meses" className="grid w-max grid-flow-col grid-rows-[repeat(7,10px)] auto-cols-[10px] gap-[3px]">
          {cells.map((c, i) => (
            <span key={i} className={`rounded-[2.5px] ${c.date ? heatBg[level(c.cents, scale)] : ''}`} />
          ))}
        </div>
      </div>
      <div className="flex justify-between pr-3 text-[11px] font-semibold text-ink-3">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </section>
  )
}
