import type { ISODate } from '../db/types'

const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const pad = (n: number) => String(n).padStart(2, '0')

// Datas de negócio são AAAA-MM-DD no calendário local da pessoa, sem fuso (GER-06).
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const today = (now: Date = new Date()): ISODate => toISODate(now)

function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return [y, m, d]
}

// "Qua, 30 set"
export function formatDay(date: ISODate): string {
  const [y, m, d] = parts(date)
  return `${weekdays[new Date(y, m - 1, d).getDay()]}, ${d} ${months[m - 1]}`
}

// "Hoje, 30 out" / "Ontem, 29 out" / "Qua, 28 out"
export function formatDayRelative(date: ISODate, now: Date = new Date()): string {
  const [y, m, d] = parts(date)
  const base = formatDay(date)
  if (date === today(now)) return `Hoje, ${d} ${months[m - 1]}`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (date === toISODate(yesterday)) return `Ontem, ${d} ${months[m - 1]}`
  return y === now.getFullYear() ? base : `${base} ${y}`
}

// "2026-10" a partir de uma data
export const monthOf = (date: ISODate) => date.slice(0, 7)

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return `${monthNames[m - 1]} ${y}`
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

// Intervalo [início, fim] do mês, para consultar o índice de data.
export function monthRange(month: string): [ISODate, ISODate] {
  return [`${month}-01`, `${month}-31`]
}
