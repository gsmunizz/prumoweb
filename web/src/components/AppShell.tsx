import { useState } from 'react'
import { Link, Navigate, Outlet } from '@tanstack/react-router'
import { apiFetch } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useSession } from '../lib/session'

const icon = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

// Ícones e rótulos da navegação principal do design: Início, Transações, Calendário, Investimentos, Mais.
const tabs = [
  { to: '/', label: 'Início', path: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/transacoes', label: 'Transações', path: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4' },
  { to: '/calendario', label: 'Calendário', path: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18' },
  { to: '/investimentos', label: 'Investimentos', path: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6' },
  { to: '/mais', label: 'Mais', path: 'M3 4.5A1.5 1.5 0 0 1 4.5 3h4A1.5 1.5 0 0 1 10 4.5v4A1.5 1.5 0 0 1 8.5 10h-4A1.5 1.5 0 0 1 3 8.5zM14 4.5A1.5 1.5 0 0 1 15.5 3h4A1.5 1.5 0 0 1 21 4.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 8.5zM3 15.500A1.5 1.5 0 0 1 4.5 14h4a1.5 1.5 0 0 1 1.5 1.500v4A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.500zM14 15.500a1.5 1.5 0 0 1 1.5-1.500h4a1.5 1.5 0 0 1 1.5 1.500v4a1.5 1.5 0 0 1-1.5 1.500h-4a1.5 1.5 0 0 1-1.5-1.500z' },
] as const

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

// Layout das telas autenticadas: aviso de e-mail/offline no topo e barra de navegação embaixo.
export function AppShell() {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <div role="status" className="grid min-h-dvh place-items-center text-sm font-semibold text-ink-3">
        Carregando…
      </div>
    )
  }
  if (session.status === 'anonymous') return <Navigate to="/login" replace />

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      {session.offline && (
        <p role="status" className="bg-ink px-4 py-2 text-center text-[13px] font-semibold text-surface">
          Sem conexão. Você está vendo os dados do aparelho.
        </p>
      )}
      {!session.user.email_verified && <VerifyBanner />}
      <Outlet />
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-5 px-1 pt-2 pb-2">
          {tabs.map((t) => (
            <li key={t.to}>
              <Link
                to={t.to}
                activeOptions={{ exact: t.to === '/' }}
                className="group flex flex-col items-center gap-1 text-[11px] font-semibold text-ink-2 data-[status=active]:font-extrabold data-[status=active]:text-cobalt"
              >
                <span className="flex h-[30px] w-14 items-center justify-center rounded-full group-data-[status=active]:bg-cobalt-soft">
                  <svg width="22" height="22" viewBox="0 0 24 24" strokeWidth="1.8" {...icon}>
                    <path d={t.path} />
                  </svg>
                </span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
