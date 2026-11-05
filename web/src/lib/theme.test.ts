import { describe, expect, it } from 'vitest'
import { themeAttr } from './theme'

describe('themeAttr', () => {
  it('claro e escuro viram o atributo; sistema não tem atributo', () => {
    expect(themeAttr('light')).toBe('light')
    expect(themeAttr('dark')).toBe('dark')
    expect(themeAttr('system')).toBeNull()
  })
})
