import { useEffect, type ReactNode } from 'react'

// Folha que sobe da base (design "08 · Detalhes"): fundo que fecha, Esc e foco no diálogo.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-30">
      <button aria-label="Fechar" onClick={onClose} className="absolute inset-0 bg-ink/50" />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[92dvh] max-w-md flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-surface px-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5"
      >
        <div aria-hidden="true" className="mx-auto h-[5px] w-10 shrink-0 rounded-full bg-line" />
        <h2 className="text-lg font-extrabold">{title}</h2>
        {children}
      </section>
    </div>
  )
}
