import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link, Navigate, Outlet, useRouterState } from '@tanstack/react-router'
import { useBreakpoint } from '../lib/breakpoint'
import { apiFetch } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useSession } from '../lib/session'

const icon = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

const paths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  cal: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18',
  trend: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  more: 'M3 4.5A1.5 1.5 0 0 1 4.5 3h4A1.5 1.5 0 0 1 10 4.5v4A1.5 1.5 0 0 1 8.5 10h-4A1.5 1.5 0 0 1 3 8.5zM14 4.5A1.5 1.5 0 0 1 15.5 3h4A1.5 1.5 0 0 1 21 4.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 8.5zM3 15.500A1.5 1.5 0 0 1 4.5 14h4a1.5 1.5 0 0 1 1.5 1.500v4A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.500zM14 15.500a1.5 1.5 0 0 1 1.5-1.500h4a1.5 1.5 0 0 1 1.5 1.500v4a1.5 1.5 0 0 1-1.5 1.500h-4a1.5 1.5 0 0 1-1.5-1.500z',
  wallet: 'M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-4a2 2 0 0 0 0 4h4v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  plus: 'M12 5v14M5 12h14',
}

interface NavItem {
  to: string
  label: string
  short?: string
  path: string
  // Prefixo do caminho que deixa o item ativo; o início só vale em '/' exato.
  match?: string
}

// Celular: Início, Transações, Calendário, Investimentos e Mais.
const mobileTabs: NavItem[] = [
  { to: '/', label: 'Início', path: paths.home },
  { to: '/transacoes', label: 'Transações', path: paths.list },
  { to: '/calendario', label: 'Calendário', path: paths.cal },
  { to: '/investimentos', label: 'Investimentos', path: paths.trend },
  { to: '/mais', label: 'Mais', path: paths.more },
]

// Tablet: o trilho tem os quatro destinos principais e o Mais, que abre Contas, Categorias e Configurações.
const tabletTabs: NavItem[] = [
  { to: '/', label: 'Início', path: paths.home },
  { to: '/transacoes', label: 'Transações', path: paths.list },
  { to: '/calendario', label: 'Calendário', path: paths.cal },
  { to: '/investimentos', label: 'Investim.', path: paths.trend },
  { to: '/mais/contas', label: 'Mais', path: paths.more, match: '/mais' },
]

// Desktop: barra lateral com os destinos principais e a seção Gerenciar.
const desktopMain: NavItem[] = [
  { to: '/', label: 'Início', path: paths.home },
  { to: '/transacoes', label: 'Transações', path: paths.list },
  { to: '/calendario', label: 'Calendário', path: paths.cal },
  { to: '/investimentos', label: 'Investimentos', path: paths.trend },
]
const desktopManage: NavItem[] = [
  { to: '/mais/contas', label: 'Contas', path: paths.wallet },
  { to: '/mais/categorias', label: 'Categorias', path: paths.tag },
  { to: '/mais/configuracoes', label: 'Configurações', path: paths.sliders },
]

function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/'
  const prefix = item.match ?? item.to
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function VerifyBanner() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle')

  async function resend() {
    setState('sending')
    try {
      await apiFetch('/auth/verify-email/resend', { method: 'POST' })
      setState('sent')
    } catch (e) {
      setState(errorMessage(e))
    }
  }

  return (
    <div role="status" className="flex items-center gap-3 bg-warning-soft px-4 py-2.5 text-[13px] text-warning">
      <span className="flex-1 font-semibold">
        {state === 'sent' ? 'Enviamos um novo link. Confira sua caixa de entrada.' : 'Verifique seu e-mail para proteger sua conta.'}
        {state !== 'idle' && state !== 'sending' && state !== 'sent' && ` ${state}`}
      </span>
      {state !== 'sent' && (
        <button onClick={() => void resend()} disabled={state === 'sending'} className="font-extrabold underline">
          Reenviar link
        </button>
      )}
    </div>
  )
}

function BottomBar({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Navegação principal" className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-3xl grid-cols-5 px-1 pt-2 pb-2">
        {mobileTabs.map((t) => {
          const active = isActive(t, pathname)
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 text-[11px] ${active ? 'font-extrabold text-cobalt' : 'font-semibold text-ink-2'}`}
              >
                <span className={`flex h-[30px] w-14 items-center justify-center rounded-full ${active ? 'bg-cobalt-soft' : ''}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...icon}>
                    <path d={t.path} />
                  </svg>
                </span>
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// Tablet (design "Tablet · Dashboard"): trilho de 96px com o botão Nova e os destinos.
function Rail({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Navegação principal" className="sticky top-0 flex h-dvh w-24 shrink-0 flex-col items-center gap-5 border-r border-line bg-surface py-6">
      <Link to="/transacoes/nova" aria-label="Nova transação" className="flex flex-col items-center gap-1 text-[11px] font-extrabold text-cobalt">
        <span className="grid size-14 place-items-center rounded-[18px] bg-cobalt text-white">
          <svg width="26" height="26" viewBox="0 0 24 24" strokeWidth="2.4" {...icon}>
            <path d={paths.plus} />
          </svg>
        </span>
        Nova
      </Link>
      {tabletTabs.map((t) => {
        const active = isActive(t, pathname)
        return (
          <Link
            key={t.to}
            to={t.to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 text-[11px] ${active ? 'font-extrabold text-cobalt' : 'font-bold text-ink-2'}`}
          >
            <span className={`flex h-9 w-14 items-center justify-center rounded-full ${active ? 'bg-cobalt-soft' : ''}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.9" {...icon}>
                <path d={t.path} />
              </svg>
            </span>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

function SideLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname)
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm ${active ? 'bg-cobalt-soft font-extrabold text-cobalt-strong' : 'font-bold text-ink-2 hover:bg-bg'}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="1.9" {...icon}>
        <path d={item.path} />
      </svg>
      {item.label}
    </Link>
  )
}

// Desktop (design "Desktop · Dashboard"): barra lateral de 240px com marca, botão e navegação.
function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-surface px-4 py-6">
      <div className="flex items-center gap-2.5 px-2">
        <span aria-hidden="true" className="grid size-9 place-items-center rounded-[11px] bg-cobalt">
          <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.4" {...icon} stroke="#fff">
            <path d="M12 3v18M7 8l5-5 5 5M6 21h12" />
          </svg>
        </span>
        <span className="text-xl font-extrabold tracking-tight">Prumo</span>
      </div>
      <Link to="/transacoes/nova" className="flex h-12 items-center justify-center gap-2 rounded-[14px] bg-cobalt text-[15px] font-extrabold text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.4" {...icon}>
          <path d={paths.plus} />
        </svg>
        Nova transação
      </Link>
      <nav aria-label="Navegação principal" className="flex flex-col gap-0.5">
        {desktopMain.map((i) => (
          <SideLink key={i.to} item={i} pathname={pathname} />
        ))}
        <span className="px-3 pb-1.5 pt-[18px] text-[11px] font-extrabold tracking-[0.6px] text-ink-3">GERENCIAR</span>
        {desktopManage.map((i) => (
          <SideLink key={i.to} item={i} pathname={pathname} />
        ))}
      </nav>
    </aside>
  )
}

// Layout das telas autenticadas: aviso de e-mail/offline no topo e a navegação do ambiente:
// barra inferior no celular, trilho no tablet e barra lateral no desktop.
export function AppShell({ children }: { children?: ReactNode } = {}) {
  const session = useSession()
  const bp = useBreakpoint()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  if (session.status === 'loading') {
    return (
      <div role="status" className="grid min-h-dvh place-items-center text-sm font-semibold text-ink-3">
        Carregando…
      </div>
    )
  }
  if (session.status === 'anonymous') return <Navigate to="/login" replace />

  const mobile = bp === 'mobile'
  return (
    <div className="flex min-h-dvh">
      {bp === 'tablet' && <Rail pathname={pathname} />}
      {bp === 'desktop' && <Sidebar pathname={pathname} />}
      <div className={`flex min-w-0 flex-1 flex-col ${mobile ? 'mx-auto max-w-3xl pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : ''}`}>
        {session.offline && (
          <p role="status" className="bg-ink px-4 py-2 text-center text-[13px] font-semibold text-surface">
            Sem conexão. Você está vendo os dados do aparelho.
          </p>
        )}
        {!session.user.email_verified && <VerifyBanner />}
        {children ?? <Outlet />}
      </div>
      {mobile && <BottomBar pathname={pathname} />}
    </div>
  )
}
