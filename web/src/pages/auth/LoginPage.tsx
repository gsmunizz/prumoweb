import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, FormError } from '../../components/ui'
import { errorMessage } from '../../lib/errors'
import { login } from '../../lib/session'
import { GoogleButton } from './GoogleButton'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      await navigate({ to: '/' })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Entrar" subtitle="Acesse suas finanças em qualquer aparelho.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" busy={busy}>
          Entrar
        </Button>
        <Link to="/forgot-password" className="text-center text-sm font-bold text-cobalt">
          Esqueci minha senha
        </Link>
      </form>
      <GoogleButton />
      <p className="text-center text-sm text-ink-2">
        Ainda não tem conta?{' '}
        <Link to="/register" className="font-bold text-cobalt">
          Criar conta
        </Link>
      </p>
    </AuthLayout>
  )
}
