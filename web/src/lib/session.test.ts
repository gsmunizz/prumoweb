import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api'
import { getSession, login, logout, resetSession, restoreSession } from './session'

const user = { id: 'u1', email: 'a@b.co', email_verified: true }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const apiError = (status: number, code: string) => json(status, { error: { code, message: code } })

const store = new Map<string, string>()

beforeEach(() => {
  resetSession()
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('sessão', () => {
  it('login guarda o usuário e anexa o token nas chamadas seguintes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { user, access_token: 'tok-1', expires_in: 900 }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await login('a@b.co', 'senha-longa-123')
    expect(getSession()).toEqual({ status: 'authenticated', user, offline: false })

    await apiFetch('/me')
    const headers = new Headers((fetchMock.mock.calls[1]![1] as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer tok-1')
    expect(headers.get('X-Prumo-Client')).toBe('web')
  })

  it('renova o token uma vez quando a API responde 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { user, access_token: 'velho', expires_in: 900 }))
      .mockResolvedValueOnce(apiError(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce(json(200, { access_token: 'novo', expires_in: 900 }))
      .mockResolvedValueOnce(json(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    await login('a@b.co', 'senha-longa-123')
    await expect(apiFetch('/me')).resolves.toEqual({ ok: true })
    const retry = new Headers((fetchMock.mock.calls[3]![1] as RequestInit).headers)
    expect(retry.get('Authorization')).toBe('Bearer novo')
  })

  it('restoreSession fica anônimo quando o refresh é recusado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiError(401, 'REFRESH_INVALID')))
    await restoreSession()
    expect(getSession()).toEqual({ status: 'anonymous' })
  })

  it('restoreSession abre offline se o aparelho já teve login e não há rede', async () => {
    store.set('prumo:user', JSON.stringify(user))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await restoreSession()
    expect(getSession()).toEqual({ status: 'authenticated', user, offline: true })
  })

  it('restoreSession sem rede e sem login prévio vai para a tela de entrada', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await restoreSession()
    expect(getSession()).toEqual({ status: 'anonymous' })
  })

  it('logout limpa a sessão e a dica local mesmo sem rede', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { user, access_token: 'tok', expires_in: 900 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    await login('a@b.co', 'senha-longa-123')
    await logout()
    expect(getSession()).toEqual({ status: 'anonymous' })
    expect(store.has('prumo:user')).toBe(false)
  })
})

describe('restoreSession com /me falhando', () => {
  it('segue offline com a dica local em vez de ficar carregando', async () => {
    store.set('prumo:user', JSON.stringify(user))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(200, { access_token: 't', expires_in: 900 }))
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    )
    await restoreSession()
    expect(getSession()).toEqual({ status: 'authenticated', user, offline: true })
  })
})
