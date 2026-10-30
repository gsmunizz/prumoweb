import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, FormError } from '../../components/ui'
import { apiFetch } from '../../lib/api'
import { errorMessage } from '../../lib/errors'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/auth/password/forgot', { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim() }) })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviamos um link para você criar uma nova senha.">
      {sent ? (
        // A API responde igual exista ou não a conta (não revela cadastros).
        <p role="status" className="rounded-field bg-cobalt-soft px-3.5 py-3 text-sm font-semibold text-cobalt-strong">
          Se houver uma conta com este e-mail, o link chega em instantes. Ele vale por 1 hora.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <FormError>{error}</FormError>}
          <Button type="submit" busy={busy}>
            Enviar link
          </Button>
        </form>
      )}
      <Link to="/login" className="text-center text-sm font-bold text-cobalt">
        Voltar para entrar
      </Link>
    </AuthLayout>
  )
}
