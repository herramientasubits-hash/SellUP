/**
 * Agente 1 · Rescate con Claude — orquestación de un lote (dependencias inyectadas).
 *
 * Corre en segundo plano al terminar una búsqueda del asistente:
 *  1. «Candidatos por revisar» a los que les falta sector o tamaño;
 *  2. «Descartadas» por falta de datos.
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
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import { decideRescue, DEFAULT_ICP_MIN_EMPLOYEES } from './rescue-decision';
import {
  buildCandidateRescuePatch,
  buildRescueInProgress,
  CLAUDE_RESCUE_METADATA_KEY,
  rescueStillPending,
  type CandidateRescuePatch,
} from './rescue-patch';
import {
  buildDispositionAdmissionOrigin,
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
  /** «Una empresa, un vendedor»: reclama la identidad de los candidatos rescatados. */
  claimIdentities: (batchId: string, candidateIds: readonly string[]) => Promise<void>;
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
      failed: number;
      remaining: number;
      estimatedCostUsd: number;
    }
  | { ok: false; error: 'model_not_configured' | 'quota_exhausted' | 'catalog_unavailable' | 'load_failed'; detail?: string };

type WorkItem =
  | { kind: 'candidate'; row: ClassifiableCandidateRow }
  | { kind: 'disposition'; row: RescuableDispositionRow };

type ItemOutcome =
  | { tag: 'completed' | 'discarded' | 'unchanged' | 'admitted' | 'kept' | 'failed' | 'skipped'; cost: number };

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

export function needsCandidateRescue(row: ClassifiableCandidateRow, nowMs: number): boolean {
  if (row.status !== 'needs_review') return false;
  if (!row.website && !row.domain) return false;
  if (!rescueStillPending(row.metadata?.[CLAUDE_RESCUE_METADATA_KEY], nowMs)) return false;
  if (isLushaSectorReview(row)) return true;
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
    rescueStillPending(metadata?.[CLAUDE_RESCUE_METADATA_KEY], deps.nowMs())
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
  });
  const decidedAt = deps.nowIso();
  const saved = await deps.patchCandidate(row.id, (metadata) =>
    buildCandidateRescuePatch({ metadata, result, decision, minEmployees, decidedAt }),
  );
  const cost = result.usage?.estimatedCostUsd ?? 0;
  if (!saved) return { tag: 'failed', cost };
  if (decision.kind === 'discard') return { tag: 'discarded', cost };
  if (decision.kind === 'admit') return { tag: 'completed', cost };
  return { tag: 'unchanged', cost };
}

async function rescueDisposition(
  row: RescuableDispositionRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
  admittedIds: string[],
): Promise<ItemOutcome> {
  const claimed = await deps.patchDispositionEvidence(row.id, (evidence) =>
    needsDispositionRescue({ ...row, evidence }, deps.nowMs())
      ? buildDispositionInProgressEvidence(evidence, deps.nowIso())
      : null,
  );
  if (!claimed) return { tag: 'skipped', cost: 0 };

  const company = dispositionToCompanyInput(row);
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
  if (!result) return { tag: 'failed', cost: 0 };
  await logUsage(result, ctx.batchId, ctx.triggeredBy, deps);
  const cost = result.usage?.estimatedCostUsd ?? 0;

  const decision = decideRescue(result, {
    icpMinEmployees: DEFAULT_ICP_MIN_EMPLOYEES,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry,
  });
  const decidedAt = deps.nowIso();
  // Una fila de Descartadas sólo vuelve si el SECTOR quedó confirmado (se descartó por eso).
  if (decision.kind === 'admit' && decision.sectorConfirmed) {
    const candidateId = await deps.admitDisposition(
      row.id,
      buildDispositionAdmissionOrigin(result, decision, DEFAULT_ICP_MIN_EMPLOYEES, decidedAt),
    );
    if (candidateId) {
      admittedIds.push(candidateId);
      return { tag: 'admitted', cost };
    }
    return { tag: 'failed', cost };
  }
  // Se queda en Descartadas: si Claude completó algo pero no el sector, no es un «admit».
  const staysDecision = decision.kind === 'admit' ? ({ kind: 'unchanged', why: 'sector_unknown' } as const) : decision;
  const saved = await deps.patchDispositionEvidence(row.id, (evidence) =>
    buildDispositionStaysEvidence(evidence, result, staysDecision, decidedAt),
  );
  return { tag: saved ? 'kept' : 'failed', cost };
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

  const startedMs = deps.nowMs();
  const work: WorkItem[] = [
    ...candidates.filter((row) => needsCandidateRescue(row, startedMs)).map((row) => ({ kind: 'candidate' as const, row })),
    ...dispositions.filter((row) => needsDispositionRescue(row, startedMs)).map((row) => ({ kind: 'disposition' as const, row })),
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
    candidatesDiscarded: count('discarded'),
    candidatesUnchanged: count('unchanged'),
    dispositionsAdmitted: count('admitted'),
    dispositionsKept: count('kept'),
    failed: count('failed'),
    remaining: work.length - outcomes.filter((o) => o.tag !== 'skipped').length,
    estimatedCostUsd: Math.round(outcomes.reduce((acc, o) => acc + o.cost, 0) * 1_000_000) / 1_000_000,
  };
}
