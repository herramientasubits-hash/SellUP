/**
 * Agente 1 · Rescate con Claude — orquestación de un lote (dependencias inyectadas).
 *
 * Corre en segundo plano al terminar una búsqueda del asistente:
 *  1. «Candidatos por revisar» a los que les falta sector o tamaño;
 *  2. «Descartadas» por falta de datos (y, con el buscador encendido, sin dominio).
 * Respeta la configuración igual que el clasificador (modelo de Configuración → IA,
 * cuota de Anthropic) y registra cada llamada en `provider_usage_logs`.
 */

import { CLASSIFIABLE_FAILED_CONDITIONS, type ClassifiableCandidateRow } from '../classification-metadata';
import { buildClassifierUsageLog, type ActiveAnthropicModel } from '../classify-batch-candidates';
import type {
  ClassifierCatalogIndustry,
  ClassifierCompanyInput,
  CompanyClassificationResult,
} from '../types';
import type { DuplicateCheckInput } from '../../types';
import type { DomainFinderInput, DomainFinderOutcome } from '../domain-finder';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import {
  buildDomainFinderInput,
  buildDomainSearchStaysEvidence,
  buildDomainSearchUsageLog,
  buildFoundEvidence,
  buildFoundWebsiteColumns,
  buildUnverifiedHintWebsiteVerification,
  CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
  dispositionDisplayName,
  readFoundWebsite,
  unverifiedWebsiteHint,
  type DomainDuplicateCheck,
  type FoundWebsite,
} from './domain-search';
import { decideRescue, DEFAULT_ICP_MIN_EMPLOYEES, storedSmallSizeDiscard } from './rescue-decision';
import {
  buildCandidateRescuePatch,
  buildRescueInProgress,
  buildStoredSmallSizeDiscardPatch,
  CLAUDE_RESCUE_METADATA_KEY,
  rescueStillPending,
  type CandidateRescuePatch,
} from './rescue-patch';
import {
  buildStoredReassignCandidatePatch,
  buildStoredReassignDispositionOrigin,
  decideStoredReassignment,
  icpGatePassed,
} from './reassign-stored';
import {
  buildDispositionAdmissionOrigin,
  buildDispositionReassignOrigin,
  buildDispositionInProgressEvidence,
  buildDispositionStaysEvidence,
  dispositionToCompanyInput,
  needsDispositionRescue,
  type RescuableDispositionRow,
} from './rescue-dispositions';

export const RESCUE_CONCURRENCY = 4;
/** Empresas por corrida en segundo plano (el resto queda para la próxima). */
export const RESCUE_MAX_COMPANIES_PER_RUN = 60;
/** Después de esto no se empieza ninguna empresa nueva (cabe en 300 s de Vercel). */
export const RESCUE_RUN_DEADLINE_MS = 200_000;

export type RescueBatchDeps = {
  resolveActiveModel: () => Promise<ActiveAnthropicModel | { error: string }>;
  checkQuota: () => Promise<{ allowed: boolean }>;
  loadCatalog: () => Promise<ClassifierCatalogIndustry[]>;
  loadReviewCandidates: (batchId: string) => Promise<ClassifiableCandidateRow[]>;
  loadDispositions: (batchId: string) => Promise<RescuableDispositionRow[]>;
  /** Macroindustria PEDIDA en la búsqueda (`prospect_batches.metadata.industry_id`). */
  loadBatchIndustryId: (batchId: string) => Promise<string | null>;
  /**
   * ¿Claude buscó empresas en este lote (`metadata.claude_company_search`)? Esas filas no
   * traen completitud: se revisan también (AGENT1-CLAUDE-COMPANY-SEARCH-AUTO-1).
   */
  loadBatchHasClaudeCompanySearch?: (batchId: string) => Promise<boolean>;
  classify: (
    company: ClassifierCompanyInput,
    catalog: readonly ClassifierCatalogIndustry[],
    active: ActiveAnthropicModel,
  ) => Promise<CompanyClassificationResult>;
  logUsage: (input: LogProviderUsageInput) => Promise<boolean>;
  /**
   * Escribe sólo si el candidato sigue «para revisión» y nadie más escribió en
   * medio. `buildPatch` recibe la metadata RELEÍDA. false = no se escribió.
   */
  patchCandidate: (
    candidateId: string,
    buildPatch: (metadata: Record<string, unknown> | null) => CandidateRescuePatch | null,
  ) => Promise<boolean>;
  /** Igual, sobre la evidencia de una fila de Descartadas que sigue `discarded`. */
  patchDispositionEvidence: (
    dispositionId: string,
    buildEvidence: (evidence: Record<string, unknown> | null) => Record<string, unknown> | null,
  ) => Promise<boolean>;
  /** Pasa la fila de Descartadas a «Candidatos por revisar». null = no se pudo. */
  admitDisposition: (dispositionId: string, origin: SendToReviewOrigin) => Promise<string | null>;
  /**
   * Tras pasar a revisión, deja en la fila de Descartadas la decisión final del rescate
   * (antes se quedaba «en proceso»). Ausente = no se marca. Nunca bloquea.
   */
  markDispositionSent?: (dispositionId: string, rescue: Record<string, unknown>) => Promise<void>;
  /** «Una empresa, un vendedor»: reclama la identidad de los candidatos rescatados. */
  claimIdentities: (batchId: string, candidateIds: readonly string[]) => Promise<void>;
  /**
   * Descartes de Claude por SECTOR ya guardados en el lote (candidatos `discarded`
   * y filas de Descartadas). Ausente = no se reabren (costo cero: no llama a Claude).
   */
  loadSectorMismatchDiscards?: (batchId: string) => Promise<{
    candidates: ClassifiableCandidateRow[];
    dispositions: RescuableDispositionRow[];
  }>;
  /** Como `patchCandidate`, pero sólo si el candidato sigue `discarded`. */
  reopenDiscardedCandidate?: (
    candidateId: string,
    buildPatch: (metadata: Record<string, unknown> | null) => CandidateRescuePatch | null,
  ) => Promise<boolean>;
  /**
   * Buscador de sitio oficial para descartadas SIN dominio. Ausente = apagado
   * (`ENABLE_AGENT1_CLAUDE_DOMAIN_FINDER`): esas filas ni se cargan ni se tocan.
   */
  domainSearch?: {
    findWebsite: (input: DomainFinderInput, active: ActiveAnthropicModel) => Promise<DomainFinderOutcome>;
    /** SellUp + HubSpot, sólo lectura. Lanza si alguna de las dos no se pudo revisar. */
    checkDuplicate: (input: DuplicateCheckInput) => Promise<DomainDuplicateCheck>;
  };
  nowIso: () => string;
  nowMs: () => number;
};

export type RescueBatchSummary =
  | {
      ok: true;
      candidatesCompleted: number;
      candidatesDiscarded: number;
      candidatesUnchanged: number;
      dispositionsAdmitted: number;
      dispositionsKept: number;
      /** Otra industria UBITS: en revisión con la industria corregida, sin contar para la meta. */
      reassigned: number;
      failed: number;
      remaining: number;
      estimatedCostUsd: number;
    }
  | { ok: false; error: 'model_not_configured' | 'quota_exhausted' | 'catalog_unavailable' | 'load_failed'; detail?: string };

type WorkItem =
  | { kind: 'candidate'; row: ClassifiableCandidateRow }
  | { kind: 'disposition'; row: RescuableDispositionRow };

type ItemOutcome =
  | { tag: 'completed' | 'discarded' | 'unchanged' | 'admitted' | 'reassigned' | 'kept' | 'failed' | 'skipped'; cost: number };

function readIcpThreshold(metadata: Record<string, unknown> | null): number {
  const gate = metadata?.icp_size_gate as { threshold?: unknown } | undefined;
  return typeof gate?.threshold === 'number' && gate.threshold > 0 ? gate.threshold : DEFAULT_ICP_MIN_EMPLOYEES;
}

function failedConditions(metadata: Record<string, unknown> | null): string[] {
  const failed = (metadata?.target_completeness as { failed_conditions?: unknown } | undefined)?.failed_conditions;
  return Array.isArray(failed) ? failed.filter((f): f is string => typeof f === 'string') : [];
}

/**
 * Lusha no escribe `target_completeness` (trae tamaño y LinkedIn confirmados) pero
 * su sector es genérico («Technology, Information & Media»): se revisa el SECTOR.
 * Decisión de la dueña 30-09.
 */
function isLushaSectorReview(row: ClassifiableCandidateRow): boolean {
  return row.source_primary === 'lusha' && !row.metadata?.target_completeness;
}

/**
 * Lote del piloto «Claude busca empresas»: sus candidatos no traen `target_completeness`
 * (lo escriben Apollo y Tavily). Sin esto, uno sin tamaño quedaba sin revisar
 * (Prod 02-10: Coelum Networks).
 */
function isUnassessedPilotCandidate(row: ClassifiableCandidateRow): boolean {
  if (row.metadata?.target_completeness) return false;
  const status = (row.metadata?.icp_size_gate as { size_status?: unknown } | undefined)?.size_status;
  return status === undefined || status === null || status === 'unknown';
}

export function needsCandidateRescue(
  row: ClassifiableCandidateRow,
  nowMs: number,
  /** Lote del piloto «Claude busca empresas» (`metadata.claude_company_search`). */
  options: { includeUnassessed?: boolean } = {},
): boolean {
  if (row.status !== 'needs_review') return false;
  if (!row.website && !row.domain) return false;
  if (!rescueStillPending(row.metadata?.[CLAUDE_RESCUE_METADATA_KEY], nowMs, row.metadata?.claude_classification)) {
    return false;
  }
  if (isLushaSectorReview(row)) return true;
  if (options.includeUnassessed && isUnassessedPilotCandidate(row)) return true;
  return failedConditions(row.metadata).some((f) => (CLASSIFIABLE_FAILED_CONDITIONS as readonly string[]).includes(f));
}

function sizeAlreadyConfirmed(metadata: Record<string, unknown> | null): boolean {
  const status = (metadata?.icp_size_gate as { size_status?: unknown } | undefined)?.size_status;
  return typeof status === 'string' && status.startsWith('confirmed');
}

type RescueRunContext = {
  batchId: string;
  triggeredBy: string | null;
  catalog: readonly ClassifierCatalogIndustry[];
  active: ActiveAnthropicModel;
  /** Macroindustria pedida: autoridad para «coincide con el lote» (no el `industry` del proveedor). */
  requestedIndustry: { id: string; name: string } | null;
};

function candidateToCompany(row: ClassifiableCandidateRow, ctx: RescueRunContext): ClassifierCompanyInput {
  return {
    candidateId: row.id,
    name: row.name ?? '',
    websiteOrDomain: row.website ?? row.domain,
    countryCode: row.country_code,
    countryName: row.country,
    currentIndustryId: ctx.requestedIndustry?.id ?? row.industry_id,
    currentIndustryName: ctx.requestedIndustry ? null : row.industry ?? null,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry ?? null,
  };
}

async function safeClassify(
  company: ClassifierCompanyInput,
  catalog: readonly ClassifierCatalogIndustry[],
  active: ActiveAnthropicModel,
  deps: RescueBatchDeps,
): Promise<CompanyClassificationResult | null> {
  try {
    return await deps.classify(company, catalog, active);
  } catch (err) {
    console.error('[claude-rescue] classify failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function logUsage(result: CompanyClassificationResult, batchId: string, triggeredBy: string | null, deps: RescueBatchDeps) {
  const log = buildClassifierUsageLog(result, { batchId, triggeredBy, classifiedAt: deps.nowIso() });
  if (log) await deps.logUsage({ ...log, metadata: { ...(log.metadata ?? {}), flow: 'claude_rescue' } });
}

async function rescueCandidate(
  row: ClassifiableCandidateRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
): Promise<ItemOutcome> {
  const claimed = await deps.patchCandidate(row.id, (metadata) =>
    rescueStillPending(metadata?.[CLAUDE_RESCUE_METADATA_KEY], deps.nowMs(), metadata?.claude_classification)
      ? { metadata: { ...(metadata ?? {}), [CLAUDE_RESCUE_METADATA_KEY]: buildRescueInProgress(deps.nowIso()) } }
      : null,
  );
  if (!claimed) return { tag: 'skipped', cost: 0 };

  const result = await safeClassify(candidateToCompany(row, ctx), ctx.catalog, ctx.active, deps);
  if (!result) return { tag: 'failed', cost: 0 };
  await logUsage(result, ctx.batchId, ctx.triggeredBy, deps);

  const minEmployees = readIcpThreshold(row.metadata);
  const decision = decideRescue(result, {
    icpMinEmployees: minEmployees,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry ?? null,
    sizeAlreadyConfirmed: sizeAlreadyConfirmed(row.metadata),
    sizePassedIcpGate: icpGatePassed(row.metadata),
  });
  const decidedAt = deps.nowIso();
  const saved = await deps.patchCandidate(row.id, (metadata) =>
    buildCandidateRescuePatch({ metadata, result, decision, minEmployees, decidedAt }),
  );
  const cost = result.usage?.estimatedCostUsd ?? 0;
  if (!saved) return { tag: 'failed', cost };
  if (decision.kind === 'discard') return { tag: 'discarded', cost };
  if (decision.kind === 'reassign') return { tag: 'reassigned', cost };
  if (decision.kind === 'admit') return { tag: 'completed', cost };
  return { tag: 'unchanged', cost };
}

type WebsiteStep =
  | { kind: 'found'; found: FoundWebsite; cost: number }
  | { kind: 'done'; outcome: ItemOutcome };

/**
 * Descartada SIN dominio: Claude busca el sitio oficial y se revisan duplicados.
 * Sólo sigue al rescate si el sitio quedó comprobado y la empresa es NUEVA.
 */
async function resolveDispositionWebsite(
  row: RescuableDispositionRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
  domainSearch: NonNullable<RescueBatchDeps['domainSearch']>,
): Promise<WebsiteStep> {
  let found = readFoundWebsite(row.evidence);
  let cost = 0;
  if (!found) {
    const startedMs = deps.nowMs();
    let outcome: DomainFinderOutcome;
    try {
      outcome = await domainSearch.findWebsite(buildDomainFinderInput(row, null), ctx.active);
    } catch (err) {
      console.error('[claude-rescue] domain search failed:', err instanceof Error ? err.message : err);
      outcome = { found: false, reason: 'model_error', errorCode: 'unexpected_error', usage: null };
    }
    const searchedAt = deps.nowIso();
    const log = buildDomainSearchUsageLog(outcome, {
      batchId: ctx.batchId,
      dispositionId: row.id,
      triggeredBy: ctx.triggeredBy,
      searchedAt,
      durationMs: deps.nowMs() - startedMs,
    });
    if (log) await deps.logUsage(log);
    cost = outcome.usage?.estimatedCostUsd ?? 0;
    // d6: la web propuesta no abrió, pero la empresa trae número fiscal oficial y el
    // dominio lleva su nombre ⇒ sigue como PISTA sin confirmar.
    const hint = unverifiedWebsiteHint(row, outcome);
    if (hint) {
      found = hint;
    } else if (!outcome.found) {
      const saved = await deps.patchDispositionEvidence(row.id, (evidence) =>
        buildDomainSearchStaysEvidence(evidence, { kind: 'not_found', outcome }, searchedAt),
      );
      return { kind: 'done', outcome: { tag: saved ? 'kept' : 'failed', cost } };
    } else {
      found = { website: outcome.website, domain: outcome.domain, verification: outcome.verification };
    }
  }

  let duplicate: DomainDuplicateCheck;
  try {
    duplicate = await domainSearch.checkDuplicate({
      name: dispositionDisplayName(row),
      website: found.website,
      domain: found.domain,
      countryCode: row.country_code,
    });
  } catch (err) {
    // Sin poder revisar SellUp/HubSpot NO se admite: se guarda el sitio y se reintenta.
    console.error('[claude-rescue] duplicate check failed:', err instanceof Error ? err.message : err);
    const at = deps.nowIso();
    const kept = found;
    await deps.patchDispositionEvidence(row.id, (evidence) => ({
      ...buildFoundEvidence(evidence, kept, at),
      [CLAUDE_RESCUE_METADATA_KEY]: { ...buildRescueInProgress(at), decision: 'retryable' },
    }));
    return { kind: 'done', outcome: { tag: 'failed', cost } };
  }
  if (duplicate.status !== 'new_candidate') {
    const at = deps.nowIso();
    const kept = found;
    const saved = await deps.patchDispositionEvidence(row.id, (evidence) =>
      buildDomainSearchStaysEvidence(evidence, { kind: 'duplicate', found: kept, duplicate }, at),
    );
    return { kind: 'done', outcome: { tag: saved ? 'kept' : 'failed', cost } };
  }
  return { kind: 'found', found, cost };
}

async function rescueDisposition(
  row: RescuableDispositionRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
  admittedIds: string[],
): Promise<ItemOutcome> {
  const claimed = await deps.patchDispositionEvidence(row.id, (evidence) =>
    needsDispositionRescue({ ...row, evidence }, deps.nowMs(), !!deps.domainSearch)
      ? buildDispositionInProgressEvidence(evidence, deps.nowIso())
      : null,
  );
  if (!claimed) return { tag: 'skipped', cost: 0 };

  let found: FoundWebsite | null = null;
  let searchCost = 0;
  if (!row.domain) {
    if (!deps.domainSearch) return { tag: 'skipped', cost: 0 };
    const step = await resolveDispositionWebsite(row, ctx, deps, deps.domainSearch);
    if (step.kind === 'done') return step.outcome;
    found = step.found;
    searchCost = step.cost;
  }

  const baseCompany = dispositionToCompanyInput(row);
  const company = found
    ? { ...baseCompany, name: dispositionDisplayName(row), websiteOrDomain: found.website }
    : baseCompany;
  const result = await safeClassify(
    ctx.requestedIndustry
      ? {
          ...company,
          currentIndustryId: ctx.requestedIndustry.id,
          currentIndustryName: null,
          requestedIndustryName: ctx.requestedIndustry.name,
        }
      : { ...company, requestedIndustryName: row.industry },
    ctx.catalog,
    ctx.active,
    deps,
  );
  // Sitio ya pagado y comprobado: se guarda aunque la clasificación falle.
  const withFound = (evidence: Record<string, unknown> | null) =>
    found ? buildFoundEvidence(evidence, found, deps.nowIso()) : evidence;
  if (!result) {
    if (found) {
      await deps.patchDispositionEvidence(row.id, (evidence) => ({
        ...withFound(evidence),
        [CLAUDE_RESCUE_METADATA_KEY]: { ...buildRescueInProgress(deps.nowIso()), decision: 'retryable' },
      }));
    }
    return { tag: 'failed', cost: searchCost };
  }
  await logUsage(result, ctx.batchId, ctx.triggeredBy, deps);
  const cost = searchCost + (result.usage?.estimatedCostUsd ?? 0);

  const decision = decideRescue(result, {
    icpMinEmployees: DEFAULT_ICP_MIN_EMPLOYEES,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry,
  });
  const decidedAt = deps.nowIso();
  // Una fila de Descartadas sólo vuelve si el SECTOR quedó confirmado (se descartó por eso),
  // o si es de OTRA industria UBITS (vuelve con la industria corregida, sin contar para la meta).
  const goesBack = decision.kind === 'reassign' || (decision.kind === 'admit' && decision.sectorConfirmed);
  if (goesBack) {
    const origin =
      decision.kind === 'reassign'
        ? buildDispositionReassignOrigin(result, decision, DEFAULT_ICP_MIN_EMPLOYEES, decidedAt)
        : buildDispositionAdmissionOrigin(result, decision, DEFAULT_ICP_MIN_EMPLOYEES, decidedAt);
    const candidateId = await deps.admitDisposition(
      row.id,
      found
        ? {
            ...origin,
            metadata: {
              ...origin.metadata,
              [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: buildFoundEvidence(null, found, decidedAt)[
                CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY
              ],
              ...(buildUnverifiedHintWebsiteVerification(found)
                ? { website_verification: buildUnverifiedHintWebsiteVerification(found) }
                : {}),
            },
            columns: { ...buildFoundWebsiteColumns(row, found), ...(origin.columns ?? {}) },
          }
        : origin,
    );
    if (candidateId) {
      admittedIds.push(candidateId);
      await markSent(deps, row.id, origin.metadata);
      return { tag: decision.kind === 'reassign' ? 'reassigned' : 'admitted', cost };
    }
    return { tag: 'failed', cost };
  }
  // Se queda en Descartadas: si Claude completó algo pero no el sector, no es un «admit».
  const staysDecision = decision.kind === 'admit' ? ({ kind: 'unchanged', why: 'sector_unknown' } as const) : decision;
  const saved = await deps.patchDispositionEvidence(row.id, (evidence) =>
    buildDispositionStaysEvidence(withFound(evidence), result, staysDecision, decidedAt),
  );
  return { tag: saved ? 'kept' : 'failed', cost };
}

/** Marca final en la fila de Descartadas; un fallo sólo se registra (es informativo). */
async function markSent(deps: RescueBatchDeps, dispositionId: string, metadata: Record<string, unknown>) {
  const rescue = metadata[CLAUDE_RESCUE_METADATA_KEY];
  if (!deps.markDispositionSent || !rescue || typeof rescue !== 'object') return;
  try {
    await deps.markDispositionSent(dispositionId, rescue as Record<string, unknown>);
  } catch (err) {
    console.error('[claude-rescue] disposition mark failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Descartes por sector YA guardados que encajan con UBITS → revisión con la
 * industria corregida. Sólo lee la clasificación guardada: costo cero.
 */
async function reassignStoredSectorMismatches(
  batchId: string,
  requestedIndustryName: string | null,
  deps: RescueBatchDeps,
  reopenedIds: string[],
): Promise<number> {
  if (!deps.loadSectorMismatchDiscards) return 0;
  let loaded: Awaited<ReturnType<NonNullable<RescueBatchDeps['loadSectorMismatchDiscards']>>>;
  try {
    loaded = await deps.loadSectorMismatchDiscards(batchId);
  } catch (err) {
    console.error('[claude-rescue] stored sector discards read failed:', err instanceof Error ? err.message : err);
    return 0;
  }
  let reassigned = 0;
  const decidedAt = deps.nowIso();
  if (deps.reopenDiscardedCandidate) {
    for (const row of loaded.candidates) {
      const saved = await deps.reopenDiscardedCandidate(row.id, (metadata) => {
        const decision = decideStoredReassignment({
          stored: metadata,
          requestedIndustryName,
          icpMinEmployees: readIcpThreshold(metadata),
          sizePassedIcpGate: icpGatePassed(metadata),
        });
        return decision ? buildStoredReassignCandidatePatch(metadata, decision, decidedAt) : null;
      });
      if (saved) {
        reopenedIds.push(row.id);
        reassigned++;
      }
    }
  }
  for (const row of loaded.dispositions) {
    if (row.status !== 'discarded' || row.candidate_id) continue;
    const decision = decideStoredReassignment({
      stored: row.evidence,
      requestedIndustryName: requestedIndustryName ?? row.industry,
      icpMinEmployees: DEFAULT_ICP_MIN_EMPLOYEES,
      sizePassedIcpGate: false,
    });
    if (!decision) continue;
    const origin = buildStoredReassignDispositionOrigin(row.evidence, decision, decidedAt);
    const candidateId = await deps.admitDisposition(row.id, origin);
    if (candidateId) {
      reopenedIds.push(candidateId);
      await markSent(deps, row.id, origin.metadata);
      reassigned++;
    }
  }
  return reassigned;
}

/**
 * Candidatos en revisión cuya clasificación GUARDADA ya demuestra que están bajo el
 * umbral ICP → Descartadas con la cita. Sólo lee lo guardado: costo cero.
 */
async function discardStoredSmallSizes(
  candidates: readonly ClassifiableCandidateRow[],
  deps: RescueBatchDeps,
): Promise<Set<string>> {
  const discardedIds = new Set<string>();
  const decidedAt = deps.nowIso();
  for (const row of candidates) {
    if (!storedSmallSizeDiscard(row.metadata, readIcpThreshold(row.metadata))) continue;
    const saved = await deps.patchCandidate(row.id, (metadata) => {
      const threshold = readIcpThreshold(metadata);
      const decision = storedSmallSizeDiscard(metadata, threshold);
      return decision ? buildStoredSmallSizeDiscardPatch(metadata, decision, threshold, decidedAt) : null;
    });
    if (saved) discardedIds.add(row.id);
  }
  return discardedIds;
}

/** Procesa en paralelo; deja de EMPEZAR ítems nuevos cuando `shouldStop()` es true. */
async function mapUntil<T, R>(items: readonly T[], limit: number, shouldStop: () => boolean, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !shouldStop()) {
        const item = items[next++];
        results.push(await fn(item));
      }
    }),
  );
  return results;
}

export async function rescueBatchWithClaude(
  params: {
    batchId: string;
    triggeredBy: string | null;
    /** Tiempo para EMPEZAR empresas nuevas; por defecto RESCUE_RUN_DEADLINE_MS. */
    deadlineMs?: number;
    /** Lote del piloto «Claude busca empresas»: revisar también los que no traen completitud. */
    includeUnassessed?: boolean;
  },
  deps: RescueBatchDeps,
): Promise<RescueBatchSummary> {
  const deadlineMs = params.deadlineMs ?? RESCUE_RUN_DEADLINE_MS;
  const active = await deps.resolveActiveModel();
  if ('error' in active) return { ok: false, error: 'model_not_configured', detail: active.error };
  if (!(await deps.checkQuota()).allowed) return { ok: false, error: 'quota_exhausted' };

  let catalog: ClassifierCatalogIndustry[];
  let candidates: ClassifiableCandidateRow[];
  let dispositions: RescuableDispositionRow[];
  try {
    catalog = await deps.loadCatalog();
  } catch (err) {
    return { ok: false, error: 'catalog_unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  if (catalog.length === 0) return { ok: false, error: 'catalog_unavailable', detail: 'empty_catalog' };
  try {
    [candidates, dispositions] = await Promise.all([
      deps.loadReviewCandidates(params.batchId),
      deps.loadDispositions(params.batchId),
    ]);
  } catch (err) {
    return { ok: false, error: 'load_failed', detail: err instanceof Error ? err.message : String(err) };
  }

  const includeUnassessed =
    params.includeUnassessed === true ||
    (deps.loadBatchHasClaudeCompanySearch
      ? await deps.loadBatchHasClaudeCompanySearch(params.batchId).catch(() => false)
      : false);
  const startedMs = deps.nowMs();
  const storedSizeDiscards = await discardStoredSmallSizes(candidates, deps);
  const work: WorkItem[] = [
    ...candidates
      .filter((row) => !storedSizeDiscards.has(row.id))
      .filter((row) => needsCandidateRescue(row, startedMs, { includeUnassessed }))
      .map((row) => ({ kind: 'candidate' as const, row })),
    ...dispositions.filter((row) => needsDispositionRescue(row, startedMs, !!deps.domainSearch)).map((row) => ({ kind: 'disposition' as const, row })),
  ];
  const thisRun = work.slice(0, RESCUE_MAX_COMPANIES_PER_RUN);
  const requestedIndustryId = await deps.loadBatchIndustryId(params.batchId).catch(() => null);
  const requestedCatalogIndustry = catalog.find((i) => i.industryId === requestedIndustryId) ?? null;
  const ctx: RescueRunContext = {
    batchId: params.batchId,
    triggeredBy: params.triggeredBy,
    catalog,
    active,
    requestedIndustry: requestedCatalogIndustry
      ? { id: requestedCatalogIndustry.industryId, name: requestedCatalogIndustry.industryName }
      : null,
  };
  const admittedIds: string[] = [];
  const storedReassigned = await reassignStoredSectorMismatches(
    params.batchId,
    ctx.requestedIndustry?.name ?? null,
    deps,
    admittedIds,
  );

  const outcomes = await mapUntil(
    thisRun,
    RESCUE_CONCURRENCY,
    () => deps.nowMs() - startedMs >= deadlineMs,
    (item) =>
      item.kind === 'candidate' ? rescueCandidate(item.row, ctx, deps) : rescueDisposition(item.row, ctx, deps, admittedIds),
  );

  // «Una empresa, un vendedor»: si otro vendedor ya la tiene, el reclamo la marca duplicada.
  if (admittedIds.length > 0) await deps.claimIdentities(params.batchId, admittedIds);

  const count = (tag: ItemOutcome['tag']) => outcomes.filter((o) => o.tag === tag).length;
  return {
    ok: true,
    candidatesCompleted: count('completed'),
    candidatesDiscarded: count('discarded') + storedSizeDiscards.size,
    candidatesUnchanged: count('unchanged'),
    dispositionsAdmitted: count('admitted'),
    dispositionsKept: count('kept'),
    reassigned: count('reassigned') + storedReassigned,
    failed: count('failed'),
    remaining: work.length - outcomes.filter((o) => o.tag !== 'skipped').length,
    estimatedCostUsd: Math.round(outcomes.reduce((acc, o) => acc + o.cost, 0) * 1_000_000) / 1_000_000,
  };
}
