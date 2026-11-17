/** La búsqueda en todo SellUp desde el navegador, por `/api/search/records` (no por acciones). */

import type { SellUpRecordsResult } from './types';

export async function fetchSellUpRecords(q: string, signal?: AbortSignal): Promise<SellUpRecordsResult> {
  const res = await fetch(`/api/search/records?${new URLSearchParams({ q }).toString()}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`búsqueda en SellUp: HTTP ${res.status}`);
  return (await res.json()) as SellUpRecordsResult;
}
