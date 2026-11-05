import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { db } from '../../db'
import { ExportSheet } from '../export/ExportSheet'
import type { Theme } from '../../db/types'
import { useLive } from '../../lib/useLive'
import { useSession } from '../../lib/session'
import { applyTheme } from '../../lib/theme'
import { syncLabel } from '../../pages/MaisPage'
import { saveRecord, useSyncStatus } from '../../sync'

const themes: { value: Theme; label: string; preview: string; line: string }[] = [
  { value: 'light', label: 'Claro', preview: '#FFFFFF', line: '#E2E6EC' },
  { value: 'dark', label: 'Escuro', preview: '#121A2B', line: '#26314A' },
  { value: 'system', label: 'Sistema', preview: '#F4F6F8', line: '#D0D5DD' },
]

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase('pt-BR')

// Configurações do design: perfil (leitura), tema (salvo no perfil e sincronizado), moeda e atalhos.
// Lembrete, biometria e PIN são recursos do app nativo e não entram na web.
export function SettingsPage() {
  const session = useSession()
  const sync = useSyncStatus()
  const profile = useLive(() => db.profile.toCollection().first(), [])
  const email = session.status === 'authenticated' ? session.user.email : ''
  const name = profile?.name ?? ''
  const [exporting, setExporting] = useState(false)

  async function pick(theme: Theme) {
    if (!profile || profile.theme === theme) return
    applyTheme(theme)
    await saveRecord('profile', { ...profile, theme, updated_at: new Date().toISOString() })
  }

  return (
    <main className="flex flex-col gap-5 px-4 pb-10 pt-[calc(1rem+env(safe-area-inset-top))]">
      <header className="flex items-center gap-2">
        <Link to="/mais" aria-label="Voltar" className="grid size-11 place-items-center rounded-field">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-lg font-extrabold">Configurações</h1>
      </header>

      <section aria-label="Perfil" className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4">
        <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-cobalt-soft text-lg font-extrabold text-cobalt-strong">
          {initialsOf(name || email) || '?'}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-base font-extrabold">{name || 'Sem nome'}</p>
          <p className="truncate text-[13px] text-ink-2">{email}</p>
        </div>
      </section>

      <section aria-labelledby="ap-t" className="flex flex-col gap-2">
        <h2 id="ap-t" className="px-1.5 text-[13px] font-bold uppercase tracking-wide text-ink-2">
          Aparência
        </h2>
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <span className="text-[15px] font-bold">Tema</span>
          <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-2">
            {themes.map((t) => {
              const on = (profile?.theme ?? 'system') === t.value
              return (
                <button
                  key={t.value}
                  role="radio"
                  aria-checked={on}
                  disabled={!profile}
                  onClick={() => void pick(t.value)}
                  className={`flex flex-col items-center gap-2 rounded-2xl p-2.5 text-[13px] font-bold disabled:opacity-60 ${on ? 'border-2 border-cobalt bg-cobalt-soft/40' : 'border border-line bg-surface'}`}
                >
                  <span aria-hidden="true" className="flex h-11 w-16 flex-col gap-1 rounded-[10px] border border-line p-[7px]" style={{ background: t.preview }}>
                    <span className="h-2 w-[70%] rounded-[3px] bg-cobalt" />
                    <span className="h-1.5 w-full rounded-[3px]" style={{ background: t.line }} />
                    <span className="h-1.5 w-[60%] rounded-[3px]" style={{ background: t.line }} />
                  </span>
                  {t.label}
                </button>
              )
            })}
          </div>
          {!profile && <p className="text-xs text-ink-3">O tema fica disponível quando o perfil for carregado.</p>}
        </div>
      </section>

      <section aria-labelledby="pref-t" className="flex flex-col gap-2">
        <h2 id="pref-t" className="px-1.5 text-[13px] font-bold uppercase tracking-wide text-ink-2">
          Preferências
        </h2>
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface px-4">
          <li className="flex min-h-14 items-center justify-between gap-3">
            <span className="text-[15px] font-bold">Moeda</span>
            <span className="text-sm font-semibold text-ink-2">Real (R$)</span>
          </li>
          <li>
            <Link to="/mais/categorias" className="flex min-h-14 items-center justify-between gap-3 text-ink">
              <span className="text-[15px] font-bold">Categorias</span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
          <li>
            <Link to="/mais/contas" className="flex min-h-14 items-center justify-between gap-3 text-ink">
              <span className="text-[15px] font-bold">Contas</span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="data-t" className="flex flex-col gap-2">
        <h2 id="data-t" className="px-1.5 text-[13px] font-bold uppercase tracking-wide text-ink-2">
          Dados
        </h2>
        <div className="flex min-h-14 flex-col justify-center gap-0.5 rounded-card border border-line bg-surface px-4 py-3">
          <span className="text-[15px] font-bold">Sincronização</span>
          <span className="text-xs font-semibold text-ink-2">{syncLabel(session.status === 'authenticated' && session.offline, sync)}</span>
        </div>
        <button onClick={() => setExporting(true)} className="flex min-h-14 items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 text-left">
          <span className="text-[15px] font-bold">Exportar transações (CSV)</span>
          <span aria-hidden="true">›</span>
        </button>
      </section>
      {exporting && <ExportSheet onClose={() => setExporting(false)} />}
    </main>
  )
}
