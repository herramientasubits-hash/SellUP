// ============================================================
// Asistente de Slack — lectura comercial de SellUp con el alcance de quien
// pregunta. Usa el cliente de servicio (no hay sesión del navegador) y por eso
// CADA consulta filtra a mano con la regla de la plataforma: admin → todo;
// líder/manager → su equipo en cascada por el organigrama; vendedor → lo suyo.
// Los filtros que pide Claude (país, fecha, responsable…) sólo ACOTAN ese
// alcance, nunca lo amplían. Sólo lectura.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommercialScope } from '@/modules/access/commercial-scope-logic';
import { displayUserName } from '@/modules/access/user-names';
import {
  buildCandidateOwnershipOrClause,
  intersectOptionalUserIds,
  resolveCandidateResponsibleId,
} from '@/modules/assignment/assignment-core';
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from '@/modules/accounts/types';
import {
  BATCH_STATUS_LABELS,
  CANDIDATE_STATUS_LABELS,
  type BatchStatus,
  type CandidateStatus,
} from '@/modules/prospect-batches/types';
import { providerDisplayName } from '@/modules/usage-tracking/provider-failure';
import { getVisibleSince } from '@/lib/visible-since';
import { accountLink, accountsLink, aiUsageLink, pendingProspectsLink, prospectsLink, searchesLink } from './links';
import {
  accountLookup,
  accountScopeClause,
  batchScopeClause,
  clip,
  combineOr,
  countryFilter,
  createdSince,
  day,
  cascadeIds,
  effectiveBatchOwnerClause,
  ilikePattern,
  matchPeople,
  PersonFilterProblem,
  PROSPECT_STATE_STATUSES,
  type PersonRow,
  round2,
  scopeOwnerIds,
  usagePeriodStart,
} from './query-helpers';
import type {
  AssistantAccountDetail,
  AssistantAccountList,
  AssistantContact,
  AssistantContactList,
  AssistantDataSource,
  AssistantProspectList,
  AssistantSearch,
  AssistantSummary,
  AssistantUsage,
  UsagePeriod,
  WhoseFilter,
} from './tools';

/** Estados de una búsqueda que todavía no termina. */
const OPEN_BATCH_STATUSES: BatchStatus[] = ['generating', 'ready_for_review', 'in_review'];
const USAGE_PAGE_SIZE = 1000;
const USAGE_MAX_PAGES = 20;
const BRIEF_STATUS_LABELS: Record<string, string> = {
  ready: 'Lista',
  completed: 'Lista',
  running: 'En curso',
  pending: 'En curso',
  failed: 'Falló',
  expired: 'Vencida',
};
const PACK_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  needs_review: 'Por revisar',
  used: 'Usado',
  discarded: 'Descartado',
  failed: 'Falló',
};

// Supabase encadena filtros sobre el mismo builder; el tipo exacto no importa aquí.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function applyCountry(query: Query, pais: string | undefined, prefix = ''): Query {
  const filter = countryFilter(pais);
  if (!filter) return query;
  return filter.column === 'country_code'
    ? query.eq(`${prefix}country_code`, filter.value)
    : query.ilike(`${prefix}country`, filter.value);
}

type ContactRow = {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  linkedin_url: string | null;
  account?: { id: string; name: string | null } | null;
};

const CONTACT_COLUMNS = 'full_name, first_name, last_name, job_title, department, email, phone, mobile_phone, linkedin_url';

export interface AssistantDataSourceOptions {
  appUrl: string;
  /** Ve dólares (admin y líderes/managers, como en Uso de IA). */
  moneyVisible: boolean;
  now?: Date;
  /** Quien pregunta: para «mío» y «mi equipo». */
  askerId?: string;
  /**
   * La cascada de una persona con la regla de la plataforma (grupo ∪ reportes,
   * ver `createTeamScopeResolver`). Para «mi equipo» de un administrador y «el
   * equipo de Carla». Sin ella (pruebas), la cascada por `manager_id`.
   */
  resolveTeam?: (userId: string) => Promise<string[]>;
}

type UserLite = PersonRow & { manager_id: string | null };

export function createAssistantDataSource(
  admin: SupabaseClient,
  scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds' | 'isRestrictedToSelf'>,
  options: AssistantDataSourceOptions,
): Omit<AssistantDataSource, 'help'> {
  const owners = scopeOwnerIds(scope);
  const now = options.now ?? new Date();
  // Corte de visibilidad de la plataforma (SELLUP_VISIBLE_SINCE): lo de antes de
  // la entrega no aparece en Contactos ni en Uso de IA; el asistente tampoco lo muestra.
  const visibleSince = getVisibleSince();
  const appUrl = options.appUrl;

  function toContact(c: ContactRow): AssistantContact {
    return {
      nombre: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Sin nombre',
      cargo: c.job_title,
      area: c.department,
      correo: c.email,
      telefono: c.mobile_phone || c.phone,
      linkedin: c.linkedin_url,
      empresa: c.account?.name ?? null,
      enlaceEmpresa: c.account?.id ? accountLink(appUrl, c.account.id) : null,
    };
  }

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

  /** Personas de la organización (para nombres parciales y cascadas); se lee una vez. */
  let usersCache: Promise<UserLite[]> | null = null;
  function allUsers(): Promise<UserLite[]> {
    usersCache ??= (async () => {
      const { data, error } = await admin.from('internal_users').select('id, full_name, email, manager_id').limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as UserLite[];
    })();
    return usersCache;
  }

  /** La persona y su gente en cascada (regla de la plataforma si se inyectó). */
  async function teamOf(userId: string): Promise<string[]> {
    if (options.resolveTeam) return options.resolveTeam(userId);
    return cascadeIds(userId, await allUsers());
  }

  /** Vendedor/Growth (o líder sin equipo): todo lo suyo es «sólo lo tuyo». */
  const selfOnly = scope.isRestrictedToSelf && !scope.canViewAll;

  /**
   * De quién se leen los datos, SIEMPRE dentro del alcance del rol:
   * otra persona (por nombre parcial o correo, con o sin su equipo), lo propio,
   * el equipo de quien pregunta o todo su alcance. `null` = sin restricción.
   * Si el nombre es ambiguo, no existe o está fuera del alcance, lanza
   * `PersonFilterProblem` (la herramienta lo devuelve para preguntar).
   */
  async function peopleIds(who: WhoseFilter = {}): Promise<string[] | null> {
    const askerId = options.askerId;
    if (who.responsable) {
      const users = await allUsers();
      const found = matchPeople(users, who.responsable);
      if (found.length === 0) throw new PersonFilterProblem('sin_coincidencias', who.responsable);
      const visible = owners === null ? found : found.filter((u) => owners.includes(u.id));
      if (visible.length === 0) throw new PersonFilterProblem('fuera_de_alcance', who.responsable);
      if (visible.length > 1) {
        throw new PersonFilterProblem(
          'varias_personas',
          who.responsable,
          visible.slice(0, 8).map((u) => displayUserName(u) ?? u.email ?? u.id),
        );
      }
      const person = visible[0];
      const ids = who.equipo ? await teamOf(person.id) : [person.id];
      return intersectOptionalUserIds(owners, ids) ?? [];
    }
    if (who.de === 'mio' && askerId) return intersectOptionalUserIds(owners, [askerId]) ?? [];
    if (who.de === 'mi_equipo' && askerId) {
      // Líder/manager: su alcance ES su equipo (grupo ∪ reportes, como la plataforma).
      // Vendedor/Growth: sólo lo suyo. Admin: su cascada en el organigrama.
      if (!scope.canViewAll) return owners ?? [];
      return intersectOptionalUserIds(owners, await teamOf(askerId)) ?? [];
    }
    return owners;
  }

  /**
   * «mío» o una sola persona: los prospectos se cuentan por su RESPONSABLE
   * efectivo. Sin decir de quién, vale la visibilidad de la pantalla (lotes de
   * los que es dueño o que creó).
   */
  function isPersonal(who: WhoseFilter = {}): boolean {
    return who.de === 'mio' || (Boolean(who.responsable) && !who.equipo);
  }

  /** En palabras, de quién son los datos que se devuelven. */
  function whoseLabel(who: WhoseFilter = {}): string {
    if (who.responsable) return who.equipo ? `${who.responsable} y su equipo` : who.responsable;
    if (who.de === 'mio' || selfOnly) return 'sólo lo tuyo';
    if (who.de === 'mi_equipo') return 'tú y tu equipo (en cascada por el organigrama)';
    return scope.canViewAll ? 'toda la plataforma' : 'tu equipo (en cascada por el organigrama)';
  }

  /**
   * Lotes de `users`. Alcance (como la pantalla): dueño o creador. Personal
   * («mío», una persona): sólo los que son suyos de verdad — dueño o, sin
   * dueño, creador — para no contarle lo de otro dueño.
   */
  async function batchesOwnedBy(users: string[], personal: boolean): Promise<string[]> {
    if (users.length === 0) return [];
    const clause = personal ? effectiveBatchOwnerClause(users) : batchScopeClause(users);
    const { data, error } = await admin.from('prospect_batches').select('id').or(clause).limit(5000);
    if (error) throw new Error(error.message);
    return (data ?? []).map((b) => b.id as string);
  }

  /** Cláusula «responsable efectivo» de un prospecto: asignado, o el del lote. */
  async function candidateOwnership(users: string[] | null, personal = false): Promise<string | null | ''> {
    if (users === null) return null;
    if (users.length === 0) return '';
    return buildCandidateOwnershipOrClause(users, await batchesOwnedBy(users, personal)) ?? '';
  }

  async function countPending(users: string[] | null, personal: boolean): Promise<number> {
    const ownership = await candidateOwnership(users, personal);
    if (ownership === '') return 0;
    let query = admin
      .from('prospect_candidates')
      .select('id', { count: 'exact', head: true })
      .in('status', [...(PROSPECT_STATE_STATUSES.por_revisar ?? [])]);
    if (ownership) query = query.or(ownership);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  const source: Omit<AssistantDataSource, 'help'> = {
    usageVisible: options.moneyVisible,
    async summary(who): Promise<AssistantSummary> {
      const enlaces = { empresas: accountsLink(appUrl), porRevisar: pendingProspectsLink(appUrl), busquedas: searchesLink(appUrl) };
      const alcance = whoseLabel(who);
      const users = await peopleIds(who);
      if (users !== null && users.length === 0) {
        return { alcance, empresasActivas: 0, empresasPorEstado: {}, prospectosPorRevisar: 0, busquedasEnCurso: 0, contactos: 0, enlaces };
      }

      let accounts = admin.from('accounts').select('pipeline_status').is('archived_at', null).limit(20000);
      if (users) accounts = accounts.or(accountScopeClause(users));

      let openBatches = admin
        .from('prospect_batches')
        .select('id', { count: 'exact', head: true })
        .is('archived_at', null)
        .in('status', OPEN_BATCH_STATUSES);
      if (users) openBatches = openBatches.or(batchScopeClause(users));

      let contacts = admin
        .from('contacts')
        .select('id, accounts!inner(owner_id, created_by)', { count: 'exact', head: true })
        .is('archived_at', null)
        .is('accounts.archived_at', null);
      if (visibleSince) contacts = contacts.gte('created_at', visibleSince);
      if (users) contacts = contacts.or(accountScopeClause(users), { referencedTable: 'accounts' });

      const [acc, open, cont, pending] = await Promise.all([accounts, openBatches, contacts, countPending(users, isPersonal(who))]);
      for (const res of [acc, open, cont]) if (res.error) throw new Error(res.error.message);

      const byStatus: Record<string, number> = {};
      for (const row of (acc.data ?? []) as Array<{ pipeline_status: string | null }>) {
        const label = PIPELINE_STATUS_LABELS[row.pipeline_status as PipelineStatus] ?? row.pipeline_status ?? 'Sin estado';
        byStatus[label] = (byStatus[label] ?? 0) + 1;
      }
      return {
        alcance,
        empresasActivas: (acc.data ?? []).length,
        empresasPorEstado: byStatus,
        prospectosPorRevisar: pending,
        busquedasEnCurso: open.count ?? 0,
        contactos: cont.count ?? 0,
        enlaces,
      };
    },

    async prospects(filters, limit): Promise<AssistantProspectList> {
      const enlace = prospectsLink(appUrl, filters.estado, filters);
      const empty: AssistantProspectList = { estado: filters.estado, total: 0, mostrados: 0, enlace, prospectos: [] };
      const ownership = await candidateOwnership(await peopleIds(filters), isPersonal(filters));
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
          'name, status, country, industry, company_size, employee_count, website, tax_identifier, tax_id, assigned_to, created_at, reviewed_by, reviewed_at, rejection_reason, review_notes, batch:prospect_batches!prospect_candidates_batch_id_fkey(name, owner_id, created_by)',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      const statuses = PROSPECT_STATE_STATUSES[filters.estado];
      if (statuses) query = query.in('status', [...statuses]);
      // Un solo `or`: responsable efectivo Y (si viene) texto.
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
        status: string;
        country: string | null;
        industry: string | null;
        company_size: string | null;
        employee_count: number | null;
        website: string | null;
        tax_identifier: string | null;
        tax_id: string | null;
        assigned_to: string | null;
        created_at: string;
        reviewed_by: string | null;
        reviewed_at: string | null;
        rejection_reason: string | null;
        review_notes: string | null;
        batch: { name: string | null; owner_id: string | null; created_by?: string | null } | null;
      }>;
      // Responsable efectivo (como la pantalla): asignado, dueño del lote o quien lo creó.
      const responsibleOf = (r: (typeof rows)[number]) =>
        resolveCandidateResponsibleId({ assignedTo: r.assigned_to, batchOwnerId: r.batch?.owner_id, batchCreatedBy: r.batch?.created_by });
      const names = await namesOf(rows.flatMap((r) => [responsibleOf(r), r.reviewed_by]));
      return {
        estado: filters.estado,
        total: count ?? rows.length,
        mostrados: rows.length,
        enlace,
        prospectos: rows.map((r) => {
          const ownerId = responsibleOf(r);
          const decided = r.status === 'discarded' || r.status === 'approved' || r.status === 'converted_to_account';
          return {
            nombre: r.name,
            estado: CANDIDATE_STATUS_LABELS[r.status as CandidateStatus] ?? r.status,
            pais: r.country,
            industria: r.industry,
            tamano: r.company_size ?? (r.employee_count ? `${r.employee_count} empleados` : null),
            sitioWeb: r.website,
            nit: r.tax_identifier ?? r.tax_id,
            busqueda: r.batch?.name ?? null,
            responsable: ownerId ? names.get(ownerId) ?? null : null,
            creado: day(r.created_at),
            ...(decided
              ? {
                  decidioPor: r.reviewed_by ? names.get(r.reviewed_by) ?? null : 'Automático',
                  decidido: day(r.reviewed_at),
                  motivo: clip(r.rejection_reason ?? r.review_notes, 200),
                }
              : {}),
          };
        }),
      };
    },

    async accounts(filters, limit): Promise<AssistantAccountList> {
      const users = await peopleIds(filters);
      if (users !== null && users.length === 0) return { total: 0, mostradas: 0, empresas: [] };

      let query = admin
        .from('accounts')
        .select('id, name, pipeline_status, country, industry, website, owner_id, created_at, contacts(count)', { count: 'exact' })
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
      const textClause = filters.texto
        ? (() => {
            const p = ilikePattern(filters.texto);
            return `name.ilike.${p},legal_name.ilike.${p},domain.ilike.${p},tax_identifier.ilike.${p}`;
          })()
        : null;
      const orClause = combineOr(users ? accountScopeClause(users) : null, textClause);
      if (orClause) query = query.or(orClause);
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

    async accountDetail(queryText): Promise<AssistantAccountDetail> {
      /** No está en Empresas: puede estar por revisar (o descartada) o ser el nombre de un contacto. */
      const notApprovedYet = async (text: string): Promise<AssistantAccountDetail> => {
        const [prospects, people] = await Promise.all([
          source.prospects({ texto: text, estado: 'todos', periodo: 'todo' }, 5),
          source.contacts({ texto: text }, 5),
        ]);
        return {
          encontrada: false,
          otrasCoincidencias: [],
          ...(prospects.prospectos.length > 0 ? { enProspectos: prospects.prospectos, enlaceProspectos: prospects.enlace } : {}),
          ...(people.contactos.length > 0 ? { contactosConEseNombre: people.contactos } : {}),
        };
      };

      const notFound: AssistantAccountDetail = { encontrada: false, otrasCoincidencias: [] };
      if (owners !== null && owners.length === 0) return notFound;
      const lookup = accountLookup(queryText);

      let query = admin
        .from('accounts')
        .select(
          'id, name, legal_name, tax_identifier, tax_identifier_type, pipeline_status, pipeline_substatus, country, city, region, industry, company_size, website, domain, linkedin_url, hubspot_company_id, source, owner_id, created_by, created_at, updated_at, notes',
        )
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(4);
      if (lookup.kind === 'id') query = query.eq('id', lookup.value);
      const orClause = combineOr(owners ? accountScopeClause(owners) : null, lookup.kind === 'text' ? lookup.clause : null);
      if (orClause) query = query.or(orClause);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, string | null>>;
      if (rows.length === 0) return lookup.kind === 'text' ? notApprovedYet(queryText) : notFound;

      const a = rows[0];
      const accountId = a.id as string;
      let contactsQuery = admin
        .from('contacts')
        .select(CONTACT_COLUMNS, { count: 'exact' })
        .eq('account_id', accountId)
        .is('archived_at', null);
      // Corte de visibilidad, igual que Contactos (`contacts()`).
      if (visibleSince) contactsQuery = contactsQuery.gte('created_at', visibleSince);
      const [contactsRes, briefRes, packsRes] = await Promise.all([
        contactsQuery.order('is_primary', { ascending: false }).limit(10),
        admin
          .from('account_research_briefs')
          .select('status, summary, created_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false })
          .limit(1),
        admin
          .from('first_call_packs')
          .select('target_name, target_title, channel, status, created_at')
          .eq('account_id', accountId)
          .is('discarded_at', null)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      for (const res of [contactsRes, briefRes, packsRes]) if (res.error) throw new Error(res.error.message);
      const names = await namesOf([a.owner_id, a.created_by]);
      const brief = ((briefRes.data ?? []) as Array<{ status: string; summary: string | null; created_at: string }>)[0];

      return {
        encontrada: true,
        otrasCoincidencias: rows.slice(1).map((r) => r.name as string),
        empresa: {
          id: accountId,
          nombre: a.name as string,
          razonSocial: a.legal_name,
          nit: a.tax_identifier,
          tipoNit: a.tax_identifier_type,
          estado: PIPELINE_STATUS_LABELS[a.pipeline_status as PipelineStatus] ?? a.pipeline_status ?? 'Sin estado',
          subestado: a.pipeline_substatus,
          pais: a.country,
          ciudad: a.city,
          region: a.region,
          industria: a.industry,
          tamano: a.company_size,
          sitioWeb: a.website,
          dominio: a.domain,
          linkedin: a.linkedin_url,
          hubspotId: a.hubspot_company_id,
          fuente: a.source,
          responsable: a.owner_id ? names.get(a.owner_id) ?? null : null,
          creadaPor: a.created_by ? names.get(a.created_by) ?? null : null,
          creada: day(a.created_at),
          actualizada: day(a.updated_at),
          notas: clip(a.notes, 600),
          enlace: accountLink(appUrl, accountId),
        },
        contactos: ((contactsRes.data ?? []) as unknown as ContactRow[]).map(toContact),
        totalContactos: contactsRes.count ?? 0,
        rumbo: {
          investigacion: brief
            ? { estado: BRIEF_STATUS_LABELS[brief.status] ?? brief.status, resumen: clip(brief.summary, 500), fecha: day(brief.created_at) }
            : null,
          primerosContactos: ((packsRes.data ?? []) as Array<Record<string, string | null>>).map((p) => ({
            para: p.target_name,
            cargo: p.target_title,
            canal: p.channel,
            estado: PACK_STATUS_LABELS[p.status ?? ''] ?? p.status ?? '',
            fecha: day(p.created_at),
          })),
        },
      };
    },

    async contacts(filters, limit): Promise<AssistantContactList> {
      if (owners !== null && owners.length === 0) return { total: 0, mostrados: 0, contactos: [] };
      let query = admin
        .from('contacts')
        .select(`${CONTACT_COLUMNS}, account:accounts!inner(id, name, owner_id, created_by, country, country_code, domain, archived_at)`, {
          count: 'exact',
        })
        .is('archived_at', null)
        .is('account.archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (visibleSince) query = query.gte('created_at', visibleSince);
      // Persona Y cargo en un solo `or` de la tabla de contactos.
      const personClause = filters.texto
        ? (() => {
            const p = ilikePattern(filters.texto);
            return `full_name.ilike.${p},first_name.ilike.${p},last_name.ilike.${p},email.ilike.${p}`;
          })()
        : null;
      const titleClause = filters.cargo
        ? (() => {
            const p = ilikePattern(filters.cargo);
            return `job_title.ilike.${p},department.ilike.${p}`;
          })()
        : null;
      const contactClause = combineOr(personClause, titleClause);
      if (contactClause) query = query.or(contactClause);
      // Alcance de la empresa Y (si viene) empresa pedida, en un solo `or` de la tabla embebida.
      const companyClause = filters.empresa
        ? (() => {
            const p = ilikePattern(filters.empresa);
            return `name.ilike.${p},domain.ilike.${p}`;
          })()
        : null;
      const accountClause = combineOr(owners ? accountScopeClause(owners) : null, companyClause);
      if (accountClause) query = query.or(accountClause, { referencedTable: 'account' });
      query = applyCountry(query, filters.pais, 'account.');
      const { data, count, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as ContactRow[];
      return { total: count ?? rows.length, mostrados: rows.length, contactos: rows.map(toContact) };
    },

    async searches(filters, limit): Promise<AssistantSearch[]> {
      const users = await peopleIds(filters);
      if (users !== null && users.length === 0) return [];
      let query = admin
        .from('prospect_batches')
        .select('id, name, status, country, industry, target_count, owner_id, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (users) query = query.or(batchScopeClause(users));
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

    async aiUsage(period: UsagePeriod, who: WhoseFilter = {}): Promise<AssistantUsage> {
      if (!options.moneyVisible) throw new Error('Uso de IA lo ven sólo administradores, managers y líderes.');
      const periodStart = usagePeriodStart(period, now);
      const since = visibleSince && visibleSince > periodStart ? visibleSince : periodStart;
      const money = options.moneyVisible;
      const users = await peopleIds(who);
      const alcance = whoseLabel(who);
      const empty: AssistantUsage = {
        periodo: period,
        desde: day(since),
        alcance,
        consultas: 0,
        errores: 0,
        creditos: 0,
        costoUsd: money ? 0 : null,
        porProveedor: [],
        porPersona: [],
        enlace: aiUsageLink(appUrl),
      };
      if (users !== null && users.length === 0) return empty;

      const rows: Array<{ provider_key: string; status: string; estimated_cost_usd: number | null; credits_used: number | null; triggered_by: string | null }> = [];
      for (let page = 0; page < USAGE_MAX_PAGES; page++) {
        let query = admin
          .from('provider_usage_logs')
          .select('provider_key, status, estimated_cost_usd, credits_used, triggered_by')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(page * USAGE_PAGE_SIZE, (page + 1) * USAGE_PAGE_SIZE - 1);
        if (users) query = query.in('triggered_by', users);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as typeof rows));
        if (!data || data.length < USAGE_PAGE_SIZE) break;
      }

      type Bucket = { consultas: number; errores: number; creditos: number; costoUsd: number };
      const add = (map: Map<string, Bucket>, key: string, r: (typeof rows)[number]) => {
        const b = map.get(key) ?? { consultas: 0, errores: 0, creditos: 0, costoUsd: 0 };
        b.consultas += 1;
        if (r.status !== 'success') b.errores += 1;
        b.creditos += Number(r.credits_used ?? 0);
        b.costoUsd += Number(r.estimated_cost_usd ?? 0);
        map.set(key, b);
      };
      const byProvider = new Map<string, Bucket>();
      const byPerson = new Map<string, Bucket>();
      for (const r of rows) {
        add(byProvider, r.provider_key, r);
        add(byPerson, r.triggered_by ?? 'sistema', r);
      }
      const names = await namesOf([...byPerson.keys()].filter((k) => k !== 'sistema'));
      const usd = (n: number) => (money ? round2(n) : null);
      const porProveedor = [...byProvider.entries()]
        .map(([key, b]) => ({ proveedor: providerDisplayName(key), consultas: b.consultas, errores: b.errores, creditos: round2(b.creditos), costoUsd: usd(b.costoUsd) }))
        .sort((a, b) => (b.costoUsd ?? 0) - (a.costoUsd ?? 0) || b.consultas - a.consultas);
      const porPersona = [...byPerson.entries()]
        .map(([key, b]) => ({ persona: key === 'sistema' ? 'Automático' : names.get(key) ?? 'Sin nombre', consultas: b.consultas, creditos: round2(b.creditos), costoUsd: usd(b.costoUsd) }))
        .sort((a, b) => (b.costoUsd ?? 0) - (a.costoUsd ?? 0) || b.consultas - a.consultas)
        .slice(0, 15);
      const totalUsd = [...byProvider.values()].reduce((s, b) => s + b.costoUsd, 0);
      return {
        ...empty,
        consultas: rows.length,
        errores: porProveedor.reduce((s, p) => s + p.errores, 0),
        creditos: round2([...byProvider.values()].reduce((s, b) => s + b.creditos, 0)),
        costoUsd: usd(totalUsd),
        porProveedor,
        // Un vendedor sólo se ve a sí mismo: el desglose por persona no aporta.
        porPersona: scope.isRestrictedToSelf && !scope.canViewAll ? [] : porPersona,
      };
    },
  };
  return source;
}
