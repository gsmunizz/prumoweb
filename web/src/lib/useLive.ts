import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'

// Resultado de uma consulta ao IndexedDB que se atualiza sozinho quando os dados mudam
// (inclusive quando o sync traz registros de outro aparelho). undefined enquanto carrega.
export function useLive<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => undefined })
    return () => sub.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
