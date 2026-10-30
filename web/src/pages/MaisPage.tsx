import { useState } from 'react'
import { db } from '../db'
import { logout, useSession } from '../lib/session'

// "Mais" do design (perfil, atalhos, configurações). Nesta etapa: perfil e sair.
export function MaisPage() {
  const session = useSession()
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  if (session.status !== 'authenticated') return null
  const { email } = session.user

  async function ask() {
    // AUT-19: sair apaga o banco local; avisa antes se há alterações ainda não enviadas.
    setConfirming(await db.outbox.count())
  }

  async function leave() {
    setBusy(true)
    await logout()
  }

  return (
    <main className="flex flex-col gap-4 px-4 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <h1 className="text-[26px] font-extrabold tracking-tight">Mais</h1>

      <section className="flex items-center gap-3.5 rounded-card border border-line bg-surface p-4">
        <span aria-hidden="true" className="grid size-[52px] place-items-center rounded-full bg-cobalt-soft text-lg font-extrabold text-cobalt-strong">
          {email.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-extrabold">{email}</p>
          <p className="text-[13px] text-ink-2">{session.offline ? 'Sem conexão' : 'Conectado'}</p>
        </div>
      </section>

      {confirming === null ? (
        <button onClick={() => void ask()} className="h-14 rounded-2xl border border-line bg-surface text-base font-extrabold text-error">
          Sair
        </button>
      ) : (
        <section role="alertdialog" aria-label="Confirmar saída" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-2">
            {confirming > 0
              ? `Há ${confirming} alteração(ões) que ainda não foram enviadas e serão perdidas ao sair. Conecte-se à internet para sincronizar antes.`
              : 'Os dados deste aparelho serão apagados. Eles continuam na sua conta.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setConfirming(null)} className="h-12 rounded-2xl border border-line font-extrabold">
              Cancelar
            </button>
            <button onClick={() => void leave()} disabled={busy} className="h-12 rounded-2xl bg-error font-extrabold text-white disabled:opacity-60">
              {busy ? 'Saindo…' : 'Sair mesmo assim'}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
