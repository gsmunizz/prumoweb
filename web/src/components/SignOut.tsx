import { useState } from 'react'
import { db } from '../db'
import { logout } from '../lib/session'

// Sair da conta (AUT-19): apaga o banco local, então avisa antes se há alterações ainda não enviadas.
export function SignOut({ className = 'h-14 rounded-2xl border border-line bg-surface text-base font-extrabold text-error' }: { className?: string }) {
  const [confirming, setConfirming] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function leave() {
    setBusy(true)
    await logout()
  }

  if (confirming === null) {
    return (
      <button onClick={() => void db.outbox.count().then(setConfirming)} className={className}>
        Sair
      </button>
    )
  }
  return (
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
  )
}
