import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AuthLayout } from '../../components/AuthLayout'
import { FormError } from '../../components/ui'
import { restoreSession } from '../../lib/session'
import { ApiError } from '../../lib/api'
import { errorMessage } from '../../lib/errors'

// Destino do redirecionamento do Google: /auth/callback?intent=login&error=CODIGO.
// Sem erro, o cookie de sessão já foi gravado pela API; basta restaurar a sessão.
export function CallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = new URLSearchParams(window.location.search).get('error')
    if (code) {
      setError(errorMessage(new ApiError(400, { code, message: code })))
      return
    }
    restoreSession()
      .then(() => navigate({ to: '/', replace: true }))
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [navigate])

  return (
    <AuthLayout title="Entrando…">
      {error ? <FormError>{error}</FormError> : <p role="status" className="text-sm text-ink-2">Concluindo o login…</p>}
      {error && (
        <Link to="/login" className="text-center text-sm font-bold text-cobalt">
          Voltar para entrar
        </Link>
      )}
    </AuthLayout>
  )
}
