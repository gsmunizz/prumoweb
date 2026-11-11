import { describe, expect, it } from 'vitest'
import { breakpointOf } from './breakpoint'

describe('breakpointOf', () => {
  it('separa celular, tablet e desktop', () => {
    expect(breakpointOf(390)).toBe('mobile')
    expect(breakpointOf(767)).toBe('mobile')
    expect(breakpointOf(768)).toBe('tablet')
    expect(breakpointOf(834)).toBe('tablet')
    expect(breakpointOf(1279)).toBe('tablet')
    expect(breakpointOf(1280)).toBe('desktop')
    expect(breakpointOf(1440)).toBe('desktop')
  })
})
