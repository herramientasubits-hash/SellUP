/**
 * AGENT1-TAVILY-FIRST-1 — Tavily primero; Apollo → Lusha sólo para lo que falte
 * (puro).
 *
 * Decisión de la dueña (01-10): Tavily es gratis (1.000 créditos al mes), así que
 * va primero en toda corrida del modo automático. Opción C: la corrida termina
 * con Tavily si deja al menos tantas empresas PARA REVISAR (no duplicadas ni
 * descartadas) como el objetivo; si no, Apollo completa en la misma corrida y,
 * detrás, Lusha como siempre.
 *
 * Por qué «para revisar» y no «aceptadas»: el tamaño de una empresa de Tavily
 * lo completa Claude DESPUÉS de la corrida (rescate en `after()`), así que al
 * decidir casi ninguna cuenta todavía como aceptada. Decidir por aceptadas
 * llamaría siempre a Apollo y Tavily sólo sumaría costo de Claude. El conteo de
 * `accepted_for_target` no cambia: sigue diciendo la verdad medida.
 *
 * Nunca falla una corrida: cualquier tropiezo de Tavily ⇒ Apollo como siempre.
 * Sin reglas propias: Tavily se rige por su configuración en Proveedores
 * (AGENT1-TAVILY-PROVIDER-CONFIG-1), como Apollo y Lusha.
 */

/**
 * Rondas del tramo de Tavily. Prod 01-10 (CL×Salud, 34eeac5a): con 2 rondas la
 * corrida entera tardó 47 s; hay tiempo para una tercera.
 */
export const TAVILY_FIRST_MAX_ROUNDS = 3;

// ── AGENT1-TAVILY-FIRST-2 — tiempos dentro de los 300 s de Vercel ─────────────
//
// Prod 01-10 (34eeac5a): Tavily dejó 9 para revisar y la corrida terminó sin
// Apollo; DESPUÉS Claude descartó 5 y el vendedor recibió 4. Ahora Claude revisa
// dentro de la corrida y la decisión se toma con lo que sobrevive.

/** Ventana máxima para que Claude EMPIECE empresas nuevas dentro de la corrida. */
export const TAVILY_FIRST_RESCUE_WINDOW_MS = 60_000;
/** Por debajo de esto no vale la pena empezar a revisar. */
export const TAVILY_FIRST_MIN_RESCUE_WINDOW_MS = 15_000;
/**
 * Apollo sólo empieza si no han pasado más de esto desde el inicio de la acción:
 * su presupuesto de evaluación es de 150 s y la función muere a los 300 s.
 */
export const TAVILY_FIRST_APOLLO_START_LIMIT_MS = 140_000;
/** Lusha, detrás de Apollo, sólo empieza si queda margen. */
export const TAVILY_FIRST_LUSHA_START_LIMIT_MS = 200_000;

/** Ventana para Claude, o `null` si ya no hay tiempo para empezar. */
export function resolveInlineRescueWindowMs(elapsedMs: number): number | null {
  const window = Math.min(TAVILY_FIRST_RESCUE_WINDOW_MS, TAVILY_FIRST_APOLLO_START_LIMIT_MS - elapsedMs);
  return window >= TAVILY_FIRST_MIN_RESCUE_WINDOW_MS ? window : null;
}

/**
 * AGENT1-FREE-LAYER-RESCUE-FIRST-1 — ventana del rescate de las sin web del buscador
 * gratuito, ANTES de Tavily. Corta (45 s) y nunca se come el tiempo de lo que viene:
 * deja al menos 60 s antes del límite de arranque de Apollo para Tavily y su revisión.
 */
export const FREE_LAYER_RESCUE_WINDOW_MS = 45_000;
export const FREE_LAYER_RESCUE_RESERVE_MS = 60_000;

export function resolveFreeLayerRescueWindowMs(elapsedMs: number): number | null {
  const window = Math.min(FREE_LAYER_RESCUE_WINDOW_MS, TAVILY_FIRST_APOLLO_START_LIMIT_MS - FREE_LAYER_RESCUE_RESERVE_MS - elapsedMs);
  return window >= TAVILY_FIRST_MIN_RESCUE_WINDOW_MS ? window : null;
}

export function canStartApolloAfterTavilyFirst(elapsedMs: number): boolean {
  return elapsedMs <= TAVILY_FIRST_APOLLO_START_LIMIT_MS;
}

export function canStartLushaAfterTavilyFirst(elapsedMs: number): boolean {
  return elapsedMs <= TAVILY_FIRST_LUSHA_START_LIMIT_MS;
}

export type TavilyFirstSkipReason =
  /** La cuota de Tavily en Proveedores no alcanza (la maneja la dueña a mano). */
  | 'provider_quota_exhausted'
  | 'tavily_not_configured';

export type TavilyFirstOutcome =
  /** Tavily dejó suficientes para revisar (tras Claude, si alcanzó a revisar): Apollo y Lusha no corrieron. */
  | { outcome: 'satisfied'; reviewable: number; reviewableBeforeClaude: number; claudeReviewed: boolean; target: number; acceptedAfterClaude?: number | null; acceptedInLot?: number | null }
  /** Tavily dejó pocas: Apollo completó en la misma corrida. */
  | { outcome: 'apollo_completed'; reviewable: number | null; reviewableBeforeClaude: number | null; claudeReviewed: boolean; target: number; acceptedAfterClaude?: number | null; acceptedInLot?: number | null }
  /** Tras Claude quedaron pocas y ya no había tiempo para Apollo: se entrega lo que hay. */
  | { outcome: 'short_no_time'; reviewable: number; reviewableBeforeClaude: number; claudeReviewed: true; target: number; acceptedAfterClaude?: number | null; acceptedInLot?: number | null }
  /** Tavily no corrió; la corrida fue Apollo como siempre. */
  | { outcome: 'skipped'; skipReason: TavilyFirstSkipReason }
  /**
   * AGENT1-TAVILY-FIRST-4 — Tavily dejó pocas pero el lote no se pudo reabrir
   * para Apollo: se entrega lo de Tavily (Apollo no corre ni gasta).
   */
  | { outcome: 'batch_reopen_failed'; reviewable: number | null; reviewableBeforeClaude: number | null; claudeReviewed: boolean; target: number; acceptedAfterClaude?: number | null; acceptedInLot?: number | null }
  /**
   * AGENT1-DELIVERY-CAP-HARD-1 — Tavily (y Claude) dejaron pocas que CUENTAN pero el
   * lote ya llegó al tope de entrega (máximo 10 por búsqueda): Apollo y Lusha no
   * corren ni gastan, porque nada de lo que trajeran cabría en el lote.
   */
  | { outcome: 'lot_at_delivery_cap'; reviewable: number | null; reviewableBeforeClaude: number | null; claudeReviewed: boolean; target: number; lotReviewable: number; deliveryCap: number; acceptedAfterClaude?: number | null; acceptedInLot?: number | null }
  /** Tavily falló a mitad; la corrida siguió con Apollo. */
  | { outcome: 'failed' };

/**
 * AGENT1-DELIVERY-CAP-HARD-1 — ¿el lote ya está en el tope de entrega? Sin tope o
 * sin conteo ⇒ no (se sigue como siempre).
 */
export function isLotAtDeliveryCap(lotReviewable: number | null, deliveryCap: number | null): boolean {
  if (lotReviewable === null || deliveryCap === null) return false;
  return lotReviewable >= deliveryCap;
}

export function resolveTavilyFirstPrecheck(input: {
  tavilyConfigured: boolean;
  quota: { status: 'available' | 'blocked' } | null;
}): TavilyFirstSkipReason | null {
  if (!input.tavilyConfigured) return 'tavily_not_configured';
  // `null` = no se pudo leer: no bloquea, como no bloquea un proveedor sin cuota configurada.
  if (input.quota?.status === 'blocked') return 'provider_quota_exhausted';
  return null;
}

/** ¿Basta lo que dejó Tavily? `null` (no se pudo contar) ⇒ no basta: Apollo completa. */
/**
 * AGENT1-TAVILY-FIRST-4 — lo revisable que aportó TAVILY: el conteo del lote
 * menos lo que ya estaba antes del tramo (capa gratuita y banco de empresas,
 * que escriben en el mismo lote). Sin esto, filas ajenas daban por «satisfecha»
 * la corrida sin que Tavily aportara nada.
 */
export function tavilyOwnReviewable(lotReviewable: number | null, preExisting: number): number | null {
  if (lotReviewable === null) return null;
  return Math.max(0, lotReviewable - Math.max(0, preExisting));
}

export function isTavilyFirstSatisfied(reviewable: number | null, target: number): boolean {
  return reviewable !== null && reviewable >= target;
}

/**
 * AGENT1-TAVILY-FIRST-5 — ¿Tavily cierra la corrida?
 *
 * Prod 02-10 (PE×Energía 2fc07f4a; BO 26c12524): con Claude ya revisando dentro
 * de la corrida, «para revisar» dejó pasar portales y gremios: 5 para revisar y
 * 1 que cuenta (Perú), 8 y 0 (Bolivia), y Apollo no corrió. Cuando Claude revisó
 * y se pudo medir, decide lo que CUENTA para la meta; si no, lo revisable, como
 * antes (sin revisión casi nada cuenta todavía).
 */
export function isTavilyFirstClosing(input: {
  reviewable: number | null;
  acceptedAfterClaude: number | null;
  claudeReviewed: boolean;
  target: number;
  /**
   * AGENT1-TAVILY-FIRST-6 — aceptadas del LOTE ENTERO (banco, capa gratuita y
   * Tavily) recontadas tras Claude, contra el objetivo PEDIDO. Prod 05-10
   * (CL×Salud 0f60a313): 3 del banco + 3 de Tavily cerraban la meta, pero el banco
   * aún no contaba al decidir y la corrida pagó Apollo y «Claude busca empresas».
   */
  acceptedInLot?: number | null;
  requestedTarget?: number;
}): boolean {
  if (
    input.claudeReviewed &&
    input.acceptedInLot != null &&
    input.requestedTarget !== undefined &&
    input.acceptedInLot >= input.requestedTarget
  ) {
    return true;
  }
  if (input.claudeReviewed && input.acceptedAfterClaude !== null) {
    return input.acceptedAfterClaude >= input.target;
  }
  return isTavilyFirstSatisfied(input.reviewable, input.target);
}

/**
 * AGENT1-TAVILY-FIRST-6 — ¿revisar con Claude dentro de la corrida? Si lo de
 * Tavily basta para el hueco, o si el LOTE entero (banco + capa gratuita + Tavily)
 * tiene revisables suficientes para el objetivo pedido: la misma pasada revisa
 * las del banco, que de otro modo sólo contaban después de la corrida.
 */
export function shouldReviewTavilyFirstInline(input: {
  tavilyOwnReviewable: number | null;
  target: number;
  lotReviewable: number | null;
  requestedTarget: number;
}): boolean {
  if (isTavilyFirstSatisfied(input.tavilyOwnReviewable, input.target)) return true;
  return input.lotReviewable !== null && input.lotReviewable >= input.requestedTarget;
}

export type WriterTruthLike = {
  completeValidCandidates: number | null | undefined;
  persistedCandidates: number;
  acceptedIdentities?: readonly string[];
};

/**
 * La verdad del escritor de los dos tramos de pago (Tavily + Apollo) sumada.
 * `null` en cualquiera de los dos ⇒ `null` (no medido): sumar un no-medido a un
 * medido sería inventar una cifra.
 */
export function combineWriterTruths(a: WriterTruthLike, b: WriterTruthLike | null): WriterTruthLike {
  if (!b) return a;
  const complete =
    a.completeValidCandidates == null || b.completeValidCandidates == null
      ? null
      : a.completeValidCandidates + b.completeValidCandidates;
  const identities = [...(a.acceptedIdentities ?? []), ...(b.acceptedIdentities ?? [])];
  return {
    completeValidCandidates: complete,
    persistedCandidates: a.persistedCandidates + b.persistedCandidates,
    ...(identities.length > 0 ? { acceptedIdentities: identities } : {}),
  };
}

/**
 * AGENT1-TAVILY-FIRST-3 — la verdad del tramo de Tavily tras la revisión de Claude.
 *
 * El writer mide las aceptadas al escribir; Claude completa tamaños DESPUÉS
 * (dentro de la corrida). Prod 02-10 (97c86cf7): el lote decía 0 aunque Veolia ya
 * contaba. `ids` = filas de Tavily que cuentan en la base tras la revisión; `null`
 * (no revisó o no se pudo leer) ⇒ se queda lo medido por el writer.
 */
export function withRecountedAcceptance(truth: WriterTruthLike, ids: readonly string[] | null): WriterTruthLike {
  if (ids === null) return truth;
  return {
    ...truth,
    completeValidCandidates: ids.length,
    acceptedIdentities: ids.map((id) => `candidate:${id}`),
  };
}

// ── AGENT1-TAVILY-FIRST-4 — reabrir el lote antes de Apollo ───────────────────
//
// Prod 02-10 (PE×Energía, c530fef3): el escritor de Tavily deja el lote en
// `ready_for_review` y el de Apollo sólo escribe en lotes `draft`/`generating`
// (`BATCH_INCOMPATIBLE_STATUS`) ⇒ la corrida terminaba en GENERATION_FAILED
// después de pagar Apollo. Antes de que Apollo complete, el lote vuelve a
// `generating`; el escritor de Apollo lo deja otra vez en `ready_for_review`.

/** Lo mínimo del cliente Supabase que usa la reapertura (inyectable en pruebas). */
export type ReopenBatchClient = {
  from(table: 'prospect_batches'): {
    update(values: { status: 'generating' }): {
      eq(column: 'id', value: string): {
        eq(column: 'status', value: 'ready_for_review'): PromiseLike<{ error: unknown }>;
      };
    };
  };
};

/**
 * Devuelve el lote a `generating` SÓLO si Tavily lo dejó en `ready_for_review`
 * (cualquier otro estado queda intacto: 0 filas no es error). `false` = la
 * escritura falló y Apollo no debe correr.
 */
export async function reopenBatchForApolloAfterTavilyFirst(
  client: ReopenBatchClient,
  batchId: string,
): Promise<boolean> {
  try {
    const { error } = await client
      .from('prospect_batches')
      .update({ status: 'generating' })
      .eq('id', batchId)
      .eq('status', 'ready_for_review');
    return !error;
  } catch {
    return false;
  }
}
