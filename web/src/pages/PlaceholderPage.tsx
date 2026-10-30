// Telas do design que ainda não foram construídas; entram nos próximos PRs da Fase 1.
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="flex flex-1 flex-col gap-2 px-4 pt-[calc(1.5rem+env(safe-area-inset-top))]">
      <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
      <p className="text-sm text-ink-2">Esta tela chega em breve.</p>
    </main>
  )
}
