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

export type SupplierSearchRunDeps = {
  /** `ENABLE_AGENT1_SUPPLIER_SEARCH`; ausente = apagada. */
  resolveSupplierSearchEnabled?: () => boolean;
  /** «Claude busca proveedores» escribiendo en el lote de la corrida. */
  runClaudeSupplierSearch?: (input: { batchId: string; phaseMs: number }) => Promise<ClaudeSearchLegOutcome>;
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
  const elapsedMs =
    deps.actionStartedAtMs === undefined ? null : (deps.nowMs ? deps.nowMs() : Date.now()) - deps.actionStartedAtMs;
  let leg: ClaudeSearchLegOutcome;
  try {
    leg = await deps.runClaudeSupplierSearch({ batchId, phaseMs: resolveSupplierSearchPhaseMs(elapsedMs) });
  } catch (err) {
    leg = { executed: false, reason: `failed:${(err instanceof Error ? err.message : String(err)).slice(0, 160)}` };
  }

  // 5. La aceptación: la MISMA autoridad que el resto del asistente, con Claude como
  //    único aporte (en la posición de las piernas tardías, como en la corrida normal).
  const legTruth = claudeLegWriterTruth(leg);
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
          [SUPPLIER_SEARCH_LEG_METADATA_KEY]: leg,
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

  return {
    ok: true,
    status: persisted > 0 ? (acceptedForTarget.targetReached ? 'success_target_reached' : 'success_partial') : 'no_new_candidates',
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
