import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthLayout } from '../../components/AuthLayout'
import { FormError } from '../../components/ui'
import { apiFetch } from '../../lib/api'
import { errorMessage, takeFragmentToken } from '../../lib/errors'
import { markEmailVerified } from '../../lib/session'

// Páginas de link único enviado por e-mail: consomem o token do fragmento assim que abrem.
function TokenPage({ title, path, success, onDone }: { title: string; path: string; success: string; onDone?: () => void }) {
  const [state, setState] = useState<{ status: 'working' } | { status: 'ok' } | { status: 'error'; message: string }>({ status: 'working' })
  const started = useRef(false)

  useEffect(() => {
    // StrictMode roda o efeito duas vezes em desenvolvimento; o token só vale uma.
    if (started.current) return
    started.current = true
    const token = takeFragmentToken()
    if (!token) {
      setState({ status: 'error', message: 'Link incompleto. Abra o link do e-mail de novo.' })
      return
    }
    apiFetch(path, { method: 'POST', auth: false, body: JSON.stringify({ token }) })
      .then(() => {
        onDone?.()
        setState({ status: 'ok' })
      })
      .catch((e: unknown) => setState({ status: 'error', message: errorMessage(e) }))
  }, [path, onDone])

  return (
    <AuthLayout title={title}>
      {state.status === 'working' && <p role="status" className="text-sm text-ink-2">Confirmando…</p>}
      {state.status === 'ok' && (
        <p role="status" className="rounded-field bg-income-soft px-3.5 py-3 text-sm font-semibold text-income">
          {success}
        </p>
      )}
      {state.status === 'error' && <FormError>{state.message}</FormError>}
      <Link to="/" className="text-center text-sm font-bold text-cobalt">
        Abrir o Prumo
      </Link>
    </AuthLayout>
  )
}

export const VerifyEmailPage = () => (
  <TokenPage title="Verificar e-mail" path="/auth/verify-email" success="E-mail verificado. Tudo certo!" onDone={markEmailVerified} />
)

export const ConfirmEmailPage = () => (
  <TokenPage title="Confirmar novo e-mail" path="/me/email/confirm" success="E-mail alterado. Use o novo endereço para entrar." />
)
