/**
 * Agente 1 · Rescate con Claude — dependencias reales (sólo servidor).
 *
 * Todo con el cliente ADMINISTRATIVO: el rescate corre en segundo plano y la
 * tabla de reclamos globales sólo admite `service_role` (igual que Lusha).
 *
 * Escrituras: sólo `prospect_candidates` (metadata, tamaño estimado y, si Claude
 * demuestra que no cumple, `status='discarded'`), `prospect_discarded_dispositions`
 * (evidencia o paso a revisión) y el reclamo de identidad. Nunca aprueba nada.
 */

import { isAgent1ClaudeDomainFinderEnabled } from '@/lib/feature-flags.server';
import { buildLiveRescueOfficialIdentityResolver } from './rescue-official-identity.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveMaxDeliveredCandidates } from '@/modules/prospect-batches/delivery-cap';
import { BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES } from '../../batch-identity-registry';
import { checkProviderQuotaAvailable } from '@/modules/budgets/budget-resolution';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { sendDispositionToReviewCore } from '@/modules/prospect-discards/send-to-review-core';
import { claimGlobalIdentitiesForPersistedCandidates } from '@/server/prospect-batches/global-identity-claims-store';
import { checkCompanyDuplicate } from '../../duplicate-checker';
import { fetchSafePageHtml } from '../../website-verifier';
import { CLAUDE_PAGE_MAX_HTML_BYTES } from '../page-text';
import type { ClassifiableCandidateRow } from '../classification-metadata';
import { buildLiveClassifyCompanyDeps } from '../classify-company';
import { findOfficialWebsite } from '../domain-finder';
import {
  CLASSIFIER_PAGE_TIMEOUT_MS,
  classifyCompanyLive,
  loadClassifierCatalog,
  resolveActiveAnthropicModel,
} from '../classify-batch-candidates.server';
import { CLAUDE_CLASSIFIER_PROVIDER_KEY } from '../types';
import { DOMAIN_SEARCH_REASON_CODE, type DomainDuplicateCheck } from './domain-search';
import { findKnownCompanyMatch, type KnownCompanyRow } from './known-company-guard';
import type { RescueBatchDeps } from './rescue-batch';
import { RESCUABLE_DISPOSITION_REASON_CODES, type RescuableDispositionRow } from './rescue-dispositions';
import { SECTOR_MISMATCH_DISCARD_REASON } from './reassign-stored';
import { attachIndustryCatalogVersion, CLAUDE_RESCUE_METADATA_KEY, type CandidateRescuePatch } from './rescue-patch';

/** Versión de catálogo de una macroindustria (la tabla exige industria + versión). */
async function loadIndustryCatalogVersion(industryId: string): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('industries')
    .select('catalog_version_id')
    .eq('id', industryId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[claude-rescue] industry catalog version read failed:', error.message);
    return null;
  }
  const version = (data as { catalog_version_id?: unknown } | null)?.catalog_version_id;
  return typeof version === 'string' && version ? version : null;
}

/** Añade `catalog_version_id` a unas columnas que cambian la industria (si la cambian). */
async function withCatalogVersion<T extends Record<string, unknown>>(columns: T): Promise<Record<string, unknown>> {
  if (typeof columns.industry_id !== 'string') return columns;
  return attachIndustryCatalogVersion(columns, await loadIndustryCatalogVersion(columns.industry_id));
}

/** Reintentos si otro proceso escribió la fila entre la lectura y la escritura. */
const WRITE_MAX_ATTEMPTS = 3;

async function patchCandidate(
  candidateId: string,
  buildPatch: Parameters<RescueBatchDeps['patchCandidate']>[1],
  expectedStatus: 'needs_review' | 'discarded' = 'needs_review',
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < WRITE_MAX_ATTEMPTS; attempt++) {
    const current = await admin
      .from('prospect_candidates')
      .select('metadata, status, updated_at')
      .eq('id', candidateId)
      .maybeSingle();
    if (current.error || !current.data) return false;
    const row = current.data as { metadata: Record<string, unknown> | null; status: string; updated_at: string };
    if (row.status !== expectedStatus) return false;
    const built = buildPatch(row.metadata);
    if (!built) return false;
    const patch = (await withCatalogVersion(built)) as CandidateRescuePatch;

    const { data, error } = await admin
      .from('prospect_candidates')
      .update(patch)
      .eq('id', candidateId)
      .eq('status', expectedStatus)
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) {
      console.error('[claude-rescue] candidate write failed:', error.message);
      return false;
    }
    if (Array.isArray(data) && data.length === 1) return true;
  }
  return false;
}

async function patchDispositionEvidence(
  dispositionId: string,
  buildEvidence: Parameters<RescueBatchDeps['patchDispositionEvidence']>[1],
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  for (let attempt = 0; attempt < WRITE_MAX_ATTEMPTS; attempt++) {
    const current = await admin
      .from('prospect_discarded_dispositions')
      .select('evidence, status, updated_at')
      .eq('id', dispositionId)
      .maybeSingle();
    if (current.error || !current.data) return false;
    const row = current.data as { evidence: Record<string, unknown> | null; status: string; updated_at: string };
    if (row.status !== 'discarded') return false;
    const evidence = buildEvidence(row.evidence);
    if (!evidence) return false;

    const { data, error } = await admin
      .from('prospect_discarded_dispositions')
      .update({ evidence })
      .eq('id', dispositionId)
      .eq('status', 'discarded')
      .eq('updated_at', row.updated_at)
      .select('id');
    if (error) {
      console.error('[claude-rescue] disposition write failed:', error.message);
      return false;
    }
    if (Array.isArray(data) && data.length === 1) return true;
  }
  return false;
}

/** SellUp + HubSpot en sólo lectura. Si alguna no se pudo revisar, NO se admite. */
async function checkDuplicateStrict(
  input: Parameters<NonNullable<RescueBatchDeps['domainSearch']>['checkDuplicate']>[0],
): Promise<DomainDuplicateCheck> {
  const result = await checkCompanyDuplicate(input);
  if (result.errors?.length) throw new Error(`duplicate_check_errors:${result.errors.join(' | ')}`);
  if (!result.checkedSources.includes('sellup') || !result.checkedSources.includes('hubspot')) {
    throw new Error(`duplicate_check_incomplete:${result.checkedSources.join(',')}`);
  }
  return { status: result.status, summary: result.summary };
}

/**
 * SOURCES-EC-CLOSE-2 — fuentes con el nombre comercial y la sigla OFICIALES por
 * número fiscal, por país. Sólo lectura, una consulta acotada por empresa.
 */
const OFFICIAL_NAME_SOURCE_KEYS: Readonly<Record<string, readonly string[]>> = {
  EC: ['ec_sri_trade_name_registry', 'ec_scvs_alias_registry'],
};

async function loadOfficialNames(input: { countryCode: string; taxId: string }): Promise<string[]> {
  const sourceKeys = OFFICIAL_NAME_SOURCE_KEYS[input.countryCode];
  if (!sourceKeys) return [];
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from('source_company_snapshots')
      .select('normalized_legal_name')
      .eq('country_code', input.countryCode)
      .in('source_key', [...sourceKeys])
      .eq('normalized_tax_id', input.taxId)
      .limit(5);
    if (error || !Array.isArray(data)) return [];
    return [
      ...new Set(
        (data as Array<{ normalized_legal_name: string | null }>)
          .map((row) => row.normalized_legal_name?.trim() ?? '')
          .filter((name) => name.length >= 3),
      ),
    ];
  } catch {
    return [];
  }
}

const liveDomainSearch: NonNullable<RescueBatchDeps['domainSearch']> = {
  officialNames: loadOfficialNames,
  findWebsite: (input, active) =>
    findOfficialWebsite(
      input,
      active.model,
      buildLiveClassifyCompanyDeps(active.apiKey, (website) => fetchSafePageHtml(website, CLASSIFIER_PAGE_TIMEOUT_MS, CLAUDE_PAGE_MAX_HTML_BYTES)),
    ),
  checkDuplicate: checkDuplicateStrict,
  findKnownCompany,
};

/**
 * AGENT1-RESCUE-KNOWN-COMPANY-GUARD-1 — candidatas del mismo lote (cualquier estado)
 * y candidatas vivas con el mismo número fiscal. Sólo lectura, dos consultas acotadas.
 */
async function findKnownCompany(input: {
  batchId: string;
  taxId: string | null;
  names: readonly string[];
}): Promise<DomainDuplicateCheck | null> {
  const client = createSupabaseAdminClient();
  const batch = await client
    .from('prospect_candidates')
    .select('name, tax_identifier, status')
    .eq('batch_id', input.batchId)
    .limit(KNOWN_COMPANY_BATCH_ROWS);
  if (batch.error) throw new Error(`known_company_batch_read_failed:${batch.error.message}`);
  let taxRows: KnownCompanyRow[] = [];
  if (input.taxId) {
    const sameTax = await client
      .from('prospect_candidates')
      .select('name, tax_identifier, status')
      .eq('tax_identifier', input.taxId)
      .in('status', [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES])
      .limit(5);
    if (sameTax.error) throw new Error(`known_company_tax_read_failed:${sameTax.error.message}`);
    taxRows = (sameTax.data ?? []) as KnownCompanyRow[];
  }
  return findKnownCompanyMatch({
    names: input.names,
    taxId: input.taxId,
    batchRows: (batch.data ?? []) as KnownCompanyRow[],
    taxRows,
  });
}

/** Un lote tiene a lo sumo decenas de candidatas; el tope sólo acota la lectura. */
const KNOWN_COMPANY_BATCH_ROWS = 500;

/**
 * PostgREST: `neq` deja fuera las filas SIN decisión (NULL), así que se pide
 * explícitamente «sin decisión o distinta de reassign».
 */
export const NOT_REASSIGNED_FILTER =
  'metadata->claude_rescue->>decision.is.null,metadata->claude_rescue->>decision.neq.reassign';

export function buildLiveRescueBatchDeps(triggeredBy: string | null): RescueBatchDeps {
  const domainSearchEnabled = isAgent1ClaudeDomainFinderEnabled();
  const reasonCodes = domainSearchEnabled
    ? [...RESCUABLE_DISPOSITION_REASON_CODES, DOMAIN_SEARCH_REASON_CODE]
    : [...RESCUABLE_DISPOSITION_REASON_CODES];
  return {
    ...(domainSearchEnabled ? { domainSearch: liveDomainSearch } : {}),
    resolveActiveModel: resolveActiveAnthropicModel,
    checkQuota: () => checkProviderQuotaAvailable(CLAUDE_CLASSIFIER_PROVIDER_KEY),
    // El rescate también corre SIN sesión (vueltas en cadena desde la ruta del cron):
    // el catálogo se lee con el cliente de servicio, sólo lectura.
    loadCatalog: () => loadClassifierCatalog(createSupabaseAdminClient()),
    loadReviewCandidates: async (batchId) => {
      const { data, error } = await createSupabaseAdminClient()
        .from('prospect_candidates')
        .select('id, industry_id, industry, source_primary, name, website, domain, country_code, country, status, metadata, tax_identifier')
        .eq('batch_id', batchId)
        .eq('status', 'needs_review');
      if (error) throw new Error(`candidates_read_failed:${error.message}`);
      return (data ?? []) as ClassifiableCandidateRow[];
    },
    // AGENT1-DELIVERY-CAP-HARD-1 — máximo 10 por búsqueda: tope menos lo que ya está
    // vivo en el lote (los MISMOS estados que cuenta el escritor común).
    // AGENT1-RESCUE-SLOTS-REQUESTED-INDUSTRY-1 — sin las de OTRA industria
    // (`claude_rescue.decision = 'reassign'`): no ocupan lugar de la búsqueda.
    deliverySlots: async (batchId) => {
      const cap = resolveMaxDeliveredCandidates();
      if (cap === null) return null;
      const { count, error } = await createSupabaseAdminClient()
        .from('prospect_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .in('status', [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES])
        .or(NOT_REASSIGNED_FILTER);
      if (error || count === null) return null;
      return Math.max(0, cap - count);
    },
    loadDispositions: async (batchId) => {
      const { data, error } = await createSupabaseAdminClient()
        .from('prospect_discarded_dispositions')
        .select('id, batch_id, candidate_id, status, name, domain, country_code, industry, reason_code, evidence, round_origin, provider_identifier')
        .eq('batch_id', batchId)
        .eq('status', 'discarded')
        .in('reason_code', reasonCodes);
      if (error) throw new Error(`dispositions_read_failed:${error.message}`);
      return (data ?? []) as RescuableDispositionRow[];
    },
    loadBatchIndustryId: async (batchId) => {
      const { data } = await createSupabaseAdminClient()
        .from('prospect_batches')
        .select('metadata')
        .eq('id', batchId)
        .maybeSingle();
      const id = (data as { metadata?: { industry_id?: unknown } } | null)?.metadata?.industry_id;
      return typeof id === 'string' && id ? id : null;
    },
    loadSectorMismatchDiscards: async (batchId) => {
      const admin = createSupabaseAdminClient();
      const [candidates, dispositions] = await Promise.all([
        admin
          .from('prospect_candidates')
          .select('id, industry_id, industry, source_primary, name, website, domain, country_code, country, status, metadata')
          .eq('batch_id', batchId)
          .eq('status', 'discarded')
          .eq('metadata->claude_rescue->>discard_reason', SECTOR_MISMATCH_DISCARD_REASON),
        admin
          .from('prospect_discarded_dispositions')
          .select('id, batch_id, candidate_id, status, name, domain, country_code, industry, reason_code, evidence, round_origin, provider_identifier')
          .eq('batch_id', batchId)
          .eq('status', 'discarded')
          .eq('evidence->claude_rescue->>discard_reason', SECTOR_MISMATCH_DISCARD_REASON),
      ]);
      if (candidates.error) throw new Error(`sector_discards_read_failed:${candidates.error.message}`);
      if (dispositions.error) throw new Error(`sector_dispositions_read_failed:${dispositions.error.message}`);
      return {
        candidates: (candidates.data ?? []) as ClassifiableCandidateRow[],
        dispositions: (dispositions.data ?? []) as RescuableDispositionRow[],
      };
    },
    reopenDiscardedCandidate: (candidateId, buildPatch) => patchCandidate(candidateId, buildPatch, 'discarded'),
    loadBatchHasClaudeCompanySearch: async (batchId) => {
      const { data } = await createSupabaseAdminClient()
        .from('prospect_batches')
        .select('metadata')
        .eq('id', batchId)
        .maybeSingle();
      return !!(data as { metadata?: Record<string, unknown> | null } | null)?.metadata?.claude_company_search;
    },
    classify: classifyCompanyLive,
    // SOURCES-CL-RESCUE-OFFICIAL-IDENTITY-1 — número fiscal oficial de lo que se admite.
    resolveOfficialIdentity: buildLiveRescueOfficialIdentityResolver(),
    logUsage: logProviderUsage,
    patchCandidate: (candidateId, buildPatch) => patchCandidate(candidateId, buildPatch),
    patchDispositionEvidence,
    admitDisposition: async (dispositionId, origin) => {
      const outcome = await sendDispositionToReviewCore(
        {
          supabase: createSupabaseAdminClient(),
          actorUserId: triggeredBy as string,
          // El lote es de quien corrió la búsqueda: el rescate no cruza de lote.
          isBatchInScope: async () => true,
        },
        dispositionId,
        origin.columns ? { ...origin, columns: await withCatalogVersion(origin.columns) } : origin,
      );
      if (outcome.outcome === 'sent' || outcome.outcome === 'idempotent') return outcome.candidateId;
      console.error('[claude-rescue] admit failed:', outcome.outcome);
      return null;
    },
    markDispositionSent: async (dispositionId, rescue) => {
      const admin = createSupabaseAdminClient();
      const current = await admin
        .from('prospect_discarded_dispositions')
        .select('evidence, status')
        .eq('id', dispositionId)
        .maybeSingle();
      const row = current.data as { evidence: Record<string, unknown> | null; status: string } | null;
      if (current.error || !row || row.status !== 'sent_to_review') return;
      const { error } = await admin
        .from('prospect_discarded_dispositions')
        .update({ evidence: { ...(row.evidence ?? {}), [CLAUDE_RESCUE_METADATA_KEY]: rescue } })
        .eq('id', dispositionId)
        .eq('status', 'sent_to_review');
      if (error) console.error('[claude-rescue] disposition mark failed:', error.message);
    },
    claimIdentities: async (batchId, candidateIds) => {
      const outcome = await claimGlobalIdentitiesForPersistedCandidates(
        createSupabaseAdminClient(),
        batchId,
        candidateIds,
      );
      if (outcome.degraded) console.error('[claude-rescue] identity claims degraded for batch', batchId);
    },
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
}
