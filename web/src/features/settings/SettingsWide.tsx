import { useState, type ReactNode } from 'react'
import { SignOut } from '../../components/SignOut'
import { IconChevron, PageHead, SectionNav, ghostButton, widePage } from '../../components/wide'
import { db } from '../../db'
import type { Theme } from '../../db/types'
import { useLive } from '../../lib/useLive'
import { useSession } from '../../lib/session'
import { applyTheme } from '../../lib/theme'
import { syncLabel } from '../../pages/MaisPage'
import { saveRecord, useSyncStatus } from '../../sync'
import { ExportSheet } from '../export/ExportSheet'

const themes: { value: Theme; label: string; swatch: string }[] = [
  { value: 'light', label: 'Claro', swatch: '#FFFFFF' },
  { value: 'dark', label: 'Escuro', swatch: '#0A0F1C' },
  { value: 'system', label: 'Sistema', swatch: 'linear-gradient(90deg, #FFFFFF 50%, #0A0F1C 50%)' },
]

// Alertas, biometria, PIN, sessões e backup são recursos que ainda não existem: aparecem como no
// design, porém desligados e marcados "Em breve", para não prometer o que o app não faz.
const alerts = [
  { id: 'venc', label: 'Contas a vencer', hint: 'Aviso 2 dias antes do vencimento' },
  { id: 'orc', label: 'Limite de gastos', hint: 'Quando uma categoria passar de 80%' },
  { id: 'sem', label: 'Resumo semanal', hint: 'Todo domingo às 18h' },
  { id: 'dica', label: 'Dicas de economia', hint: 'Sugestões baseadas no seu histórico' },
]

const Soon = () => <span className="rounded-full bg-bg px-2.5 py-1 text-xs font-extrabold text-ink-3">Em breve</span>

// Configurações no tablet (uma coluna, com as seções do Mais) e no desktop (duas colunas).
// Designs "Tablet · Configurações" e "Desktop · Configurações".
export function SettingsWide({ variant }: { variant: 'tablet' | 'desktop' }) {
  const desktop = variant === 'desktop'
  const session = useSession()
  const sync = useSyncStatus()
  const profile = useLive(() => db.profile.toCollection().first(), [])
  const email = session.status === 'authenticated' ? session.user.email : ''
  const [exporting, setExporting] = useState(false)

  async function pick(theme: Theme) {
    if (!profile || profile.theme === theme) return
    applyTheme(theme)
    await saveRecord('profile', { ...profile, theme, updated_at: new Date().toISOString() })
  }

  const card = 'flex flex-col rounded-card border border-line bg-surface'

  const appearance = (
    <section aria-labelledby="cfg-ap" className={`${card} gap-4 ${desktop ? 'p-6' : 'px-6 py-5'}`}>
      <h2 id="cfg-ap" className={`font-extrabold ${desktop ? 'text-lg' : 'text-[17px]'}`}>
        Aparência
      </h2>
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-2.5">
        {themes.map((t) => {
          const on = (profile?.theme ?? 'system') === t.value
          return (
            <button
              key={t.value}
              role="radio"
              aria-checked={on}
              disabled={!profile}
              onClick={() => void pick(t.value)}
              className={`flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl p-3 text-sm font-extrabold disabled:opacity-60 ${on ? 'border-2 border-cobalt bg-cobalt-soft/40' : 'border border-line bg-surface'}`}
            >
              <span aria-hidden="true" className="h-7 w-10 rounded-lg border border-line" style={{ background: t.swatch }} />
              {t.label}
            </button>
          )
        })}
      </div>
      {!profile && <p className="text-xs text-ink-3">O tema fica disponível quando o perfil for carregado.</p>}
    </section>
  )

  const notifications = (
    <section aria-labelledby="cfg-nt" className={`${card} px-6 py-2`}>
      <div className="flex items-center justify-between pb-2 pt-4">
        <h2 id="cfg-nt" className={`font-extrabold ${desktop ? 'text-lg' : 'text-[17px]'}`}>
          Notificações
        </h2>
        <Soon />
      </div>
      {alerts.map((a) => (
        <div key={a.id} className="flex min-h-[68px] items-center gap-4 border-t border-line">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id={`sw-${a.id}`} className="text-[15px] font-bold text-ink-2">
              {a.label}
            </span>
            <span className="text-[13px] font-medium text-ink-3">{a.hint}</span>
          </div>
          <button role="switch" aria-checked="false" aria-labelledby={`sw-${a.id}`} disabled className="flex h-11 w-[52px] items-center justify-center opacity-60">
            <span className="relative block h-7 w-12 rounded-full bg-line">
              <span className="absolute left-[3px] top-[3px] size-[22px] rounded-full bg-white shadow-card" />
            </span>
          </button>
        </div>
      ))}
    </section>
  )

  const security = (
    <section aria-labelledby="cfg-sg" className={`${card} px-6 py-2`}>
      <h2 id="cfg-sg" className={`pb-2 pt-4 font-extrabold ${desktop ? 'text-lg' : 'text-[17px]'}`}>
        Segurança
      </h2>
      <div className="flex min-h-16 items-center gap-3.5 border-t border-line">
        <span className="flex-1 text-[15px] font-bold text-ink-2">Bloqueio com biometria</span>
        <Soon />
      </div>
      {['Alterar PIN', 'Sessões ativas'].map((label) => (
        <div key={label} className="flex min-h-14 items-center justify-between border-t border-line text-[15px] font-bold text-ink-2">
          {label}
          <span className="flex items-center gap-2">
            <Soon />
            <span className="text-ink-3">
              <IconChevron />
            </span>
          </span>
        </div>
      ))}
    </section>
  )

  const data = (
    <section aria-labelledby="cfg-dt" className={`${card} gap-3.5 p-6`}>
      <h2 id="cfg-dt" className={`font-extrabold ${desktop ? 'text-lg' : 'text-[17px]'}`}>
        Dados e backup
      </h2>
      <p className="text-sm leading-normal text-ink-2">
        {syncLabel(session.status === 'authenticated' && session.offline, sync)}. Seus dados ficam neste aparelho e são sincronizados com a sua conta.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <button onClick={() => setExporting(true)} className={`${ghostButton} h-12 px-[18px] text-sm`}>
          Exportar CSV
        </button>
        <button disabled className={`${ghostButton} h-12 gap-2 px-[18px] text-sm opacity-60`}>
          Fazer backup agora
          <Soon />
        </button>
      </div>
    </section>
  )

  const account: ReactNode = (
    <section aria-labelledby="cfg-ac" className={`${card} gap-3.5 p-6`}>
      <h2 id="cfg-ac" className={`font-extrabold ${desktop ? 'text-lg' : 'text-[17px]'}`}>
        Conta
      </h2>
      <p className="truncate text-sm font-semibold text-ink-2">{profile?.name ? `${profile.name} · ${email}` : email}</p>
      <SignOut className="h-12 self-start rounded-[14px] border border-line bg-surface px-[18px] text-sm font-extrabold text-error" />
    </section>
  )

  const risk = (
    <section aria-labelledby="cfg-rk" className="flex flex-col gap-3 rounded-card border border-[#F3C4BB] bg-surface p-6">
      <h2 id="cfg-rk" className={`font-extrabold text-error ${desktop ? 'text-lg' : 'text-[17px]'}`}>
        Zona de risco
      </h2>
      <p className="text-sm leading-normal text-ink-2">Apagar todos os dados remove contas, categorias e transações deste dispositivo.</p>
      <button disabled className="flex h-12 items-center gap-2 self-start rounded-[14px] border border-error bg-surface px-[18px] text-sm font-extrabold text-error opacity-60">
        Apagar todos os dados
        <Soon />
      </button>
    </section>
  )

  return (
    <main className={widePage}>
      <PageHead size={desktop ? 28 : 26} title="Configurações" subtitle="Aparência, notificações, segurança e dados" />
      {!desktop && <SectionNav current="configuracoes" />}
      {desktop ? (
        <div className="flex max-w-[1100px] flex-wrap items-start gap-6">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            {appearance}
            {notifications}
          </div>
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-6">
            {security}
            {data}
            {account}
            {risk}
          </div>
        </div>
      ) : (
        <>
          {appearance}
          {notifications}
          {security}
          {data}
          {account}
          {risk}
        </>
      )}
      {exporting && <ExportSheet onClose={() => setExporting(false)} />}
    </main>
  )
}
