import type { ISODate, UUID } from '../db/types'

// Namespace dos ids de snapshot; idêntico ao da API (syncer.SnapshotNamespace, INV-21).
const SNAPSHOT_NAMESPACE = '7d1c5b2e-4f3a-4a6b-9c8d-0e1f2a3b4c5d'

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

// UUID v5 (SHA-1) de um nome dentro de um namespace, como em RFC 4122.
export async function uuidV5(name: string, namespace: string): Promise<UUID> {
  const ns = uuidBytes(namespace)
  const nm = new TextEncoder().encode(name)
  const input = new Uint8Array(ns.length + nm.length)
  input.set(ns)
  input.set(nm, ns.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const h = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Um snapshot por ativo por dia: o id é derivado, então dois aparelhos que lançam o mesmo
// dia convergem para o mesmo registro em vez de duplicar.
export const snapshotId = (investmentId: UUID, date: ISODate) => uuidV5(`${investmentId}:${date}`, SNAPSHOT_NAMESPACE)
