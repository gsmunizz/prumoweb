import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { Button, FormError } from '../../components/ui'
import { db } from '../../db'
import { today } from '../../lib/dates'
import { buildCsv } from './csv'

type Scope = 'mes' | 'tudo'

// Exporta as transações em CSV (Configurações → Dados). O arquivo sai do navegador, sem envio.
export function ExportSheet({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<Scope>('mes')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const now = today()
      const month = now.slice(0, 7)
      const [txs, accounts, categories] = await Promise.all([
        scope === 'mes' ? db.transactions.where('date').between(`${month}-01`, `${month}-31`, true, true).toArray() : db.transactions.toArray(),
        db.accounts.toArray(),
        db.categories.toArray(),
      ])
      const csv = buildCsv(txs, accounts, categories)
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = scope === 'mes' ? `prumo-transacoes-${month}.csv` : `prumo-transacoes-${now}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      onClose()
    } catch {
      setError('Não foi possível gerar o arquivo. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Exportar transações" onClose={onClose}>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-bold text-ink-2">Período</legend>
        {(
          [
            ['mes', 'Este mês'],
            ['tudo', 'Tudo'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={`flex min-h-12 items-center gap-3 rounded-field border px-3.5 ${scope === value ? 'border-cobalt bg-cobalt-soft/40' : 'border-line bg-surface'}`}>
            <input type="radio" name="periodo" value={value} checked={scope === value} onChange={() => setScope(value)} className="size-4 accent-cobalt" />
            <span className="text-[15px] font-bold">{label}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-ink-2">Um arquivo CSV com data, tipo, descrição, categoria, conta, valor e se é movimento interno (transferência ou aporte). Abre no Excel e no Planilhas Google.</p>
      {error && <FormError>{error}</FormError>}
      <Button onClick={() => void download()} busy={busy}>
        Baixar CSV
      </Button>
    </Sheet>
  )
}
