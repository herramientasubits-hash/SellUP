/**
 * AGENT1-SUPPLIER-SEARCH-1 — «Proveedores de una empresa», Fase 1 (puro; dependencias inyectadas).
 *
 * La persona escribe una empresa de referencia (p. ej. «Ecopetrol»), un país y una
 * industria. Claude busca en la web empresas de esa industria con evidencia pública de
 * que le venden (casos de éxito, «nuestros clientes»…) y las escribe en el lote de la
 * corrida con el escritor de siempre: sitio, duplicados SellUp/HubSpot (sólo lectura),
 * número fiscal oficial, país, sector, tamaño y «una empresa, un vendedor».
 *
 * Camino propio y corto a propósito:
 *  - NO corre la capa gratuita, el banco, Tavily, Apollo ni Lusha: ninguno sabe buscar
 *    «quién le vende a X». Por eso tampoco reserva del presupuesto del piloto; Claude
 *    se rige por su cuota de Proveedores (`checkProviderQuotaAvailable('anthropic')`).
 *  - La industria es OBLIGATORIA: así todas las compuertas por industria funcionan como
 *    siempre y lo que no encaja lo reasigna o descarta el rescate de Claude.
 *  - Lo que no cabe en los 10 no va al banco de empresas (un proveedor de X no es un
 *    candidato general del país × industria).
 *  - Nada se aprueba solo. 0 escrituras en HubSpot.
 */

import type { ClaudeSearchLegOutcome } from './wizard-claude-search-leg';
import { claudeLegWriterTruth, CLAUDE_SEARCH_LEG_TAIL_MS, WIZARD_FUNCTION_LIMIT_MS } from './wizard-claude-search-leg';
import type { WizardExecutionActionResult } from './wizard-execution-types';
import {
  buildCompetitorNoNewBreakdown,
  combineCompetitorRounds,
  type CompetitorBatchOutcome,
} from './wizard-competitor-run';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult } from './wizard-idempotency';
import type { CatalogResolutionOutput } from './wizard-catalog-resolver';
import {
  decidePersistenceReadiness,
  type PersistenceReadinessProbe,
} from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import {
  durableCandidatesFromCount,
  resolveBatchTerminalStatusDecision,
  type BatchTerminalStatus,
} from '@/server/prospect-batches/batch-durable-candidates';
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  resolveAcceptanceFromRunFacts,
  toAcceptedForTargetMetadata,
} from '@/modules/prospect-batches/accepted-for-target';
import { fullTargetResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import {
  resolveDiscoveryTaxonomyCapability,
  toDiscoveryTaxonomyMetadata,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';

/** Lo que el producto promete entregar, igual que «Empresas por criterios». */
export const SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES = 10;
/** Tope para EMPEZAR consultas a Claude cuando es el único paso de la corrida. */
export const SUPPLIER_SEARCH_MAX_PHASE_MS = 170_000;
/** Clave del bloque del lote con lo que hizo el paso (qué aportó o por qué no corrió). */
export const SUPPLIER_SEARCH_LEG_METADATA_KEY = 'supplier_search_leg';
/**
 * AGENT1-SUPPLIER-SEARCH-4 — rondas de Claude por corrida. Prod 14-10: los proveedores
 * famosos de una gran empresa ya están en HubSpot/SellUp (Bancolombia: 4 de 5
 * duplicados); la 2.ª ronda pide medianos y menos conocidos, con lo visto excluido.
 * Tope ≈ US$0,50 por corrida.
 */
export const SUPPLIER_SEARCH_MAX_ROUNDS = 2;
/** Tope por ronda para EMPEZAR consultas: con dos rondas y el rescate, cabe en los 300 s. */
export const SUPPLIER_SEARCH_ROUND_MAX_PHASE_MS = 110_000;
/** Con menos que esto por delante no se empieza una ronda. */
export const SUPPLIER_SEARCH_ROUND_MIN_PHASE_MS = 50_000;
/** Lo que una ronda deja al final: escribir (90 s) y el rescate en línea (60 s). */
export const SUPPLIER_SEARCH_ROUND_TAIL_MS = 150_000;
/** Ventana máxima para que el rescate de Claude EMPIECE empresas dentro de la corrida. */
export const SUPPLIER_SEARCH_RESCUE_WINDOW_MS = 60_000;
/** Por debajo de esto no vale la pena empezar a revisar. */
export const SUPPLIER_SEARCH_MIN_RESCUE_WINDOW_MS = 15_000;
/** Lo que se deja al final para terminar la empresa en curso y sellar el lote. */
export const SUPPLIER_SEARCH_RESCUE_TAIL_MS = 90_000;

export type SupplierSearchRunDeps = {
  /** `ENABLE_AGENT1_SUPPLIER_SEARCH`; ausente = apagada. */
  resolveSupplierSearchEnabled?: () => boolean;
  /** «Claude busca proveedores» escribiendo en el lote de la corrida. */
  runClaudeSupplierSearch?: (input: { batchId: string; phaseMs: number; round?: number }) => Promise<ClaudeSearchLegOutcome>;
  /**
   * AGENT1-SUPPLIER-SEARCH-4 — lo que quedó en el lote (para Por revisar, duplicadas de
   * HubSpot / SellUp). Decide la 2.ª ronda y el «sin empresas nuevas» honesto. `null` =
   * no se pudo leer (se decide con lo que dijo el escritor).
   */
  countCompetitorBatchOutcome?: (batchId: string) => Promise<CompetitorBatchOutcome | null>;
  /**
   * AGENT1-SUPPLIER-SEARCH-3 — el MISMO rescate de Claude que corre en segundo plano
   * (sector y tamaño), aquí dentro de la corrida y con ventana corta. `true` = revisó.
   */
  rescueBatchInline?: (input: { batchId: string; windowMs: number }) => Promise<boolean>;
  /** Ids de las filas web del lote que cuentan para la meta, leídos tras el rescate. */
  listAcceptedCandidateIds?: (batchId: string) => Promise<string[] | null>;
  checkPersistenceReadiness: () => Promise<PersistenceReadinessProbe>;
  reserveSlot: (input: WizardExecutionReservationInput) => Promise<WizardExecutionReservationResult>;
  /** Sella el estado del lote y publica su metadata terminal en la MISMA escritura. */
  sealFreeOnlyBatchStatus?: (input: {
    batchId: string;
    status: BatchTerminalStatus;
    metadata?: Record<string, unknown> | null;
  }) => Promise<void>;
  actionStartedAtMs?: number;
  nowMs?: () => number;
};

export type SupplierSearchRunInput = {
  userId: string;
  clientRequestId: string;
  countryCode: string;
  countryName: string;
  catalogVersion: string;
  additionalCriteria: string | null;
  referenceCompanyName: string;
  catalogResolution: CatalogResolutionOutput;
  searchDepth: string;
};

/** Tiempo para empezar consultas: lo que quede de los 300 s menos la cola de escritura. */
export function resolveSupplierSearchPhaseMs(elapsedMs: number | null): number {
  const remaining = WIZARD_FUNCTION_LIMIT_MS - (elapsedMs ?? 0);
  return Math.max(0, Math.min(SUPPLIER_SEARCH_MAX_PHASE_MS, remaining - CLAUDE_SEARCH_LEG_TAIL_MS));
}

/** Tiempo para EMPEZAR una ronda, o `null` si ya no cabe con la escritura y el rescate. */
export function resolveSupplierRoundPhaseMs(elapsedMs: number | null): number | null {
  const phase = Math.min(
    SUPPLIER_SEARCH_ROUND_MAX_PHASE_MS,
    WIZARD_FUNCTION_LIMIT_MS - (elapsedMs ?? 0) - SUPPLIER_SEARCH_ROUND_TAIL_MS,
  );
  return phase >= SUPPLIER_SEARCH_ROUND_MIN_PHASE_MS ? phase : null;
}

/** ¿Otra ronda? Sólo si faltan empresas NUEVAS para Por revisar y quedan rondas. */
export function shouldRunAnotherSupplierRound(
  leg: Extract<ClaudeSearchLegOutcome, { executed: true }>,
  round: number,
  reviewable: number | null,
): boolean {
  if (round + 1 >= SUPPLIER_SEARCH_MAX_ROUNDS) return false;
  return (reviewable ?? leg.completeValidCandidates ?? 0) < SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES;
}

/** Ventana del rescate en línea, o `null` si ya no hay tiempo para empezar. */
export function resolveSupplierRescueWindowMs(elapsedMs: number | null): number | null {
  if (elapsedMs === null) return null;
  const window = Math.min(
    SUPPLIER_SEARCH_RESCUE_WINDOW_MS,
    WIZARD_FUNCTION_LIMIT_MS - elapsedMs - SUPPLIER_SEARCH_RESCUE_TAIL_MS,
  );
  return window >= SUPPLIER_SEARCH_MIN_RESCUE_WINDOW_MS ? window : null;
}

/** Texto para la persona cuando el paso de Claude no pudo correr. */
export function describeSupplierSearchFailure(reason: string): { message: string; retryable: boolean } {
  if (reason === 'quota_exhausted') {
    return {
      message: 'Se agotó la cuota mensual de Claude en Proveedores. Pide que la amplíen para seguir buscando proveedores.',
      retryable: false,
    };
  }
  if (reason.startsWith('model_not_configured')) {
    return {
      message: 'Falta configurar el modelo de Claude en Configuración → IA para buscar proveedores.',
      retryable: false,
    };
  }
  return {
    message: 'No se pudo completar la búsqueda de proveedores. Inténtalo de nuevo en unos minutos.',
    retryable: true,
  };
}

export async function executeSupplierSearchRun(
  input: SupplierSearchRunInput,
  deps: SupplierSearchRunDeps,
): Promise<WizardExecutionActionResult> {
  // 1. Bandera — el servidor manda, aunque el navegador ofrezca la opción.
  if (deps.resolveSupplierSearchEnabled?.() !== true) {
    return {
      ok: false,
      code: 'EXECUTION_DISABLED',
      message: 'La búsqueda de proveedores todavía no está habilitada.',
      retryable: false,
    };
  }
  if (!deps.runClaudeSupplierSearch) {
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'La búsqueda de proveedores no está disponible en este momento.',
      retryable: false,
    };
  }

  // 2. ¿Se pueden guardar candidatos? Antes de crear el lote y de pagar a Claude.
  const persistenceReadiness = decidePersistenceReadiness(
    await deps.checkPersistenceReadiness().catch((): PersistenceReadinessProbe => ({ status: 'probe_failed' })),
  );
  if (!persistenceReadiness.ready) {
    return {
      ok: false,
      code: 'PERSISTENCE_NOT_READY',
      message: persistenceReadiness.adminMessage,
      retryable: persistenceReadiness.reason === 'probe_failed',
      persistenceNotReady: {
        errorCode: persistenceReadiness.errorCode,
        reason: persistenceReadiness.reason,
        stage: persistenceReadiness.stage,
      },
    };
  }

  // 3. El lote de la corrida (idempotente por usuario + clientRequestId).
  const { catalogResolution } = input;
  const macroIndustryKey = resolveMacroIndustryKey({
    slug: catalogResolution.industry.slug,
    displayName: catalogResolution.industry.name,
  });
  let reservation: WizardExecutionReservationResult;
  try {
    reservation = await deps.reserveSlot({
      userId: input.userId,
      clientRequestId: input.clientRequestId,
      initialBatchPayload: {
        requestSource: 'chat_wizard',
        catalogVersionId: catalogResolution.catalog.version,
        industryId: catalogResolution.industry.id,
        subindustryIds: catalogResolution.subindustries.map((s) => s.id),
        countryCode: input.countryCode,
        additionalCriteria: input.additionalCriteria,
        targetCount: SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
        country: input.countryName,
        industry: catalogResolution.industry.name,
        searchDepth: input.searchDepth,
        discoveryTaxonomy: {
          ...toDiscoveryTaxonomyMetadata(resolveDiscoveryTaxonomyCapability(catalogResolution.catalog.version)),
          macro_industry_key: macroIndustryKey,
          macro_industry_display_name: catalogResolution.industry.name,
          requested_subindustries: catalogResolution.subindustries.map((s) => s.name),
        },
        supplierSearch: { referenceCompanyName: input.referenceCompanyName },
      },
    });
  } catch {
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: 'No se pudo reservar la ejecución. Por favor, intenta nuevamente.',
      retryable: true,
    };
  }

  // Un reintento de la MISMA corrida no vuelve a pagar a Claude.
  if (reservation.status === 'already_reserved') {
    return {
      ok: true,
      status: 'already_started',
      batchId: reservation.batchId,
      batchStatus: 'draft',
      redirectPath: `/prospect-batches/${reservation.batchId}`,
    };
  }
  const batchId = reservation.batchId;

  // 4. Claude busca proveedores y escribe en el lote (el escritor decide el estado).
  const elapsed = (): number | null =>
    deps.actionStartedAtMs === undefined ? null : (deps.nowMs ? deps.nowMs() : Date.now()) - deps.actionStartedAtMs;
  const runSupplierSearch = deps.runClaudeSupplierSearch;
  const runRound = async (round: number, phaseMs: number): Promise<ClaudeSearchLegOutcome> => {
    try {
      return await runSupplierSearch({ batchId, phaseMs, round });
    } catch (err) {
      return { executed: false, reason: `failed:${(err instanceof Error ? err.message : String(err)).slice(0, 160)}` };
    }
  };
  const readOutcome = async (): Promise<CompetitorBatchOutcome | null> =>
    deps.countCompetitorBatchOutcome ? await deps.countCompetitorBatchOutcome(batchId).catch(() => null) : null;

  let leg: ClaudeSearchLegOutcome = await runRound(
    0,
    resolveSupplierRoundPhaseMs(elapsed()) ?? resolveSupplierSearchPhaseMs(elapsed()),
  );
  const rounds: Array<{ round: number; outcome: ClaudeSearchLegOutcome }> = [{ round: 0, outcome: leg }];
  let batchOutcome = leg.executed ? await readOutcome() : null;

  // 4a. AGENT1-SUPPLIER-SEARCH-4 — 2.ª ronda: sólo si faltan nuevas y queda tiempo. Una
  //     ronda que falla no tumba lo que la anterior ya dejó en el lote.
  for (
    let round = 0;
    leg.executed && shouldRunAnotherSupplierRound(leg, round, batchOutcome?.reviewable ?? null);
    round += 1
  ) {
    const phaseMs = resolveSupplierRoundPhaseMs(elapsed());
    if (phaseMs === null) {
      rounds.push({ round: round + 1, outcome: { executed: false, reason: 'not_enough_time' } });
      break;
    }
    const next = await runRound(round + 1, phaseMs);
    rounds.push({ round: round + 1, outcome: next });
    if (!next.executed) break;
    leg = combineCompetitorRounds(leg, next);
    batchOutcome = await readOutcome();
  }

  // 4b. AGENT1-SUPPLIER-SEARCH-3 — el escritor mide la aceptación ANTES de saber el
  //     tamaño (Claude no lo trae): Prod 14-10, 6 corridas con 0 aceptadas aunque
  //     Minsait tiene 10.001 empleados. El rescate de Claude (sector y tamaño) corre
  //     aquí, con ventana corta, y la aceptación se relee después. Cualquier tropiezo ⇒
  //     se queda la del escritor; el rescate en segundo plano sigue como siempre.
  let rescue: { reviewed: boolean; acceptedIds: string[] | null; windowMs: number | null } = {
    reviewed: false,
    acceptedIds: null,
    windowMs: null,
  };
  if (leg.executed && leg.persistedCandidates > 0 && deps.rescueBatchInline && deps.listAcceptedCandidateIds) {
    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
    const windowMs = resolveSupplierRescueWindowMs(
      deps.actionStartedAtMs === undefined ? null : nowMs - deps.actionStartedAtMs,
    );
    if (windowMs !== null) {
      const reviewed = await deps.rescueBatchInline({ batchId, windowMs }).catch(() => false);
      const acceptedIds = reviewed ? await deps.listAcceptedCandidateIds(batchId).catch(() => null) : null;
      rescue = { reviewed, acceptedIds, windowMs };
    }
  }

  // 5. La aceptación: la MISMA autoridad que el resto del asistente, con Claude como
  //    único aporte (en la posición de las piernas tardías, como en la corrida normal).
  const writerTruth = claudeLegWriterTruth(leg);
  const legTruth =
    writerTruth && rescue.acceptedIds !== null
      ? {
          ...writerTruth,
          completeValidCandidates: rescue.acceptedIds.length,
          ...(rescue.acceptedIds.length > 0
            ? { acceptedIdentities: rescue.acceptedIds.map((id) => `candidate:${id}`) }
            : {}),
        }
      : writerTruth;
  const persisted = legTruth?.persistedCandidates ?? 0;
  const acceptedForTarget = resolveAcceptanceFromRunFacts(
    { demand: fullTargetResultDemand(SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES), freePersistedCandidates: 0 },
    PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
    legTruth ?? PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
    persisted,
  );

  // 6. Sellado terminal: estado + metadata en UNA escritura. Si Claude no corrió, el
  //    lote queda `failed` (no hay filas); si corrió, el escritor ya lo cerró y aquí
  //    sólo se republica el estado que decide la máquina de siempre.
  const sealDecision = resolveBatchTerminalStatusDecision({
    preExisting: durableCandidatesFromCount(0),
    persistedCandidates: persisted,
    persistenceFailureCount: leg.executed ? 0 : 1,
  });
  if (sealDecision.action === 'write' && deps.sealFreeOnlyBatchStatus) {
    await deps
      .sealFreeOnlyBatchStatus({
        batchId,
        status: sealDecision.status,
        metadata: {
          [SUPPLIER_SEARCH_LEG_METADATA_KEY]: {
            ...leg,
            rounds,
            inline_rescue: {
              reviewed: rescue.reviewed,
              window_ms: rescue.windowMs,
              accepted_after_rescue: rescue.acceptedIds?.length ?? null,
            },
          },
          ...(leg.executed ? { [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(acceptedForTarget) } : {}),
        },
      })
      .catch(() => undefined);
  }

  if (!leg.executed) {
    const failure = describeSupplierSearchFailure(String(leg.reason));
    return {
      ok: false,
      code: 'GENERATION_FAILED',
      message: failure.message,
      retryable: failure.retryable,
    };
  }

  // AGENT1-SUPPLIER-SEARCH-4 — si todo lo escrito eran duplicadas (Prod 14-10, Bancolombia:
  // 4 de 5), el resultado lo dice con su causa en vez de «se generaron N».
  const reviewable = batchOutcome?.reviewable ?? null;
  const nothingNew = persisted === 0 || reviewable === 0;
  return {
    ok: true,
    status: nothingNew ? 'no_new_candidates' : acceptedForTarget.targetReached ? 'success_target_reached' : 'success_partial',
    ...(batchOutcome && reviewable === 0 ? { noNewCandidatesBreakdown: buildCompetitorNoNewBreakdown(batchOutcome) } : {}),
    batchId,
    batchStatus: persisted > 0 ? 'ready_for_review' : 'nothing_to_write',
    candidateCount: persisted,
    redirectPath: `/prospect-batches/${batchId}`,
    targetPersistibleCandidates: SUPPLIER_SEARCH_TARGET_PERSISTIBLE_CANDIDATES,
    targetReached: acceptedForTarget.targetReached,
    acceptedForTarget,
    claudeSearchLeg: leg,
  };
}
