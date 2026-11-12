// ============================================================
// Alcance por registro (servidor): ¿quien pide puede tocar ESTA empresa,
// contacto, búsqueda o candidata? La misma regla que las listas, en cascada:
//   · admin → todo;
//   · manager / líder → lo suyo y lo de toda su gente hacia abajo
//     (organigrama + grupo, como `resolveCommercialScope`);
//   · vendedor / Growth → lo suyo.
// Una empresa (y sus contactos) es de alguien del alcance si es su responsable o
// la creó; una búsqueda, si es su dueño o la creó; una candidata, si es su
// asignado o el dueño/creador de su búsqueda.
// Con ENABLE_COMMERCIAL_SCOPE apagada no restringe nada (como las listas).
// Lee con el cliente de servicio: decide antes de que la acción toque nada.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import { resolveCommercialScope } from './commercial-scope';

export const OUT_OF_SCOPE_MESSAGE = 'No tienes acceso a este registro: es de alguien fuera de tu equipo.';

/** Personas cuyo trabajo puede tocar quien pide. `null` = todo; `[]` = nada. */
export async function currentScopeUserIds(): Promise<string[] | null> {
  if (!isCommercialScopeEnabled()) return null;
  const scope = await resolveCommercialScope();
  if (!scope) return [];
  return scope.canViewAll ? null : [...scope.allowedUserIds];
}

/** ¿Alguna de estas personas está en el alcance? */
export function anyInScope(scopeIds: readonly string[] | null, people: ReadonlyArray<string | null | undefined>): boolean {
  if (scopeIds === null) return true;
  const allowed = new Set(scopeIds);
  return people.some((id) => typeof id === 'string' && id.length > 0 && allowed.has(id));
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;

async function accountPeople(admin: Admin, accountId: string): Promise<Array<string | null> | null> {
  const { data } = await admin.from('accounts').select('owner_id, created_by').eq('id', accountId).maybeSingle();
  return data ? [data.owner_id as string | null, data.created_by as string | null] : null;
}

async function batchPeople(admin: Admin, batchId: string): Promise<Array<string | null> | null> {
  const { data } = await admin.from('prospect_batches').select('owner_id, created_by').eq('id', batchId).maybeSingle();
  return data ? [data.owner_id as string | null, data.created_by as string | null] : null;
}

/** ¿Puede tocar esta empresa? Falla cerrado si no existe o no se puede leer. */
export async function canActOnAccount(accountId: string): Promise<boolean> {
  const scopeIds = await currentScopeUserIds();
  if (scopeIds === null) return true;
  if (!accountId) return false;
  const people = await accountPeople(createSupabaseAdminClient(), accountId);
  return people !== null && anyInScope(scopeIds, people);
}

/** ¿Puede tocar este contacto? Va con su empresa (como la lista de Contactos). */
export async function canActOnContact(contactId: string): Promise<boolean> {
  const scopeIds = await currentScopeUserIds();
  if (scopeIds === null) return true;
  if (!contactId) return false;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('contacts').select('account_id').eq('id', contactId).maybeSingle();
  if (!data?.account_id) return false;
  const people = await accountPeople(admin, data.account_id as string);
  return people !== null && anyInScope(scopeIds, people);
}

/** ¿Puede tocar esta búsqueda? */
export async function canActOnBatch(batchId: string): Promise<boolean> {
  const scopeIds = await currentScopeUserIds();
  if (scopeIds === null) return true;
  if (!batchId) return false;
  const people = await batchPeople(createSupabaseAdminClient(), batchId);
  return people !== null && anyInScope(scopeIds, people);
}

/** ¿Puede tocar esta candidata? Su asignado o el dueño/creador de su búsqueda. */
export async function canActOnCandidate(candidateId: string): Promise<boolean> {
  const scopeIds = await currentScopeUserIds();
  if (scopeIds === null) return true;
  if (!candidateId) return false;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('prospect_candidates').select('assigned_to, batch_id').eq('id', candidateId).maybeSingle();
  if (!data) return false;
  const batch = data.batch_id ? await batchPeople(admin, data.batch_id as string) : null;
  return anyInScope(scopeIds, [data.assigned_to as string | null, ...(batch ?? [])]);
}

/** Variantes que lanzan, para acciones que ya lanzan sus errores. */
export async function requireAccountInScope(accountId: string): Promise<void> {
  if (!(await canActOnAccount(accountId))) throw new Error(OUT_OF_SCOPE_MESSAGE);
}
export async function requireContactInScope(contactId: string): Promise<void> {
  if (!(await canActOnContact(contactId))) throw new Error(OUT_OF_SCOPE_MESSAGE);
}
export async function requireBatchInScope(batchId: string): Promise<void> {
  if (!(await canActOnBatch(batchId))) throw new Error(OUT_OF_SCOPE_MESSAGE);
}
export async function requireCandidateInScope(candidateId: string): Promise<void> {
  if (!(await canActOnCandidate(candidateId))) throw new Error(OUT_OF_SCOPE_MESSAGE);
}

/**
 * Corridas y solicitudes de «Buscar contactos» (Agente 2): de quien la lanzó o
 * de la empresa. Así nadie gasta créditos en la búsqueda de otro equipo con su id.
 */
async function canActOnEnrichment(table: 'contact_enrichment_runs' | 'contact_enrichment_requests', id: string): Promise<boolean> {
  const scopeIds = await currentScopeUserIds();
  if (scopeIds === null) return true;
  if (!id) return false;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from(table).select('triggered_by, account_id').eq('id', id).maybeSingle();
  if (!data) return false;
  if (anyInScope(scopeIds, [data.triggered_by as string | null])) return true;
  const people = data.account_id ? await accountPeople(admin, data.account_id as string) : null;
  return people !== null && anyInScope(scopeIds, people);
}

export async function requireEnrichmentRunInScope(runId: string): Promise<void> {
  if (!(await canActOnEnrichment('contact_enrichment_runs', runId))) throw new Error(OUT_OF_SCOPE_MESSAGE);
}
export async function requireEnrichmentRequestInScope(requestId: string): Promise<void> {
  if (!(await canActOnEnrichment('contact_enrichment_requests', requestId))) throw new Error(OUT_OF_SCOPE_MESSAGE);
}
