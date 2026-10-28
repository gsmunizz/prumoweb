import { describe, expect, it } from 'vitest'
import { formatCents, parseReaisToCents } from './money'

describe('formatCents', () => {
  it('formata em reais', () => {
    expect(formatCents(1990)).toBe('R$ 19,90')
    expect(formatCents(123456789)).toBe('R$ 1.234.567,89')
    expect(formatCents(-500)).toBe('-R$ 5,00')
  })

  it('recusa valor que não é inteiro', () => {
    expect(() => formatCents(19.9)).toThrow(RangeError)
  })
})

describe('parseReaisToCents', () => {
  it.each([
    ['19,90', 1990],
    ['19,9', 1990],
    ['7', 700],
    ['1.234,56', 123456],
    ['R$ 0,01', 1],
  ])('%s → %i', (input, cents) => {
    expect(parseReaisToCents(input)).toBe(cents)
  })

  it.each(['', 'abc', '1,234', '12.34', '1.23,00'])('recusa %s', (input) => {
    expect(parseReaisToCents(input)).toBeNull()
  })
})
