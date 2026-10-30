import { describe, expect, it } from 'vitest'
import { snapshotId, uuidV5 } from './ids'

describe('uuidV5', () => {
  it('bate com o vetor conhecido do RFC (namespace DNS, "www.example.com")', async () => {
    expect(await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })
})

describe('snapshotId', () => {
  it('é determinístico e muda com o dia', async () => {
    const inv = '11111111-1111-4111-8111-111111111111'
    // Valor calculado pela API (syncer.SnapshotID): os dois lados têm de concordar.
    expect(await snapshotId(inv, '2026-10-30')).toBe('48d1c5fc-cbc3-5636-a1e2-a53aa229a22f')
    expect(await snapshotId(inv, '2026-10-30')).toBe(await snapshotId(inv, '2026-10-30'))
    expect(await snapshotId(inv, '2026-10-30')).not.toBe(await snapshotId(inv, '2026-10-31'))
  })
})
