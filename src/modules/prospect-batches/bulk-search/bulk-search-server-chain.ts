import { isBulkRole } from '@/modules/access/capabilities';
import type { ContinueApolloRoundResult } from '@/modules/prospect-batches/apollo-continuation-actions';

/**
 * La búsqueda masiva corre sola en el servidor (dueña 28-10). Puro: después de
 * cada ronda decide si el servidor pide la siguiente y cuándo.
 *
 * El plan de Vercel sólo permite crons diarios, así que no hay un reloj que la
 * empuje: cada ronda, al terminar, pide la siguiente. Un tope de esperas seguidas
 * evita que una búsqueda que no avanza (otra pestaña la conduce, una continuación
 * de Apollo tarda) gaste invocaciones sin fin; en ese caso la retoma el navegador
 * de quien la lanzó, como siempre.
 */

/** Esperas seguidas antes de soltar la búsqueda al navegador (~10 min con 30 s). */
export const SERVER_CHAIN_MAX_CONSECUTIVE_WAITS = 20;
/** Una espera nunca baja de 1 s (no martilla) ni pasa de 30 s (cabe en la función). */
export const SERVER_CHAIN_MIN_DELAY_MS = 1_000;
export const SERVER_CHAIN_MAX_DELAY_MS = 30_000;

export type ServerChainDecision =
  | { kind: 'chain'; delayMs: number; consecutiveWaits: number }
  | { kind: 'stop'; reason: 'done' | 'not_found' | 'too_many_waits' };

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms)) return SERVER_CHAIN_MIN_DELAY_MS;
  return Math.min(SERVER_CHAIN_MAX_DELAY_MS, Math.max(SERVER_CHAIN_MIN_DELAY_MS, Math.round(ms)));
}

/**
 * Lo que la cadena necesita saber de un paso: una ronda (`BulkRoundResponse`) o un
 * tramo de la continuación de Apollo (`continuationStep`).
 */
export type ServerChainStep =
  | { ok: false }
  | { ok: true; next: 'continue' | 'wait' | 'done'; retryAfterMs: number };

/** Tras un fallo de la continuación, como hace el navegador. */
const CONTINUATION_RETRY_AFTER_FAILURE_MS = 30_000;

/**
 * Un tramo de la continuación de Apollo, como paso de la cadena (dueña 28-10). Si
 * avanzó o la corrida cerró, la cadena sigue ya (no cuenta como espera); si la tiene
 * otro (el navegador, el cron) o falló, espera lo que pide.
 */
export function continuationStep(result: ContinueApolloRoundResult): ServerChainStep {
  if (result.status === 'finished' || result.status === 'failed') {
    return { ok: true, next: 'continue', retryAfterMs: 0 };
  }
  if (result.status === 'forbidden') return { ok: false };
  const retryAfterMs = result.retryAfterMs ?? CONTINUATION_RETRY_AFTER_FAILURE_MS;
  const progressed = result.pendingOrganizationCount > 0 && retryAfterMs < CONTINUATION_RETRY_AFTER_FAILURE_MS;
  return progressed ? { ok: true, next: 'continue', retryAfterMs: 0 } : { ok: true, next: 'wait', retryAfterMs };
}

export function decideServerChain(response: ServerChainStep, consecutiveWaits: number): ServerChainDecision {
  if (!response.ok) return { kind: 'stop', reason: 'not_found' };
  if (response.next === 'done') return { kind: 'stop', reason: 'done' };
  // Sin espera: la ronda siguiente arranca ya (el paso nuevo es otra función).
  if (response.next === 'continue') return { kind: 'chain', delayMs: 0, consecutiveWaits: 0 };
  const waits = Math.max(0, consecutiveWaits) + 1;
  if (waits > SERVER_CHAIN_MAX_CONSECUTIVE_WAITS) return { kind: 'stop', reason: 'too_many_waits' };
  return { kind: 'chain', delayMs: clampDelay(response.retryAfterMs), consecutiveWaits: waits };
}

/**
 * Lo que viaja de una ronda a la siguiente: el id, el contador de esperas y cuánto
 * esperar antes de empezar (la espera la hace el paso siguiente, con su propio tiempo).
 */
export interface ServerChainRequest {
  bulkSearchId: string;
  consecutiveWaits: number;
  delayMs: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida el cuerpo de la petición interna; cualquier otra forma se rechaza. */
export function parseServerChainRequest(body: unknown): ServerChainRequest | null {
  if (!body || typeof body !== 'object') return null;
  const { bulkSearchId, consecutiveWaits } = body as Record<string, unknown>;
  if (typeof bulkSearchId !== 'string' || !UUID.test(bulkSearchId)) return null;
  const waits = consecutiveWaits === undefined ? 0 : consecutiveWaits;
  if (typeof waits !== 'number' || !Number.isInteger(waits) || waits < 0 || waits > SERVER_CHAIN_MAX_CONSECUTIVE_WAITS) {
    return null;
  }
  const delay = (body as Record<string, unknown>).delayMs ?? 0;
  if (typeof delay !== 'number' || !Number.isInteger(delay) || delay < 0 || delay > SERVER_CHAIN_MAX_DELAY_MS) return null;
  return { bulkSearchId, consecutiveWaits: waits, delayMs: delay };
}

/** ¿Puede esta persona tener una búsqueda conducida a su nombre? Activa y Growth o admin. */
export function canRunOnBehalfOf(user: { accessStatus: string | null; roleKey: string | null; isAdmin: boolean }): boolean {
  if (user.accessStatus !== 'active') return false;
  if (user.isAdmin) return true;
  return isBulkRole(user.roleKey);
}

/**
 * La dirección propia de SellUp, SÓLO de la configuración del servidor
 * (`NEXT_PUBLIC_APP_URL`, la misma de las conexiones con Google y Slack). Nunca
 * sale del pedido entrante: el secreto no puede viajar a un host elegido por otro.
 * Sin ella (o mal escrita), `null`: no se encadena nada.
 */
export function resolveOwnOrigin(raw: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return url.origin;
  } catch {
    return null;
  }
}
