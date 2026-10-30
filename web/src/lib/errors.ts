import { ApiError } from './api'

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  EMAIL_TAKEN: 'Este e-mail já tem cadastro. Tente entrar.',
  WEAK_PASSWORD: 'Senha curta ou comum demais. Use ao menos 10 caracteres.',
  REGISTRATION_CLOSED: 'O cadastro está aberto só para convidados por enquanto.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  TOKEN_INVALID: 'Este link é inválido, venceu ou já foi usado. Peça um novo.',
  ALREADY_VERIFIED: 'Este e-mail já foi verificado.',
  EMAIL_NOT_VERIFIED: 'Verifique seu e-mail antes de continuar.',
  OIDC_FAILED: 'Não foi possível entrar com o Google. Tente de novo.',
  ACCOUNT_LINK_REQUIRED: 'Já existe uma conta com este e-mail. Entre com a senha e vincule o Google em Configurações.',
  GOOGLE_ALREADY_LINKED: 'Esta conta Google já está vinculada a outro usuário.',
  UNAUTHENTICATED: 'Sua sessão terminou. Entre de novo.',
  SERVICE_UNAVAILABLE: 'O serviço está indisponível agora. Tente em instantes.',
}

// Texto para a pessoa a partir de qualquer erro de chamada à API.
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return messages[e.code] ?? 'Algo deu errado. Tente de novo.'
  if (e instanceof TypeError) return 'Sem conexão. Verifique a internet e tente de novo.'
  return 'Algo deu errado. Tente de novo.'
}

// Erros de campo (422 VALIDATION_FAILED): campo -> mensagem.
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_FAILED' || !Array.isArray(e.details)) return {}
  const reasons: Record<string, string> = {
    REQUIRED: 'Campo obrigatório.',
    INVALID_FORMAT: 'Formato inválido.',
    TOO_SHORT: 'Muito curto.',
    TOO_LONG: 'Muito longo.',
    INVALID_VALUE: 'Valor inválido.',
  }
  const out: Record<string, string> = {}
  for (const d of e.details as { field: string; reason: string }[]) out[d.field] = reasons[d.reason] ?? 'Valor inválido.'
  return out
}

// Token dos links de e-mail vem no fragmento (#token=...), que não chega a servidores nem logs.
// Lê e apaga da barra de endereço.
export function takeFragmentToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
  if (token) history.replaceState(null, '', window.location.pathname + window.location.search)
  return token
}
