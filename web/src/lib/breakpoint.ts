import { useSyncExternalStore } from 'react'

// Os três ambientes do design: celular (< 768px), tablet (768 a 1279px) e desktop (>= 1280px).
// A tela certa de cada ambiente é escolhida por media query, sem depender do user agent.
export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

export const TABLET_QUERY = '(min-width: 768px)'
export const DESKTOP_QUERY = '(min-width: 1280px)'

export function breakpointOf(width: number): Breakpoint {
  return width >= 1280 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile'
}

function snapshot(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'mobile'
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop'
  return window.matchMedia(TABLET_QUERY).matches ? 'tablet' : 'mobile'
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
  const lists = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)]
  for (const l of lists) l.addEventListener('change', onChange)
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange)
  }
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, snapshot, () => 'mobile')
}

// Tablet e desktop usam o trilho ou a barra lateral em vez da barra inferior.
export const useIsWide = () => useBreakpoint() !== 'mobile'
