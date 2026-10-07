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
  isAccountLevelModelError,
  readFoundWebsite,
  unverifiedWebsiteHint,
  dispositionTaxId,
  OFFICIAL_NAME_COUNTRIES,
  officialTradeNameWebsite,
  previousClaimedUrl,
  registryFirstWordWebsite,
  DOMAIN_SEARCH_REASON_CODE,
  PARENT_GROUP_WEBSITE_KEY,
  parentGroupWebsite,
  type DomainDuplicateCheck,
  type FoundWebsite,
  type ParentGroupWebsite,
} from './domain-search';
import { decideRescue, DEFAULT_ICP_MIN_EMPLOYEES, storedSmallSizeDiscard } from './rescue-decision';
import { officialSizeSignal } from './official-size-signal';
import {
  lookUpRescueOfficialIdentity,
  withRescueOfficialIdentity,
  type RescueOfficialIdentityResolver,
} from './rescue-official-identity';
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
  OFFICIAL_SIZE_RULE_MARKER,
  type RescuableDispositionRow,
} from './rescue-dispositions';
import { institutionWebMatchesName } from './institution-web-name-match';

/**
 * Empresas a la vez. 6 (antes 4) por decisión de la dueña (06-10): en Chile ×
 * Salud y Chile × Tecnología el rescate en segundo plano sólo alcanzaba ~15 de 50
 * dentro del tiempo de la búsqueda. Cada empresa espera sobre todo a la red
 * (búsqueda web de Claude, descarga de páginas); sin 429 de Anthropic medidos con 4.
 */
export const RESCUE_CONCURRENCY = 6;
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
  /**
   * SOURCES-CL-RESCUE-OFFICIAL-IDENTITY-1 — número fiscal oficial (SII, RES…) de lo
   * que el rescate admite sin él. Opcional: sin esto, como antes.
   */
  resolveOfficialIdentity?: RescueOfficialIdentityResolver;
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
    /**
     * SOURCES-EC-CLOSE-2 — nombre comercial y sigla OFICIALES de ese número fiscal
     * (sólo lectura; `[]` si no hay o falla). Ausente = no se usan.
     */
    officialNames?: (input: { countryCode: string; taxId: string }) => Promise<string[]>;
    /**
     * AGENT1-RESCUE-KNOWN-COMPANY-GUARD-1 — ¿SellUp ya tiene esta empresa por otro
     * camino (mismo nombre base en el lote, mismo número fiscal vivo)? Sólo lectura;
     * `null` = nueva. Ausente = sólo el control por web (como antes).
     */
    findKnownCompany?: (input: {
      batchId: string;
      taxId: string | null;
      names: readonly string[];
    }) => Promise<DomainDuplicateCheck | null>;
  };
  /**
   * AGENT1-DELIVERY-CAP-HARD-1 — lugares libres en el lote bajo el tope de entrega
   * (máximo 10 por búsqueda): tope menos lo que ya está vivo en el lote. `null` =
   * sin tope. Ausente = sin tope (como antes).
   */
  deliverySlots?: (batchId: string) => Promise<number | null>;
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
      /**
       * AGENT1-DELIVERY-CAP-HARD-1 — descartadas que no se revisaron porque el lote ya
       * estaba en el tope de entrega (sin gasto; se quedan en Descartadas).
       */
      dispositionsCapped?: number;
    }
  | { ok: false; error: 'model_not_configured' | 'quota_exhausted' | 'catalog_unavailable' | 'load_failed'; detail?: string };

type WorkItem =
  | { kind: 'candidate'; row: ClassifiableCandidateRow }
  | { kind: 'disposition'; row: RescuableDispositionRow };

type ItemOutcome =
  | {
      tag: 'completed' | 'discarded' | 'unchanged' | 'admitted' | 'reassigned' | 'kept' | 'failed' | 'skipped' | 'capped';
      cost: number;
    };

/** AGENT1-DELIVERY-CAP-HARD-1 — lugares libres en el lote (Infinity = sin tope). */
type DeliverySlots = {
  remaining: number;
  /** Lugares apartados por filas que Claude está revisando ahora mismo. */
  reserved?: number;
  /** Filas esperando a que una revisión en curso devuelva su lugar. */
  waiters?: Array<() => void>;
};

/** Despierta a las filas que esperaban un lugar (cada una vuelve a mirar). */
function releaseSlotWaiters(slots: DeliverySlots): void {
  const waiters = slots.waiters ?? [];
  slots.waiters = [];
  for (const wake of waiters) wake();
}

/**
 * AGENT1-RESCUE-WAITS-FOR-RESERVED-SLOTS-1 — sin lugar libre pero con lugares
 * APARTADOS por revisiones en curso, la fila espera a que terminen: si esas no
 * entran, el lugar vuelve y le toca. Sólo sin lugares libres NI apartados se queda
 * en Descartadas. Prod 07-10 (Costa Rica × Servicios, bbc7a8ad): 3 lugares libres,
 * 6 revisiones a la vez; las 3 primeras terminaron sin entrar y las otras 8 (con
 * Concentrix y P&G) quedaron «capped» sin revisar.
 */
async function reserveDeliverySlot(slots: DeliverySlots): Promise<boolean> {
  while (slots.remaining <= 0) {
    if ((slots.reserved ?? 0) <= 0) return false;
    await new Promise<void>((resolve) => (slots.waiters ??= []).push(resolve));
  }
  slots.remaining--;
  slots.reserved = (slots.reserved ?? 0) + 1;
  return true;
}

/**
 * Reserva un lugar ANTES de gastar en Claude; si la fila no termina en revisión, lo
 * devuelve. Sin lugar ⇒ ni se revisa (cero gasto) y se queda en Descartadas.
 *
 * AGENT1-RESCUE-SLOTS-REQUESTED-INDUSTRY-1 — una empresa de OTRA industria
 * (`reassigned`) vuelve a revisión con su industria corregida pero NO ocupa uno
 * de los 10 lugares de la búsqueda: el lugar vuelve. Prod 07-10 (Ecuador ×
 * Retail, 2aab8384): Proexpo (mariscos) y Olimpo Flowers ocuparon lugares de
 * Retail y Kywi, Pycca o Eljuri se quedaron en Descartadas.
 */
async function rescueDispositionWithinCap(
  row: RescuableDispositionRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
  admittedIds: string[],
): Promise<ItemOutcome> {
  if (!(await reserveDeliverySlot(ctx.slots))) return { tag: 'capped', cost: 0 };
  let kept = false;
  try {
    const outcome = await rescueDisposition(row, ctx, deps, admittedIds);
    kept = keepsDeliverySlot(outcome.tag);
    return outcome;
  } finally {
    ctx.slots.reserved = (ctx.slots.reserved ?? 1) - 1;
    if (!kept) ctx.slots.remaining++;
    releaseSlotWaiters(ctx.slots);
  }
}

/** Sólo una empresa de la industria pedida que entra a revisión ocupa uno de los lugares. */
export function keepsDeliverySlot(tag: ItemOutcome['tag']): boolean {
  return tag === 'admitted';
}

/** Un candidato en revisión que resulta de OTRA industria deja libre su lugar. */
async function rescueCandidateFreeingSlot(
  row: ClassifiableCandidateRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
): Promise<ItemOutcome> {
  const outcome = await rescueCandidate(row, ctx, deps);
  if (outcome.tag === 'reassigned') {
    ctx.slots.remaining++;
    releaseSlotWaiters(ctx.slots);
  }
  return outcome;
}

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
  /**
   * Se enciende al primer error de la CUENTA de Anthropic (saldo, credenciales):
   * no se empieza ninguna empresa más en esta corrida.
   */
  halt: { accountError: boolean };
  /** AGENT1-DELIVERY-CAP-HARD-1 — lugares libres bajo el tope de entrega. */
  slots: DeliverySlots;
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
  if (ctx.halt.accountError) return { tag: 'skipped', cost: 0 };
  const claimed = await deps.patchCandidate(row.id, (metadata) =>
    rescueStillPending(metadata?.[CLAUDE_RESCUE_METADATA_KEY], deps.nowMs(), metadata?.claude_classification)
      ? { metadata: { ...(metadata ?? {}), [CLAUDE_RESCUE_METADATA_KEY]: buildRescueInProgress(deps.nowIso()) } }
      : null,
  );
  if (!claimed) return { tag: 'skipped', cost: 0 };

  const result = await safeClassify(candidateToCompany(row, ctx), ctx.catalog, ctx.active, deps);
  if (!result) return { tag: 'failed', cost: 0 };
  await logUsage(result, ctx.batchId, ctx.triggeredBy, deps);

  // SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — tamaño ya medido por la fuente oficial.
  const official = officialSizeSignal({
    countryCode: row.country_code,
    fromFreeLayer: row.source_primary === 'public_source',
  });
  const minEmployees = official.measured ? official.minEmployees : readIcpThreshold(row.metadata);
  const decision = decideRescue(result, {
    icpMinEmployees: minEmployees,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry ?? null,
    sizeAlreadyConfirmed: official.measured || sizeAlreadyConfirmed(row.metadata),
    sizePassedIcpGate: icpGatePassed(row.metadata),
  });
  const decidedAt = deps.nowIso();
  const identity =
    decision.kind === 'admit'
      ? await lookUpRescueOfficialIdentity(deps.resolveOfficialIdentity, {
          name: row.name ?? '',
          website: row.website,
          domain: row.domain,
          countryCode: row.country_code,
          country: row.country,
          existingTaxIdentifier: row.tax_identifier ?? null,
        })
      : null;
  const saved = await deps.patchCandidate(row.id, (metadata) =>
    withRescueOfficialIdentity(buildCandidateRescuePatch({ metadata, result, decision, minEmployees, decidedAt }), identity),
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
  | { kind: 'done'; outcome: ItemOutcome }
  /** AGENT1-RESCUE-SUBSIDIARY-WITHOUT-WEB-1 — filial grande cuya única web es la de la matriz. */
  | {
      kind: 'parent';
      parent: ParentGroupWebsite;
      outcome: Extract<DomainFinderOutcome, { found: false }>;
      searchedAt: string;
      cost: number;
    };

/**
 * AGENT1-RESCUE-SUBSIDIARY-WITHOUT-WEB-1 — ¿la fuente OFICIAL dice que es grande?
 * Sólo filas del buscador gratuito: la fuente ya filtra por tamaño (CL, EC, DO, PE),
 * trae los trabajadores (≥ umbral) o la marca «grande» por tramo (CR: Grandes
 * Contribuyentes de Hacienda, dueña 07-10). Sin ese dato, no entra sin web.
 */
export function isOfficiallyLargeFreeLayerRow(
  row: Pick<RescuableDispositionRow, 'round_origin' | 'country_code' | 'evidence'>,
): boolean {
  if (row.round_origin !== 'free_source' || row.evidence?.tax_identifier_present !== true) return false;
  const official = officialSizeSignal({ countryCode: row.country_code, fromFreeLayer: true });
  if (official.measured) return true;
  const workforce = row.evidence?.official_workforce as { workers?: unknown } | undefined;
  if (typeof workforce?.workers === 'number' && workforce.workers >= official.minEmployees) return true;
  const band = row.evidence?.official_size_band as { band?: unknown } | undefined;
  return band?.band === 'large';
}

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
  // SOURCES-EC-CLOSE-2 — nombre comercial / sigla oficial del mismo número fiscal.
  const country = (row.country_code ?? '').toUpperCase();
  const taxId = dispositionTaxId(row);
  const usesOfficialNames = !found && !!domainSearch.officialNames && OFFICIAL_NAME_COUNTRIES.has(country) && taxId !== null;
  let officialNames: string[] = [];
  if (usesOfficialNames && taxId !== null) {
    try {
      officialNames = await domainSearch.officialNames!({ countryCode: country, taxId });
    } catch {
      officialNames = [];
    }
  }
  // La web que Claude ya había propuesto antes: si es la marca oficial, vale sin volver a pagar.
  const officialFallback = (claimedUrl: string | null | undefined): FoundWebsite | null =>
    officialTradeNameWebsite(claimedUrl, officialNames, dispositionDisplayName(row), country) ??
    (usesOfficialNames ? registryFirstWordWebsite(claimedUrl, dispositionDisplayName(row), country) : null);
  if (!found) found = officialFallback(previousClaimedUrl(row.evidence));
  if (!found) {
    const startedMs = deps.nowMs();
    let outcome: DomainFinderOutcome;
    try {
      outcome = await domainSearch.findWebsite(buildDomainFinderInput(row, null, officialNames), ctx.active);
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
    if (isAccountLevelModelError(outcome)) ctx.halt.accountError = true;
    // d6: la web propuesta no abrió, pero la empresa trae número fiscal oficial y el
    // dominio lleva su nombre ⇒ sigue como PISTA sin confirmar.
    const official = outcome.found ? null : officialFallback(outcome.claimedUrl);
    const hint = official ?? unverifiedWebsiteHint(row, outcome);
    // AGENT1-RESCUE-SUBSIDIARY-WITHOUT-WEB-1 — filial grande con sólo la web de la matriz.
    const parent = !hint && !outcome.found && isOfficiallyLargeFreeLayerRow(row) ? parentGroupWebsite(row, outcome) : null;
    if (parent && !outcome.found) return { kind: 'parent', parent, outcome, searchedAt, cost };
    if (hint) {
      found = hint;
    } else if (!outcome.found) {
      const saved = await deps.patchDispositionEvidence(row.id, (evidence) =>
        buildDomainSearchStaysEvidence(evidence, { kind: 'not_found', outcome }, searchedAt, {
          officialNamesChecked: usesOfficialNames,
        }),
      );
      return { kind: 'done', outcome: { tag: saved ? 'kept' : 'failed', cost } };
    } else {
      found = { website: outcome.website, domain: outcome.domain, verification: outcome.verification };
    }
  }

  // AGENT1-RESCUE-INSTITUTION-WEB-NAME-1 — una web .gob/.edu de OTRA entidad no vale.
  if (!institutionWebMatchesName(found.domain, [dispositionDisplayName(row), row.name ?? '', ...officialNames])) {
    const at = deps.nowIso();
    const outcome = { found: false as const, reason: 'identity_not_confirmed' as const, claimedUrl: found.website, usage: null };
    const saved = await deps.patchDispositionEvidence(row.id, (evidence) =>
      buildDomainSearchStaysEvidence(evidence, { kind: 'not_found', outcome }, at, { officialNamesChecked: usesOfficialNames }),
    );
    return { kind: 'done', outcome: { tag: saved ? 'kept' : 'failed', cost } };
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
  if (duplicate.status === 'new_candidate' && domainSearch.findKnownCompany) {
    // La web encontrada puede ser OTRA de una empresa que SellUp ya tiene (Prod 07-10:
    // «PYCCA S.A.» con polipapel.com mientras «Pycca», pycca.com, ya estaba en el lote).
    // Fail-open: el control por web ya pasó; un fallo de esta lectura sólo se registra.
    try {
      const known = await domainSearch.findKnownCompany({
        batchId: ctx.batchId,
        taxId,
        names: [dispositionDisplayName(row), row.name ?? ''],
      });
      if (known) duplicate = known;
    } catch (err) {
      console.error('[claude-rescue] known company check failed:', err instanceof Error ? err.message : err);
    }
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

/**
 * AGENT1-RESCUE-SUBSIDIARY-WITHOUT-WEB-1 — filial GRANDE (según la fuente oficial) de un
 * grupo cuya única web es la de la matriz (amazon.com para AMAZON SUPPORT SERVICES COSTA
 * RICA). Entra a revisión SIN web sólo si, además:
 *   · no es duplicada (SellUp + HubSpot por NOMBRE, y la guarda de nombre/número fiscal;
 *     nunca por el dominio global, que sería la matriz);
 *   · Claude, leyendo la web de la matriz, CONFIRMA la industria pedida.
 * La web global nunca se guarda como la del candidato (sólo como referencia), el reclamo
 * «una empresa, un vendedor» va por el número fiscal, y el tamaño es el oficial (no el
 * de la matriz). Si algo falla, se queda en Descartadas como antes.
 */
/** Columnas que en la vía de la matriz describirían a la MATRIZ, no a la filial. */
const PARENT_PAGE_COLUMNS = [
  'website',
  'employee_count',
  'employee_count_status',
  'employee_count_source',
  'employee_count_confidence',
] as const;

function withoutKeys(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

async function rescueParentGroupDisposition(
  row: RescuableDispositionRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
  domainSearch: NonNullable<RescueBatchDeps['domainSearch']>,
  admittedIds: string[],
  step: Extract<WebsiteStep, { kind: 'parent' }>,
): Promise<ItemOutcome> {
  const { parent, outcome, searchedAt } = step;
  const displayName = dispositionDisplayName(row);
  const parentRef = (extra: Record<string, unknown>) => ({
    [PARENT_GROUP_WEBSITE_KEY]: { website: parent.website, domain: parent.domain, searched_at: searchedAt, ...extra },
  });
  const stays = async (extra: Record<string, unknown>, cost: number): Promise<ItemOutcome> => {
    const saved = await deps.patchDispositionEvidence(row.id, (evidence) => ({
      ...buildDomainSearchStaysEvidence(evidence, { kind: 'not_found', outcome }, searchedAt),
      ...parentRef(extra),
    }));
    return { tag: saved ? 'kept' : 'failed', cost };
  };

  let duplicate: DomainDuplicateCheck;
  try {
    duplicate = await domainSearch.checkDuplicate({ name: displayName, website: null, domain: null, countryCode: row.country_code });
    if (duplicate.status === 'new_candidate' && domainSearch.findKnownCompany) {
      const known = await domainSearch
        .findKnownCompany({ batchId: ctx.batchId, taxId: dispositionTaxId(row), names: [displayName, row.name ?? ''] })
        .catch(() => null);
      if (known) duplicate = known;
    }
  } catch (err) {
    console.error('[claude-rescue] parent-group duplicate check failed:', err instanceof Error ? err.message : err);
    return stays({ decision: 'retryable' }, step.cost);
  }
  if (duplicate.status !== 'new_candidate') return stays({ duplicate_status: duplicate.status }, step.cost);

  const company = { ...dispositionToCompanyInput(row), name: displayName, websiteOrDomain: parent.website };
  const result = await safeClassify(
    ctx.requestedIndustry
      ? { ...company, currentIndustryId: ctx.requestedIndustry.id, currentIndustryName: null, requestedIndustryName: ctx.requestedIndustry.name }
      : { ...company, requestedIndustryName: row.industry },
    ctx.catalog,
    ctx.active,
    deps,
  );
  if (!result) return stays({ decision: 'classification_failed' }, step.cost);
  await logUsage(result, ctx.batchId, ctx.triggeredBy, deps);
  const cost = step.cost + (result.usage?.estimatedCostUsd ?? 0);

  const official = officialSizeSignal({ countryCode: row.country_code, fromFreeLayer: true });
  const decision = decideRescue(result, {
    icpMinEmployees: official.minEmployees,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry,
    sizeAlreadyConfirmed: true,
    officialSizeMeasured: true,
  });
  if (decision.kind !== 'admit' || !decision.sectorConfirmed) {
    return stays({ sector_confirmed: false, decision: decision.kind }, cost);
  }

  const decidedAt = deps.nowIso();
  const base = buildDispositionAdmissionOrigin(result, decision, official.minEmployees, decidedAt);
  // Lo que Claude leyó en la web de la MATRIZ (sitio, empleados) no es de la filial.
  const columns = withoutKeys(base.columns ?? {}, PARENT_PAGE_COLUMNS);
  const metadata = withoutKeys(base.metadata, ['icp_size_gate']);
  const candidateId = await deps.admitDisposition(row.id, {
    ...base,
    reviewNote: `Filial de grupo sin web propia (la web ${parent.domain} es de la matriz). Rescatada por Claude: ${
      result.sector?.industryName ?? 'sector del lote'
    }. Completar la web local.`,
    metadata: { ...metadata, ...parentRef({ web_pending: true }) },
    columns: { ...columns, name: displayName },
  });
  if (!candidateId) return { tag: 'failed', cost };
  admittedIds.push(candidateId);
  await markSent(deps, row.id, base.metadata);
  return { tag: 'admitted', cost };
}

async function rescueDisposition(
  row: RescuableDispositionRow,
  ctx: RescueRunContext,
  deps: RescueBatchDeps,
  admittedIds: string[],
): Promise<ItemOutcome> {
  // Cuenta de Anthropic caída: ni se marca «en proceso» (quedaría colgada 15 min).
  if (ctx.halt.accountError) return { tag: 'skipped', cost: 0 };
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
    if (step.kind === 'parent') return rescueParentGroupDisposition(row, ctx, deps, deps.domainSearch, admittedIds, step);
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

  // SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — tamaño ya medido por la fuente oficial.
  const official = officialSizeSignal({
    countryCode: row.country_code,
    fromFreeLayer: row.round_origin === 'free_source' || row.evidence?.tax_identifier_present === true,
  });
  const decision = decideRescue(result, {
    icpMinEmployees: official.minEmployees,
    requestedIndustryName: ctx.requestedIndustry?.name ?? row.industry,
    ...(official.measured ? { sizeAlreadyConfirmed: true, officialSizeMeasured: true } : {}),
  });
  const decidedAt = deps.nowIso();
  // Una fila de Descartadas sólo vuelve si el SECTOR quedó confirmado (se descartó por eso),
  // o si es de OTRA industria UBITS (vuelve con la industria corregida, sin contar para la meta).
  // SOURCES-EC-CLOSE-2 — una del buscador gratuito descartada SÓLO por falta de web, con
  // la web ya encontrada y el tamaño medido por la fuente oficial: su industria viene de
  // la tabla oficial del país, no de Claude. Vuelve aunque Claude no confirme el sector
  // (con el aviso de sector sin confirmar, si lo hay).
  const officialFreeLayerWebOnly =
    official.measured && !!found && row.reason_code === DOMAIN_SEARCH_REASON_CODE;
  const goesBack =
    decision.kind === 'reassign' ||
    (decision.kind === 'admit' && (decision.sectorConfirmed || officialFreeLayerWebOnly));
  if (goesBack) {
    const baseOrigin =
      decision.kind === 'reassign'
        ? buildDispositionReassignOrigin(result, decision, official.minEmployees, decidedAt)
        : buildDispositionAdmissionOrigin(result, decision, official.minEmployees, decidedAt);
    // Las del buscador gratuito ya traen su número fiscal (send-to-review-core);
    // el resto lo busca en las fuentes oficiales con el sitio encontrado.
    const identity =
      row.evidence?.tax_identifier_present === true
        ? null
        : await lookUpRescueOfficialIdentity(deps.resolveOfficialIdentity, {
            name: found ? dispositionDisplayName(row) : row.name,
            website: found?.website ?? null,
            domain: found?.domain ?? row.domain,
            countryCode: row.country_code,
            country: null,
          });
    const origin = identity
      ? {
          ...baseOrigin,
          metadata: { ...baseOrigin.metadata, official_source_enrichment: identity.metadata },
          columns: { ...(baseOrigin.columns ?? {}), ...identity.columns },
        }
      : baseOrigin;
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
  const saved = await deps.patchDispositionEvidence(row.id, (evidence) => {
    const stays = buildDispositionStaysEvidence(withFound(evidence), result, staysDecision, decidedAt);
    if (!official.measured) return stays;
    // Decidida YA con la regla del tamaño oficial: no se reintenta por ella.
    const rescue = stays[CLAUDE_RESCUE_METADATA_KEY] as Record<string, unknown> | undefined;
    return { ...stays, [CLAUDE_RESCUE_METADATA_KEY]: { ...(rescue ?? {}), [OFFICIAL_SIZE_RULE_MARKER]: true } };
  });
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
 *
 * AGENT1-RESCUE-SLOTS-REQUESTED-INDUSTRY-1 — son de OTRA industria: no ocupan
 * los lugares de la búsqueda (antes sí, y dejaban fuera a las de la industria pedida).
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
    // Tamaño medido por la fuente oficial: una cifra guardada de Claude no la descarta.
    if (officialSizeSignal({ countryCode: row.country_code, fromFreeLayer: row.source_primary === 'public_source' }).measured) {
      continue;
    }
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

/**
 * AGENT1-FREE-LAYER-RESCUE-FIRST-1 — descartada del buscador gratuito sólo por
 * falta de web, con número fiscal oficial. Prod 07-10 (BO×Tecnología 84ddefb7):
 * Entel, ZTE, Garo… llegaron con NIT y sin web, Tavily llenó el lote hasta el tope y
 * el rescate nunca les buscó la web.
 */
export function isFreeSourceMissingDomainDisposition(
  row: Pick<RescuableDispositionRow, 'round_origin' | 'reason_code' | 'provider_identifier' | 'domain'>,
): boolean {
  return (
    row.round_origin === 'free_source' &&
    row.reason_code === 'missing_domain_final' &&
    !row.domain &&
    (row.provider_identifier ?? '').startsWith('tax:')
  );
}

export async function rescueBatchWithClaude(
  params: {
    batchId: string;
    triggeredBy: string | null;
    /** Tiempo para EMPEZAR empresas nuevas; por defecto RESCUE_RUN_DEADLINE_MS. */
    deadlineMs?: number;
    /** Lote del piloto «Claude busca empresas»: revisar también los que no traen completitud. */
    includeUnassessed?: boolean;
    /**
     * AGENT1-FREE-LAYER-RESCUE-FIRST-1 — revisar SÓLO las descartadas sin web del
     * buscador gratuito con número fiscal (round_origin free_source,
     * missing_domain_final, `tax:`), nada de candidatas ni de Apollo/Tavily. Para la
     * pasada que corre ANTES de Tavily dentro de la búsqueda.
     */
    onlyFreeSourceMissingDomain?: boolean;
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
  const onlyFreeSource = params.onlyFreeSourceMissingDomain === true;
  const storedSizeDiscards = onlyFreeSource ? new Set<string>() : await discardStoredSmallSizes(candidates, deps);
  const work: WorkItem[] = [
    ...(onlyFreeSource ? [] : candidates)
      .filter((row) => !storedSizeDiscards.has(row.id))
      .filter((row) => needsCandidateRescue(row, startedMs, { includeUnassessed }))
      .map((row) => ({ kind: 'candidate' as const, row })),
    ...dispositions
      .filter((row) => !onlyFreeSource || isFreeSourceMissingDomainDisposition(row))
      .filter((row) => needsDispositionRescue(row, startedMs, !!deps.domainSearch))
      .map((row) => ({ kind: 'disposition' as const, row })),
  ];
  const thisRun = work.slice(0, RESCUE_MAX_COMPANIES_PER_RUN);
  const requestedIndustryId = await deps.loadBatchIndustryId(params.batchId).catch(() => null);
  // AGENT1-DELIVERY-CAP-HARD-1 — si no se puede leer, el rescate sigue como antes.
  const freeSlots = deps.deliverySlots ? await deps.deliverySlots(params.batchId).catch(() => null) : null;
  const requestedCatalogIndustry = catalog.find((i) => i.industryId === requestedIndustryId) ?? null;
  const ctx: RescueRunContext = {
    batchId: params.batchId,
    triggeredBy: params.triggeredBy,
    catalog,
    active,
    requestedIndustry: requestedCatalogIndustry
      ? { id: requestedCatalogIndustry.industryId, name: requestedCatalogIndustry.industryName }
      : null,
    halt: { accountError: false },
    slots: { remaining: freeSlots === null ? Number.POSITIVE_INFINITY : Math.max(0, freeSlots) },
  };
  const admittedIds: string[] = [];
  const storedReassigned = onlyFreeSource
    ? 0
    : await reassignStoredSectorMismatches(params.batchId, ctx.requestedIndustry?.name ?? null, deps, admittedIds);

  const outcomes = await mapUntil(
    thisRun,
    RESCUE_CONCURRENCY,
    () => ctx.halt.accountError || deps.nowMs() - startedMs >= deadlineMs,
    (item) =>
      item.kind === 'candidate'
        ? rescueCandidateFreeingSlot(item.row, ctx, deps)
        : rescueDispositionWithinCap(item.row, ctx, deps, admittedIds),
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
    dispositionsCapped: count('capped'),
  };
}
