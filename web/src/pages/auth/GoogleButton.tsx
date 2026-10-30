// Login com o Google é uma navegação completa: a API redireciona ao Google e volta
// para /auth/callback (AUT-21). Se o servidor não tiver o Google configurado, a rota
// responde 404 e a página mostra o erro padrão do callback.
export function GoogleButton({ label = 'Continuar com o Google' }: { label?: string }) {
  return (
    <>
      <div className="flex items-center gap-3 text-xs font-semibold text-ink-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        ou
        <span className="h-px flex-1 bg-line" />
      </div>
      <a
        href="/api/v1/auth/google/start?intent=login"
        className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-base font-extrabold text-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.300z" />
          <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.400l-3.2-2.500c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.100H3.100v2.600A10 10 0 0 0 12 22z" />
          <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.400H3.100a10 10 0 0 0 0 9.200L6.4 14z" />
          <path fill="#EA4335" d="M12 5.900c1.5 0 2.8.5 3.8 1.500l2.8-2.800A10 10 0 0 0 3.1 7.400L6.4 10C7.2 7.7 9.4 5.9 12 5.900z" />
        </svg>
        {label}
      </a>
    </>
  )
}
