// Cliente HTTP da API. Em produção o host do frontend repassa /api/* para a API Go
// (mesma origem, sem CORS); em desenvolvimento o proxy do Vite faz o mesmo.

export const API_BASE = '/api/v1'

// Corpo de erro padrão da API: { error: { code, message, details?, request_id } }.
export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
  request_id?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  readonly requestId?: string

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
    this.requestId = body.request_id
  }
}

// A sessão (lib/session.ts) se registra aqui para o cliente anexar o token de acesso
// e renová-lo uma vez quando a API responde 401.
export interface AuthHook {
  token(): string | null
  refresh(): Promise<boolean>
}

let authHook: AuthHook | null = null
export const setAuthHook = (hook: AuthHook | null) => {
  authHook = hook
}

export interface ApiInit extends RequestInit {
  // false nas rotas públicas e na própria renovação, que não carregam token nem repetem.
  auth?: boolean
}

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { auth = true, ...rest } = init
  const send = () => {
    const headers = new Headers(rest.headers)
    const token = auth ? authHook?.token() : null
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return request(path, { ...rest, headers })
  }

  let res = await send()
  if (res.status === 401 && auth && authHook && (await authHook.refresh())) res = await send()
  return parse<T>(res)
}

function request(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  // Exigido pelas rotas que leem o cookie de sessão (AUT-17).
  headers.set('X-Prumo-Client', 'web')
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' })
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 202) return undefined as T

  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (body as { error?: ApiErrorBody } | null)?.error
    throw new ApiError(res.status, err ?? { code: 'INTERNAL', message: res.statusText })
  }
  return body as T
}

export interface Health {
  status: 'ok' | 'degraded'
  version: string
  db: 'ok' | 'down'
}

export const getHealth = () => apiFetch<Health>('/health', { auth: false })
