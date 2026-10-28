import 'server-only';
import { resolveOwnOrigin, type ServerChainRequest } from './bulk-search-server-chain';

/** La ruta interna que corre una ronda en el servidor (excluida del proxy, con CRON_SECRET). */
export const BULK_SEARCH_SERVER_ROUND_PATH = '/api/cron/bulk-search-rounds';

/** Lo bastante para que la ruta acepte el pedido (responde 202 antes de trabajar). */
const KICK_TIMEOUT_MS = 10_000;

/**
 * Pide al servidor la siguiente ronda. Nunca lanza: si falla, la búsqueda queda
 * como estaba y la retoma el navegador de quien la lanzó al volver a SellUp.
 */
export async function kickServerRound(request: ServerChainRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  const origin = resolveOwnOrigin();
  if (!secret || !origin) {
    console.warn('[BulkSearchServerRunner] sin CRON_SECRET o NEXT_PUBLIC_APP_URL: la búsqueda sigue con el navegador.');
    return false;
  }
  try {
    const response = await fetch(new URL(BULK_SEARCH_SERVER_ROUND_PATH, origin), {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
      // Una redirección llevaría el secreto a otro sitio: se corta.
      redirect: 'error',
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    return response.status === 202;
  } catch (error) {
    console.error('[BulkSearchServerRunner] no se pudo pedir la siguiente ronda', request.bulkSearchId, error instanceof Error ? error.message : error);
    return false;
  }
}
