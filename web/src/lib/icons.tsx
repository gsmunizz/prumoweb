// Catálogo de ícones das categorias e contas (GER-11). A API guarda só a chave; os
// desenhos ficam aqui, no traço de 1.8px do design system.
const paths: Record<string, string> = {
  utensils: 'M4 3v7a3 3 0 0 0 3 3v8M10 3v7M7 3v4M17 21V3c-2.5 1-4 3.5-4 7v3h4',
  'shopping-cart':
    'M2 3h3l2.7 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6M7.5 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M16.5 20a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  car: 'M5 17H3v-5l2-5h14l2 5v5h-2M3 12h18M9.5 17h5M5.5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0M14.5 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  home: 'M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6',
  receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6',
  'heart-pulse': 'M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20zM6 12h3l1.5-2 3 4 1.5-2h3',
  'graduation-cap': 'M2 9l10-5 10 5-10 5zM6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.500M22 9v6',
  gamepad: 'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.3 5H6.7a4 4 0 0 0-3.9 3.200L2 15a3 3 0 0 0 5.2 2l1.3-1.500h7l1.3 1.500A3 3 0 0 0 22 15l-.8-6.800A4 4 0 0 0 17.3 5z',
  'shopping-bag': 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  landmark: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2 3 7v2h18V7z',
  'circle-ellipsis': 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M8 12h.01M12 12h.01M16 12h.01',
  briefcase: 'M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  laptop: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5V16H4V6.5A1.5 1.5 0 0 1 5.5 5zM2 20h20',
  'trending-up': 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  undo: 'M9 14 4 9l5-5M4 9h10.500a5.5 5.5 0 0 1 0 11H11',
  gift: 'M4 10h16v11H4zM2 7h20v3H2zM12 7v14M12 7S10 3 7.5 3a2 2 0 0 0 0 4M12 7s2-4 4.5-4a2 2 0 0 1 0 4',
  wallet: 'M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5',
  tag: 'M20.6 13.4 13.4 20.600a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.600a2 2 0 0 1 0 2.800zM7.5 7.500h.01',
}

export function CategoryIcon({ name, size = 20 }: { name: string | null | undefined; size?: number }) {
  const d = paths[name ?? ''] ?? paths['tag']!
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// Cor de destaque (#RRGGBB) e fundo suave derivado dela: 12% de opacidade sobre a superfície.
export function tint(color: string): { color: string; background: string } {
  return { color, background: `color-mix(in srgb, ${color} 12%, transparent)` }
}
