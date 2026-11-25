import 'server-only';

// TABLEROS-1 — Lecturas de /dashboards. SÓLO LEE: no inserta, no actualiza, no
// borra, no llama proveedores ni HubSpot.
//
// Lee con el cliente de servicio (como Uso de IA) y limita cada consulta al
// alcance comercial de quien mira ANTES de pedir las filas: un BD nunca recibe
// filas de otra persona, ni siquiera para descartarlas después.
//
// Todo sale de tablas que ya existen (fase 1, sin cambios en la base). Lo que
// necesita tablas nuevas está en docs/tableros-faltantes.md.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  IN_FILTER_CHUNK_SIZE,
  fetchAllPages,
  fetchAllPagesInChunks,
  type PageFetcher,
  type PaginatedReadResult,
} from '@/lib/supabase/paginated-read';
import { clampToVisibleSince } from '@/lib/visible-since';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { getCommercialScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';
import {
  computeDashboard,
  type CompanyBatchRow,
  type CompanyCandidateRow,
  type ContactCandidateRow,
  type ContactRunRow,
  type DashboardData,
  type HubSpotEnrichmentRow,
  type LinkedContactRow,
} from './dashboard-core';
import { filledHubspotPropertiesOf, sizeBandOf } from './dashboard-dimensions';
import { bogotaDayOf, resolveDashboardRange, type DashboardFilters, type ResolvedRange } from './dashboard-filters';
import {
  resolveDashboardAudience,
  type DashboardScopeKind,
  type DirectoryGroup,
  type DirectoryUser,
} from './dashboard-scope';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface DashboardFilterDirectory {
  scopeKind: DashboardScopeKind;
  users: DirectoryUser[];
  groups: DirectoryGroup[];
  /** Países con alguna actividad en el periodo (para el filtro). */
  countries: string[];
}

export type DashboardLoadResult =
  | { kind: 'denied' }
  | {
      kind: 'ready';
      /** El «ahora» con el que se calculó (ISO), para las antigüedades de la página. */
      now: string;
      scopeKind: DashboardScopeKind;
      range: ResolvedRange;
      directory: DashboardFilterDirectory;
      data: DashboardData;
      /** Lecturas que fallaron: las cifras pueden estar incompletas. */
      readErrors: string[];
      /** Alguna lectura llegó al tope de seguridad: las cifras pueden quedarse cortas. */
      truncated: boolean;
      ignoredTeams: string[];
      ignoredPeople: string[];
    };

// ── Columnas ───────────────────────────────────────────────────────────────────

const RUN_COLUMNS = 'id, request_id, status, triggered_by, created_at, company_country_code';
const CONTACT_CANDIDATE_COLUMNS =
  'id, enrichment_run_id, status, source, created_at, reviewed_by, reviewed_at, email, phone, linkedin_url, seniority, matched_hubspot_contact_id';
const LINKED_CONTACT_COLUMNS =
  'id, email, phone, linkedin_url, source_candidate_id:metadata->>source_candidate_id, hubspot_sync:metadata->hubspot_sync';
const BATCH_COLUMNS = 'id, created_by, created_at, country_code';
const COMPANY_CANDIDATE_COLUMNS =
  'id, batch_id, status, source_primary, created_at, reviewed_by, reviewed_at, country_code, industry, company_size, employee_count';
const ENRICHMENT_ACCOUNT_COLUMNS =
  'id, country_code, industry, company_size, request:metadata->hubspot_enrichment_request';

const REVIEWED_CONTACT_STATUSES = ['approved', 'discarded', 'duplicate'];
const REVIEWED_COMPANY_STATUSES = ['approved', 'converted_to_account', 'discarded', 'duplicate'];

interface RawRun {
  id: string;
  request_id: string | null;
  status: string;
  triggered_by: string | null;
  created_at: string;
  company_country_code: string | null;
}

interface RawContactCandidate {
  id: string;
  enrichment_run_id: string | null;
  status: string;
  source: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  seniority: string | null;
  matched_hubspot_contact_id: string | null;
}

interface RawLinkedContact {
  id: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source_candidate_id: string | null;
  hubspot_sync: unknown;
}

interface RawBatch {
  id: string;
  created_by: string | null;
  created_at: string;
  country_code: string | null;
}

interface RawCompanyCandidate {
  id: string;
  batch_id: string | null;
  status: string;
  source_primary: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  country_code: string | null;
  industry: string | null;
  company_size: string | null;
  employee_count: number | null;
}

interface RawEnrichmentAccount {
  id: string;
  country_code: string | null;
  industry: string | null;
  company_size: string | null;
  request: unknown;
}

// ── Utilidades ─────────────────────────────────────────────────────────────────

const has = (value: string | null | undefined) => typeof value === 'string' && value.trim().length > 0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function upperCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

class ReadLog {
  readonly errors: string[] = [];
  truncated = false;
  take<T>(label: string, result: PaginatedReadResult<T>): T[] {
    if (result.error) {
      console.error(`[dashboards] ${label} read failed:`, result.error);
      this.errors.push(label);
    }
    if (result.truncated) this.truncated = true;
    return result.rows;
  }
}

/**
 * Lee todas las páginas, limitadas a `userIds` en `column` cuando hay límite.
 * `null` = sin límite de personas.
 */
function readScoped<T>(
  userIds: string[] | null,
  column: string,
  build: (scope: (query: ScopableQuery) => ScopableQuery) => PageFetcher<T>,
): Promise<PaginatedReadResult<T>> {
  if (userIds === null) return fetchAllPages(build((query) => query));
  return fetchAllPagesInChunks(userIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    build((query) => query.in(column, chunk)),
  );
}

// La API de supabase-js encadena filtros sobre el mismo constructor; aquí sólo hace falta `.in`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ScopableQuery = any;

function readByIds<T>(
  ids: readonly string[],
  build: (chunk: string[]) => PageFetcher<T>,
): Promise<PaginatedReadResult<T>> {
  if (ids.length === 0) return Promise.resolve({ rows: [], truncated: false, error: null });
  return fetchAllPagesInChunks([...new Set(ids)], IN_FILTER_CHUNK_SIZE, build);
}

// ── Directorio (filtros) ───────────────────────────────────────────────────────

async function loadSelf(admin: AdminClient, userId: string): Promise<{ user: DirectoryUser | null; group: DirectoryGroup | null }> {
  const { data } = await admin
    .from('internal_users')
    .select('id, full_name, email, group_id')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return { user: null, group: null };
  const user: DirectoryUser = {
    id: data.id as string,
    name: (data.full_name as string | null) ?? (data.email as string | null) ?? 'Tú',
    email: (data.email as string | null) ?? null,
    groupId: (data.group_id as string | null) ?? null,
  };
  if (!user.groupId) return { user, group: null };
  const { data: group } = await admin
    .from('organization_groups')
    .select('id, name, parent_group_id')
    .eq('id', user.groupId)
    .maybeSingle();
  return {
    user,
    group: group
      ? { id: group.id as string, name: group.name as string, parentGroupId: (group.parent_group_id as string | null) ?? null, depth: 0 }
      : null,
  };
}

// ── Carga ──────────────────────────────────────────────────────────────────────

export async function loadDashboard(
  filters: DashboardFilters,
  options: { now?: Date; countryLabel?: (code: string) => string } = {},
): Promise<DashboardLoadResult> {
  const scope = await resolveCommercialScope();
  if (!scope) return { kind: 'denied' };

  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const today = bogotaDayOf(nowIso)!;
  const range = resolveDashboardRange(filters, today);
  const scopeKind: DashboardScopeKind = scope.canViewAll ? 'admin' : scope.isRestrictedToSelf ? 'self' : 'team';
  const admin = createSupabaseAdminClient();

  // Directorio: quién y qué equipos se pueden elegir (ya limitado al alcance).
  let users: DirectoryUser[] = [];
  let groups: DirectoryGroup[] = [];
  let self: DirectoryUser | null = null;
  if (scopeKind === 'self') {
    const loaded = await loadSelf(admin, scope.currentUserId);
    self = loaded.user;
    groups = loaded.group ? [loaded.group] : [];
  } else {
    const scopeOptions = await getCommercialScopeFilterOptions();
    users = scopeOptions.users.map((user) => ({
      id: user.id,
      name: user.full_name ?? user.email ?? 'Sin nombre',
      email: user.email,
      groupId: user.group_id,
    }));
    groups = scopeOptions.groups.map((group) => ({
      id: group.id,
      name: group.name,
      parentGroupId: group.parent_group_id,
      depth: group.depth,
    }));
  }

  const audience = resolveDashboardAudience({
    kind: scopeKind,
    currentUserId: scope.currentUserId,
    allowedUserIds: scope.allowedUserIds,
    users,
    groups,
    requestedTeams: filters.teams,
    requestedPeople: filters.people,
    self,
  });

  const log = new ReadLog();
  const userIds = audience.queryUserIds;
  const readNothing = range.isEmpty || (userIds !== null && userIds.length === 0);
  // El corte de visibilidad (05-11) también manda, por si algún día se mueve después del lanzamiento.
  const fromIso = clampToVisibleSince(range.fromIso) ?? range.fromIso;
  const toIso = range.toIsoExclusive;

  let runs: RawRun[] = [];
  let foundContactsRaw: RawContactCandidate[] = [];
  let reviewedContactsRaw: RawContactCandidate[] = [];
  let batches: RawBatch[] = [];
  let foundCompaniesRaw: RawCompanyCandidate[] = [];
  let reviewedCompaniesRaw: RawCompanyCandidate[] = [];
  let enrichmentAccounts: RawEnrichmentAccount[] = [];

  if (!readNothing) {
    [runs, reviewedContactsRaw, batches, reviewedCompaniesRaw, enrichmentAccounts] = await Promise.all([
      readScoped<RawRun>(userIds, 'triggered_by', (scoped) => (from, to) =>
        scoped(
          admin.from('contact_enrichment_runs').select(RUN_COLUMNS).gte('created_at', fromIso).lt('created_at', toIso),
        )
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('búsquedas de contactos', result)),
      readScoped<RawContactCandidate>(userIds, 'reviewed_by', (scoped) => (from, to) =>
        scoped(
          admin
            .from('contact_enrichment_candidates')
            .select(CONTACT_CANDIDATE_COLUMNS)
            .in('status', REVIEWED_CONTACT_STATUSES)
            .gte('reviewed_at', fromIso)
            .lt('reviewed_at', toIso),
        )
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('contactos revisados', result)),
      readScoped<RawBatch>(userIds, 'created_by', (scoped) => (from, to) =>
        scoped(admin.from('prospect_batches').select(BATCH_COLUMNS).gte('created_at', fromIso).lt('created_at', toIso))
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('búsquedas de empresas', result)),
      readScoped<RawCompanyCandidate>(userIds, 'reviewed_by', (scoped) => (from, to) =>
        scoped(
          admin
            .from('prospect_candidates')
            .select(COMPANY_CANDIDATE_COLUMNS)
            .in('status', REVIEWED_COMPANY_STATUSES)
            .gte('reviewed_at', fromIso)
            .lt('reviewed_at', toIso),
        )
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('empresas revisadas', result)),
      readScoped<RawEnrichmentAccount>(userIds, 'metadata->hubspot_enrichment_request->>requested_by', (scoped) => (from, to) =>
        scoped(
          admin
            .from('accounts')
            .select(ENRICHMENT_ACCOUNT_COLUMNS)
            .not('metadata->hubspot_enrichment_request', 'is', null)
            .gte('metadata->hubspot_enrichment_request->>completed_at', fromIso)
            .lt('metadata->hubspot_enrichment_request->>completed_at', toIso),
        )
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('empresas de HubSpot enriquecidas', result)),
    ]);

    // Lo que encontraron las búsquedas del periodo (sus candidatos).
    [foundContactsRaw, foundCompaniesRaw] = await Promise.all([
      readByIds<RawContactCandidate>(runs.map((run) => run.id), (chunk) => (from, to) =>
        admin
          .from('contact_enrichment_candidates')
          .select(CONTACT_CANDIDATE_COLUMNS)
          .in('enrichment_run_id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('contactos encontrados', result)),
      readByIds<RawCompanyCandidate>(batches.map((batch) => batch.id), (chunk) => (from, to) =>
        admin
          .from('prospect_candidates')
          .select(COMPANY_CANDIDATE_COLUMNS)
          .in('batch_id', chunk)
          .order('id', { ascending: true })
          .range(from, to),
      ).then((result) => log.take('empresas encontradas', result)),
    ]);
  }

  // País y buscador de los contactos revisados cuya búsqueda es de antes del periodo.
  const runById = new Map(runs.map((run) => [run.id, run]));
  const missingRunIds = reviewedContactsRaw
    .map((candidate) => candidate.enrichment_run_id)
    .filter((id): id is string => Boolean(id) && !runById.has(id!));
  const approvedIds = reviewedContactsRaw.filter((candidate) => candidate.status === 'approved').map((c) => c.id);

  const [olderRuns, linkedRaw] = await Promise.all([
    readByIds<Pick<RawRun, 'id' | 'triggered_by' | 'company_country_code'>>(missingRunIds, (chunk) => (from, to) =>
      admin
        .from('contact_enrichment_runs')
        .select('id, triggered_by, company_country_code')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    ).then((result) => log.take('búsquedas de contactos anteriores', result)),
    readByIds<RawLinkedContact>(approvedIds, (chunk) => (from, to) =>
      admin
        .from('contacts')
        .select(LINKED_CONTACT_COLUMNS)
        .in('metadata->>source_candidate_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    ).then((result) => log.take('contactos aprobados en SellUp', result)),
  ]);
  const runMeta = new Map<string, { triggeredBy: string | null; countryCode: string | null }>();
  for (const run of [...runs, ...olderRuns]) {
    runMeta.set(run.id, { triggeredBy: run.triggered_by, countryCode: upperCode(run.company_country_code) });
  }

  // ── Normalización: de filas crudas a filas del núcleo (sin datos personales) ──
  const toContactCandidate = (row: RawContactCandidate): ContactCandidateRow => {
    const meta = row.enrichment_run_id ? runMeta.get(row.enrichment_run_id) : undefined;
    return {
      id: row.id,
      runId: row.enrichment_run_id,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      hasEmail: has(row.email),
      hasPhone: has(row.phone),
      hasLinkedin: has(row.linkedin_url),
      seniority: row.seniority,
      matchedHubspotContactId: row.matched_hubspot_contact_id,
      countryCode: meta?.countryCode ?? null,
      searchedBy: meta?.triggeredBy ?? null,
    };
  };

  const batchCreator = new Map(batches.map((batch) => [batch.id, batch.created_by]));
  const toCompanyCandidate = (row: RawCompanyCandidate): CompanyCandidateRow => ({
    id: row.id,
    batchId: row.batch_id,
    status: row.status,
    source: row.source_primary,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    countryCode: upperCode(row.country_code),
    industry: row.industry,
    sizeBand: sizeBandOf(row.employee_count, row.company_size),
    searchedBy: row.batch_id ? batchCreator.get(row.batch_id) ?? null : null,
  });

  const contactRuns: ContactRunRow[] = runs.map((run) => ({
    id: run.id,
    requestId: run.request_id,
    status: run.status,
    triggeredBy: run.triggered_by,
    createdAt: run.created_at,
    countryCode: upperCode(run.company_country_code),
  }));

  const companyBatches: CompanyBatchRow[] = batches.map((batch) => ({
    id: batch.id,
    createdBy: batch.created_by,
    createdAt: batch.created_at,
    countryCode: upperCode(batch.country_code),
  }));

  const linkedContacts: LinkedContactRow[] = linkedRaw
    .filter((row) => row.source_candidate_id)
    .map((row) => ({
      candidateId: row.source_candidate_id as string,
      hasEmail: has(row.email),
      // Sólo el teléfono principal: los escritores de la columna del móvil están auditados (4O-E4.1) y aquí no se lee.
      hasPhone: has(row.phone),
      hasLinkedin: has(row.linkedin_url),
      filledHubspotProperties: filledHubspotPropertiesOf(row.hubspot_sync),
    }));

  const hubspotEnrichments: HubSpotEnrichmentRow[] = enrichmentAccounts.flatMap((account) => {
    const request = asRecord(account.request);
    if (!request) return [];
    return [
      {
        accountId: account.id,
        requestedBy: asString(request.requested_by),
        completedAt: asString(request.completed_at),
        status: asString(request.status) ?? 'unknown',
        filled: asStringArray(request.filled),
        countryCode: upperCode(account.country_code),
        industry: account.industry,
        sizeBand: sizeBandOf(null, account.company_size),
      },
    ];
  });

  const foundContacts = foundContactsRaw.map(toContactCandidate);
  const reviewedContacts = reviewedContactsRaw.map(toContactCandidate);
  const foundCompanies = foundCompaniesRaw.map(toCompanyCandidate);
  const reviewedCompanies = reviewedCompaniesRaw.map(toCompanyCandidate);

  const countries = new Set<string>();
  for (const code of [
    ...contactRuns.map((run) => run.countryCode),
    ...companyBatches.map((batch) => batch.countryCode),
    ...foundCompanies.map((company) => company.countryCode),
    ...reviewedCompanies.map((company) => company.countryCode),
    ...reviewedContacts.map((contact) => contact.countryCode),
    ...hubspotEnrichments.map((enrichment) => enrichment.countryCode),
  ]) {
    if (code) countries.add(code);
  }
  for (const code of filters.countries) countries.add(code);

  const data = computeDashboard({
    range,
    granularity: filters.granularity,
    now: nowIso,
    filters,
    people: audience.people,
    contactRuns,
    foundContacts,
    reviewedContacts,
    linkedContacts,
    companyBatches,
    foundCompanies,
    reviewedCompanies,
    hubspotEnrichments,
    countryLabel: options.countryLabel,
  });

  return {
    kind: 'ready',
    now: nowIso,
    scopeKind,
    range,
    directory: { scopeKind, users, groups, countries: [...countries].sort() },
    data,
    readErrors: log.errors,
    truncated: log.truncated,
    ignoredTeams: audience.ignoredTeams,
    ignoredPeople: audience.ignoredPeople,
  };
}
