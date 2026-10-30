import { describe, expect, it } from 'vitest'
import { formatDay, formatDayRelative, monthLabel, shiftMonth, toISODate } from './dates'

describe('dates', () => {
  it('formata o dia como no design', () => {
    expect(formatDay('2026-09-30')).toBe('Qua, 30 set')
  })
  it('usa Hoje e Ontem', () => {
    const now = new Date(2026, 9, 30, 15, 0)
    expect(formatDayRelative('2026-10-30', now)).toBe('Hoje, 30 out')
    expect(formatDayRelative('2026-10-29', now)).toBe('Ontem, 29 out')
    expect(formatDayRelative('2026-10-27', now)).toBe('Ter, 27 out')
  })
  it('usa o calendário local, não UTC', () => {
    expect(toISODate(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
  })
  it('navega entre meses atravessando o ano', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthLabel('2026-09')).toBe('Setembro 2026')
  })
})
