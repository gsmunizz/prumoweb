import { useMemo, useState } from 'react'
import { db } from '../../db'
import type { AssetClass } from '../../db/types'
import { monthLabel, monthOf, today } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import { useLive } from '../../lib/useLive'
import { activeAccounts } from '../transactions/queries'
import { AssetSheet, NewAssetSheet } from './AssetSheets'
import { EvolutionChart } from './EvolutionChart'
import { assetClasses, buildAssets, classInfo, distribution, evolution, formatQuantity, isOpen, monthGain, monthsSinceFirst, totalsOf, type Asset } from './rules'

type Range = '6M' | '1A' | 'Tudo'
const ranges: Range[] = ['6M', '1A', 'Tudo']

const pct = (n: number, signed = true) => `${signed ? (n >= 0 ? '+' : '−') : ''}${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const money = (cents: number) => `${cents >= 0 ? '+' : '−'}${formatCents(Math.abs(cents))}`

export function InvestmentsPage() {
  const now = today()
  const [range, setRange] = useState<Range>('1A')
  const [filter, setFilter] = useState<AssetClass | 'todos'>('todos')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const data = useLive(async () => {
    const [investments, movements, snapshots] = await Promise.all([db.investments.toArray(), db.investment_movements.toArray(), db.investment_snapshots.toArray()])
    return { investments, movements, snapshots }
  }, [])
  const accounts = useLive(activeAccounts, [])
  const txs = useLive(() => db.transactions.filter((t) => !t.deleted_at && t.investment_movement_id !== null).toArray(), [])

  const view = useMemo(() => {
    if (!data) return null
    const { investments, movements, snapshots } = data
    const assets = buildAssets(investments, movements, snapshots)
    const months = range === '6M' ? 6 : range === '1A' ? 12 : monthsSinceFirst(movements, snapshots, now)
    return {
      assets,
      totals: totalsOf(assets),
      slices: distribution(assets),
      gain: monthGain(investments, movements, snapshots, now),
      points: evolution(investments, movements, snapshots, now, months),
    }
  }, [data, range, now])

  const open: Asset | undefined = view?.assets.find((a) => a.investment.id === openId)
  const shown = (view?.assets ?? []).filter((a) => isOpen(a) && (filter === 'todos' || a.investment.asset_class === filter)).sort((a, b) => (b.current ?? 0) - (a.current ?? 0))
  const openCount = (view?.assets ?? []).filter(isOpen).length
  const totals = view?.totals
  const empty = view !== null && view.assets.length === 0

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col pb-28 md:pb-10 xl:max-w-none xl:px-8 xl:pt-7">
      <header className="flex items-center justify-between px-4 pb-3 pt-[calc(1.25rem+env(safe-area-inset-top))] md:px-8 xl:px-0 xl:pt-0">
        <h1 className="text-[26px] font-extrabold tracking-tight xl:text-[28px]">Investimentos</h1>
        <button onClick={() => setAdding(true)} aria-label="Adicionar investimento" className="grid size-11 place-items-center rounded-field border border-line bg-surface xl:flex xl:h-12 xl:w-auto xl:gap-2 xl:border-0 xl:bg-cobalt xl:px-5 xl:text-[15px] xl:font-extrabold xl:text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden xl:inline">Novo ativo</span>
        </button>
      </header>

      {view === null ? (
        <p role="status" className="py-10 text-center text-sm text-ink-3">
          Carregando…
        </p>
      ) : empty ? (
        <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
          <p className="text-base font-extrabold">Nenhum investimento ainda</p>
          <p className="max-w-64 text-sm text-ink-2">Cadastre seus ativos para acompanhar o patrimônio, a rentabilidade e a distribuição por classe.</p>
          <button onClick={() => setAdding(true)} className="mt-2 h-12 rounded-2xl bg-cobalt px-6 text-[15px] font-extrabold text-white">
            Adicionar ativo
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4 xl:grid xl:grid-cols-6 xl:gap-6 xl:px-0">
          <section aria-label="Resumo do patrimônio" className="xl:col-span-6 flex flex-col gap-[18px] rounded-3xl bg-[#0f1729] p-[22px] text-white">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-[#b3bdcf]">Patrimônio total</span>
              <span className="text-[34px] font-extrabold tracking-tight">{formatCents(totals!.current)}</span>
              <span className="flex flex-wrap items-center gap-2 text-[13px] text-[#b3bdcf]">
                {view.gain.pct !== null && <span className={`rounded-full px-[9px] py-1 text-xs font-extrabold ${view.gain.cents >= 0 ? 'bg-[#3dd6a0] text-[#062b1e]' : 'bg-[#ff8a73] text-[#3b0d03]'}`}>{pct(view.gain.pct)}</span>}
                {money(view.gain.cents)} em {monthLabel(monthOf(now)).split(' ')[0]!.toLowerCase()}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-[#26314a] pt-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-[#b3bdcf]">Valor investido</span>
                <span className="text-base font-extrabold">{formatCents(totals!.invested)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-[#b3bdcf]">Rentabilidade</span>
                <span className={`text-base font-extrabold ${totals!.gain >= 0 ? 'text-[#3dd6a0]' : 'text-[#ff8a73]'}`}>{money(totals!.gain)}</span>
                <span className={`text-xs font-bold ${totals!.gain >= 0 ? 'text-[#3dd6a0]' : 'text-[#ff8a73]'}`}>{totals!.pct === null ? '—' : `${pct(totals!.pct)} total`}</span>
              </div>
            </div>
          </section>

          <section aria-labelledby="evo-t" className="xl:col-span-4 flex flex-col gap-3.5 rounded-card border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 id="evo-t" className="text-base font-extrabold">
                Evolução patrimonial
              </h2>
              <div role="group" aria-label="Período do gráfico" className="flex gap-0.5 rounded-chip bg-bg p-[3px]">
                {ranges.map((r) => (
                  <button key={r} aria-pressed={range === r} onClick={() => setRange(r)} className={`h-[30px] rounded-lg px-2.5 text-xs ${range === r ? 'bg-surface font-extrabold text-ink shadow-card' : 'font-bold text-ink-2'}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-4 text-xs font-semibold text-ink-2">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-[3px] w-3.5 rounded-sm bg-cobalt" />
                Patrimônio
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-[#98a2b3]" />
                Valor investido
              </span>
            </div>
            <EvolutionChart points={view.points} />
          </section>

          {view.slices.length > 0 && (
            <section aria-labelledby="dist-t" className="xl:col-span-2 flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
              <h2 id="dist-t" className="text-base font-extrabold">
                Distribuição por classe
              </h2>
              <div role="img" aria-label={view.slices.map((s) => `${classInfo(s.asset_class).label} ${pct(s.pct, false)}`).join(', ')} className="flex h-3.5 gap-0.5 overflow-hidden rounded-[7px]">
                {view.slices.map((s) => (
                  <span key={s.asset_class} style={{ width: `${s.pct}%`, background: classInfo(s.asset_class).color }} />
                ))}
              </div>
              <ul className="flex flex-col">
                {view.slices.map((s, i) => (
                  <li key={s.asset_class} className={`flex items-center gap-2.5 py-2.5 ${i ? 'border-t border-line' : ''}`}>
                    <span aria-hidden="true" className="size-3 shrink-0 rounded" style={{ background: classInfo(s.asset_class).color }} />
                    <span className="flex-1 text-sm font-bold">{classInfo(s.asset_class).label}</span>
                    <span className="text-sm font-bold text-ink-2">{formatCents(s.cents)}</span>
                    <span className="w-[52px] text-right text-sm font-extrabold">{pct(s.pct, false)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="ativos-t" className="flex flex-col gap-3 xl:col-span-6">
            <div className="flex items-center justify-between px-1 pt-1">
              <h2 id="ativos-t" className="text-lg font-extrabold">
                Meus ativos
              </h2>
              <span className="text-[13px] font-semibold text-ink-2">
                {openCount} {openCount === 1 ? 'ativo' : 'ativos'}
              </span>
            </div>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
              {([['todos', 'Todos'], ...assetClasses.map((c) => [c.value, c.short])] as [AssetClass | 'todos', string][]).map(([key, label]) => (
                <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={`h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-bold ${filter === key ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink-2'}`}>
                  {label}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-2">Nenhum ativo nesta classe.</p>
            ) : (
              <ul className="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-3 xl:grid-cols-3">
                {shown.map((a) => (
                  <AssetCard key={a.investment.id} asset={a} onOpen={() => setOpenId(a.investment.id)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {adding && <NewAssetSheet accounts={accounts ?? []} onClose={() => setAdding(false)} />}
      {open && data && <AssetSheet asset={open} movements={data.movements} accounts={accounts ?? []} transactions={txs ?? []} onClose={() => setOpenId(null)} />}
    </main>
  )
}

function AssetCard({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const { investment: inv, position, current, ret } = asset
  const info = classInfo(inv.asset_class)
  const abbr = (inv.ticker ?? inv.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase()
  const positive = (ret ?? 0) >= 0
  return (
    <li>
      <button onClick={onOpen} className="flex w-full flex-col gap-3 rounded-[18px] border border-line bg-surface px-4 py-3.5 text-left">
        <span className="flex items-center gap-3">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[14px] text-[11px] font-extrabold" style={{ background: info.soft, color: info.color }}>
            {abbr}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[15px] font-extrabold">{inv.name}</span>
            <span className="text-xs font-semibold text-ink-3">
              {info.label} · {formatQuantity(position.quantity)}
            </span>
          </span>
          <span className={`rounded-full px-2 py-1 text-xs font-extrabold ${ret === null ? 'bg-bg text-ink-3' : positive ? 'bg-income-soft text-income' : 'bg-error-soft text-error'}`}>{ret === null ? '—' : pct(ret)}</span>
        </span>
        <span className="grid grid-cols-2 gap-2 rounded-xl bg-bg px-3 py-2.5">
          <span className="flex flex-col gap-px">
            <span className="text-[11px] font-semibold text-ink-2">Investido</span>
            <span className="text-sm font-bold">{formatCents(position.invested)}</span>
          </span>
          <span className="flex flex-col gap-px">
            <span className="text-[11px] font-semibold text-ink-2">Valor atual</span>
            <span className="text-sm font-extrabold">{current === null ? '—' : formatCents(current)}</span>
          </span>
        </span>
      </button>
    </li>
  )
}
