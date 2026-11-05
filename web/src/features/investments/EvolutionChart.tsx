import { formatDay } from '../../lib/dates'
import { formatCents } from '../../lib/money'
import type { EvolutionPoint } from './rules'

const W = 318
const H = 150
const TOP = 10
const BOT = 140

// Eixo em números redondos: de mil em mil reais a partir de R$ 10 mil, senão de 100 em 100.
const stepFor = (cents: number) => (cents >= 10_000_00 ? 1_000_00 : 100_00)
const mil = (cents: number) => (cents >= 10_000_00 ? `R$ ${Math.round(cents / 100_000)} mil` : formatCents(cents).replace(/,00$/, ''))
const monthShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const label = (date: string, withYear: boolean) => `${monthShort[Number(date.slice(5, 7)) - 1]}${withYear ? `/${date.slice(2, 4)}` : ''}`

// Linha do patrimônio e linha tracejada do valor investido (design "05 · Investimentos").
export function EvolutionChart({ points }: { points: EvolutionPoint[] }) {
  const all = points.flatMap((p) => [p.value, p.invested])
  const rawLo = Math.min(...all)
  const rawHi = Math.max(...all)
  const pad = Math.max((rawHi - rawLo) * 0.08, 100)
  const step = stepFor(rawHi)
  const lo = Math.max(0, Math.floor((rawLo - pad) / step) * step)
  const hi = Math.ceil((rawHi + pad) / step) * step
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * W : W / 2)
  const y = (v: number) => BOT - ((v - lo) / (hi - lo)) * (BOT - TOP)
  const line = (key: 'value' | 'invested') => points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  const last = points.length - 1
  const first = points[0]!
  const end = points[last]!
  const desc = `Patrimônio de ${formatCents(first.value)} em ${formatDay(first.date)} para ${formatCents(end.value)} em ${formatDay(end.date)}`
  const withYear = first.date.slice(0, 4) !== end.date.slice(0, 4)
  const ticks = [0, Math.round(last / 4), Math.round(last / 2), Math.round((3 * last) / 4), last].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc} className="block w-full overflow-visible">
        <path d={`M0 ${TOP}H${W}M0 75H${W}M0 ${BOT}H${W}`} stroke="var(--color-line)" strokeWidth="1" />
        <text x="0" y="6" fontSize="10" fill="var(--color-ink-3)" fontWeight="600">
          {mil(hi)}
        </text>
        <text x="0" y="136" fontSize="10" fill="var(--color-ink-3)" fontWeight="600">
          {mil(lo)}
        </text>
        <path d={`M0,${H} L${line('value').replace(/ /g, ' L')} L${W},${H} Z`} fill="var(--color-cobalt)" fillOpacity="0.08" />
        <polyline points={line('invested')} fill="none" stroke="#98A2B3" strokeWidth="2" strokeDasharray="5 4" />
        <polyline points={line('value')} fill="none" stroke="var(--color-cobalt)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last)} cy={y(end.value)} r="5.5" fill="var(--color-surface)" stroke="var(--color-cobalt)" strokeWidth="3" />
      </svg>
      <div aria-hidden="true" className="flex justify-between text-[11px] font-semibold text-ink-3">
        {ticks.map((i) => (
          <span key={i}>{label(points[i]!.date, withYear && (i === 0 || i === last))}</span>
        ))}
      </div>
    </div>
  )
}
