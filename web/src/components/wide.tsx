import { useEffect, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

// Peças das telas de tablet e desktop (canvas "Desktop e tablet"): cabeçalho de página, segmentos,
// painel lateral e diálogo centralizado.

const icon = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export const IconPlus = ({ size = 18, w = 2.4 }: { size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth={w} {...icon}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const IconClose = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="2" {...icon}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
export const IconEdit = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="2" {...icon}>
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)
export const IconTrash = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="2" {...icon}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)
export const IconChevron = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" strokeWidth="2" {...icon}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

// Corpo das telas largas: 28px de respiro em cima, 32px dos lados e 40px embaixo.
export const widePage = 'flex min-w-0 flex-1 flex-col gap-5 px-8 pb-10 pt-7'

export function PageHead({ title, subtitle, action, size = 28 }: { title: string; subtitle?: ReactNode; action?: ReactNode; size?: 26 | 28 }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className={`${size === 28 ? 'text-[28px] tracking-[-0.6px]' : 'text-[26px] tracking-[-0.5px]'} font-extrabold`}>{title}</h1>
        {subtitle && <span className="text-sm text-ink-3">{subtitle}</span>}
      </div>
      {action}
    </div>
  )
}

export const primaryButton = 'flex items-center justify-center gap-2 rounded-[14px] bg-cobalt text-[15px] font-extrabold text-white disabled:opacity-60'
export const ghostButton = 'flex items-center justify-center rounded-[14px] border border-line bg-surface text-[15px] font-extrabold text-ink'

// Controle segmentado (abas Despesas/Receitas, seções do tablet e tipo da transação).
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; size?: 'md' | 'sm' }) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 self-start bg-ink/[0.06] p-1 ${size === 'md' ? 'rounded-[14px]' : 'rounded-xl'}`}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`font-extrabold ${size === 'md' ? 'h-10 rounded-[10px] px-[22px] text-sm' : 'h-9 rounded-[9px] px-3.5 text-[13px]'} ${on ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// Seções do Mais no tablet: Contas, Categorias e Configurações (design "Tablet · Contas e carteiras").
export function SectionNav({ current }: { current: 'contas' | 'categorias' | 'configuracoes' }) {
  const items = [
    { key: 'contas', to: '/mais/contas', label: 'Contas' },
    { key: 'categorias', to: '/mais/categorias', label: 'Categorias' },
    { key: 'configuracoes', to: '/mais/configuracoes', label: 'Configurações' },
  ] as const
  return (
    <nav aria-label="Seções" className="flex gap-1 self-start rounded-[14px] bg-ink/[0.06] p-1">
      {items.map((i) => (
        <Link
          key={i.key}
          to={i.to}
          aria-current={i.key === current ? 'page' : undefined}
          className={`flex h-10 items-center rounded-[10px] px-5 text-sm font-extrabold ${i.key === current ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  )
}

// Painel lateral do desktop: formulário ou confirmação ao lado da lista, sem cobrir a tela.
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside aria-label={title} className="flex w-full max-w-[400px] flex-[1_1_320px] flex-col gap-4 rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">{title}</h2>
        <button onClick={onClose} aria-label="Fechar painel" className="grid size-11 place-items-center rounded-xl">
          <IconClose />
        </button>
      </div>
      {children}
    </aside>
  )
}

// Diálogo centralizado sobre a tela (nova transação no desktop e confirmações de exclusão).
export function Modal({ label, labelledBy, describedBy, role = 'dialog', onClose, width, children }: { label?: string; labelledBy?: string; describedBy?: string; role?: 'dialog' | 'alertdialog'; onClose: () => void; width: number; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 grid place-items-center p-6">
      <button aria-label="Fechar" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/55" />
      <section
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="relative flex max-h-full w-full flex-col overflow-y-auto rounded-[28px] bg-surface shadow-sheet"
        style={{ maxWidth: width }}
      >
        {children}
      </section>
    </div>
  )
}

// Folha inferior de até 640px do tablet (formulários de Contas e Categorias).
export function TabletSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <button aria-label="Fechar" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <section role="dialog" aria-modal="true" aria-label={title} className="relative flex max-h-[92dvh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-surface px-7 pb-7 pt-3 shadow-sheet">
        <span aria-hidden="true" className="h-[5px] w-10 shrink-0 self-center rounded-[3px] bg-line" />
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="grid size-11 place-items-center rounded-xl">
            <IconClose />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
