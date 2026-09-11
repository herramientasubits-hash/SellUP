/**
 * wizard-lusha-waterfall.ts — ¿corre la pierna Lusha? Decisión PURA.
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 4.
 *
 * Sin Supabase, sin proveedor, sin `process.env`, sin reloj. El servidor
 * resuelve los hechos (bandera, disponibilidad, cuenta de útiles) y esta función
 * decide. Así la política se puede probar sin arrancar nada y no existe una
 * segunda forma de encender la pierna.
 *
 * ── 🔴 El orden de las razones ES la política ────────────────────────────────
 *
 * Se evalúan en este orden, y el orden importa porque cada respuesta gobierna
 * una promesa distinta:
 *
 *   1. bandera apagada      → CERO llamadas a Lusha, pase lo que pase;
 *   2. Apollo no terminal   → sin veredicto de Apollo no hay hueco que calcular;
 *   3. objetivo cubierto    → Lusha no consume NADA si Apollo llegó al objetivo;
 *   4. Lusha no disponible  → su propia puerta (`ENABLE_LUSHA_PREVIEW`) manda;
 *   5. macro sin mapear     → Lusha exige una de las 12 macro industrias;
 *   6. lote canónico ausente → CORTE 5A: sin el lote de la corrida, la pierna
 *      crearía uno SEGUNDO, y una búsqueda de la persona acabaría partida en dos.
 *      Fail-closed: antes que dos lotes, ninguna llamada.
 *
 * Sólo si las seis pasan la pierna corre, y corre con el HUECO: lo que falta,
 * no el objetivo entero.
 */

/** Por qué NO corrió la pierna. Vocabulario cerrado: se registra, no se narra. */
export type LushaWaterfallSkipReason =
  | 'waterfall_flag_disabled'
  | 'apollo_run_not_terminal'
  | 'target_reached'
  | 'lusha_unavailable'
  | 'macro_industry_unmapped'
  | 'canonical_batch_unresolved';

export type LushaWaterfallDecision =
  | { readonly run: false; readonly reason: LushaWaterfallSkipReason }
  | {
      readonly run: true;
      readonly gap: number;
      readonly macroIndustryKey: string;
      /** CORTE 5A — EL lote de la corrida. La pierna escribe dentro de él. */
      readonly canonicalBatchId: string;
    };

export type LushaWaterfallDecisionInput = {
  /** `ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL`, ya resuelta por el servidor. */
  readonly waterfallEnabled: boolean;
  /** `ENABLE_LUSHA_PREVIEW`: la puerta propia de Lusha, que este hito no toca. */
  readonly lushaAvailable: boolean;
  /** ¿Apollo llegó a un veredicto? Una corrida caída no autoriza continuar. */
  readonly apolloTerminal: boolean;
  /** El objetivo único del wizard. */
  readonly target: number;
  /**
   * Empresas ÚTILES acumuladas por todas las piernas anteriores (capa gratuita
   * + Apollo R1 + R2), medidas con la MISMA autoridad de aceptación que decide
   * si la corrida terminó. No es un conteo de filas ni de resultados crudos.
   */
  readonly usefulAccumulated: number;
  /** Una de las 12 macro industrias, o `null` si la publicada no mapea. */
  readonly macroIndustryKey: string | null;
  /**
   * CORTE 5A — `prospect_batches.id` que la corrida del wizard YA reservó.
   *
   * `null` sólo puede significar que la ejecución llegó aquí sin lote, y en ese
   * estado la pierna no debe correr: sin lote canónico la acción de Lusha
   * crearía el suyo y el requisito M —un `wizard_run_id` reconstruye las tres
   * piernas— quedaría roto en silencio.
   */
  readonly canonicalBatchId: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════
// AGENT1-WATERFALL-LEG-FAILURE-REASON-1 — por qué FALLÓ una pierna que SÍ corrió
// ═══════════════════════════════════════════════════════════════════════════
//
// ── 🔴 El defecto que cierra ─────────────────────────────────────────────────
//
// `LushaWaterfallSkipReason` (arriba) explica por qué la pierna NO corrió. No
// existía nada que explicara por qué una pierna que SÍ corrió no dejó nada: la
// acción de Lusha no lanza —devuelve `{ ok: false }`—, así que un bloqueo de
// presupuesto, un lote canónico irresoluble y una caída del proveedor salían
// los tres publicados como `executed: true, skipReason: null,
// persistedCandidates: 0`. Indistinguibles entre sí, e indistinguibles de una
// corrida sana que no encontró nada. Reconstruir la causa exigía volver a
// preguntarle a Lusha, es decir, volver a pagar.
//
// ── 🔴 Qué NO hace ──────────────────────────────────────────────────────────
//
// Es OBSERVACIÓN y nada más. No decide, no cuenta, no acepta, no liquida y no
// cambia si la corrida es terminal. No convierte un error en éxito ni un éxito
// en error: se limita a leer lo que el resultado YA traía.

/**
 * Vocabulario CERRADO. Cuatro códigos, derivados de datos que el resultado ya
 * publica — no de una taxonomía nueva que habría que mantener al día.
 *
 * 🔴 `unclassified_leg_failure` es deliberado y NO es un hueco: un fallo sin
 * causa reconocible tiene que decir «no se pudo clasificar», nunca `null`. Un
 * `null` significaría «no hubo fallo», que es una afirmación distinta y falsa.
 */
export type LushaWaterfallLegFailureCode =
  | 'budget'
  | 'canonical_batch_unresolved'
  | 'provider_error'
  | 'unclassified_leg_failure';

export type LushaWaterfallLegFailure = {
  readonly code: LushaWaterfallLegFailureCode;
  /**
   * La cadena que el propio resultado traía en `error`, acotada. Se transcribe,
   * no se reinterpreta: es lo único que puede decir algo que el código no dice
   * —sobre todo dentro del cajón—. `null` cuando el resultado no traía ninguna.
   */
  readonly reason: string | null;
};

/** Tope de la transcripción: se registra, no se narra. */
export const LUSHA_WATERFALL_LEG_FAILURE_REASON_MAX_LENGTH = 200;

/** `lusha-budget-gate.ts` — los dos códigos de la puerta de presupuesto. */
const BUDGET_FAILURE_ERROR_CODES: ReadonlySet<string> = new Set([
  'lusha_budget_blocked',
  'lusha_budget_unavailable',
]);

/** `lusha-pending-review-actions.ts` — `WATERFALL_BATCH_UNRESOLVED_CODE`. */
const CANONICAL_BATCH_FAILURE_ERROR_CODE = 'waterfall_canonical_batch_unresolved';

/** `lusha-multibranch-execution.ts` — los dos `LushaRunStopReason` de proveedor. */
const PROVIDER_FAILURE_STOP_REASONS: ReadonlySet<string> = new Set([
  'provider_failure',
  'provider_billing_anomaly',
]);

/**
 * Los HECHOS que el clasificador mira, y sólo ésos.
 *
 * 🔴 Estructural a propósito: `PersistLushaPendingReviewResult` encaja sin
 * conversión, y este módulo sigue siendo PURO —sin importar el servidor, sin
 * Supabase y sin proveedor—, que es la condición para poder probarlo sin
 * arrancar nada.
 */
export type LushaWaterfallLegFailureFacts = {
  readonly ok: boolean;
  readonly error?: string | null;
  readonly budgetExceeded?: { readonly reason: string } | null;
  readonly pagesRequested?: number | null;
  readonly stopReason?: string | null;
};

function transcribeFailureReason(error: string | null | undefined): string | null {
  if (typeof error !== 'string') return null;
  const trimmed = error.trim();
  if (trimmed === '') return null;
  return trimmed.slice(0, LUSHA_WATERFALL_LEG_FAILURE_REASON_MAX_LENGTH);
}

/**
 * ¿Por qué falló? `null` ⇒ no falló.
 *
 * 🔴 Manda `ok`, NUNCA `status`. El núcleo devuelve `{ ok: true, status:
 * 'empty' }` cuando la corrida funcionó y no halló nada reutilizable: guiarse
 * por `status` marcaría esa corrida como fallida y le inventaría una causa.
 *
 * 🔴 El orden es el de la CAUSA, no el del síntoma. Presupuesto y lote canónico
 * bloquean ANTES de que salga una sola petición, así que se reconocen primero;
 * `provider_error` exige evidencia de que la corrida llegó a pedir —páginas
 * despachadas o un `stopReason` de proveedor—, porque casi todo fallo lleva
 * `status: 'error'` y colgar el proveedor de ese campo convertiría el cajón en
 * código muerto y le echaría al proveedor culpas que no son suyas.
 */
export function classifyLushaWaterfallLegFailure(
  facts: LushaWaterfallLegFailureFacts,
): LushaWaterfallLegFailure | null {
  if (facts.ok) return null;

  const reason = transcribeFailureReason(facts.error);

  if (
    (facts.budgetExceeded !== null && facts.budgetExceeded !== undefined) ||
    (reason !== null && BUDGET_FAILURE_ERROR_CODES.has(reason))
  ) {
    return { code: 'budget', reason };
  }
  if (reason === CANONICAL_BATCH_FAILURE_ERROR_CODE) {
    return { code: 'canonical_batch_unresolved', reason };
  }
  if (
    (facts.pagesRequested ?? 0) > 0 ||
    (typeof facts.stopReason === 'string' && PROVIDER_FAILURE_STOP_REASONS.has(facts.stopReason))
  ) {
    return { code: 'provider_error', reason };
  }
  return { code: 'unclassified_leg_failure', reason };
}

export function decideLushaWaterfallLeg(
  input: LushaWaterfallDecisionInput,
): LushaWaterfallDecision {
  if (!input.waterfallEnabled) {
    return { run: false, reason: 'waterfall_flag_disabled' };
  }
  if (!input.apolloTerminal) {
    return { run: false, reason: 'apollo_run_not_terminal' };
  }

  // El hueco se calcula sobre la cuenta de útiles, nunca negativo. Un excedente
  // (8 útiles contra un objetivo de 5) cierra igual que un empate.
  const gap = Math.max(0, input.target - Math.max(0, input.usefulAccumulated));
  if (gap === 0) {
    return { run: false, reason: 'target_reached' };
  }

  if (!input.lushaAvailable) {
    return { run: false, reason: 'lusha_unavailable' };
  }
  if (input.macroIndustryKey === null || input.macroIndustryKey.trim() === '') {
    return { run: false, reason: 'macro_industry_unmapped' };
  }
  if (input.canonicalBatchId === null || input.canonicalBatchId.trim() === '') {
    return { run: false, reason: 'canonical_batch_unresolved' };
  }

  return {
    run: true,
    gap,
    macroIndustryKey: input.macroIndustryKey,
    canonicalBatchId: input.canonicalBatchId,
  };
}
