/**
 * platform-cleanup-2026-11-11.mts — one-off (decisión de la dueña, 11-11-2026; molde: 05-11).
 *
 * Segunda limpieza «en ceros»: las pruebas del 11-11 (búsqueda México · Seguros,
 * árboles, Rumbo) al banco gratis. El lote archivado de brcastro (Chile · Retail)
 * queda fuera del alcance: tiene una reserva de presupuesto.
 *
 * Entrega de SellUp a los líderes de ventas «como si empezara de cero»:
 *   · TODAS las búsquedas del Agente 1 (todos los usuarios, todas las fuentes) → empresas
 *     elegibles al banco gratis; luego se borran lotes y empresas de la plataforma.
 *   · Fichas de Empresas archivadas (sus contactos quedan como banco de contactos).
 *   · Usuarios *.qa, grupos «(QA)», preaprobaciones de prueba, corridas e historial borrados.
 *
 *   --export   SÓLO LECTURA. Respaldo JSON de todo lo que se va a tocar.
 *   --plan     SÓLO LECTURA. Construye los items del banco (como la app).
 *   --deposit  ESCRIBE. Libera los reclamos de esas empresas y las deposita en el banco.
 *
 * El depósito y el borrado se hacen por SQL (rol postgres, una transacción) por el MCP:
 * la cuenta de servicio no puede borrar reclamos (migración 140). Ver el .md hermano.
 *
 *   node --env-file=.env.local --import ./ws-stub.mjs --import tsx \
 *     scripts/ops/platform-cleanup-2026-11-11.mts --export|--plan
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveGlobalIdentityClaims } from '@/server/agents/prospecting-toolkit/global-identity-claims';
import { toRegisteredBatchIdentity } from '@/server/prospect-batches/batch-identity-registry-store';
import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import {
  isDepositItemWellFormed,
} from '@/server/prospect-batches/company-bank/company-bank-store';
import {
  PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
  projectCandidateForBank,
} from '@/server/prospect-batches/company-bank/pipeline-candidate-bank-payload';
import {
  COMPANY_BANK_DEPOSIT_CHUNK,
  COMPANY_BANK_MAX_PAYLOAD_BYTES,
  COMPANY_BANK_MAX_TTL_DAYS,
  type CompanyBankDepositItem,
  type CompanyBankSourceProvider,
} from '@/server/prospect-batches/company-bank/company-bank-types';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';

// ─── Constantes ─────────────────────────────────────────────────────────────────

const EXPECTED_PROJECT_REF = 'lrdruowtadwbdulndlph';
const OUT_DIR = '/Users/ub-col-pro-lf4/Documents/SellUp-data/cleanup-2026-11-11';
const EXPORT_DIR = join(OUT_DIR, 'export');
const PLAN_DIR = join(OUT_DIR, 'plan');
const PAGE = 1000;
const IN_CHUNK = 100;

/** Aprobadas (no convertidas) que la dueña quiere en el banco. */
/** Lote archivado el 05-11 con reserva de presupuesto (brcastro, Chile · Retail): no se toca. */
const KEPT_BATCH_IDS: readonly string[] = ['4aa882ed-f440-4ec8-8708-a0cfdb081cb8'];

const APPROVED_TO_BANK_IDS = [
  '12491b27-b53a-48ff-a016-8c37b67e4682', // ACTI
  '0fa88731-0e8b-448e-88c1-ee7b6f804e4a', // AstraZeneca
] as const;

/** Industrias viejas del lote → nombre canónico del catálogo macro (decisión 14-10). */
const LEGACY_INDUSTRY_TO_CANONICAL: Readonly<Record<string, string>> = {
  Salud: 'Salud & Farmacéuticos',
  'Retail y Consumo': 'Retail',
  'Logística y Transporte': 'Transporte & Logística',
  Educación: 'Compañía de Servicios',
};

/** source_primary del candidato → source_provider del banco (vocabulario cerrado de la 142). */
const SOURCE_PRIMARY_TO_BANK: Readonly<Record<string, CompanyBankSourceProvider>> = {
  apollo: 'apollo',
  lusha: 'lusha',
  web_ai: 'tavily',
  public_source: 'free_source',
  external_import: 'free_source',
};

/** Estados de HubSpot que NO son coincidencia. */
const HUBSPOT_NON_MATCH = new Set(['', 'not_attempted', 'no_match', 'unchecked', 'not_checked']);

const BANK_TTL_DAYS = COMPANY_BANK_MAX_TTL_DAYS;

type Row = Record<string, unknown>;

// ─── Utilidades ─────────────────────────────────────────────────────────────────

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rec(value: unknown): Row | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}


function connect(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) fail('faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  const ref = new URL(url).hostname.split('.')[0];
  if (ref !== EXPECTED_PROJECT_REF) fail(`el entorno apunta a ${ref}, no a ${EXPECTED_PROJECT_REF}`);
  console.log(`env OK: proyecto ${ref}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** SELECT paginado. `apply` añade filtros. */
async function selectAll(
  db: SupabaseClient,
  table: string,
  columns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- constructor de consultas de supabase-js, script de un solo uso
  apply: (q: any) => any,
  orderBy = 'id',
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const query = apply(db.from(table).select(columns)).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    const { data, error } = await query;
    if (error) fail(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return rows;
  }
}

/** SELECT por lista de valores (troceada y paginada), deduplicado por `dedupeKey`. */
async function selectIn(
  db: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  values: readonly string[],
  orderBy = 'id',
  dedupeKey: string | null = 'id',
): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const part of chunks(values, IN_CHUNK)) {
    const rows = await selectAll(db, table, columns, (q) => q.in(column, part), orderBy);
    for (const row of rows) {
      const key = dedupeKey ? String(row[dedupeKey]) : JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

// ─── Alcance ────────────────────────────────────────────────────────────────────

type Scope = {
  batches: Row[];
  batchIds: string[];
  candidates: Row[];
  candidateIds: string[];
  clientRequestIds: string[];
};

async function loadScope(db: SupabaseClient): Promise<Scope> {
  const batches = (await selectAll(db, 'prospect_batches', '*', (q) => q))
    .filter((b) => !KEPT_BATCH_IDS.includes(String(b.id)));
  const batchIds = batches.map((b) => String(b.id));
  const candidates = await selectIn(db, 'prospect_candidates', '*', 'batch_id', batchIds);
  const clientRequestIds = [...new Set(batches.map((b) => str(b.client_request_id)).filter((v): v is string => !!v))];
  return { batches, batchIds, candidates, candidateIds: candidates.map((c) => String(c.id)), clientRequestIds };
}

// ─── --export ───────────────────────────────────────────────────────────────────

/** Tablas que la limpieza borra o modifica: respaldo completo (son chicas). */
const FULL_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['prospect_batches', 'id'], ['prospect_candidates', 'id'], ['agent1_company_identity_claims', 'id'],
  ['prospect_discarded_dispositions', 'id'], ['prospect_candidate_audit', 'id'], ['prospect_enrichment_jobs', 'id'],
  ['apollo_round_continuation_jobs', 'id'], ['agent1_company_relationships', 'id'], ['agent1_competitor_watches', 'id'],
  ['prospect_bulk_searches', 'id'], ['prospect_bulk_search_rounds', 'id'], ['agent1_company_bank', 'id'],
  ['accounts', 'id'], ['contacts', 'id'], ['account_audit', 'id'], ['contact_audit', 'id'],
  ['contact_enrichment_requests', 'id'], ['contact_enrichment_runs', 'id'], ['contact_enrichment_candidates', 'id'],
  ['contact_enrichment_bulk_runs', 'id'], ['account_research_briefs', 'id'], ['first_call_packs', 'id'],
  ['agent_runs', 'id'], ['agent_run_steps', 'id'], ['provider_usage_logs', 'id'], ['result_quality_events', 'id'],
  ['user_notifications', 'id'], ['internal_users', 'id'], ['organization_groups', 'id'], ['user_preapprovals', 'id'],
  ['access_audit', 'id'], ['wizard_budget_reservations', 'id'],
];

async function runExport(db: SupabaseClient): Promise<void> {
  mkdirSync(EXPORT_DIR, { recursive: true });
  const counts: Record<string, number> = {};
  for (const [table, orderBy] of FULL_TABLES) {
    const rows = await selectAll(db, table, '*', (q) => q, orderBy);
    writeJson(join(EXPORT_DIR, `${table}.json`), rows);
    counts[table] = rows.length;
  }
  const scope = await loadScope(db);
  for (const [name, column, values] of [
    ['agent1_run_progress', 'client_request_id', scope.clientRequestIds],
    ['lusha_prospecting_request_fence', 'client_request_id', scope.clientRequestIds],
  ] as const) {
    const rows = await selectIn(db, name, '*', column, values, column, name === 'lusha_prospecting_request_fence' ? 'fence_key' : null);
    writeJson(join(EXPORT_DIR, `${name}.json`), rows);
    counts[name] = rows.length;
  }
  const manifest = { exported_at: new Date().toISOString(), project: EXPECTED_PROJECT_REF, counts };
  writeJson(join(EXPORT_DIR, 'manifest.json'), manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

// ─── --plan ─────────────────────────────────────────────────────────────────────

type Exclusion = { candidateId: string; name: string | null; countryCode: string | null; reason: string };

function resolveBatchMacro(batch: Row): string | null {
  const meta = rec(batch.metadata);
  const fromMeta = str(meta?.macro_industry_key);
  if (fromMeta && /^[a-z][a-z0-9_]{1,63}$/.test(fromMeta)) return fromMeta;
  const industry = str(batch.industry);
  if (!industry) return null;
  const displayName = LEGACY_INDUSTRY_TO_CANONICAL[industry] ?? industry;
  return resolveMacroIndustryKey({ slug: industry, displayName });
}

function resolveCandidateMacro(c: Row): string | null {
  const industry = str(c.industry);
  if (!industry) return null;
  const displayName = LEGACY_INDUSTRY_TO_CANONICAL[industry] ?? industry;
  return resolveMacroIndustryKey({ slug: industry, displayName });
}

function isBankEligibleStatus(c: Row): boolean {
  if (APPROVED_TO_BANK_IDS.includes(String(c.id) as (typeof APPROVED_TO_BANK_IDS)[number])) {
    return c.status === 'approved' && !c.converted_account_id;
  }
  if (c.status !== 'needs_review') return false;
  if (!['no_match', 'unchecked'].includes(String(c.duplicate_status))) return false;
  if (str(c.matched_hubspot_company_id)) return false;
  return HUBSPOT_NON_MATCH.has(String(c.hubspot_match_status ?? ''));
}

function buildBankCandidate(c: Row, batch: Row, domain: string): ProspectingPipelineCandidate {
  const trace = rec(c.source_trace);
  const sizeValue = str(c.company_size);
  const employees = c.employee_count == null ? null : num(c.employee_count);
  return {
    name: String(c.name),
    originalName: str(c.legal_name),
    website: str(c.website),
    domain,
    country: str(c.country) ?? str(batch.country) ?? String(c.country_code),
    countryCode: String(c.country_code),
    industry: str(c.industry) ?? str(batch.industry) ?? '',
    sourceUrl: str(trace?.sourceUrl) ?? str(trace?.source_url),
    sourceTitle: null,
    sourceSnippet: null,
    websiteVerification: null,
    duplicateCheck: null,
    scoring: {
      confidenceScore: num(c.confidence_score),
      fitScore: num(c.fit_score),
      dataCompletenessScore: num(c.data_completeness_score),
      qualityLabel: 'needs_review',
      recommendedAction: 'review_manually',
      breakdown: {
        existenceSignals: 0, websiteSignals: 0, duplicateSignals: 0, sourceSignals: 0,
        fitSignals: 0, completenessSignals: 0, penalties: 0,
      },
      reasons: ['banked_from_platform_cleanup_2026_11_11'],
      warnings: [],
      blockers: [],
      metadata: {
        origin_candidate_id: String(c.id),
        origin_batch_id: String(c.batch_id),
        origin_source_primary: str(c.source_primary),
        tax_identifier: str(c.tax_identifier),
        tax_identifier_type: str(c.tax_identifier_type),
        subindustry: str(c.subindustry),
        sector_description: str(c.sector_description),
      },
    },
    companySize: sizeValue,
    employeeCount: employees,
    companyLinkedInUrl: str(c.linkedin_url),
    apolloOrganizationId: c.source_primary === 'apollo' ? str(trace?.providerCompanyId) : null,
    providerEnrichmentCapture: null,
    officialSourceIdentity: null,
  };
}

type PlannedItem = CompanyBankDepositItem & { originCandidateId: string };

function planItems(scope: Scope): { items: PlannedItem[]; excluded: Exclusion[] } {
  const batchById = new Map(scope.batches.map((b) => [String(b.id), b]));
  const items: PlannedItem[] = [];
  const excluded: Exclusion[] = [];
  const seenClaimKeys = new Set<string>();

  for (const c of scope.candidates) {
    const base = { candidateId: String(c.id), name: str(c.name), countryCode: str(c.country_code) };
    if (!isBankEligibleStatus(c)) {
      excluded.push({ ...base, reason: `status:${String(c.status)}/${String(c.duplicate_status)}${str(c.matched_hubspot_company_id) ? '/hubspot_match' : ''}` });
      continue;
    }
    const batch = batchById.get(String(c.batch_id));
    if (!batch) { excluded.push({ ...base, reason: 'batch_not_found' }); continue; }
    const countryCode = str(c.country_code)?.toUpperCase() ?? null;
    if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) { excluded.push({ ...base, reason: 'invalid_country' }); continue; }
    const macro = resolveCandidateMacro(c) ?? resolveBatchMacro(batch);
    if (!macro) { excluded.push({ ...base, reason: `macro_unresolved:${String(batch.industry)}` }); continue; }
    const provider = SOURCE_PRIMARY_TO_BANK[String(c.source_primary)];
    if (!provider) { excluded.push({ ...base, reason: `unknown_source_primary:${String(c.source_primary)}` }); continue; }

    const identity = toRegisteredBatchIdentity({
      id: String(c.id),
      name: str(c.name),
      domain: str(c.domain),
      website: str(c.website),
      country_code: countryCode,
      tax_id: str(c.tax_id),
      tax_identifier: str(c.tax_identifier),
      status: str(c.status),
      metadata: rec(c.metadata),
      source_trace: rec(c.source_trace),
    });
    const claims = deriveGlobalIdentityClaims(identity.evidence).filter((k) => k.key.trim() !== '');
    if (claims.length === 0) { excluded.push({ ...base, reason: 'no_identity_signal' }); continue; }
    const domain = identity.evidence.normalizedDomain ?? (str(c.domain) ? normalizeDomain(String(c.domain)) : null);
    if (!domain) { excluded.push({ ...base, reason: 'no_domain' }); continue; }
    const dupKey = claims.map((k) => `${k.type}:${k.key}`).find((k) => seenClaimKeys.has(k));
    if (dupKey) { excluded.push({ ...base, reason: `same_company_twice_in_scope:${dupKey}` }); continue; }

    const projected = projectCandidateForBank(buildBankCandidate(c, batch, domain));
    if (!projected) { excluded.push({ ...base, reason: 'payload_too_large' }); continue; }
    const payload = { kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, candidate: projected, requestedSubindustries: [] };

    const missing: string[] = [];
    if (!str(c.company_size) && c.employee_count == null) missing.push('company_size');
    if (!str(c.industry) && !str(batch.industry)) missing.push('industry');
    const item: PlannedItem = {
      countryCode,
      macroIndustryKey: macro,
      tier: missing.length === 0 ? 'ready' : 'to_complete',
      sourceProvider: provider,
      claims,
      payload,
      missingFields: missing,
      sourceBatchId: null, // el lote se borra después: el FK lo dejaría NULL igual.
      ttlDays: BANK_TTL_DAYS,
      originCandidateId: String(c.id),
    };
    if (!isDepositItemWellFormed(item) || Buffer.byteLength(JSON.stringify(payload), 'utf8') > COMPANY_BANK_MAX_PAYLOAD_BYTES) {
      excluded.push({ ...base, reason: 'not_well_formed' });
      continue;
    }
    for (const k of claims) seenClaimKeys.add(`${k.type}:${k.key}`);
    items.push(item);
  }
  return { items, excluded };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- constructor de consultas de supabase-js, script de un solo uso
async function countIn(db: SupabaseClient, table: string, column: string, values: readonly string[], extra?: (q: any) => any): Promise<number> {
  let total = 0;
  for (const part of chunks(values, IN_CHUNK)) {
    let q = db.from(table).select('*', { count: 'exact', head: true }).in(column, part);
    if (extra) q = extra(q);
    const { count, error } = await q;
    if (error) fail(`${table}: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

async function activeBankCollisions(db: SupabaseClient, items: readonly PlannedItem[]): Promise<number> {
  const bank = await selectAll(db, 'agent1_company_bank', 'id, status, claim_fiscal, claim_domain, claim_provider_entity, claim_linkedin', (q) =>
    q.in('status', ['banked', 'reserved']),
  );
  const keys = new Set<string>();
  for (const r of bank) {
    if (r.claim_fiscal) keys.add(`fiscal:${r.claim_fiscal}`);
    if (r.claim_domain) keys.add(`domain:${r.claim_domain}`);
    if (r.claim_provider_entity) keys.add(`provider_entity:${r.claim_provider_entity}`);
    if (r.claim_linkedin) keys.add(`linkedin:${r.claim_linkedin}`);
  }
  return items.filter((i) => i.claims.some((k) => keys.has(`${k.type}:${k.key}`))).length;
}

async function foreignActiveClaims(db: SupabaseClient, items: readonly PlannedItem[], scope: Scope): Promise<number> {
  const inScope = new Set(scope.candidateIds);
  let n = 0;
  for (const part of chunks(items, 50)) {
    const keys = [...new Set(part.flatMap((i) => i.claims.map((k) => k.key)))];
    const rows = await selectIn(db, 'agent1_company_identity_claims', 'id, claim_type, claim_key, candidate_id, released_at', 'claim_key', keys);
    const foreign = new Set(
      rows.filter((r) => r.released_at == null && !inScope.has(String(r.candidate_id))).map((r) => `${r.claim_type}:${r.claim_key}`),
    );
    n += part.filter((i) => i.claims.some((k) => foreign.has(`${k.type}:${k.key}`))).length;
  }
  return n;
}

function tally<T>(rows: readonly T[], keyOf: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[keyOf(r)] = (out[keyOf(r)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function runPlan(db: SupabaseClient): Promise<void> {
  mkdirSync(PLAN_DIR, { recursive: true });
  const scope = await loadScope(db);
  const { items, excluded } = planItems(scope);
  const bankCandidateIds = items.map((i) => i.originCandidateId);

  const counts = {
    batches: scope.batchIds.length,
    candidates: scope.candidateIds.length,
    claims_active_of_bank_items: await countIn(db, 'agent1_company_identity_claims', 'candidate_id', bankCandidateIds, (q) => q.is('released_at', null)),
    claims_rows_by_candidate: await countIn(db, 'agent1_company_identity_claims', 'candidate_id', scope.candidateIds),
    claims_rows_by_batch: await countIn(db, 'agent1_company_identity_claims', 'batch_id', scope.batchIds),
    wizard_budget_reservations_batch_links: await countIn(db, 'wizard_budget_reservations', 'batch_id', scope.batchIds),
    agent1_run_progress: await countIn(db, 'agent1_run_progress', 'client_request_id', scope.clientRequestIds),
    lusha_prospecting_request_fence: await countIn(db, 'lusha_prospecting_request_fence', 'client_request_id', scope.clientRequestIds),
    cascade_prospect_discarded_dispositions: await countIn(db, 'prospect_discarded_dispositions', 'batch_id', scope.batchIds),
    cascade_prospect_candidate_audit: await countIn(db, 'prospect_candidate_audit', 'batch_id', scope.batchIds),
    cascade_prospect_enrichment_jobs: await countIn(db, 'prospect_enrichment_jobs', 'candidate_id', scope.candidateIds),
    cascade_apollo_round_continuation_jobs: await countIn(db, 'apollo_round_continuation_jobs', 'batch_id', scope.batchIds),
    set_null_provider_usage_logs_kept: await countIn(db, 'provider_usage_logs', 'batch_id', scope.batchIds),
    set_null_bank_source_batch: await countIn(db, 'agent1_company_bank', 'source_batch_id', scope.batchIds),
    set_null_bank_assigned_batch: await countIn(db, 'agent1_company_bank', 'assigned_batch_id', scope.batchIds),
  };

  const summary = {
    planned_at: new Date().toISOString(),
    bank_items: items.length,
    expected_skipped_in_bank: await activeBankCollisions(db, items),
    expected_skipped_claimed_by_other_seller: await foreignActiveClaims(db, items, scope),
    by_country_provider_tier: tally(items, (i) => `${i.countryCode}|${i.sourceProvider}|${i.tier}`),
    by_provider: tally(items, (i) => i.sourceProvider),
    by_tier: tally(items, (i) => i.tier),
    by_macro: tally(items, (i) => i.macroIndustryKey),
    excluded_total: excluded.length,
    excluded_by_reason: tally(excluded, (e) => e.reason.split(':')[0] === 'status' ? e.reason : e.reason.split(':')[0]),
    approved_included: items.filter((i) => APPROVED_TO_BANK_IDS.includes(i.originCandidateId as never)).length,
    converted_to_account_excluded: scope.candidates.filter((c) => c.status === 'converted_to_account').length,
    counts,
  };

  const steps = [
    { step: 1, action: 'release_claims', table: 'agent1_company_identity_claims', op: 'UPDATE released_at=now() WHERE candidate_id IN bank_items AND released_at IS NULL', expected_rows: counts.claims_active_of_bank_items },
    { step: 2, action: 'bank_deposit', rpc: 'agent1_bank_deposit', op: `${Math.ceil(items.length / COMPANY_BANK_DEPOSIT_CHUNK)} chunks of ${COMPANY_BANK_DEPOSIT_CHUNK}`, expected_rows: items.length },
    { step: 3, action: 'delete_claims', table: 'agent1_company_identity_claims', op: 'DELETE WHERE candidate_id IN scope OR batch_id IN scope (FK sin ON DELETE)', expected_rows: Math.max(counts.claims_rows_by_candidate, counts.claims_rows_by_batch) },
    { step: 4, action: 'null_budget_batch_link', table: 'wizard_budget_reservations', op: 'UPDATE batch_id=NULL (importes intactos; autorizado 14-10)', expected_rows: counts.wizard_budget_reservations_batch_links },
    { step: 5, action: 'delete_run_progress', table: 'agent1_run_progress', op: 'DELETE WHERE client_request_id IN scope', expected_rows: counts.agent1_run_progress },
    { step: 6, action: 'delete_lusha_fence', table: 'lusha_prospecting_request_fence', op: 'DELETE WHERE client_request_id IN scope', expected_rows: counts.lusha_prospecting_request_fence },
    { step: 7, action: 'delete_batches', table: 'prospect_batches', op: 'DELETE WHERE id IN scope (cascada: candidatos, descartadas, auditoría, enriquecimiento, continuaciones; SET NULL: usage logs, banco). El historial del chat sale de aquí.', expected_rows: counts.batches, cascades: {
      prospect_candidates: counts.candidates,
      prospect_discarded_dispositions: counts.cascade_prospect_discarded_dispositions,
      prospect_candidate_audit: counts.cascade_prospect_candidate_audit,
      prospect_enrichment_jobs: counts.cascade_prospect_enrichment_jobs,
      apollo_round_continuation_jobs: counts.cascade_apollo_round_continuation_jobs,
      provider_usage_logs_set_null_KEPT: counts.set_null_provider_usage_logs_kept,
      agent1_company_bank_source_batch_set_null: counts.set_null_bank_source_batch,
      agent1_company_bank_assigned_batch_set_null: counts.set_null_bank_assigned_batch,
    } },
    { step: 8, action: 'verify', op: 'recontar: 0 lotes de egarcia, 0 claims de su alcance, banco +deposited' },
  ];

  writeJson(join(PLAN_DIR, 'bank-items.json'), items);
  writeJson(join(PLAN_DIR, 'excluded.json'), excluded);
  writeJson(join(PLAN_DIR, 'summary.json'), summary);
  writeJson(join(PLAN_DIR, 'steps.json'), { scope: { batchIds: scope.batchIds, candidateIds: scope.candidateIds, clientRequestIds: scope.clientRequestIds }, steps });
  console.log(JSON.stringify({ ...summary, by_country_provider_tier: undefined }, null, 2));
  console.log(`by_country_provider_tier: ${JSON.stringify(summary.by_country_provider_tier)}`);
}

// ─── --deposit (ESCRIBE EN PRODUCCIÓN: autorizado por la dueña el 11-11) ─────────

async function runDeposit(db: SupabaseClient): Promise<void> {
  const items = JSON.parse(readFileSync(join(PLAN_DIR, 'bank-items.json'), 'utf8')) as PlannedItem[];
  if (items.length === 0) fail('plan vacío');
  const candidateIds = items.map((i) => i.originCandidateId);
  let released = 0;
  for (const part of chunks(candidateIds, IN_CHUNK)) {
    const { count, error } = await db
      .from('agent1_company_identity_claims')
      .update({ released_at: new Date().toISOString() }, { count: 'exact' })
      .in('candidate_id', part)
      .is('released_at', null);
    if (error) fail(`liberar reclamos: ${error.message}`);
    released += count ?? 0;
  }
  const totals = { released_claims: released, deposited: 0, skipped_claimed: 0, skipped_in_bank: 0, skipped_invalid: 0 };
  for (const part of chunks(items, COMPANY_BANK_DEPOSIT_CHUNK)) {
    const payload = part.map((planned) => {
      const item: Partial<PlannedItem> = { ...planned };
      delete item.originCandidateId;
      return item;
    });
    const { data, error } = await db.rpc('agent1_bank_deposit', { p_items: payload });
    if (error) fail(`agent1_bank_deposit: ${error.message}`);
    const r = data as Record<string, number>;
    totals.deposited += r.deposited ?? 0;
    totals.skipped_claimed += r.skipped_claimed ?? 0;
    totals.skipped_in_bank += r.skipped_in_bank ?? 0;
    totals.skipped_invalid += r.skipped_invalid ?? 0;
  }
  writeJson(join(OUT_DIR, 'deposit-result.json'), { at: new Date().toISOString(), ...totals });
  console.log(JSON.stringify(totals, null, 2));
}

// ─── main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = ['--export', '--plan', '--deposit'].find((m) => process.argv.includes(m));
  if (!mode) fail('modo requerido: --export | --plan | --deposit');
  mkdirSync(OUT_DIR, { recursive: true });
  const db = connect();
  if (mode === '--export') return runExport(db);
  if (mode === '--plan') return runPlan(db);
  return runDeposit(db);
}

main().catch((error) => fail(error instanceof Error ? error.stack ?? error.message : String(error)));
