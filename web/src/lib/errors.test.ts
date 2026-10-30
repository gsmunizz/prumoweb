import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { errorMessage, fieldErrors } from './errors'

describe('errorMessage', () => {
  it('traduz códigos conhecidos e cai num texto genérico', () => {
    expect(errorMessage(new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'x' }))).toMatch(/incorretos/)
    expect(errorMessage(new ApiError(500, { code: 'INTERNAL', message: 'x' }))).toMatch(/Algo deu errado/)
  })
  it('trata falha de rede como falta de conexão', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toMatch(/Sem conexão/)
  })
})

describe('fieldErrors', () => {
  it('mapeia os campos do 422', () => {
    const e = new ApiError(422, {
      code: 'VALIDATION_FAILED',
      message: 'x',
      details: [{ field: 'email', reason: 'INVALID_FORMAT' }],
    })
    expect(fieldErrors(e)).toEqual({ email: 'Formato inválido.' })
  })
})
