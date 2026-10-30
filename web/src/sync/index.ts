import { useSyncExternalStore } from 'react'
import { db, wipeLocalData } from '../db'
import type { EntityName, SyncedRecord } from '../db/types'
import { getSession, restoreSession, subscribeSession } from '../lib/session'
import { SyncEngine } from './engine'

// Instância única do app e o agendamento dos ciclos de sync.
export const engine = new SyncEngine()

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error'
  pending: number
  lastSyncedAt: string | null
  // true quando a última tentativa falhou por falta de rede
  offline: boolean
}

let status: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null, offline: false }
const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach((l) => l())
}

export const getSyncStatus = () => status
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    getSyncStatus,
  )

async function refreshCounters() {
  setStatus({ pending: await engine.pendingCount(), lastSyncedAt: await engine.lastSyncedAt() })
}

let timer: ReturnType<typeof setTimeout> | undefined
let failures = 0

// Pede um ciclo de sync; vários pedidos seguidos viram um só (espera `delay` ms).
export function requestSync(delay = 1500): void {
  clearTimeout(timer)
  timer = setTimeout(() => void run(), delay)
}

async function run() {
  let session = getSession()
  // Abriu sem rede: ao voltar a conexão, confirma a sessão (e obtém o token) antes de sincronizar.
  if (session.status === 'authenticated' && session.offline) {
    await restoreSession().catch(() => undefined)
    session = getSession()
  }
  if (session.status !== 'authenticated' || session.offline) return
  setStatus({ state: 'syncing' })
  try {
    await engine.sync()
    failures = 0
    setStatus({ state: 'idle', offline: false })
  } catch (e) {
    failures++
    setStatus({ state: 'error', offline: e instanceof TypeError })
    // Tenta de novo com espera crescente (até 5 min); o evento "online" tenta antes.
    requestSync(Math.min(5 * 60_000, 5_000 * 2 ** (failures - 1)))
  }
  await refreshCounters()
}

// Grava no IndexedDB e agenda o envio. É por aqui que a interface escreve dados.
export async function saveRecord<T extends SyncedRecord>(entity: EntityName, record: T): Promise<void> {
  await engine.write(entity, record)
  await refreshCounters()
  requestSync()
}

export async function deleteRecord(entity: EntityName, id: string): Promise<void> {
  await engine.remove(entity, id)
  await refreshCounters()
  requestSync()
}

let started = false
let interval: ReturnType<typeof setInterval> | undefined

// Liga o sync enquanto houver sessão. Troca de usuário apaga o banco local antes (SYN-10).
export function startSync(): void {
  if (started) return
  started = true

  const onSession = async () => {
    const s = getSession()
    if (s.status !== 'authenticated') return
    const owner = (await db.meta.get('user_id'))?.value
    if (owner && owner !== s.user.id) await wipeLocalData()
    await db.meta.put({ key: 'user_id', value: s.user.id })
    await refreshCounters()
    requestSync(0)
  }
  subscribeSession(() => void onSession())
  void onSession()

  window.addEventListener('online', () => requestSync(0))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(0)
  })
  interval = setInterval(() => requestSync(0), 60_000)
}

export function stopSync(): void {
  clearTimeout(timer)
  clearInterval(interval)
  started = false
}

