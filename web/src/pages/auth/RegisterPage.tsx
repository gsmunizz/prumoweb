import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { AuthLayout } from '../../components/AuthLayout'
import { Button, Field, FormError } from '../../components/ui'
import { errorMessage, fieldErrors } from '../../lib/errors'
import { register } from '../../lib/session'
import { GoogleButton } from './GoogleButton'

export function RegisterPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      await register({ name: name.trim(), email: email.trim(), password, accept_terms: terms })
      await navigate({ to: '/' })
    } catch (err) {
      const f = fieldErrors(err)
      setFields(f)
      setError(Object.keys(f).length ? null : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Leva menos de um minuto.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
        <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} />
        <Field
          label="Senha"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          hint="De 10 a 128 caracteres."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fields.password}
        />
        <label className="flex items-start gap-3 text-sm text-ink-2">
          <input type="checkbox" required checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 size-5 accent-cobalt" />
          <span>Li e aceito os termos de uso e a política de privacidade.</span>
        </label>
        {error && <FormError>{error}</FormError>}
        <Button type="submit" busy={busy}>
          Criar conta
        </Button>
      </form>
      <GoogleButton label="Cadastrar com o Google" />
      <p className="text-center text-sm text-ink-2">
        Já tem conta?{' '}
        <Link to="/login" className="font-bold text-cobalt">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  )
}
