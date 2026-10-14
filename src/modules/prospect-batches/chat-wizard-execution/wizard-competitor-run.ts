/**
 * Agente 1 · «Competidores de una empresa» — la corrida (pura; dependencias
 * inyectadas por la acción del asistente).
 *
 * Decisión de la dueña (14-10): la referencia se escribe o se toma de Cuentas, las
 * competidoras pueden ser de cualquier tamaño dentro de la industria y no se gasta
 * crédito de Apollo. Por eso esta corrida NO pasa por la capa gratuita, el banco,
 * Tavily, Apollo ni Lusha —todas buscan «empresas de la industria», no
 * competidoras—: la fuente es «Claude busca empresas» con consultas que nombran a
 * la referencia. Lo que Claude propone entra por la cadena de siempre (sitio
 * verificado, duplicados SellUp/HubSpot, número fiscal, «una empresa, un
 * vendedor», revisión). Nada se aprueba solo.
 *
 * Lote: el mismo slot idempotente del asistente (`clientRequestId`), con la
 * referencia en `metadata.competitor_search`. Aceptación y sellado: las mismas
 * autoridades que la corrida por criterios (`resolveAcceptanceFromRunFacts`,
 * `resolveBatchTerminalStatusDecision`), sin aritmética propia.
 */

import {
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  resolveAcceptanceFromRunFacts,
  toAcceptedForTargetMetadata,
  type RunAcceptanceFacts,
} from '@/modules/prospect-batches/accepted-for-target';
import {
  toCompetitorSearchMetadata,
  type CompetitorReference,
} from '@/modules/prospect-batches/competitor-search/competitor-reference';
import { fullTargetResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import {
  resolveDiscoveryTaxonomyCapability,
  toDiscoveryTaxonomyMetadata,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';
import {
  decidePersistenceReadiness,
  type PersistenceReadinessProbe,
} from '@/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness';
import {
  NO_PRE_EXISTING_DURABLE_CANDIDATES,
  resolveBatchTerminalStatusDecision,
  type BatchTerminalStatus,
} from '@/server/prospect-batches/batch-durable-candidates';
import { createCanonicalWizardBatchResolver } from './wizard-canonical-batch';
import type { CatalogResolutionOutput } from './wizard-catalog-resolver';
import {
  claudeLegWriterTruth,
  CLAUDE_SEARCH_LEG_TAIL_MS,
  WIZARD_FUNCTION_LIMIT_MS,
  type ClaudeSearchLegOutcome,
} from './wizard-claude-search-leg';
import type { WizardExecutionActionResult } from './wizard-execution-types';
import type { WizardExecutionReservationInput, WizardExecutionReservationResult } from './wizard-idempotency';
import { WIZARD_PIPELINE_DEFAULTS } from './wizard-pipeline-adapter';

/** Tope por ronda para EMPEZAR consultas: con dos rondas, las dos caben en los 300 s. */
export const COMPETITOR_SEARCH_MAX_PHASE_MS = 110_000;
/** Con menos que esto por delante no se empieza: Claude + verificar + escribir. */
export const COMPETITOR_SEARCH_MIN_PHASE_MS = 60_000;

export type CompetitorRunDeps = {
  reserveSlot: (input: WizardExecutionReservationInput) => Promise<WizardExecutionReservationResult>;
  checkPersistenceReadiness: () => Promise<PersistenceReadinessProbe>;
  /** La bandera de «Claude busca empresas»: sin ella no hay con qué buscar competidores. */
  resolveClaudeSearchLeg?: () => boolean;
  runClaudeCompanySearchLeg?: (input: {
    batchId: string;
    phaseMs: number;
    round?: number;
  }) => Promise<ClaudeSearchLegOutcome>;
  sealFreeOnlyBatchStatus?: (input: {
    batchId: string;
    status: BatchTerminalStatus;
    metadata?: Record<string, unknown> | null;
  }) => Promise<void>;
  markBatchFailed: (batchId: string, reason: 'batchid_mismatch' | 'pipeline_error') => Promise<void>;
  actionStartedAtMs?: number;
  nowMs?: () => number;
};

export type CompetitorRunInput = {
  userId: string;
  clientRequestId: string;
  countryCode: string;
  countryName: string;
  additionalCriteria: string | null;
  reference: CompetitorReference;
  catalogResolution: CatalogResolutionOutput;
  target: number;
};

/**
 * Rondas de Claude por corrida. Prod 14-10 (lote 16205dfb): la 1.ª ronda trae las
 * competidoras famosas, que ya están en HubSpot y quedan como duplicadas; la 2.ª
 * pide medianas y menos conocidas, con lo ya visto excluido. Tope ≈ US$0,50.
 */
export const COMPETITOR_SEARCH_MAX_ROUNDS = 2;

type ExecutedLeg = Extract<ClaudeSearchLegOutcome, { executed: true }>;

/** Las rondas suman como una sola pierna: filas, aceptadas, identidades y costo. */
export function combineCompetitorRounds(a: ExecutedLeg, b: ExecutedLeg): ExecutedLeg {
  return {
    executed: true,
    persistedCandidates: a.persistedCandidates + b.persistedCandidates,
    completeValidCandidates:
      a.completeValidCandidates === null || b.completeValidCandidates === null
        ? null
        : a.completeValidCandidates + b.completeValidCandidates,
    acceptedIdentities: [...a.acceptedIdentities, ...b.acceptedIdentities],
    estimatedCostUsd: Math.round((a.estimatedCostUsd + b.estimatedCostUsd) * 1_000_000) / 1_000_000,
    proposed: a.proposed + b.proposed,
    passedPreFilter: a.passedPreFilter + b.passedPreFilter,
  };
}

/** ¿Vale la pena otra ronda? Sólo si faltan empresas nuevas aceptadas. */
export function shouldRunAnotherCompetitorRound(leg: ExecutedLeg, target: number, round: number): boolean {
  if (round + 1 >= COMPETITOR_SEARCH_MAX_ROUNDS) return false;
  return (leg.completeValidCandidates ?? 0) < target;
}

/** Tiempo para empezar consultas; `null` = ya no cabe una búsqueda útil. */
export function resolveCompetitorPhaseMs(elapsedMs: number): number | null {
  const remaining = WIZARD_FUNCTION_LIMIT_MS - Math.max(0, elapsedMs);
  const phaseMs = Math.min(COMPETITOR_SEARCH_MAX_PHASE_MS, remaining - CLAUDE_SEARCH_LEG_TAIL_MS);
  return phaseMs >= COMPETITOR_SEARCH_MIN_PHASE_MS ? phaseMs : null;
}

/** La fila del lote: la misma que una corrida por criterios, más la referencia. */
export function buildCompetitorBatchPayload(
  input: CompetitorRunInput,
): WizardExecutionReservationInput['initialBatchPayload'] {
  const { catalogResolution } = input;
  return {
    requestSource: 'chat_wizard',
    catalogVersionId: catalogResolution.catalog.version,
    industryId: catalogResolution.industry.id,
    subindustryIds: catalogResolution.subindustries.map((s) => s.id),
    countryCode: input.countryCode,
    additionalCriteria: input.additionalCriteria,
    targetCount: input.target,
    country: input.countryName,
    industry: catalogResolution.industry.name,
    searchDepth: WIZARD_PIPELINE_DEFAULTS.searchDepth,
    discoveryTaxonomy: {
      ...toDiscoveryTaxonomyMetadata(resolveDiscoveryTaxonomyCapability(catalogResolution.catalog.version)),
      macro_industry_key: resolveMacroIndustryKey({
        slug: catalogResolution.industry.slug,
        displayName: catalogResolution.industry.name,
      }),
      macro_industry_display_name: catalogResolution.industry.name,
      requested_subindustries: catalogResolution.subindustries.map((s) => s.name),
    },
    competitorSearch: toCompetitorSearchMetadata(input.reference),
  };
}

function failure(
  code: 'PROVIDER_UNAVAILABLE' | 'PERSISTENCE_NOT_READY' | 'GENERATION_FAILED',
  message: string,
  retryable: boolean,
): WizardExecutionActionResult {
  return { ok: false, code, message, retryable };
}

export async function executeCompetitorSearchRun(
  input: CompetitorRunInput,
  deps: CompetitorRunDeps,
): Promise<WizardExecutionActionResult> {
  // Sin Claude no hay con qué buscar competidores: se para antes de crear el lote.
  if (deps.resolveClaudeSearchLeg?.() !== true || !deps.runClaudeCompanySearchLeg) {
    return failure(
      'PROVIDER_UNAVAILABLE',
      'La búsqueda de competidores usa a Claude, que no está activo en este momento.',
      false,
    );
  }

  // La base tiene que poder GUARDAR antes de pagar una sola llamada (mismo control
  // que la corrida por criterios).
  const readiness = decidePersistenceReadiness(
    await deps.checkPersistenceReadiness().catch((): PersistenceReadinessProbe => ({ status: 'probe_failed' })),
  );
  if (!readiness.ready) {
    return failure('PERSISTENCE_NOT_READY', readiness.adminMessage, readiness.reason === 'probe_failed');
  }

  const now = deps.nowMs ?? Date.now;
  const elapsedMs = deps.actionStartedAtMs === undefined ? 0 : now() - deps.actionStartedAtMs;
  const phaseMs = resolveCompetitorPhaseMs(elapsedMs);
  if (phaseMs === null) {
    return failure('GENERATION_FAILED', 'No quedó tiempo para buscar competidores. Intenta de nuevo.', true);
  }

  const canonicalBatch = createCanonicalWizardBatchResolver(deps.reserveSlot, {
    userId: input.userId,
    clientRequestId: input.clientRequestId,
    initialBatchPayload: buildCompetitorBatchPayload(input),
  });
  let reservation: WizardExecutionReservationResult;
  try {
    reservation = await canonicalBatch.resolve();
  } catch {
    return failure('GENERATION_FAILED', 'No se pudo reservar la ejecución. Por favor, intenta nuevamente.', true);
  }
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

  const runLeg = deps.runClaudeCompanySearchLeg;
  const runRound = async (round: number, roundPhaseMs: number): Promise<ClaudeSearchLegOutcome> => {
    try {
      return await runLeg({ batchId, phaseMs: roundPhaseMs, round });
    } catch {
      return { executed: false, reason: 'failed' };
    }
  };

  const first = await runRound(0, phaseMs);
  if (!first.executed) {
    await deps.markBatchFailed(batchId, 'pipeline_error').catch(() => undefined);
    return failure('GENERATION_FAILED', 'La búsqueda de competidores falló. Intenta de nuevo en unos minutos.', true);
  }

  // Rondas siguientes: sólo si faltan aceptadas y queda tiempo. Una ronda que falla
  // no tumba lo que la anterior ya dejó en el lote.
  let claudeLeg: ExecutedLeg = first;
  const rounds: Array<{ round: number; outcome: ClaudeSearchLegOutcome }> = [{ round: 0, outcome: first }];
  for (let round = 0; shouldRunAnotherCompetitorRound(claudeLeg, input.target, round); round += 1) {
    const elapsed = deps.actionStartedAtMs === undefined ? 0 : now() - deps.actionStartedAtMs;
    const nextPhaseMs = resolveCompetitorPhaseMs(elapsed);
    if (nextPhaseMs === null) {
      rounds.push({ round: round + 1, outcome: { executed: false, reason: 'not_enough_time' } });
      break;
    }
    const next = await runRound(round + 1, nextPhaseMs);
    rounds.push({ round: round + 1, outcome: next });
    if (!next.executed) break;
    claudeLeg = combineCompetitorRounds(claudeLeg, next);
  }

  const facts: RunAcceptanceFacts = {
    demand: fullTargetResultDemand(input.target),
    freePersistedCandidates: 0,
  };
  const legTruth = claudeLegWriterTruth(claudeLeg) ?? PAID_ROUTE_NOT_RUN_WRITER_TRUTH;
  const acceptedForTarget = resolveAcceptanceFromRunFacts(
    facts,
    legTruth,
    PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
    claudeLeg.persistedCandidates,
  );

  // Sellado terminal: el escritor ya dejó `ready_for_review` si escribió; sin
  // filas, el lote se cierra como `completed`. Viaja con la aceptación y la traza.
  const seal = resolveBatchTerminalStatusDecision({
    preExisting: NO_PRE_EXISTING_DURABLE_CANDIDATES,
    persistedCandidates: claudeLeg.persistedCandidates,
    persistenceFailureCount: 0,
  });
  if (seal.action === 'write' && deps.sealFreeOnlyBatchStatus) {
    await deps
      .sealFreeOnlyBatchStatus({
        batchId,
        status: seal.status,
        metadata: {
          [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(acceptedForTarget),
          claude_search_leg: claudeLeg,
          competitor_search_rounds: rounds,
        },
      })
      .catch(() => undefined);
  }

  const hasCandidates = claudeLeg.persistedCandidates > 0;
  return {
    ok: true,
    status: hasCandidates
      ? acceptedForTarget.targetReached
        ? 'success_target_reached'
        : 'success_partial'
      : 'no_new_candidates',
    batchId,
    batchStatus: hasCandidates ? 'ready_for_review' : 'nothing_to_write',
    candidateCount: claudeLeg.persistedCandidates,
    redirectPath: `/prospect-batches/${batchId}`,
    targetPersistibleCandidates: input.target,
    targetReached: acceptedForTarget.targetReached,
    acceptedForTarget,
    claudeSearchLeg: claudeLeg,
  };
}
