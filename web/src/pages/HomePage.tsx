import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../lib/api'
import { formatCents } from '../lib/money'

// Tela provisória da Fase 0: confirma que app, tokens do design e API conversam.
// As telas do design entram na Fase 1.
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth })

  const apiStatus = health.isPending
    ? { label: 'Verificando a API…', tone: 'text-ink-3' }
    : health.data?.status === 'ok'
      ? { label: `API ${health.data.version} no ar`, tone: 'text-income' }
      : { label: 'API fora do ar', tone: 'text-warning' }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 pt-[calc(2rem+env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10 rounded-chip" />
        <h1 className="text-2xl font-extrabold tracking-tight">Prumo</h1>
      </header>

      <section className="rounded-card bg-surface p-5 shadow-card">
        <p className="text-sm font-semibold text-ink-2">Saldo atual</p>
        <p className="mt-1 text-3xl font-extrabold">{formatCents(0)}</p>
        <div className="mt-4 flex gap-2 text-sm font-semibold">
          <span className="rounded-chip bg-income-soft px-2.5 py-1 text-income">↑ Receitas</span>
          <span className="rounded-chip bg-expense-soft px-2.5 py-1 text-expense">↓ Despesas</span>
        </div>
      </section>

      <p className={`text-sm font-semibold ${apiStatus.tone}`} aria-live="polite">
        {apiStatus.label}
      </p>
    </main>
  )
}
