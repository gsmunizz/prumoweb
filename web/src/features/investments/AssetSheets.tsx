import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { Button, Field, FormError } from '../../components/ui'
import type { Account, AssetClass } from '../../db/types'
import { today } from '../../lib/dates'
import { formatCents, parseReaisToCents } from '../../lib/money'
import { saveRecord, saveRecords } from '../../sync'
import { buildNewAsset, buildSnapshot } from './save'
import { assetClasses, classInfo, formatQuantity, parseQuantity, type Asset } from './rules'
import { useLive } from '../../lib/useLive'
import { db } from '../../db'

const centsToField = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

// Cadastro de ativo (INV-05): cria o ativo, o primeiro aporte e o primeiro valor atual juntos.
export function NewAssetSheet({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [assetClass, setAssetClass] = useState<AssetClass>('acoes')
  const [ticker, setTicker] = useState('')
  const [quantity, setQuantity] = useState('')
  const [invested, setInvested] = useState('')
  const [current, setCurrent] = useState('')
  const [date, setDate] = useState(today())
  const [accountId, setAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Corretoras primeiro: é de onde o dinheiro costuma sair (INV-04).
  const options = [...accounts].sort((a, b) => Number(b.type === 'corretora') - Number(a.type === 'corretora') || a.sort_order - b.sort_order)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Dê um nome para o ativo.')
    if (ticker.trim() && !/^[A-Za-z0-9.-]{1,12}$/.test(ticker.trim())) return setError('Ticker inválido. Use de 1 a 12 letras, números, ponto ou hífen.')
    const qty = parseQuantity(quantity.trim() || '1')
    if (qty === null) return setError('Quantidade inválida. Use um número maior que zero, com até 8 casas.')
    const paid = parseReaisToCents(invested)
    if (paid === null || paid <= 0) return setError('Informe o valor investido, como 1.234,56.')
    const now = current.trim() === '' ? paid : parseReaisToCents(current)
    if (now === null) return setError('Valor atual inválido. Use o formato 1.234,56.')
    if (date > today()) return setError('A data da compra não pode ser no futuro.')
    setBusy(true)
    try {
      await saveRecords(await buildNewAsset({ name: n, asset_class: assetClass, ticker, quantity: qty, invested: paid, current: now, date, today: today(), account_id: accountId || null }, new Date().toISOString()))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Novo ativo" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Tesouro IPCA+ 2035" />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-bold text-ink-2">Classe</legend>
          <div className="flex flex-wrap gap-2">
            {assetClasses.map((c) => (
              <button
                type="button"
                key={c.value}
                aria-pressed={assetClass === c.value}
                onClick={() => setAssetClass(c.value)}
                className={`h-10 rounded-full px-3.5 text-sm ${assetClass === c.value ? 'border-[1.5px] border-cobalt bg-cobalt-soft font-bold text-cobalt-strong' : 'border border-line bg-surface font-semibold text-ink-2'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ticker (opcional)" value={ticker} maxLength={12} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="PETR4" autoCapitalize="characters" />
          <Field label="Quantidade" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1" hint="Sem cotas, deixe 1." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor investido" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} placeholder="0,00" />
          <Field label="Valor atual" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder={invested || '0,00'} hint="Vazio = o investido." />
        </div>
        <Field label="Data da compra" type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">Conta de origem (opcional)</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-12 rounded-field border border-line bg-surface px-3 text-[15px]">
            <option value="">Sem conta</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-3">Com conta, o aporte sai do saldo dela sem contar como despesa do mês.</span>
        </label>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" busy={busy}>
          Adicionar ativo
        </Button>
      </form>
    </Sheet>
  )
}

// Detalhe do ativo e atualização do valor atual (um snapshot por dia, INV-21).
export function AssetSheet({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { investment, position, current, ret } = asset
  const info = classInfo(investment.asset_class)
  const [value, setValue] = useState(current === null ? '' : centsToField(current))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const day = today()
  const todays = useLive(() => db.investment_snapshots.where('[investment_id+date]').equals([investment.id, day]).first(), [investment.id, day])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = parseReaisToCents(value)
    if (cents === null) return setError('Valor inválido. Use o formato 1.234,56.')
    await saveRecord('investment_snapshots', await buildSnapshot(todays, investment.id, day, cents, new Date().toISOString()))
    setError(null)
    setSaved(true)
  }

  return (
    <Sheet title={investment.name} onClose={onClose}>
      <p className="-mt-2 text-sm font-semibold text-ink-3">
        {info.label}
        {investment.ticker ? ` · ${investment.ticker}` : ''} · {formatQuantity(position.quantity)} {position.quantity === 100_000_000n ? 'unidade' : 'unidades'}
      </p>
      <dl className="grid grid-cols-2 gap-2.5">
        <div className="rounded-field bg-bg px-3.5 py-3">
          <dt className="text-xs font-semibold text-ink-2">Investido</dt>
          <dd className="text-lg font-extrabold">{formatCents(position.invested)}</dd>
        </div>
        <div className="rounded-field bg-bg px-3.5 py-3">
          <dt className="text-xs font-semibold text-ink-2">Valor atual</dt>
          <dd className="text-lg font-extrabold">{current === null ? '—' : formatCents(current)}</dd>
        </div>
      </dl>
      <p className="text-sm text-ink-2">Rentabilidade: {ret === null ? '—' : `${ret >= 0 ? '+' : '−'}${Math.abs(ret).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Atualizar valor de hoje" inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false) }} placeholder="0,00" hint="Guarda um valor por dia; atualizar de novo no mesmo dia troca o valor." />
        {error && <FormError>{error}</FormError>}
        {saved && (
          <p role="status" className="text-sm font-semibold text-income">
            Valor atualizado.
          </p>
        )}
        <Button type="submit">Salvar valor atual</Button>
      </form>
    </Sheet>
  )
}
