// Valores monetários trafegam e são somados sempre em centavos inteiros (REL-04);
// a conversão para reais acontece só na exibição.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`valor em centavos inválido: ${cents}`)
  }
  return brl.format(cents / 100)
}

// Converte o que a pessoa digitou ("1.234,56", "19,9", "7") em centavos.
// Devolve null para entradas que não são um valor em reais.
export function parseReaisToCents(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null
  const [int = '0', frac = ''] = s.replace(/\./g, '').split(',')
  return Number(int) * 100 + Number(frac.padEnd(2, '0'))
}
