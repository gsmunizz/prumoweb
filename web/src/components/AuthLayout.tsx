import type { ReactNode } from 'react'

// Moldura das telas de entrada: marca, título e o conteúdo num cartão.
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pb-8 pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <img src="/icon.svg" alt="" className="size-10 rounded-chip" />
        <span className="text-2xl font-extrabold tracking-tight">Prumo</span>
      </header>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[15px] text-ink-2">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">{children}</div>
    </main>
  )
}
