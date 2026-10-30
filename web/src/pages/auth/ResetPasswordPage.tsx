import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, FormError } from '../../components/ui'
import { apiFetch } from '../../lib/api'
import { errorMessage, takeFragmentToken } from '../../lib/errors'

export function ResetPasswordPage() {
  // Lido uma vez: o fragmento é apagado da barra de endereço.
  const [token] = useState(takeFragmentToken)
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/auth/password/reset', { method: 'POST', auth: false, body: JSON.stringify({ token, new_password: password }) })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Nova senha">
      {!token ? (
        <FormError>Link incompleto. Peça um novo em “Esqueci minha senha”.</FormError>
      ) : done ? (
        <p role="status" className="rounded-field bg-income-soft px-3.5 py-3 text-sm font-semibold text-income">
          Senha alterada. Por segurança, você foi desconectado dos outros aparelhos.
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field
            label="Nova senha"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={128}
            hint="De 10 a 128 caracteres."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <FormError>{error}</FormError>}
          <Button type="submit" busy={busy}>
            Salvar nova senha
          </Button>
        </form>
      )}
      <Link to="/login" className="text-center text-sm font-bold text-cobalt">
        Ir para entrar
      </Link>
    </AuthLayout>
  )
}
