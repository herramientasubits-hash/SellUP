// ============================================================
// Asistente de Slack — encontrar QUÉ se va a aprobar, descartar o asignar
// (antes de pedir confirmación). Sólo lee, y sólo dentro del alcance de quien
// pregunta: no se puede proponer una acción sobre algo que no se ve. Al
// confirmar, la acción de la plataforma vuelve a comprobar todo con la sesión
// de la persona.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommercialScope } from '@/modules/access/commercial-scope-logic';
import { displayUserName } from '@/modules/access/user-names';
import { buildCandidateOwnershipOrClause } from '@/modules/assignment/assignment-core';
import { MAX_ACTION_ITEMS, type ActionItem } from './action-proposal';
import {
  accountScopeClause,
  batchScopeClause,
  combineOr,
  countryFilter,
  ilikePattern,
  PROSPECT_STATE_STATUSES,
  scopeOwnerIds,
} from './query-helpers';

export interface ItemSelection {
  /** Nombres (o NIT / dominio) de cada elemento. */
  nombres?: string[];
  /** Todos los pendientes de una búsqueda. */
  busqueda?: string;
  pais?: string;
}

export interface Resolution {
  items: ActionItem[];
  /** Nombres pedidos que no se encontraron (o están fuera del alcance). */
  noEncontrados: string[];
  /** Nombres que coinciden con varios elementos: hay que precisar. */
  ambiguos: Array<{ pedido: string; opciones: string[] }>;
  /** Había más de los que caben en una confirmación. */
  recortados: number;
}

export interface UserResolution {
  user: { id: string; nombre: string } | null;
  opciones: string[];
  /** Existe, pero no está en el alcance de quien pide. */
  fueraDeAlcance?: boolean;
}

export interface AssistantActionResolver {
  resolveProspects(selection: ItemSelection): Promise<Resolution>;
  resolveAccounts(selection: ItemSelection): Promise<Resolution>;
  resolveActiveUser(text: string): Promise<UserResolution>;
  /** Una persona activa DENTRO del alcance (para recordatorios: tu equipo; admin, cualquiera). */
  resolveTeamMember(text: string): Promise<UserResolution>;
  /** Personas por nombre o correo con ese estado de acceso (administración). */
  resolveUsersByStatus(names: string[], status: 'active' | 'suspended'): Promise<Resolution>;
}

type CandidateRow = { id: string; name: string; duplicate_status: string | null; matched_hubspot_company_id: string | null };

function toItem(row: CandidateRow): ActionItem {
  return {
    id: row.id,
    nombre: row.name,
    ...(row.duplicate_status === 'possible_duplicate' ? { posibleDuplicado: true } : {}),
    ...(row.matched_hubspot_company_id ? { enHubSpot: true } : {}),
  };
}

/** Junta lo encontrado por nombre: uno = listo; varios = ambiguo; ninguno = no encontrado. */
export function collectByName<T extends { id: string; name: string }>(
  requested: readonly string[],
  matchesFor: ReadonlyMap<string, readonly T[]>,
  toActionItem: (row: T) => ActionItem,
): Resolution {
  const items = new Map<string, ActionItem>();
  const noEncontrados: string[] = [];
  const ambiguos: Resolution['ambiguos'] = [];
  for (const name of requested) {
    const rows = matchesFor.get(name) ?? [];
    const exact = rows.filter((r) => r.name.trim().toLowerCase() === name.trim().toLowerCase());
    const pick = exact.length === 1 ? exact : rows;
    if (pick.length === 0) noEncontrados.push(name);
    else if (pick.length > 1) ambiguos.push({ pedido: name, opciones: pick.slice(0, 5).map((r) => r.name) });
    else items.set(pick[0].id, toActionItem(pick[0]));
  }
  const all = [...items.values()];
  return { items: all.slice(0, MAX_ACTION_ITEMS), noEncontrados, ambiguos, recortados: Math.max(0, all.length - MAX_ACTION_ITEMS) };
}

export function createAssistantActionResolver(
  admin: SupabaseClient,
  scope: Pick<CommercialScope, 'canViewAll' | 'allowedUserIds'>,
): AssistantActionResolver {
  const owners = scopeOwnerIds(scope);

  async function ownership(): Promise<string | null | ''> {
    if (owners === null) return null;
    if (owners.length === 0) return '';
    const { data, error } = await admin.from('prospect_batches').select('id').or(batchScopeClause(owners)).limit(5000);
    if (error) throw new Error(error.message);
    return buildCandidateOwnershipOrClause(owners, (data ?? []).map((b) => b.id as string)) ?? '';
  }

  async function pendingCandidates(extra: { textClause?: string | null; batchIds?: string[] | null; pais?: string }, limit: number) {
    const own = await ownership();
    if (own === '') return [] as CandidateRow[];
    let query = admin
      .from('prospect_candidates')
      .select('id, name, duplicate_status, matched_hubspot_company_id')
      .in('status', [...(PROSPECT_STATE_STATUSES.por_revisar ?? [])])
      .order('created_at', { ascending: false })
      .limit(limit);
    const orClause = combineOr(own, extra.textClause ?? null);
    if (orClause) query = query.or(orClause);
    if (extra.batchIds) query = query.in('batch_id', extra.batchIds);
    const country = countryFilter(extra.pais);
    if (country) query = country.column === 'country_code' ? query.eq('country_code', country.value) : query.ilike('country', country.value);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as CandidateRow[];
  }

  return {
    async resolveProspects(selection): Promise<Resolution> {
      let batchIds: string[] | null = null;
      if (selection.busqueda) {
        const { data, error } = await admin.from('prospect_batches').select('id').ilike('name', ilikePattern(selection.busqueda)).limit(200);
        if (error) throw new Error(error.message);
        batchIds = (data ?? []).map((b) => b.id as string);
        if (batchIds.length === 0) return { items: [], noEncontrados: [selection.busqueda], ambiguos: [], recortados: 0 };
      }

      const names = (selection.nombres ?? []).map((n) => n.trim()).filter(Boolean).slice(0, MAX_ACTION_ITEMS);
      if (names.length === 0) {
        // «todas las de la búsqueda X» / «todas las de Chile»: hace falta al menos un filtro.
        if (!batchIds && !selection.pais) return { items: [], noEncontrados: [], ambiguos: [], recortados: 0 };
        const rows = await pendingCandidates({ batchIds, pais: selection.pais }, MAX_ACTION_ITEMS + 1);
        return {
          items: rows.slice(0, MAX_ACTION_ITEMS).map(toItem),
          noEncontrados: [],
          ambiguos: [],
          recortados: Math.max(0, rows.length - MAX_ACTION_ITEMS),
        };
      }

      const matches = new Map<string, CandidateRow[]>();
      for (const name of names) {
        const p = ilikePattern(name);
        matches.set(
          name,
          await pendingCandidates(
            { textClause: `name.ilike.${p},domain.ilike.${p},tax_identifier.ilike.${p},tax_id.ilike.${p}`, batchIds, pais: selection.pais },
            6,
          ),
        );
      }
      return collectByName(names, matches, toItem);
    },

    async resolveAccounts(selection): Promise<Resolution> {
      const names = (selection.nombres ?? []).map((n) => n.trim()).filter(Boolean).slice(0, MAX_ACTION_ITEMS);
      if (names.length === 0) return { items: [], noEncontrados: [], ambiguos: [], recortados: 0 };
      if (owners !== null && owners.length === 0) return { items: [], noEncontrados: names, ambiguos: [], recortados: 0 };
      const matches = new Map<string, Array<{ id: string; name: string }>>();
      for (const name of names) {
        const p = ilikePattern(name);
        let query = admin.from('accounts').select('id, name').is('archived_at', null).limit(6);
        const orClause = combineOr(owners ? accountScopeClause(owners) : null, `name.ilike.${p},legal_name.ilike.${p},domain.ilike.${p},tax_identifier.ilike.${p}`);
        if (orClause) query = query.or(orClause);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        matches.set(name, (data ?? []) as Array<{ id: string; name: string }>);
      }
      return collectByName(names, matches, (row) => ({ id: row.id, nombre: row.name }));
    },

    async resolveTeamMember(text): Promise<UserResolution> {
      const found = await this.resolveActiveUser(text);
      if (!found.user || owners === null || owners.includes(found.user.id)) return found;
      return { user: null, opciones: [], fueraDeAlcance: true };
    },

    async resolveUsersByStatus(names, status): Promise<Resolution> {
      const matches = new Map<string, Array<{ id: string; name: string }>>();
      for (const name of names.slice(0, MAX_ACTION_ITEMS)) {
        const p = ilikePattern(name);
        const { data, error } = await admin
          .from('internal_users')
          .select('id, full_name, email')
          .eq('access_status', status)
          .or(`full_name.ilike.${p},email.ilike.${p}`)
          .limit(6);
        if (error) throw new Error(error.message);
        matches.set(
          name,
          ((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((u) => ({
            id: u.id,
            name: displayUserName(u) ?? u.email ?? 'Sin nombre',
          })),
        );
      }
      return collectByName(names, matches, (row) => ({ id: row.id, nombre: row.name }));
    },

    async resolveActiveUser(text): Promise<UserResolution> {
      const p = ilikePattern(text);
      const { data, error } = await admin
        .from('internal_users')
        .select('id, full_name, email')
        .eq('access_status', 'active')
        .or(`full_name.ilike.${p},email.ilike.${p}`)
        .limit(6);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>;
      const exact = rows.filter((r) => (r.full_name ?? '').trim().toLowerCase() === text.trim().toLowerCase());
      const pick = exact.length === 1 ? exact : rows;
      if (pick.length === 1) return { user: { id: pick[0].id, nombre: displayUserName(pick[0]) ?? 'Sin nombre' }, opciones: [] };
      return { user: null, opciones: pick.map((r) => displayUserName(r) ?? r.email ?? '').filter(Boolean) };
    },
  };
}
