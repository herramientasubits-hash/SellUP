// ============================================================
// /ai-usage — pestañas «Por país», «Por rol y grupo» y «Por búsqueda» (lecturas)
//
// Sólo lee (paginado, con el ayudante de la fase 1): lotes, candidatas,
// descartes, el banco de empresas y personas. El dinero es el mismo universo de
// consultas que el resto de la página (loadUsageContext). Respeta el alcance
// comercial (lotes de las personas a las que llega quien mira) y la regla del
// dinero (a quien no ve USD no le llega ningún importe).
// ============================================================

import { cache } from 'react';
import {
  fetchAllPages,
  fetchAllPagesInChunks,
  IN_FILTER_CHUNK_SIZE,
} from '@/lib/supabase/paginated-read';
import { flattenOrgGroups } from '@/modules/access/group-tree';
import { resolvePeriodStart } from './usage-filter-semantics';
import { batchMatchesDimensionFilters } from './usage-dimension-scope';
import {
  candidateTool,
  isProductionDiscard,
  resolveCompanyOutcomes,
  type CompanyBatchRow,
  type CompanyCandidateRow,
  type CompanyDiscardRow,
} from './company-outcomes';
import {
  aggregateCountryTools,
  aggregateRoleGroups,
  aggregateSearchBatches,
  type CountryToolRow,
  type PersonUsageRow,
  type ResolvedDiscard,
  type RoleGroupRow,
  type SearchBatchRow,
  type UsagePersonInfo,
} from './usage-breakdowns';
import {
  redactCountryTools,
  redactRoleGroups,
  redactSearchBatches,
} from './money-visibility';
import { UsageReadError, type PageResult } from './usage-dataset';
import {
  dimensionFiltersOf,
  loadUsageContext,
  usageFiltersKey,
  type AdminClient,
  type UsageDataQuality,
  type UsageFilters,
  type UserScope,
} from './queries';

const BATCH_COLUMNS = 'id, created_at, created_by, country_code, industry, source, name, status, metadata';
const CANDIDATE_COLUMNS =
  'id, batch_id, status, duplicate_status, converted_account_id, source_primary, tax_identifier, website, ' +
  'domain, country_code, record_origin, rejection_reason, classification_source, review_notes, reviewed_by, metadata';

export interface UsageBreakdowns {
  moneyVisible: boolean;
  countryTools: CountryToolRow[];
  roles: RoleGroupRow[];
  groups: RoleGroupRow[];
  people: PersonUsageRow[];
  searches: SearchBatchRow[];
  /** Nombres legibles: rol → etiqueta, grupo → nombre, persona → nombre. */
  roleLabels: Record<string, string>;
  groupNames: Record<string, string>;
  personNames: Record<string, string>;
  dataQuality: UsageDataQuality;
}

function empty(moneyVisible: boolean, dataQuality: UsageDataQuality): UsageBreakdowns {
  return {
    moneyVisible,
    countryTools: [],
    roles: [],
    groups: [],
    people: [],
    searches: [],
    roleLabels: {},
    groupNames: {},
    personNames: {},
    dataQuality,
  };
}

function orThrow<T>(table: string, read: { rows: T[]; truncated: boolean; error: string | null }) {
  if (read.error) throw new UsageReadError(table, read.error);
  return read;
}

/** Lotes del ámbito: periodo, personas (alcance comercial) y país / industria / forma. */
async function readBatches(admin: AdminClient, filters: UsageFilters, userScope: UserScope) {
  const since = resolvePeriodStart(filters.period);
  const build = (people: string[] | null) => (from: number, to: number) => {
    let query = admin.from('prospect_batches').select(BATCH_COLUMNS);
    if (since) query = query.gte('created_at', since);
    if (people) query = query.in('created_by', people);
    return query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PageResult<CompanyBatchRow>;
  };
  const read =
    userScope.mode === 'ids'
      ? await fetchAllPagesInChunks<string, CompanyBatchRow>(userScope.ids, IN_FILTER_CHUNK_SIZE, build)
      : await fetchAllPages<CompanyBatchRow>(build(null));
  orThrow('prospect_batches', read);
  const dimensions = dimensionFiltersOf(filters);
  return { rows: read.rows.filter((b) => batchMatchesDimensionFilters(b, dimensions)), truncated: read.truncated };
}

async function readByBatch<T>(
  admin: AdminClient,
  table: string,
  columns: string,
  batchColumn: string,
  batchIds: readonly string[],
  extra?: { column: string; value: string },
) {
  if (batchIds.length === 0) return { rows: [] as T[], truncated: false };
  const read = await fetchAllPagesInChunks<string, T>(batchIds, IN_FILTER_CHUNK_SIZE, (chunk) => (from, to) => {
    let query = admin.from(table).select(columns).in(batchColumn, chunk);
    if (extra) query = query.eq(extra.column, extra.value);
    return query.order('id', { ascending: true }).range(from, to) as unknown as PageResult<T>;
  });
  orThrow(table, read);
  return read;
}

async function readPeopleAndNames(admin: AdminClient) {
  type PersonRow = { id: string; full_name: string | null; email: string | null; role_id: string | null; group_id: string | null };
  const [peopleRead, rolesResult, groupsResult] = await Promise.all([
    fetchAllPages<PersonRow>(
      (from, to) =>
        admin
          .from('internal_users')
          .select('id, full_name, email, role_id, group_id')
          .order('id', { ascending: true })
          .range(from, to) as unknown as PageResult<PersonRow>,
    ),
    admin.from('roles').select('id, key, name'),
    admin.from('organization_groups').select('id, name, parent_group_id'),
  ]);
  orThrow('internal_users', peopleRead);
  if (rolesResult.error) throw new UsageReadError('roles', rolesResult.error.message);
  if (groupsResult.error) throw new UsageReadError('organization_groups', groupsResult.error.message);

  const roleById = new Map((rolesResult.data ?? []).map((r) => [r.id as string, r]));
  const roleLabels: Record<string, string> = {};
  for (const r of rolesResult.data ?? []) {
    roleLabels[r.key as string] = ((r.name as string | null) ?? '').trim() || (r.key as string);
  }
  const groupNames: Record<string, string> = {};
  const groups = (groupsResult.data ?? []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    parent_group_id: (g.parent_group_id as string | null) ?? null,
  }));
  for (const { group } of flattenOrgGroups(groups)) groupNames[group.id] = group.name;

  const people: UsagePersonInfo[] = peopleRead.rows.map((p) => ({
    id: p.id,
    name: p.full_name,
    email: p.email,
    roleKey: p.role_id ? ((roleById.get(p.role_id)?.key as string | undefined) ?? null) : null,
    groupId: p.group_id,
  }));
  const personNames: Record<string, string> = {};
  for (const p of people) personNames[p.id] = p.name ?? p.email ?? p.id.slice(0, 8);
  return { people, roleLabels, groupNames, personNames };
}

const loadBreakdowns = cache(async (key: string): Promise<UsageBreakdowns | null> => {
  const filters = JSON.parse(key) as UsageFilters;
  const context = await loadUsageContext(key);
  if (context.kind === 'denied' || context.kind === 'access_error') return null;
  if (context.kind === 'empty') return empty(context.moneyVisible, { truncated: false, readError: false });
  if (context.kind === 'read_error') return empty(context.moneyVisible, { truncated: false, readError: true });
  const { admin, userScope, data, moneyVisible } = context;

  try {
    const batchesRead = await readBatches(admin, filters, userScope);
    const batches = batchesRead.rows;
    const batchesById = new Map(batches.map((b) => [b.id, b]));
    const batchIds = batches.map((b) => b.id);

    const [candidatesRead, discardsRead, bankRead, names] = await Promise.all([
      readByBatch<CompanyCandidateRow>(admin, 'prospect_candidates', CANDIDATE_COLUMNS, 'batch_id', batchIds),
      readByBatch<CompanyDiscardRow & { id: string }>(
        admin,
        'prospect_discarded_dispositions',
        'id, batch_id, country_code, source_primary',
        'batch_id',
        batchIds,
        { column: 'status', value: 'discarded' },
      ),
      readByBatch<{ id: string; assigned_candidate_id: string | null }>(
        admin,
        'agent1_company_bank',
        'id, assigned_candidate_id',
        'assigned_batch_id',
        batchIds,
        { column: 'status', value: 'assigned' },
      ),
      readPeopleAndNames(admin),
    ]);

    const bankIds = new Set(
      bankRead.rows.map((r) => r.assigned_candidate_id).filter((id): id is string => Boolean(id)),
    );
    const outcomes = resolveCompanyOutcomes(candidatesRead.rows, batchesById, bankIds);
    const discards: ResolvedDiscard[] = discardsRead.rows
      .filter((d) => isProductionDiscard(d, batchesById.get(d.batch_id)))
      .map((d) => ({
        countryCode:
          (d.country_code ?? batchesById.get(d.batch_id)?.country_code ?? null)?.trim().toUpperCase() || null,
        tool: candidateTool(d.source_primary, false),
      }));

    // Una búsqueda sale si entregó alguna empresa real o gastó algo: un lote de
    // QA vacío y gratis no es una búsqueda.
    const batchesWithLogs = new Set(data.logsInScope.map((l) => l.batch_id).filter(Boolean));
    const batchesWithOutcomes = new Set(outcomes.map((o) => o.batchId));
    const searchBatches = batches.filter((b) => batchesWithLogs.has(b.id) || batchesWithOutcomes.has(b.id));

    const roleGroups = aggregateRoleGroups(data.logsInScope, outcomes, batchesById, names.people);
    const searches = aggregateSearchBatches(searchBatches, outcomes, data.logsInScope);
    const result: UsageBreakdowns = {
      moneyVisible,
      countryTools: aggregateCountryTools(outcomes, discards, data.logsInScope),
      roles: roleGroups.roles,
      groups: roleGroups.groups,
      people: roleGroups.people,
      searches,
      roleLabels: names.roleLabels,
      groupNames: names.groupNames,
      personNames: namesInUse(names.personNames, roleGroups.people, searches),
      dataQuality: {
        truncated:
          data.truncated ||
          batchesRead.truncated ||
          candidatesRead.truncated ||
          discardsRead.truncated ||
          bankRead.truncated,
        readError: false,
      },
    };
    if (moneyVisible) return result;
    return {
      ...result,
      countryTools: redactCountryTools(result.countryTools),
      roles: redactRoleGroups(result.roles),
      groups: redactRoleGroups(result.groups),
      people: redactRoleGroups(result.people),
      searches: redactSearchBatches(result.searches),
    };
  } catch (err) {
    console.error('[ai-usage] breakdowns read failed:', err);
    return empty(moneyVisible, { truncated: false, readError: true });
  }
});

/** Sólo los nombres de quien sale en las tablas: nunca la plantilla entera. */
function namesInUse(
  personNames: Record<string, string>,
  people: readonly PersonUsageRow[],
  searches: readonly SearchBatchRow[],
): Record<string, string> {
  const ids = new Set<string>([
    ...people.map((p) => p.userId),
    ...searches.map((s) => s.createdBy).filter((id): id is string => Boolean(id)),
  ]);
  return Object.fromEntries(Object.entries(personNames).filter(([id]) => ids.has(id)));
}

/**
 * Las tablas de empresas y costo por país, rol/grupo y búsqueda. `null` = sin
 * acceso. Nunca lanza: un fallo vuelve como dataQuality.readError.
 */
export async function getAiUsageBreakdowns(filters: UsageFilters = {}): Promise<UsageBreakdowns | null> {
  return loadBreakdowns(usageFiltersKey(filters));
}
