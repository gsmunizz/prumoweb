import { useEffect } from 'react'
import { db } from '../db'
import type { Theme } from '../db/types'
import { useLive } from './useLive'

// Valor do atributo data-theme no <html>; "system" não tem atributo e o CSS segue o aparelho.
export const themeAttr = (theme: Theme): string | null => (theme === 'system' ? null : theme)

// Aplica o tema no <html>.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  const attr = themeAttr(theme)
  if (attr === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', attr)
}

// Mantém o tema do perfil aplicado: o padrão é o do aparelho, e a troca vale em todos os
// aparelhos pelo sync (Profile.theme).
export function ThemeSync() {
  const profile = useLive(() => db.profile.toCollection().first(), [])
  const theme = profile?.theme ?? 'system'
  useEffect(() => applyTheme(theme), [theme])
  return null
}
