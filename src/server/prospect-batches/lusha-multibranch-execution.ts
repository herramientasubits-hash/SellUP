/**
 * lusha-multibranch-execution.ts — la política del ejecutor multi-rama: cuánto
 * puede pedir, cuándo para y qué se reporta.
 *
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 §§ 3, 4, 5, 6, 14–19.
 *
 * Vive aparte de `lusha-pending-review` por dos razones concretas: ese módulo ya
 * pasa de 1500 líneas, y —más importante— la política de gasto se puede probar
 * sin montar ni un doble de proveedor ni un doble de escritura. El orquestador se
 * limita a OBEDECER lo que aquí se decide.
 *
 * ── Las tres cifras que acotan el gasto ───────────────────────────────────────
 *
 *   · `targetGap`                — cuántas empresas útiles busca la corrida ENTERA.
 *   · `providerRequestsAllowed`  — cuántas peticiones puede hacer, RAMAS × páginas.
 *   · `maxRawResults`            — cuántas filas crudas puede acumular.
 *
 * Ninguna de las tres se escribe a mano: las tres se derivan de constantes que el
 * runtime ya obedece, para que subir una suba también su consecuencia económica
 * en el mismo commit.
 *
 * ── 🔴 Por qué el techo de peticiones existe si los bucles ya están acotados ───
 *
 * Un `for` de ramas dentro de un `for` de páginas ya da 6 como máximo, así que un
 * contador explícito parece redundante. No lo es: el día que alguien añada un
 * reintento, una segunda pasada o una rama de respaldo, los bucles multiplicarían
 * el gasto en silencio y la reserva —que se calculó ANTES— se quedaría corta. El
 * contador convierte eso en un tope que se ve, se prueba y no se puede rebasar
 * sin que una prueba lo diga.
 *
 * Puro: sin env, sin I/O, sin cliente de proveedor, sin DB, sin reloj.
 */

import {
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
} from './lusha-pending-review-limits';
import { LUSHA_PREVIEW_SIZE } from './lusha-preview';
import {
  LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES,
  type LushaIndustryBranch,
  type LushaMacroSearchPlan,
} from './lusha-macro-search-plan';
import type { LushaIdentityDuplicateReason } from './lusha-run-identity-registry';

// ─── targetGap (§ 3) ──────────────────────────────────────────────────────────

/**
 * Objetivo por defecto de una corrida: el mismo que el ejecutor de hoy persigue.
 *
 * Se re-publica derivado en lugar de escribirse para que la ausencia de
 * `targetGap` sea LITERALMENTE el comportamiento actual, no una réplica que
 * pudiera divergir.
 */
export const LUSHA_DEFAULT_TARGET_GAP = LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES;

/**
 * Objetivo efectivo de la corrida.
 *
 * La razón de que esto sea un parámetro y no la constante: el hueco que Lusha
 * debe cerrar NO siempre es el objetivo del wizard. La arquitectura a la que
 * apunta § 3 es «objetivo 5, las fuentes de país ya trajeron 3, Lusha busca 2».
 * Ese descubrimiento por país no existe todavía y este PR no lo construye; lo que
 * sí hace es que el ejecutor deje de asumir 5 por dentro, porque un ejecutor que
 * asume su objetivo no se puede componer con nada que lo preceda.
 *
 * Fail-safe hacia el comportamiento de hoy: ausente, no numérico, no finito, o
 * fuera de [1, objetivo por defecto] ⇒ el objetivo por defecto. Un `targetGap`
 * mayor que la política de candidatos vigente se recorta en lugar de aceptarse:
 * el hueco puede ser MENOR que el objetivo del producto (eso es su propósito),
 * nunca mayor, o se convertiría en una vía para subir el gasto por parámetro.
 */
export function resolveLushaTargetGap(
  requested: number | null | undefined,
  defaultTargetGap: number = LUSHA_DEFAULT_TARGET_GAP,
): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return defaultTargetGap;
  }
  const truncated = Math.trunc(requested);
  if (truncated < 1) return defaultTargetGap;
  if (truncated > defaultTargetGap) return defaultTargetGap;
  return truncated;
}

// ─── Ramas a ejecutar (§ 5) ───────────────────────────────────────────────────

/**
 * La rama LEGACY: la búsqueda de hoy, cuya industria la deriva el preview del
 * `sectorKey`.
 *
 * Existe para que el orquestador tenga UN solo camino de código. La alternativa
 * —un `if (plan) bucleDeRamas() else búsquedaÚnica()`— duplicaría el conteo de
 * peticiones, el dedupe y la parada por objetivo, y sería justo la clase de
 * duplicación en la que las dos copias dejan de coincidir.
 */
export const LUSHA_LEGACY_SECTOR_BRANCH = null;

export type LushaExecutionBranch = LushaIndustryBranch | typeof LUSHA_LEGACY_SECTOR_BRANCH;

/**
 * Las ramas que la corrida ejecutará, EN ORDEN de catálogo.
 *
 * Secuencial y en orden de catálogo por tres motivos (§ 5): es determinista, la
 * parada por objetivo es la más barata posible —se para antes de pedir la rama
 * siguiente— y ninguna rama de menor prioridad gasta después de que el objetivo
 * ya esté cerrado. En paralelo las tres propiedades se pierden a la vez.
 */
export function resolveLushaExecutionBranches(
  plan: Pick<LushaMacroSearchPlan, 'branches'> | null | undefined,
): readonly LushaExecutionBranch[] {
  const branches = plan?.branches ?? [];
  if (branches.length === 0) return [LUSHA_LEGACY_SECTOR_BRANCH];
  return branches;
}

// ─── Techos de la corrida (§§ 6, 17) ──────────────────────────────────────────

/**
 * Peticiones de búsqueda que la corrida puede hacer, COMO MÁXIMO.
 *
 * ramas × páginas por rama. 1 rama → 2 · 2 ramas → 4 · 3 ramas → 6. Es el MISMO
 * producto del que sale la reserva (`resolveLushaMacroPlanMaxProviderCredits`),
 * y tiene que serlo: si el techo de peticiones y la reserva salieran de dos
 * cuentas distintas, la corrida podría gastar por encima de lo reservado sin
 * ningún defecto aparente.
 */
export function resolveLushaProviderRequestsAllowed(branchCount: number): number {
  const safeBranchCount = Number.isFinite(branchCount)
    ? Math.max(1, Math.min(Math.trunc(branchCount), LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES))
    : 1;
  return safeBranchCount * LUSHA_PENDING_REVIEW_MAX_PAGES;
}

/**
 * Techo de filas crudas que la corrida puede acumular a través de TODAS las ramas.
 *
 * ramas máximas (3) × páginas (2) × tamaño de página (10) = 60, que es el número
 * que el diseño previo perseguía; aquí queda DERIVADO de las tres constantes
 * reales en vez de escrito. Es un tope de ámbito de CORRIDA, no de página: sin él,
 * la acumulación a través de ramas no tendría cota declarada aunque cada petición
 * la tenga.
 */
export const LUSHA_RUN_MAX_RAW_RESULTS =
  LUSHA_MACRO_SEARCH_PLAN_MAX_BRANCHES *
  LUSHA_PENDING_REVIEW_MAX_PAGES *
  LUSHA_PREVIEW_SIZE;

// ─── Decisión de pedir o no (§§ 5, 6, 15, 16, 17) ─────────────────────────────

/** Por qué la corrida dejó de pedir. Distingue las cinco causas de § 19. */
export type LushaRunStopReason =
  | 'target_reached'
  | 'branches_exhausted'
  | 'request_cap_reached'
  | 'raw_scan_cap_reached'
  | 'provider_failure'
  | 'no_results';

export type LushaRequestDecision =
  | { allowed: true }
  | { allowed: false; stopReason: Exclude<LushaRunStopReason, 'branches_exhausted' | 'no_results'> };

/**
 * ¿Puede la corrida hacer UNA petición más?
 *
 * Las tres negativas son independientes y ninguna es redundante: el objetivo
 * puede cerrarse con peticiones de sobra, el techo de peticiones puede agotarse
 * con el objetivo abierto, y el techo de filas crudas puede alcanzarse con las
 * dos cosas todavía en pie.
 */
export function decideLushaProviderRequest(state: {
  remainingGap: number;
  providerRequestsUsed: number;
  providerRequestsAllowed: number;
  rawResultsTotal: number;
  maxRawResults?: number;
}): LushaRequestDecision {
  const maxRawResults = state.maxRawResults ?? LUSHA_RUN_MAX_RAW_RESULTS;
  if (state.remainingGap <= 0) return { allowed: false, stopReason: 'target_reached' };
  if (state.providerRequestsUsed >= state.providerRequestsAllowed) {
    return { allowed: false, stopReason: 'request_cap_reached' };
  }
  if (state.rawResultsTotal >= maxRawResults) {
    return { allowed: false, stopReason: 'raw_scan_cap_reached' };
  }
  return { allowed: true };
}

/**
 * Hueco que queda por cerrar. UN objetivo global, nunca uno por rama (§ 4).
 *
 * `Math.max(0, …)` y no el resto crudo: un hueco negativo se propagaría como
 * «pide de más» a cualquier cuenta que lo multiplique.
 */
export function resolveLushaRemainingGap(targetGap: number, usefulCount: number): number {
  return Math.max(0, targetGap - usefulCount);
}

/**
 * ¿Cabe UNA empresa revisable más dentro del objetivo?
 *
 * 🔴 AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 § 2 — este es el tope que faltaba, y no
 * es el mismo que `decideLushaProviderRequest`.
 *
 * El tope de PETICIONES pregunta «¿pido otra página?» y funcionaba: la corrida de
 * producción paró de pedir en cuanto el objetivo se cerró. Lo que no existía era
 * el tope de ACEPTACIÓN dentro de una página ya pagada: con el objetivo en 5, la
 * rama 0 dejó 4 útiles y la página siguiente aportó 5 revisables — el ejecutor
 * empujó las cinco y persistió NUEVE. El objetivo se rebasó en el último tramo,
 * donde ya no había ninguna petición que frenar.
 *
 * Aceptar exactamente lo que cabe no descarta información: lo que sobra se
 * CUENTA (`target_overflow_discarded`), porque la página ya se pagó y esconder
 * cuánto rindió haría ilegible el rendimiento real de una rama.
 *
 * 🔴 Un sobrante NO es un duplicado ni un descarte del guard: no toca ninguno de
 * los conteos de dedupe.
 */
export function canAcceptLushaUsefulCandidate(
  targetGap: number,
  usefulCount: number,
): boolean {
  return resolveLushaRemainingGap(targetGap, usefulCount) > 0;
}

// ─── Telemetría (§§ 18, 19) ───────────────────────────────────────────────────

/** Cómo terminó UNA rama. */
export type LushaBranchOutcome = 'completed' | 'target_reached' | 'provider_failure' | 'not_attempted';

/**
 * Metadatos seguros de una rama. Sin PII y sin payload del proveedor: ids de
 * industria, conteos y motivos.
 */
export type LushaBranchTelemetry = {
  branchIndex: number;
  /** `null` en la rama legacy: su industria la deriva el preview del sector. */
  mainIndustryId: number | null;
  subIndustryId: number | null;
  pagesAttempted: number;
  providerRequests: number;
  rawResults: number;
  duplicatesRemoved: number;
  uniqueResults: number;
  usefulResults: number;
  remainingGapBefore: number;
  remainingGapAfter: number;
  providerCreditsReported: number | null;
  /**
   * § 3 — empresas de esta rama que el catálogo NO confirmó para la macro pedida.
   * Ni duplicados ni descartes del guard: precisión.
   */
  precisionRejected: number;
  /**
   * § 2 — empresas revisables y precisas que llegaron con el objetivo YA cerrado.
   * La página estaba pagada; se cuentan para no perder el rendimiento real.
   */
  targetOverflowDiscarded: number;
  outcome: LushaBranchOutcome;
};

/** Metadatos seguros de la corrida entera. */
export type LushaRunTelemetry = {
  /** `null` cuando la corrida no ejecutó un plan (ruta legacy de un sector). */
  macroKey: string | null;
  targetGap: number;
  branchCountPlanned: number;
  branchCountAttempted: number;
  providerRequestsAllowed: number;
  providerRequestsUsed: number;
  /**
   * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17/20 — páginas que NO se
   * compraron porque su rama ya había demostrado no tener novedad.
   *
   * 🔴 Es un HECHO OBSERVADO, no un ahorro. Dice cuántas peticiones dejaron de
   * emitirse, jamás cuántos créditos o dólares se habrían gastado: eso exigiría
   * un contrafactual que nadie calculó (§ 20).
   */
  pagesSkippedZeroNovelty: number;
  maxRawResults: number;
  rawResultsTotal: number;
  crossBranchDuplicatesRemoved: number;
  duplicateReasonCounts: Record<LushaIdentityDuplicateReason, number>;
  uniqueResultsTotal: number;
  usefulResultsTotal: number;
  /**
   * § 2 — revisables (no duplicados exactos) que ADEMÁS pasaron la precisión de
   * macro. Es `accepted + overflow`, y por tanto puede superar `targetGap`.
   */
  reviewableFoundTotal: number;
  /** Cuántas de esas se aceptaron. Invariante: `<= targetGap`, SIEMPRE. */
  acceptedForTargetTotal: number;
  /** Cuántas se descartaron por sobrepasar el objetivo. */
  targetOverflowDiscarded: number;
  /** Cuántas empresas revisables no probaron pertenecer a la macro pedida. */
  precisionRejectedTotal: number;
  /** Desglose por motivo del veredicto de precisión. Sin PII. */
  precisionReasonCounts: Record<string, number>;
  remainingGapFinal: number;
  creditsReserved: number | null;
  creditsReportedActual: number | null;
  stopReason: LushaRunStopReason;
  branches: readonly LushaBranchTelemetry[];
};

/** Vista serializable para `metadata`. snake_case, como el resto del lote. */
export function toLushaRunTelemetryMetadata(
  telemetry: LushaRunTelemetry,
): Record<string, unknown> {
  return {
    macro_key: telemetry.macroKey,
    target_gap: telemetry.targetGap,
    branch_count_planned: telemetry.branchCountPlanned,
    branch_count_attempted: telemetry.branchCountAttempted,
    provider_requests_allowed: telemetry.providerRequestsAllowed,
    provider_requests_used: telemetry.providerRequestsUsed,
    pages_skipped_zero_novelty: telemetry.pagesSkippedZeroNovelty,
    max_raw_results: telemetry.maxRawResults,
    raw_results_total: telemetry.rawResultsTotal,
    cross_branch_duplicates_removed: telemetry.crossBranchDuplicatesRemoved,
    duplicate_reason_counts: { ...telemetry.duplicateReasonCounts },
    unique_results_total: telemetry.uniqueResultsTotal,
    useful_results_total: telemetry.usefulResultsTotal,
    reviewable_found_total: telemetry.reviewableFoundTotal,
    accepted_for_target_total: telemetry.acceptedForTargetTotal,
    target_overflow_discarded: telemetry.targetOverflowDiscarded,
    precision_rejected_total: telemetry.precisionRejectedTotal,
    precision_reason_counts: { ...telemetry.precisionReasonCounts },
    remaining_gap_final: telemetry.remainingGapFinal,
    credits_reserved: telemetry.creditsReserved,
    credits_reported_actual: telemetry.creditsReportedActual,
    stop_reason: telemetry.stopReason,
    branches: telemetry.branches.map((branch) => ({
      branch_index: branch.branchIndex,
      main_industry_id: branch.mainIndustryId,
      sub_industry_id: branch.subIndustryId,
      pages_attempted: branch.pagesAttempted,
      provider_requests: branch.providerRequests,
      raw_results: branch.rawResults,
      duplicates_removed: branch.duplicatesRemoved,
      unique_results: branch.uniqueResults,
      useful_results: branch.usefulResults,
      remaining_gap_before: branch.remainingGapBefore,
      remaining_gap_after: branch.remainingGapAfter,
      provider_credits_reported: branch.providerCreditsReported,
      precision_rejected: branch.precisionRejected,
      target_overflow_discarded: branch.targetOverflowDiscarded,
      outcome: branch.outcome,
    })),
  };
}
