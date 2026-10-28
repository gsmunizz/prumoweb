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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  // Exigido pelas rotas que leem o cookie de sessão (AUT-17).
  headers.set('X-Prumo-Client', 'web')
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'same-origin' })
  if (res.status === 204) return undefined as T

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

export const getHealth = () => apiFetch<Health>('/health')
