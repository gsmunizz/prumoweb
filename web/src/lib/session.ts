import { useSyncExternalStore } from 'react'
import { wipeLocalData } from '../db'
import { ApiError, apiFetch, setAuthHook } from './api'

// Sessão do app. O token de acesso (15 min) vive só na memória; o refresh token é um
// cookie HttpOnly que o JavaScript nunca vê (AUT-17). Ao abrir o app, a sessão é
// restaurada com POST /auth/refresh.

export interface SessionUser {
  id: string
  email: string
  email_verified: boolean
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  // offline: a renovação não alcançou a API; o app abre com os dados do aparelho
  // (local-first) e sincroniza quando voltar a conexão.
  | { status: 'authenticated'; user: SessionUser; offline: boolean }

interface SessionResponse {
  user: SessionUser
  access_token: string
}

const HINT_KEY = 'prumo:user'

let state: SessionState = { status: 'loading' }
let token: string | null = null
let renewal: Promise<boolean> | null = null
const listeners = new Set<() => void>()

function set(next: SessionState) {
  state = next
  listeners.forEach((l) => l())
}

function remember(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(HINT_KEY, JSON.stringify(user))
    else localStorage.removeItem(HINT_KEY)
  } catch {
    // armazenamento bloqueado: o app só deixa de abrir offline sem conexão prévia
  }
}

function remembered(): SessionUser | null {
  try {
    const raw = localStorage.getItem(HINT_KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

function start(res: SessionResponse) {
  token = res.access_token
  remember(res.user)
  set({ status: 'authenticated', user: res.user, offline: false })
}

// Renova o token de acesso; chamadas simultâneas compartilham a mesma requisição,
// porque o refresh token gira a cada uso (AUT-09).
function renew(): Promise<boolean> {
  renewal ??= (async () => {
    try {
      const res = await apiFetch<{ access_token: string }>('/auth/refresh', { method: 'POST', auth: false })
      token = res.access_token
      return true
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        token = null
        remember(null)
        set({ status: 'anonymous' })
      }
      return false
    } finally {
      renewal = null
    }
  })()
  return renewal
}

setAuthHook({ token: () => token, refresh: renew })

export async function restoreSession(): Promise<void> {
  if (!(await renew())) {
    // Sem rede: se este aparelho já teve login, abre offline em vez de pedir a senha.
    const hint = remembered()
    if (state.status === 'loading') {
      set(hint ? { status: 'authenticated', user: hint, offline: true } : { status: 'anonymous' })
    }
    return
  }
  try {
    const me = await apiFetch<SessionUser>('/me')
    start({ user: { id: me.id, email: me.email, email_verified: me.email_verified }, access_token: token! })
  } catch {
    // A renovação funcionou mas o perfil não veio (rede caiu, API instável): segue offline.
    const hint = remembered()
    set(hint ? { status: 'authenticated', user: hint, offline: true } : { status: 'anonymous' })
  }
}

export async function login(email: string, password: string): Promise<void> {
  start(await apiFetch<SessionResponse>('/auth/login', { method: 'POST', auth: false, body: JSON.stringify({ email, password }) }))
}

export interface RegisterInput {
  name: string
  email: string
  password: string
  accept_terms: boolean
}

export async function register(input: RegisterInput): Promise<void> {
  start(await apiFetch<SessionResponse>('/auth/register', { method: 'POST', auth: false, body: JSON.stringify(input) }))
}

// Encerra a sessão e apaga o banco local (AUT-19). Quem chama avisa antes se há
// alterações ainda não enviadas.
export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST', auth: false })
  } catch {
    // sem rede, o cookie expira sozinho; o aparelho sai do mesmo jeito
  }
  token = null
  remember(null)
  await wipeLocalData()
  set({ status: 'anonymous' })
}

export function markEmailVerified() {
  if (state.status === 'authenticated') {
    const user = { ...state.user, email_verified: true }
    remember(user)
    set({ ...state, user })
  }
}

export const getSession = () => state
export const subscribeSession = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const useSession = () => useSyncExternalStore(subscribeSession, getSession)

// Só para testes.
export function resetSession() {
  state = { status: 'loading' }
  token = null
  renewal = null
}
