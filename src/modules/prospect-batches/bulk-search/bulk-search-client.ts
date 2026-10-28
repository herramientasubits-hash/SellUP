'use client';

/**
 * Llamadas del navegador a las rutas de la búsqueda masiva (GROWTH-BULK-SEARCH-1).
 * Por ruta y no por server action, igual que las corridas del asistente: una
 * ronda dura hasta 300 s y el navegador no puede quedar en cola detrás de ella.
 *
 * Las respuestas no lanzan: un fallo de red o un 403 vuelve como `ok: false`
 * con su mensaje, para que la pantalla lo diga y el Process Center decida si
 * reintenta.
 */

import type {
  BulkControlResult,
  BulkRoundResponse,
  BulkSearchCreateResult,
} from './bulk-search-engine';
import type { BulkSearchControlAction } from './bulk-search-schema';
import type { BulkSearchView } from './bulk-search-view';

/** Se dispara al crear una: el Process Center empieza a conducirla sin esperar. */
export const BULK_SEARCH_STARTED_EVENT = 'sellup:bulk-search-started';

export type BulkTransportFailure = { ok: false; code: 'NETWORK' | 'FORBIDDEN'; message: string };

const BASE = '/api/prospect-batches/bulk-searches';

async function request<T>(url: string, init?: RequestInit): Promise<T | BulkTransportFailure> {
  try {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
    if (response.status === 403 || response.status === 401) {
      return { ok: false, code: 'FORBIDDEN', message: body?.message ?? 'No tienes acceso a la búsqueda masiva.' };
    }
    if (!body) return { ok: false, code: 'NETWORK', message: 'No se pudo hablar con SellUp. Revisa tu conexión.' };
    return body;
  } catch {
    return { ok: false, code: 'NETWORK', message: 'No se pudo hablar con SellUp. Revisa tu conexión.' };
  }
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function createBulkSearchViaRoute(body: {
  criteria: Record<string, unknown>;
  targetCount: number;
  confirmedCreditCap: number;
  clientRequestId: string;
  label: string;
}): Promise<BulkSearchCreateResult | BulkTransportFailure> {
  return request<BulkSearchCreateResult>(BASE, post(body));
}

export async function listBulkSearchesViaRoute(): Promise<
  { ok: true; searches: BulkSearchView[] } | BulkTransportFailure
> {
  return request<{ ok: true; searches: BulkSearchView[] }>(BASE);
}

export function runBulkSearchRoundViaRoute(id: string): Promise<BulkRoundResponse | BulkTransportFailure> {
  return request<BulkRoundResponse>(`${BASE}/${encodeURIComponent(id)}/round`, post({}));
}

export function controlBulkSearchViaRoute(
  id: string,
  action: BulkSearchControlAction,
): Promise<BulkControlResult | BulkTransportFailure> {
  return request<BulkControlResult>(`${BASE}/${encodeURIComponent(id)}/control`, post({ action }));
}
