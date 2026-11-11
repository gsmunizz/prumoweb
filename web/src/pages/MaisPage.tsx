import { Link, Navigate } from '@tanstack/react-router'
import { SignOut } from '../components/SignOut'
import { useBreakpoint } from '../lib/breakpoint'
import { useSession } from '../lib/session'
import { useSyncStatus } from '../sync'

// "Mais" do design (perfil, atalhos, configurações). Nesta etapa: perfil e sair.
export function MaisPage() {
  const session = useSession()
  const sync = useSyncStatus()
  const bp = useBreakpoint()

  if (session.status !== 'authenticated') return null
  // Tablet e desktop não têm a tela Mais: Contas, Categorias e Configurações têm destino próprio.
  if (bp !== 'mobile') return <Navigate to="/mais/contas" replace />
  const { email } = session.user

  return (
    <main className="flex flex-col gap-4 px-4 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <h1 className="text-[26px] font-extrabold tracking-tight">Mais</h1>

      <section className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4">
        <span aria-hidden="true" className="grid size-[52px] place-items-center rounded-full bg-cobalt-soft text-lg font-extrabold text-cobalt-strong">
          {email.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-extrabold">{email}</p>
          <p className="text-[13px] text-ink-2">{syncLabel(session.offline || sync.offline, sync)}</p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <ShortcutCard to="/mais/contas" label="Contas" hint="Saldos e carteiras" />
        <ShortcutCard to="/mais/categorias" label="Categorias" hint="Despesas e receitas" />
        <ShortcutCard to="/mais/configuracoes" label="Configurações" hint="Tema e sincronização" />
      </div>

      <SignOut />
    </main>
  )
}

export function syncLabel(offline: boolean, s: ReturnType<typeof useSyncStatus>): string {
  if (offline) return s.pending ? `Sem conexão · ${s.pending} para enviar` : 'Sem conexão'
  if (s.state === 'syncing') return 'Sincronizando…'
  if (s.state === 'error') return 'Não foi possível sincronizar. Tentando de novo.'
  if (s.pending) return `${s.pending} para enviar`
  if (!s.lastSyncedAt) return 'Conectado'
  const min = Math.max(0, Math.round((Date.now() - new Date(s.lastSyncedAt).getTime()) / 60_000))
  return min < 1 ? 'Sincronizado agora' : `Sincronizado há ${min} min`
}

function ShortcutCard({ to, label, hint }: { to: '/mais/contas' | '/mais/categorias' | '/mais/configuracoes'; label: string; hint: string }) {
  return (
    <Link to={to} className="flex min-h-28 flex-col justify-end gap-0.5 rounded-card border border-line bg-surface p-4">
      <span className="text-[15px] font-extrabold">{label}</span>
      <span className="text-xs text-ink-2">{hint}</span>
    </Link>
  )
}
