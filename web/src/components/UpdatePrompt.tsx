import { useRegisterSW } from 'virtual:pwa-register/react'

// Aviso de nova versão com botão Atualizar, como no planejamento da PWA.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] mx-auto flex max-w-md items-center gap-3 rounded-card bg-ink px-4 py-3 text-sm text-surface shadow-sheet"
    >
      <span className="flex-1">Nova versão do Prumo disponível.</span>
      <button className="font-semibold" onClick={() => setNeedRefresh(false)}>
        Depois
      </button>
      <button
        className="rounded-chip bg-cobalt px-3 py-1.5 font-bold text-white"
        onClick={() => void updateServiceWorker(true)}
      >
        Atualizar
      </button>
    </div>
  )
}
