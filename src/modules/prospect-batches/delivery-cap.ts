/**
 * delivery-cap.ts — cuántas empresas ve UN vendedor por corrida.
 *
 * AGENT1-DELIVERY-CAP-1. Decisión de la dueña (2026-10-01, «opción B»).
 *
 * ── El problema ───────────────────────────────────────────────────────────────
 *
 * X6.13 entendió el objetivo como MÍNIMO y retiró el cupo de escritura: «ocho
 * válidas con objetivo cinco valen ocho». Correcto para lo VÁLIDO, pero dejó una
 * puerta abierta: se persiste y se entrega TODO lo elegible, también lo
 * incompleto. Medido en Producción (30-09 / 01-10): México × Tecnología dejó
 * **154** filas para un objetivo de 5 (0 aceptadas), Apollo en Perú dejó 32–35,
 * Colombia 60. Cada fila persistida reclama la empresa para ese vendedor
 * («una empresa, un vendedor»), así que una corrida acapara cientos de empresas
 * que nadie va a revisar y que los demás vendedores ya no pueden recibir.
 *
 * ── La regla ──────────────────────────────────────────────────────────────────
 *
 *   · Un vendedor recibe como MÁXIMO `AGENT1_MAX_DELIVERED_CANDIDATES` empresas
 *     por escritura (recomendado: 10).
 *   · Lo que entra va COMPLETAS PRIMERO: si hay más completas que el tope, se
 *     recortan completas —nunca una incompleta desplaza a una completa—.
 *   · Lo que no cabe NO se persiste y, por tanto, NO se reclama: queda libre para
 *     otro vendedor. Se cuenta (`capped_count`) y se declara en la metadata.
 *   · El tope NUNCA baja del objetivo: un valor menor que el objetivo es una
 *     configuración inválida y se ignora (sin tope), porque recortaría por debajo
 *     de lo que la corrida promete buscar.
 *   · Sin la variable, nada cambia (byte por byte el comportamiento de X6.13).
 *
 * Este módulo es la ÚNICA autoridad del valor. Puro: el entorno entra por
 * parámetro.
 */

import { WIZARD_TARGET_USEFUL_COMPANIES } from './wizard-target-authority';

/** El nombre de la variable de entorno (Vercel). Ausente ⇒ sin tope. */
export const DELIVERY_CAP_ENV_VAR = 'AGENT1_MAX_DELIVERED_CANDIDATES';

/** Techo de cordura: un valor mayor es un error de configuración, no una intención. */
export const DELIVERY_CAP_SANITY_MAX = 50;

/**
 * El tope vigente, o `null` si no hay (todo se entrega, como antes).
 *
 * Fail-closed hacia «sin tope»: un valor ausente, no entero, menor que el objetivo
 * o mayor que el techo de cordura NO recorta. Equivocarse hacia recortar perdería
 * empresas válidas en silencio; equivocarse hacia no recortar sólo mantiene el
 * comportamiento actual.
 */
export function resolveMaxDeliveredCandidates(
  env: Record<string, string | undefined> = process.env,
  target: number = WIZARD_TARGET_USEFUL_COMPANIES,
): number | null {
  const raw = env[DELIVERY_CAP_ENV_VAR];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(value)) return null;
  if (value < target || value > DELIVERY_CAP_SANITY_MAX) return null;
  return value;
}

export type DeliveryCapResult<T> = {
  /** Lo que se entrega, en el ORDEN ORIGINAL de la entrada. */
  delivered: T[];
  /** Lo que no cabe. En el orden original. */
  capped: T[];
  /** `true` cuando el tope recortó algo. */
  applied: boolean;
};

/**
 * Reparte `items` entre entregado y recortado.
 *
 * Con `cap === null`, o con `items.length <= cap`, no toca nada: devuelve la
 * MISMA lista (mismo orden) y `applied: false`.
 *
 * Con recorte: se eligen primero las completas (en su orden) y, si sobra sitio,
 * las demás (en su orden); la lista entregada conserva el orden original para que
 * todo lo que se calcule aguas abajo sea determinista.
 */
export function applyDeliveryCap<T>(
  items: readonly T[],
  cap: number | null,
  isComplete: (item: T) => boolean,
): DeliveryCapResult<T> {
  if (cap === null || !Number.isFinite(cap) || cap < 0 || items.length <= cap) {
    return { delivered: [...items], capped: [], applied: false };
  }
  const limit = Math.trunc(cap);
  const complete: number[] = [];
  const rest: number[] = [];
  items.forEach((item, index) => (isComplete(item) ? complete : rest).push(index));
  const keep = new Set<number>([...complete, ...rest].slice(0, limit));
  const delivered: T[] = [];
  const capped: T[] = [];
  items.forEach((item, index) => (keep.has(index) ? delivered : capped).push(item));
  return { delivered, capped, applied: true };
}

/**
 * AGENT1-COMPANY-BANK-FIRST-1 — el tope es por VENDEDOR y por búsqueda, no por
 * escritor: lo que el lote ya contiene (el banco, la capa gratuita, otra pierna)
 * se descuenta.
 *
 * AGENT1-DELIVERY-CAP-HARD-1 — regla de la dueña (07-10-2026): «mínimo debe traer
 * 5 prospectos y máximo 10; el resto va al banco». El tope es DURO: ninguna
 * pierna escribe por encima de él, ni siquiera para cerrar su objetivo. Antes un
 * «piso» (el objetivo de quien escribe) podía superarlo y en Prod hubo búsquedas
 * con 27 empresas en revisión. Lo que no cabe sale como recortado y va al banco.
 *
 * `cap === null` ⇒ sin tope (igual que antes).
 */
export function resolveEffectiveDeliveryCap(input: { cap: number | null; alreadyDelivered: number }): number | null {
  if (input.cap === null || !Number.isFinite(input.cap)) return null;
  const already = Number.isFinite(input.alreadyDelivered) ? Math.max(0, Math.trunc(input.alreadyDelivered)) : 0;
  return Math.max(Math.trunc(input.cap) - already, 0);
}
