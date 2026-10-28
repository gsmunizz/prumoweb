import type { Theme } from '../db/types'

// Aplica o tema no <html>; "system" remove o atributo e deixa o CSS seguir o aparelho.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
