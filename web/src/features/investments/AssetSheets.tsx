import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { Button, Field, FormError } from '../../components/ui'
import type { Account, AssetClass } from '../../db/types'
import { today } from '../../lib/dates'
import { formatCents, parseReaisToCents } from '../../lib/money'
import { saveRecord, saveRecords } from '../../sync'
import { buildNewAsset } from './save'
import { assetClasses, breaksPosition, classInfo, formatQuantity, parseQuantity, quantityToWire, unitsOf, type Asset } from './rules'
import { formatDay } from '../../lib/dates'
import type { EntityName, InvestmentMovement, SyncedRecord, Transaction } from '../../db/types'
import { buildMovement, buildMovementRemoval, buildSnapshot } from './save'
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

// Aporte ou resgate num ativo existente. Resgate não pode passar da posição em nenhuma data (INV-13).
export function MovementSheet({ asset, movements, accounts, onClose }: { asset: Asset; movements: InvestmentMovement[]; accounts: Account[]; onClose: () => void }) {
  const [type, setType] = useState<'aporte' | 'resgate'>('aporte')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [accountId, setAccountId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const qty = parseQuantity(quantity)
    if (qty === null) return setError('Quantidade inválida. Use um número maior que zero, com até 8 casas.')
    const cents = parseReaisToCents(amount)
    if (cents === null || cents <= 0) return setError('Informe o valor, como 1.234,56.')
    if (date > today()) return setError('A data não pode ser no futuro.')
    if (type === 'resgate' && qty > asset.position.quantity) return setError(`Você tem ${formatQuantity(asset.position.quantity)} nesse ativo. Não dá para resgatar mais que isso.`)
    const candidate: InvestmentMovement = { id: 'novo', investment_id: asset.investment.id, type, date, quantity: quantityToWire(qty), amount_cents: cents, account_id: accountId || null, created_at: '', updated_at: '', deleted_at: null }
    if (type === 'resgate' && breaksPosition(movements.filter((m) => m.investment_id === asset.investment.id), candidate)) {
      return setError('Esse resgate deixaria a posição negativa em uma data anterior. Confira as datas.')
    }
    setBusy(true)
    try {
      await saveRecords(buildMovement({ investment: asset.investment, type, quantity: qty, amount: cents, date, account_id: accountId || null }, new Date().toISOString()))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={type === 'aporte' ? 'Registrar aporte' : 'Registrar resgate'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div role="group" aria-label="Tipo de movimento" className="grid grid-cols-2 gap-1 rounded-field bg-bg p-1">
          {(['aporte', 'resgate'] as const).map((t) => (
            <button type="button" key={t} aria-pressed={type === t} onClick={() => setType(t)} className={`h-10 rounded-chip text-sm font-bold ${type === t ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
              {t === 'aporte' ? 'Aporte' : 'Resgate'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="1" hint={`Posição: ${formatQuantity(asset.position.quantity)}`} />
          <Field label={type === 'aporte' ? 'Valor pago' : 'Valor recebido'} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </div>
        <Field label="Data" type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">Conta (opcional)</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-12 rounded-field border border-line bg-surface px-3 text-[15px]">
            <option value="">Sem conta</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink-3">{type === 'aporte' ? 'Com conta, o aporte sai do saldo dela sem contar como despesa do mês.' : 'Com conta, o resgate entra no saldo dela sem contar como receita do mês.'}</span>
        </label>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" busy={busy}>
          Salvar {type === 'aporte' ? 'aporte' : 'resgate'}
        </Button>
      </form>
    </Sheet>
  )
}

// Detalhe do ativo: posição, valor atual, movimentos, edição e exclusão.
export function AssetSheet({ asset, movements, accounts, transactions, onClose }: { asset: Asset; movements: InvestmentMovement[]; accounts: Account[]; transactions: Transaction[]; onClose: () => void }) {
  const { investment, position, current, ret } = asset
  const info = classInfo(investment.asset_class)
  const [value, setValue] = useState(current === null ? '' : centsToField(current))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit' | 'movement' | 'confirmDelete'>('view')
  const [removeError, setRemoveError] = useState<string | null>(null)
  const day = today()
  const todays = useLive(() => db.investment_snapshots.where('[investment_id+date]').equals([investment.id, day]).first(), [investment.id, day])
  const mine = movements.filter((m) => m.investment_id === investment.id && !m.deleted_at).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const cents = parseReaisToCents(value)
    if (cents === null) return setError('Valor inválido. Use o formato 1.234,56.')
    await saveRecord('investment_snapshots', await buildSnapshot(todays, investment.id, day, cents, new Date().toISOString()))
    setError(null)
    setSaved(true)
  }

  async function removeMovement(m: InvestmentMovement) {
    const others = movements.filter((x) => x.investment_id === investment.id && x.id !== m.id)
    if (breaksPosition(others)) return setRemoveError('Esse aporte sustenta resgates posteriores. Exclua os resgates primeiro.')
    const linked = transactions.filter((t) => t.investment_movement_id === m.id)
    await saveRecords(buildMovementRemoval(m, linked, new Date().toISOString()))
    setRemoveError(null)
  }

  if (mode === 'movement') return <MovementSheet asset={asset} movements={movements} accounts={accounts} onClose={onClose} />
  if (mode === 'edit') return <EditAssetSheet asset={asset} onClose={() => setMode('view')} />
  if (mode === 'confirmDelete') return <DeleteAssetSheet asset={asset} movements={movements} onClose={onClose} />

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

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setMode('movement')}>Aporte ou resgate</Button>
        <Button variant="ghost" onClick={() => setMode('edit')}>Editar ativo</Button>
      </div>

      <section aria-labelledby="mov-t" className="flex flex-col gap-2">
        <h3 id="mov-t" className="text-[13px] font-bold text-ink-2">Movimentos</h3>
        {removeError && <FormError>{removeError}</FormError>}
        {mine.length === 0 ? (
          <p className="text-sm text-ink-3">Nenhum movimento.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-field border border-line">
            {mine.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex-1 text-sm">
                  <span className="font-bold">{m.type === 'aporte' ? 'Aporte' : 'Resgate'}</span> · {formatQuantity(unitsOf(m.quantity))} · {formatCents(m.amount_cents)}
                  <span className="block text-xs text-ink-3">{formatDay(m.date)}</span>
                </span>
                <button onClick={() => removeMovement(m)} aria-label={`Excluir movimento de ${formatDay(m.date)}`} className="h-11 px-2 text-sm font-bold text-error">
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button onClick={() => setMode('confirmDelete')} className="h-11 text-sm font-bold text-error">
        Excluir ativo
      </button>
    </Sheet>
  )
}

// Edita nome, classe e ticker. Quantidades e valores vêm dos movimentos, não daqui.
export function EditAssetSheet({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [name, setName] = useState(asset.investment.name)
  const [assetClass, setAssetClass] = useState<AssetClass>(asset.investment.asset_class)
  const [ticker, setTicker] = useState(asset.investment.ticker ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Dê um nome para o ativo.')
    if (ticker.trim() && !/^[A-Za-z0-9.-]{1,12}$/.test(ticker.trim())) return setError('Ticker inválido. Use de 1 a 12 letras, números, ponto ou hífen.')
    await saveRecord('investments', { ...asset.investment, name: n, asset_class: assetClass, ticker: ticker.trim() ? ticker.trim().toUpperCase() : null, updated_at: new Date().toISOString() })
    onClose()
  }

  return (
    <Sheet title="Editar ativo" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink-2">Classe</span>
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)} className="h-12 rounded-field border border-line bg-surface px-3 text-[15px]">
            {assetClasses.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Field label="Ticker (opcional)" value={ticker} maxLength={12} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        {error && <FormError>{error}</FormError>}
        <Button type="submit">Salvar</Button>
      </form>
    </Sheet>
  )
}

// Excluir ativo leva junto seus movimentos e snapshots; as transações de conta ligadas ficam, porque
// o dinheiro de fato saiu da conta (INV-06).
export function DeleteAssetSheet({ asset, movements, onClose }: { asset: Asset; movements: InvestmentMovement[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const snapshots = useLive(() => db.investment_snapshots.where('investment_id').equals(asset.investment.id).toArray(), [asset.investment.id])
  const count = movements.filter((m) => m.investment_id === asset.investment.id && !m.deleted_at).length

  async function remove() {
    setBusy(true)
    try {
      const at = new Date().toISOString()
      const entries: [EntityName, SyncedRecord][] = [['investments', { ...asset.investment, deleted_at: at, updated_at: at }]]
      for (const m of movements) if (m.investment_id === asset.investment.id && !m.deleted_at) entries.push(['investment_movements', { ...m, deleted_at: at, updated_at: at }])
      for (const s of snapshots ?? []) if (!s.deleted_at) entries.push(['investment_snapshots', { ...s, deleted_at: at, updated_at: at }])
      await saveRecords(entries)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={`Excluir ${asset.investment.name}?`} onClose={onClose}>
      <p className="text-sm text-ink-2">
        Os {count} movimentos e os valores registrados deste ativo saem junto. Os lançamentos que já saíram da conta continuam no histórico.
      </p>
      <Button onClick={remove} busy={busy} className="bg-error text-white">
        Excluir ativo
      </Button>
      <Button variant="ghost" onClick={onClose}>
        Cancelar
      </Button>
    </Sheet>
  )
}
