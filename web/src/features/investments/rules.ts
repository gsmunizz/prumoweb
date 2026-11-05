import type { AssetClass, Investment, InvestmentMovement, InvestmentSnapshot, ISODate } from '../../db/types'
import { monthOf, shiftMonth } from '../../lib/dates'

export const assetClasses: { value: AssetClass; label: string; short: string; color: string; soft: string }[] = [
  { value: 'renda_fixa', label: 'Renda fixa', short: 'Renda fixa', color: '#2446D8', soft: '#E8EDFF' },
  { value: 'acoes', label: 'Ações', short: 'Ações', color: '#0E8577', soft: '#DDF3EF' },
  { value: 'fiis', label: 'FIIs', short: 'FIIs', color: '#E08A1E', soft: '#FDF0DC' },
  { value: 'etfs', label: 'ETFs', short: 'ETFs', color: '#6941E0', soft: '#EFEAFD' },
  { value: 'cripto', label: 'Criptomoedas', short: 'Cripto', color: '#C23A66', soft: '#FBE6EE' },
  { value: 'outros', label: 'Outros', short: 'Outros', color: '#98A2B3', soft: '#EEF1F5' },
]

export const classInfo = (c: AssetClass) => assetClasses.find((x) => x.value === c) ?? assetClasses[5]!

// Quantidades têm até 8 casas decimais (INV-10): somam-se como inteiros em unidades de 1e-8,
// sem erro de ponto flutuante.
const SCALE = 100_000_000n

// Aceita "1,82", "1.82" e "0,0112"; devolve null para o que não é um número maior que zero.
export function parseQuantity(input: string): bigint | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,8})?$/.test(s)) return null
  const [int = '0', frac = ''] = s.split('.')
  const units = BigInt(int) * SCALE + BigInt(frac.padEnd(8, '0'))
  return units > 0n ? units : null
}

// Formato do servidor: ponto decimal, sem zeros à direita ("1.82", "100").
export function quantityToWire(units: bigint): string {
  const int = units / SCALE
  const frac = (units % SCALE).toString().padStart(8, '0').replace(/0+$/, '')
  return frac ? `${int}.${frac}` : `${int}`
}

const unitsOf = (wire: string): bigint => {
  const [int = '0', frac = ''] = wire.split('.')
  return BigInt(int) * SCALE + BigInt(frac.padEnd(8, '0').slice(0, 8))
}

// Para exibir: vírgula decimal.
export const formatQuantity = (units: bigint) => quantityToWire(units).replace('.', ',')

export interface Position {
  quantity: bigint
  // Valor investido pelo custo médio, em centavos (INV-12).
  invested: number
}

const byDate = (a: InvestmentMovement, b: InvestmentMovement) => (a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date))

// Divisão arredondada para o centavo mais próximo, em inteiros.
function roundDiv(num: bigint, den: bigint): bigint {
  return (2n * num + den) / (2n * den)
}

// Posição do ativo até uma data (INV-11, INV-12): o aporte soma quantidade e valor pago; o
// resgate tira o valor na proporção da quantidade resgatada.
export function positionOf(movements: InvestmentMovement[], until: ISODate = '9999-12-31'): Position {
  let quantity = 0n
  let invested = 0
  for (const m of [...movements].filter((x) => !x.deleted_at && x.date <= until).sort(byDate)) {
    const q = unitsOf(m.quantity)
    if (m.type === 'aporte') {
      quantity += q
      invested += m.amount_cents
    } else if (quantity > 0n) {
      const out = q > quantity ? quantity : q
      invested -= Number(roundDiv(BigInt(invested) * out, quantity))
      quantity -= out
    }
  }
  return { quantity, invested }
}

// Valor atual = snapshot de data mais recente (INV-22); null quando nunca foi informado.
export function currentValue(snapshots: InvestmentSnapshot[], until: ISODate = '9999-12-31'): number | null {
  let best: InvestmentSnapshot | null = null
  for (const s of snapshots) {
    if (s.deleted_at || s.date > until) continue
    if (!best || s.date > best.date || (s.date === best.date && s.updated_at > best.updated_at)) best = s
  }
  return best ? best.value_cents : null
}

// Rentabilidade = valor atual ÷ valor investido − 1 (INV-23); null sem base ou sem valor.
export function returnPct(current: number | null, invested: number): number | null {
  return current !== null && invested > 0 ? (current / invested - 1) * 100 : null
}

export interface Asset {
  investment: Investment
  position: Position
  current: number | null
  ret: number | null
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of list) {
    const k = key(item)
    const group = out.get(k)
    if (group) group.push(item)
    else out.set(k, [item])
  }
  return out
}

export function buildAssets(investments: Investment[], movements: InvestmentMovement[], snapshots: InvestmentSnapshot[], until?: ISODate): Asset[] {
  const mv = groupBy(movements, (m) => m.investment_id)
  const sn = groupBy(snapshots, (s) => s.investment_id)
  return investments
    .filter((i) => !i.deleted_at)
    .map((investment) => {
      const position = positionOf(mv.get(investment.id) ?? [], until)
      const current = currentValue(sn.get(investment.id) ?? [], until)
      return { investment, position, current, ret: returnPct(current, position.invested) }
    })
}

// Ativos com posição aberta: só eles entram nos totais (INV-24).
export const isOpen = (a: Asset) => a.position.quantity > 0n

export interface Totals {
  invested: number
  current: number
  gain: number
  // null quando não há valor investido
  pct: number | null
}

export function totalsOf(assets: Asset[]): Totals {
  let invested = 0
  let current = 0
  for (const a of assets.filter(isOpen)) {
    invested += a.position.invested
    current += a.current ?? 0
  }
  return { invested, current, gain: current - invested, pct: invested > 0 ? (current / invested - 1) * 100 : null }
}

export interface ClassSlice {
  asset_class: AssetClass
  cents: number
  pct: number
}

// Distribuição por classe = valor atual da classe ÷ valor atual total (INV-26), da maior à menor.
export function distribution(assets: Asset[]): ClassSlice[] {
  const sums = new Map<AssetClass, number>()
  let total = 0
  for (const a of assets.filter(isOpen)) {
    const v = a.current ?? 0
    if (v <= 0) continue
    sums.set(a.investment.asset_class, (sums.get(a.investment.asset_class) ?? 0) + v)
    total += v
  }
  return [...sums.entries()].map(([asset_class, cents]) => ({ asset_class, cents, pct: (cents / total) * 100 })).sort((a, b) => b.cents - a.cents)
}

export interface EvolutionPoint {
  date: ISODate
  value: number
  invested: number
}

// Último dia do mês (AAAA-MM-DD).
export function monthEnd(month: string): ISODate {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

// Evolução do patrimônio investido (INV-25): para cada fim de mês, a soma do último snapshot de
// cada ativo até o dia (o valor se repete até o próximo snapshot); o último ponto é hoje.
export function evolution(investments: Investment[], movements: InvestmentMovement[], snapshots: InvestmentSnapshot[], now: ISODate, months: number): EvolutionPoint[] {
  const dates: ISODate[] = []
  for (let i = months - 1; i >= 1; i--) dates.push(monthEnd(shiftMonth(monthOf(now), -i)))
  dates.push(now)
  return dates.map((date) => {
    const assets = buildAssets(investments, movements, snapshots, date).filter(isOpen)
    return { date, value: assets.reduce((n, a) => n + (a.current ?? 0), 0), invested: assets.reduce((n, a) => n + a.position.invested, 0) }
  })
}

// Meses entre o primeiro registro e hoje, no mínimo 2 (para o filtro "Tudo").
export function monthsSinceFirst(movements: InvestmentMovement[], snapshots: InvestmentSnapshot[], now: ISODate): number {
  const dates = [...movements, ...snapshots].filter((r) => !r.deleted_at).map((r) => r.date)
  if (!dates.length) return 2
  const first = dates.reduce((a, b) => (a < b ? a : b))
  const [fy, fm] = first.split('-').map(Number) as [number, number]
  const [ny, nm] = now.split('-').map(Number) as [number, number]
  return Math.max(2, (ny - fy) * 12 + (nm - fm) + 1)
}

// Rendimento do mês: variação do valor descontados os aportes líquidos do mês, sobre o valor
// do fim do mês anterior. null quando não havia valor antes (não há base de comparação).
export function monthGain(investments: Investment[], movements: InvestmentMovement[], snapshots: InvestmentSnapshot[], now: ISODate): { cents: number; pct: number | null } {
  const prevEnd = monthEnd(shiftMonth(monthOf(now), -1))
  const before = totalsOf(buildAssets(investments, movements, snapshots, prevEnd)).current
  const after = totalsOf(buildAssets(investments, movements, snapshots, now)).current
  const live = new Set(investments.filter((i) => !i.deleted_at).map((i) => i.id))
  let net = 0
  for (const m of movements) {
    if (m.deleted_at || !live.has(m.investment_id) || m.date <= prevEnd || m.date > now) continue
    net += m.type === 'aporte' ? m.amount_cents : -m.amount_cents
  }
  const cents = after - before - net
  return { cents, pct: before > 0 ? (cents / before) * 100 : null }
}
