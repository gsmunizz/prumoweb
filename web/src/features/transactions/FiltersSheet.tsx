import { useEffect, useMemo, useState } from 'react'
import type { Account, Category, ISODate } from '../../db/types'
import { monthOf, shiftMonth, today } from '../../lib/dates'
import { CategoryIcon } from '../../lib/icons'
import { formatCents, parseReaisToCents } from '../../lib/money'
import { useLive } from '../../lib/useLive'
import { applyFilters, defaultFilters, rangeOf, type Filters, type Period, type TypeFilter } from './filters'
import { transactionsInRange } from './queries'

const types: [TypeFilter, string][] = [
  ['all', 'Todas'],
  ['income', 'Receitas'],
  ['expense', 'Despesas'],
]

const chip = (on: boolean) => `h-10 rounded-full px-3.5 text-sm ${on ? 'border-[1.5px] border-cobalt bg-cobalt-soft font-bold text-cobalt-strong' : 'border border-line bg-surface font-semibold text-ink-2'}`

const centsToField = (cents: number | null) => (cents === null ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }))

// Folha de filtros (design "Filtros de transações"): edita um rascunho e só aplica no botão.
export function FiltersSheet({ value, categories, accounts, onApply, onClose }: { value: Filters; categories: Category[]; accounts: Account[]; onApply: (f: Filters) => void; onClose: () => void }) {
  const now = today()
  const [draft, setDraft] = useState(value)
  const [minText, setMinText] = useState(centsToField(value.min))
  const [maxText, setMaxText] = useState(centsToField(value.max))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const [from, to] = rangeOf(draft.period, now)
  const inRange = useLive(() => transactionsInRange(from, to), [from, to])
  const count = useMemo(() => applyFilters(inRange ?? [], draft).length, [inRange, draft])

  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }))
  const toggle = (key: 'categories' | 'accounts', id: string) => set({ [key]: draft[key].includes(id) ? draft[key].filter((x) => x !== id) : [...draft[key], id] })
  const setMoney = (key: 'min' | 'max', text: string) => {
    if (key === 'min') setMinText(text)
    else setMaxText(text)
    set({ [key]: text.trim() === '' ? null : parseReaisToCents(text) })
  }

  const thisMonth = monthOf(now)
  const prevMonth = shiftMonth(thisMonth, -1)
  const p = draft.period
  const preset = p.kind === 'month' && p.month === thisMonth ? 'this' : p.kind === 'month' && p.month === prevMonth ? 'prev' : p.kind === '3m' ? '3m' : 'custom'
  const pick = (period: Period) => set({ period })
  const lastDay = (iso: ISODate) => iso.slice(0, 7) + '-' + String(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate()).padStart(2, '0')
  const periodFrom = from
  const periodTo = to.endsWith('-31') ? lastDay(to) : to

  const clear = () => {
    setDraft(defaultFilters(now))
    setMinText('')
    setMaxText('')
  }
  const badMoney = (text: string, parsed: number | null) => text.trim() !== '' && parsed === null
  const invalid = badMoney(minText, draft.min) || badMoney(maxText, draft.max) || (draft.min !== null && draft.max !== null && draft.min > draft.max) || (p.kind === 'custom' && p.from > p.to)

  return (
    <div className="fixed inset-0 z-30">
      <button aria-label="Fechar filtros" onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <section role="dialog" aria-modal="true" aria-labelledby="flt-t" className="absolute inset-x-0 bottom-0 mx-auto flex h-[92dvh] max-w-md flex-col rounded-t-[28px] bg-surface md:h-[85dvh] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px]">
        <div aria-hidden="true" className="mx-auto mb-1 mt-2.5 h-[5px] w-10 rounded-full bg-line" />
        <div className="flex items-center justify-between px-5 pb-3 pt-2">
          <h2 id="flt-t" className="text-xl font-extrabold">
            Filtros
          </h2>
          <button onClick={clear} className="h-11 px-1 text-[15px] font-bold text-cobalt">
            Limpar tudo
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-5 pb-4 pt-1">
          <fieldset className="flex flex-col">
            <legend className="mb-2.5 text-sm font-extrabold">Tipo</legend>
            <div className="grid grid-cols-3 gap-1 rounded-field bg-bg p-1">
              {types.map(([key, label]) => (
                <button key={key} aria-pressed={draft.type === key} onClick={() => set({ type: key })} className={`h-10 rounded-chip text-sm font-bold ${draft.type === key ? 'bg-surface text-ink shadow-card' : 'text-ink-2'}`}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2.5 text-sm font-extrabold">Período</legend>
            <div className="flex flex-wrap gap-2">
              <button aria-pressed={preset === 'this'} onClick={() => pick({ kind: 'month', month: thisMonth })} className={chip(preset === 'this')}>
                Este mês
              </button>
              <button aria-pressed={preset === 'prev'} onClick={() => pick({ kind: 'month', month: prevMonth })} className={chip(preset === 'prev')}>
                Mês passado
              </button>
              <button aria-pressed={preset === '3m'} onClick={() => pick({ kind: '3m' })} className={chip(preset === '3m')}>
                3 meses
              </button>
              <button aria-pressed={preset === 'custom'} onClick={() => pick({ kind: 'custom', from: periodFrom, to: periodTo })} className={chip(preset === 'custom')}>
                Personalizado
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <DateField label="De" value={periodFrom} onChange={(v) => pick({ kind: 'custom', from: v, to: periodTo })} />
              <DateField label="Até" value={periodTo} onChange={(v) => pick({ kind: 'custom', from: periodFrom, to: v })} />
            </div>
            {p.kind === 'custom' && p.from > p.to && <p role="alert" className="text-xs font-semibold text-error">A data inicial não pode ser depois da final.</p>}
          </fieldset>

          <fieldset className="flex flex-col">
            <legend className="mb-2.5 text-sm font-extrabold">Categoria</legend>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => {
                const on = draft.categories.includes(c.id)
                return (
                  <button key={c.id} aria-pressed={on} onClick={() => toggle('categories', c.id)} className={`flex h-10 items-center gap-1.5 rounded-full pl-2.5 pr-3.5 text-sm font-semibold ${on ? 'border-[1.5px] border-cobalt bg-cobalt-soft' : 'border border-line bg-surface'}`}>
                    <span style={{ color: c.color }}>
                      <CategoryIcon name={c.icon} size={18} />
                    </span>
                    {c.name}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col">
            <legend className="mb-2.5 text-sm font-extrabold">Conta</legend>
            <div className="flex flex-wrap gap-2">
              <button aria-pressed={draft.accounts.length === 0} onClick={() => set({ accounts: [] })} className={chip(draft.accounts.length === 0)}>
                Todas
              </button>
              {accounts.map((a) => (
                <button key={a.id} aria-pressed={draft.accounts.includes(a.id)} onClick={() => toggle('accounts', a.id)} className={chip(draft.accounts.includes(a.id))}>
                  {a.name}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col">
            <legend className="mb-2.5 text-sm font-extrabold">Valor</legend>
            <div className="grid grid-cols-2 gap-2.5">
              <MoneyField label="Mínimo" placeholder="R$ 0,00" value={minText} invalid={badMoney(minText, draft.min)} onChange={(v) => setMoney('min', v)} />
              <MoneyField label="Máximo" placeholder="Sem limite" value={maxText} invalid={badMoney(maxText, draft.max)} onChange={(v) => setMoney('max', v)} />
            </div>
            {draft.min !== null && draft.max !== null && draft.min > draft.max && (
              <p role="alert" className="mt-2 text-xs font-semibold text-error">
                O mínimo ({formatCents(draft.min)}) passa do máximo ({formatCents(draft.max)}).
              </p>
            )}
          </fieldset>
        </div>

        <div className="border-t border-line px-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-3">
          <button
            disabled={invalid}
            onClick={() => onApply({ ...draft, search: value.search })}
            className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-cobalt text-base font-extrabold text-white disabled:opacity-50"
          >
            Ver {count} {count === 1 ? 'transação' : 'transações'}
          </button>
        </div>
      </section>
    </div>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink-2">
      {label}
      <input type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="h-[46px] rounded-xl border border-line bg-surface px-3 text-[15px] text-ink" />
    </label>
  )
}

function MoneyField({ label, placeholder, value, invalid, onChange }: { label: string; placeholder: string; value: string; invalid: boolean; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink-2">
      {label}
      <input inputMode="decimal" placeholder={placeholder} value={value} aria-invalid={invalid} onChange={(e) => onChange(e.target.value)} className={`h-[46px] rounded-xl border bg-surface px-3 text-[15px] text-ink ${invalid ? 'border-error' : 'border-line'}`} />
    </label>
  )
}
