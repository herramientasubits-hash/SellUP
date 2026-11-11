// ============================================================
// Asistente de Slack — lectura de SellUp con el alcance de quien pregunta.
// Usa el cliente de servicio (no hay sesión del navegador) y por eso CADA
// consulta filtra a mano por los responsables que esa persona puede ver:
// admin → todo; líder → su equipo; vendedor → lo suyo. Los filtros que pide
// Claude (país, fecha, responsable…) sólo pueden ACOTAR ese alcance, nunca
// ampliarlo. Sólo lectura.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommercialScope } from '@/modules/access/commercial-scope-logic';
import { displayUserName } from '@/modules/access/user-names';
import { buildCandidateOwnershipOrClause, intersectOptionalUserIds } from '@/modules/assignment/assignment-core';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/modules/accounts/types';
import {
  BATCH_STATUS_LABELS,
  CANDIDATE_STATUS_LABELS,
  type BatchStatus,
  type CandidateStatus,
} from '@/modules/prospect-batches/types';
import { providerDisplayName } from '@/modules/usage-tracking/provider-failure';
import { accountLink, accountsLink, pendingProspectsLink, searchesLink } from './links';
import type {
  AssistantAccountList,
  AssistantContact,
  AssistantDataSource,
  AssistantProspectList,
  AssistantSearch,
  AssistantSummary,
  AssistantUsage,
  CreatedPeriod,
  UsagePeriod,
} from './tools';

/** Los mismos estados que la pantalla «Por revisar». */
export const PENDING_CANDIDATE_STATUSES = ['needs_review', 'generated', 'normalized'] as const;
/** Estados de una búsqueda que todavía no termina. */
const OPEN_BATCH_STATUSES: BatchStatus[] = ['generating', 'ready_for_review', 'in_review'];
const USAGE_PAGE_SIZE = 1000;
const USAGE_MAX_PAGES = 20;
/** Bogotá (UTC-5, sin horario de verano): «hoy» y «este mes» del equipo. */
const TEAM_UTC_OFFSET_HOURS = -5;

/** `null` = sin filtro (admin). Si no, los responsables visibles. */
export function scopeOwnerIds(scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'>): string[] | null {
  return scope.canViewAll ? null : [...scope.allowedUserIds];
}

/** Inicio del periodo en hora de Bogotá, como instante ISO. */
export function usagePeriodStart(period: UsagePeriod, now: Date): string {
  const offsetMs = TEAM_UTC_OFFSET_HOURS * 3_600_000;
  const local = new Date(now.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const startLocal =
    period === 'mes' ? Date.UTC(y, m, 1) : period === 'semana' ? Date.UTC(y, m, d - 6) : Date.UTC(y, m, d);
  return new Date(startLocal - offsetMs).toISOString();
}

/** `null` = sin límite de fecha. */
export function createdSince(period: CreatedPeriod | undefined, now: Date): string | null {
  return !period || period === 'todo' ? null : usagePeriodStart(period, now);
}

/** Escapa los comodines de `ilike` en lo que escribió la persona. */
export function ilikePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, ' ').trim()}%`;
}

/** País: 2 letras = código ISO exacto; si no, por nombre. */
export function countryFilter(pais: string | undefined): { column: 'country_code'; value: string } | { column: 'country'; value: string } | null {
  const value = pais?.trim();
  if (!value) return null;
  return value.length === 2 ? { column: 'country_code', value: value.toUpperCase() } : { column: 'country', value: ilikePattern(value) };
}

function day(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Junta dos cláusulas `or` de PostgREST en una sola: (a) Y (b). */
export function combineOr(a: string | null, b: string | null): string | null {
  if (a && b) return `and(or(${a}),or(${b}))`;
  return a || b || null;
}

// Supabase encadena filtros sobre el mismo builder; el tipo exacto no importa aquí.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function applyCountry(query: Query, pais: string | undefined): Query {
  const filter = countryFilter(pais);
  if (!filter) return query;
  return filter.column === 'country_code' ? query.eq('country_code', filter.value) : query.ilike('country', filter.value);
}

export function createAssistantDataSource(
  admin: SupabaseClient,
  scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'>,
  options: { appUrl: string; now?: Date },
): AssistantDataSource {
  const owners = scopeOwnerIds(scope);
  const now = options.now ?? new Date();
  const appUrl = options.appUrl;

  async function namesOf(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const { data } = await admin.from('internal_users').select('id, full_name, email').in('id', unique);
    const names = new Map<string, string>();
    for (const user of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      const name = displayUserName(user);
      if (name) names.set(user.id, name);
    }
    return names;
  }

  /**
   * Responsables a filtrar: el alcance ∩ la persona pedida. `null` = sin
   * restricción (admin sin filtro); `[]` = nada visible.
   */
  async function ownerIds(responsable: string | undefined): Promise<string[] | null> {
    if (!responsable) return owners;
    const pattern = ilikePattern(responsable);
    const { data, error } = await admin
      .from('internal_users')
      .select('id')
      .or(`full_name.ilike.${pattern},email.ilike.${pattern}`)
      .limit(50);
    if (error) throw new Error(error.message);
    return intersectOptionalUserIds(owners, (data ?? []).map((u) => u.id as string)) ?? [];
  }

  /** Lotes cuyo dueño o creador está entre `users` (como la pantalla). */
  async function batchesOwnedBy(users: string[]): Promise<string[]> {
    if (users.length === 0) return [];
    const list = users.join(',');
    const { data, error } = await admin
      .from('prospect_batches')
      .select('id')
      .or(`owner_id.in.(${list}),created_by.in.(${list})`)
      .limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((b) => b.id as string);
  }

  /** Cláusula «responsable efectivo» de un prospecto: asignado, o el del lote. */
  async function candidateOwnership(users: string[] | null): Promise<string | null | ''> {
    if (users === null) return null;
    if (users.length === 0) return '';
    return buildCandidateOwnershipOrClause(users, await batchesOwnedBy(users)) ?? '';
  }

  async function countPending(): Promise<number> {
    const ownership = await candidateOwnership(owners);
    if (ownership === '') return 0;
    let query = admin
      .from('prospect_candidates')
      .select('id', { count: 'exact', head: true })
      .in('status', [...PENDING_CANDIDATE_STATUSES]);
    if (ownership) query = query.or(ownership);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  return {
    async summary(): Promise<AssistantSummary> {
      const enlaces = { empresas: accountsLink(appUrl), porRevisar: pendingProspectsLink(appUrl), busquedas: searchesLink(appUrl) };
      if (owners !== null && owners.length === 0) {
        return { empresasActivas: 0, empresasPorEstado: {}, prospectosPorRevisar: 0, busquedasEnCurso: 0, contactos: 0, enlaces };
      }

      let accounts = admin.from('accounts').select('pipeline_status').is('archived_at', null).limit(20000);
      if (owners) accounts = accounts.in('owner_id', owners);

      let openBatches = admin
        .from('prospect_batches')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .in('status', OPEN_BATCH_STATUSES);
      if (owners) openBatches = openBatches.in('owner_id', owners);

      let contacts = admin
        .from('contacts')
        .select('id, accounts!inner(owner_id)', { count: 'exact', head: true })
        .is('archived_at', null)
        .is('accounts.archived_at', null);
      if (owners) contacts = contacts.in('accounts.owner_id', owners);

      const [acc, open, cont, pending] = await Promise.all([accounts, openBatches, contacts, countPending()]);
      for (const res of [acc, open, cont]) if (res.error) throw new Error(res.error.message);

      const byStatus: Record<string, number> = {};
      for (const row of (acc.data ?? []) as Array<{ pipeline_status: string | null }>) {
        const label = PIPELINE_STATUS_LABELS[row.pipeline_status as PipelineStatus] ?? row.pipeline_status ?? 'Sin estado';
        byStatus[label] = (byStatus[label] ?? 0) + 1;
      }
      return {
        empresasActivas: (acc.data ?? []).length,
        empresasPorEstado: byStatus,
        prospectosPorRevisar: pending,
        busquedasEnCurso: open.count ?? 0,
        contactos: cont.count ?? 0,
        enlaces,
      };
    },

    async pendingProspects(filters, limit): Promise<AssistantProspectList> {
      const enlace = pendingProspectsLink(appUrl, filters);
      const empty: AssistantProspectList = { total: 0, mostrados: 0, enlace, prospectos: [] };
      const ownership = await candidateOwnership(await ownerIds(filters.responsable));
      if (ownership === '') return empty;

      let batchIds: string[] | null = null;
      if (filters.busqueda) {
        const { data, error } = await admin
          .from('prospect_batches')
          .select('id')
          .ilike('name', ilikePattern(filters.busqueda))
          .limit(500);
        if (error) throw new Error(error.message);
        batchIds = (data ?? []).map((b) => b.id as string);
        if (batchIds.length === 0) return empty;
      }

      let query = admin
        .from('prospect_candidates')
        .select(
          'name, country, industry, company_size, employee_count, website, tax_identifier, tax_id, assigned_to, created_at, batch:prospect_batches!prospect_candidates_batch_id_fkey(name, owner_id)',
          { count: 'exact' },
        )
        .in('status', [...PENDING_CANDIDATE_STATUSES])
        .order('created_at', { ascending: false })
        .limit(limit);
      // Un solo `or`: responsable efectivo Y (si viene) texto, sin depender de
      // cómo combine PostgREST dos parámetros `or` sueltos.
      const textClause = filters.texto
        ? (() => {
            const p = ilikePattern(filters.texto);
            return `name.ilike.${p},domain.ilike.${p},tax_identifier.ilike.${p},tax_id.ilike.${p}`;
          })()
        : null;
      const orClause = combineOr(ownership, textClause);
      if (orClause) query = query.or(orClause);
      if (batchIds) query = query.in('batch_id', batchIds);
      query = applyCountry(query, filters.pais);
      if (filters.industria) query = query.ilike('industry', ilikePattern(filters.industria));
      const since = createdSince(filters.periodo, now);
      if (since) query = query.gte('created_at', since);

      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as Array<{
        name: string;
        country: string | null;
        industry: string | null;
        company_size: string | null;
        employee_count: number | null;
        website: string | null;
        tax_identifier: string | null;
        tax_id: string | null;
        assigned_to: string | null;
        created_at: string;
        batch: { name: string | null; owner_id: string | null } | null;
      }>;
      const names = await namesOf(rows.map((r) => r.assigned_to ?? r.batch?.owner_id ?? null));
      return {
        total: count ?? rows.length,
        mostrados: rows.length,
        enlace,
        prospectos: rows.map((r) => {
          const ownerId = r.assigned_to ?? r.batch?.owner_id ?? null;
          return {
            nombre: r.name,
            pais: r.country,
            industria: r.industry,
            tamano: r.company_size ?? (r.employee_count ? `${r.employee_count} empleados` : null),
            sitioWeb: r.website,
            nit: r.tax_identifier ?? r.tax_id,
            busqueda: r.batch?.name ?? null,
            responsable: ownerId ? names.get(ownerId) ?? null : null,
            creado: day(r.created_at),
          };
        }),
      };
    },

    async accounts(filters, limit): Promise<AssistantAccountList> {
      const users = await ownerIds(filters.responsable);
      if (users !== null && users.length === 0) return { total: 0, mostradas: 0, empresas: [] };

      let query = admin
        .from('accounts')
        .select('id, name, pipeline_status, country, industry, website, owner_id, created_at, contacts(count)', { count: 'exact' })
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (users) query = query.in('owner_id', users);
      if (filters.texto) {
        const p = ilikePattern(filters.texto);
        query = query.or(`name.ilike.${p},legal_name.ilike.${p},domain.ilike.${p},tax_identifier.ilike.${p}`);
      }
      query = applyCountry(query, filters.pais);
      if (filters.industria) query = query.ilike('industry', ilikePattern(filters.industria));
      if (filters.estado) query = query.eq('pipeline_status', filters.estado);
      const since = createdSince(filters.periodo, now);
      if (since) query = query.gte('created_at', since);

      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        id: string;
        name: string;
        pipeline_status: string | null;
        country: string | null;
        industry: string | null;
        website: string | null;
        owner_id: string | null;
        created_at: string;
        contacts: Array<{ count: number }> | null;
      }>;
      const names = await namesOf(rows.map((r) => r.owner_id));
      return {
        total: count ?? rows.length,
        mostradas: rows.length,
        empresas: rows.map((r) => ({
          nombre: r.name,
          estado: PIPELINE_STATUS_LABELS[r.pipeline_status as PipelineStatus] ?? r.pipeline_status ?? 'Sin estado',
          pais: r.country,
          industria: r.industry,
          sitioWeb: r.website,
          responsable: r.owner_id ? names.get(r.owner_id) ?? null : null,
          contactos: r.contacts?.[0]?.count ?? 0,
          creada: day(r.created_at),
          enlace: accountLink(appUrl, r.id),
        })),
      };
    },

    async accountContacts(accountText, limit) {
      if (owners !== null && owners.length === 0) return { empresa: null, enlace: null, contactos: [] };
      const pattern = ilikePattern(accountText);
      let accountQuery = admin
        .from('accounts')
        .select('id, name')
        .is('archived_at', null)
        .or(`name.ilike.${pattern},domain.ilike.${pattern}`)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (owners) accountQuery = accountQuery.in('owner_id', owners);
      const { data: account, error } = await accountQuery.maybeSingle();
      if (error) throw new Error(error.message);
      if (!account) return { empresa: null, enlace: null, contactos: [] };

      const { data: contacts, error: contactsError } = await admin
        .from('contacts')
        .select('full_name, first_name, last_name, job_title, email, phone, mobile_phone, linkedin_url')
        .eq('account_id', account.id)
        .is('archived_at', null)
        .order('is_primary', { ascending: false })
        .limit(limit);
      if (contactsError) throw new Error(contactsError.message);

      return {
        empresa: account.name as string,
        enlace: accountLink(appUrl, account.id as string),
        contactos: ((contacts ?? []) as Array<Record<string, string | null>>).map(
          (c): AssistantContact => ({
            nombre: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Sin nombre',
            cargo: c.job_title,
            correo: c.email,
            telefono: c.mobile_phone || c.phone,
            linkedin: c.linkedin_url,
          }),
        ),
      };
    },

    async searches(filters, limit): Promise<AssistantSearch[]> {
      const users = await ownerIds(filters.responsable);
      if (users !== null && users.length === 0) return [];
      let query = admin
        .from('prospect_batches')
        .select('id, name, status, country, industry, target_count, owner_id, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (users) {
        const list = users.join(',');
        query = query.or(`owner_id.in.(${list}),created_by.in.(${list})`);
      }
      if (filters.texto) query = query.ilike('name', ilikePattern(filters.texto));
      query = applyCountry(query, filters.pais);
      const since = createdSince(filters.periodo, now);
      if (since) query = query.gte('created_at', since);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const batches = (data ?? []) as Array<{
        id: string;
        name: string;
        status: string;
        country: string | null;
        industry: string | null;
        target_count: number | null;
        owner_id: string | null;
        created_at: string;
      }>;
      if (batches.length === 0) return [];

      const { data: candidates, error: candError } = await admin
        .from('prospect_candidates')
        .select('batch_id, status')
        .in('batch_id', batches.map((b) => b.id))
        .limit(10000);
      if (candError) throw new Error(candError.message);

      const counts = new Map<string, Record<string, number>>();
      for (const c of (candidates ?? []) as Array<{ batch_id: string; status: string }>) {
        const label = CANDIDATE_STATUS_LABELS[c.status as CandidateStatus] ?? c.status;
        const bucket = counts.get(c.batch_id) ?? {};
        bucket[label] = (bucket[label] ?? 0) + 1;
        counts.set(c.batch_id, bucket);
      }
      const names = await namesOf(batches.map((b) => b.owner_id));
      return batches.map((b) => ({
        nombre: b.name,
        estado: BATCH_STATUS_LABELS[b.status as BatchStatus] ?? b.status,
        pais: b.country,
        industria: b.industry,
        meta: b.target_count,
        responsable: b.owner_id ? names.get(b.owner_id) ?? null : null,
        creada: day(b.created_at),
        candidatos: counts.get(b.id) ?? {},
        enlace: searchesLink(appUrl, b.id),
      }));
    },

    async aiUsage(period: UsagePeriod): Promise<AssistantUsage> {
      const since = usagePeriodStart(period, now);
      const empty: AssistantUsage = { periodo: period, desde: day(since), consultas: 0, errores: 0, costoUsd: 0, porProveedor: [] };
      if (owners !== null && owners.length === 0) return empty;

      const rows: Array<{ provider_key: string; status: string; estimated_cost_usd: number | null }> = [];
      for (let page = 0; page < USAGE_MAX_PAGES; page++) {
        let query = admin
          .from('provider_usage_logs')
          .select('provider_key, status, estimated_cost_usd')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(page * USAGE_PAGE_SIZE, (page + 1) * USAGE_PAGE_SIZE - 1);
        if (owners) query = query.in('triggered_by', owners);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as typeof rows));
        if (!data || data.length < USAGE_PAGE_SIZE) break;
      }

      const byProvider = new Map<string, { consultas: number; errores: number; costoUsd: number }>();
      for (const r of rows) {
        const bucket = byProvider.get(r.provider_key) ?? { consultas: 0, errores: 0, costoUsd: 0 };
        bucket.consultas += 1;
        if (r.status !== 'success') bucket.errores += 1;
        bucket.costoUsd += Number(r.estimated_cost_usd ?? 0);
        byProvider.set(r.provider_key, bucket);
      }
      const porProveedor = [...byProvider.entries()]
        .map(([key, b]) => ({ proveedor: providerDisplayName(key), consultas: b.consultas, errores: b.errores, costoUsd: round2(b.costoUsd) }))
        .sort((a, b) => b.costoUsd - a.costoUsd || b.consultas - a.consultas);
      return {
        ...empty,
        consultas: rows.length,
        errores: porProveedor.reduce((s, p) => s + p.errores, 0),
        costoUsd: round2(porProveedor.reduce((s, p) => s + p.costoUsd, 0)),
        porProveedor,
      };
    },
  };
}
