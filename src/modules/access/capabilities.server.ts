// Solo servidor (lee la sesión y process.env): no importarlo desde el cliente.
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import { decideApprovalResponsible, type ResponsibleUserFacts } from '@/modules/assignment/assignment-core';
import {
  CAPABILITY_DENIED_MESSAGE,
  NEEDS_ASSIGNEE_MESSAGE,
  NEEDS_GROWTH_REVIEW_MESSAGE,
  canReviewCandidate,
  decideCandidateApproval,
  hasCapability,
  type AccessSnapshot,
  type Capability,
  type CandidateDuplicateSignals,
  type CandidateOwnership,
  type CandidateReviewDecision,
} from './capabilities';

/** Bandera de despliegue de las reglas por rol (BD a mano / Growth en masa). */
export const ROLE_CAPABILITIES_FLAG = 'ENABLE_ROLE_CAPABILITIES';

/**
 * Apagada por defecto: se enciende después de dar el rol Growth a quien
 * prospecta en masa. Mientras esté apagada, nadie pierde lo que hoy puede hacer.
 */
export function isRoleCapabilitiesEnabled(): boolean {
  return process.env[ROLE_CAPABILITIES_FLAG]?.trim().toLowerCase() === 'true';
}

/** Quién está pidiendo la acción. Ante cualquier fallo de lectura, sin privilegios. */
export async function getAccessSnapshot(): Promise<AccessSnapshot> {
  try {
    const [user, isAdmin] = await Promise.all([getCurrentUser(), isCurrentUserAdmin()]);
    if (!user || user.access_status !== 'active') return { userId: null, roleKey: null, isAdmin: false };
    return { userId: user.id, roleKey: user.role_key ?? null, isAdmin };
  } catch {
    return { userId: null, roleKey: null, isAdmin: false };
  }
}

export type CapabilityCheck = { ok: true } | { ok: false; message: string };

/** Comprueba una capacidad sin lanzar: para acciones que devuelven un resultado tipado. */
export async function checkCapability(capability: Capability): Promise<CapabilityCheck> {
  const enforced = isRoleCapabilitiesEnabled();
  // Apagada, lo masivo es de cualquier usuario activo —y quien llama ya lo
  // comprobó—: no se lee nada, así nada cambia respecto a antes de las reglas.
  if (!enforced && capability !== 'revisarTodasLasCandidatas') return { ok: true };
  const access = await getAccessSnapshot();
  return hasCapability(access, capability, { enforced })
    ? { ok: true }
    : { ok: false, message: CAPABILITY_DENIED_MESSAGE[capability] };
}

/** Igual que `checkCapability`, pero lanza: para acciones que ya lanzan sus errores. */
export async function requireCapability(capability: Capability): Promise<void> {
  const check = await checkCapability(capability);
  if (!check.ok) throw new Error(check.message);
}

/**
 * ¿Puede quien pide decidir sobre esta candidata? Lee su responsable y el dueño
 * de su búsqueda con la sesión (la misma lectura que ya hacen las acciones).
 * Si la candidata no se puede leer, responde que no: falla cerrado.
 */
export async function canReviewCandidateId(candidateId: string): Promise<boolean> {
  const access = await getAccessSnapshot();
  const enforced = isRoleCapabilitiesEnabled();
  // Sin leer nada cuando la persona ya puede revisar todo.
  if (hasCapability(access, 'revisarTodasLasCandidatas', { enforced })) return true;
  if (!enforced || !access.userId || !candidateId) return false;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('prospect_candidates')
      .select('assigned_to, batch:prospect_batches!prospect_candidates_batch_id_fkey(owner_id, created_by)')
      .eq('id', candidateId)
      .maybeSingle();
    if (!data) return false;
    const batch = (Array.isArray(data.batch) ? data.batch[0] : data.batch) as
      | { owner_id?: string | null; created_by?: string | null }
      | null
      | undefined;
    return canReviewCandidate(
      access,
      {
        assignedTo: (data as { assigned_to?: string | null }).assigned_to ?? null,
        batchOwnerId: batch?.owner_id ?? null,
        batchCreatedBy: batch?.created_by ?? null,
      },
      { enforced },
    );
  } catch {
    return false;
  }
}

/** Lanza si quien pide no puede decidir sobre la candidata. */
export async function requireCandidateReviewer(candidateId: string): Promise<void> {
  if (!(await canReviewCandidateId(candidateId))) {
    throw new Error(CAPABILITY_DENIED_MESSAGE.revisarTodasLasCandidatas);
  }
}

/** Dueño y señales de duplicado de una candidata, con la sesión. Null si no se puede leer. */
async function readCandidateReviewFacts(
  candidateId: string,
): Promise<{ owner: CandidateOwnership; signals: CandidateDuplicateSignals; status: string | null } | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('prospect_candidates')
      .select(
        'status, assigned_to, duplicate_status, matched_hubspot_company_id, batch:prospect_batches!prospect_candidates_batch_id_fkey(owner_id, created_by)',
      )
      .eq('id', candidateId)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      status?: string | null;
      assigned_to?: string | null;
      duplicate_status?: string | null;
      matched_hubspot_company_id?: string | null;
      batch?: unknown;
    };
    const batch = (Array.isArray(row.batch) ? row.batch[0] : row.batch) as
      | { owner_id?: string | null; created_by?: string | null }
      | null
      | undefined;
    return {
      owner: {
        assignedTo: row.assigned_to ?? null,
        batchOwnerId: batch?.owner_id ?? null,
        batchCreatedBy: batch?.created_by ?? null,
      },
      signals: {
        duplicateStatus: row.duplicate_status ?? null,
        matchedHubSpotCompanyId: row.matched_hubspot_company_id ?? null,
      },
      status: row.status ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Estado y rol de las personas que pueden quedarse con la empresa. Con el cliente
 * de servicio: la RLS de `internal_users` no deja a un no-admin leer a los demás.
 * Null si no se pudo leer.
 */
async function readResponsibleUsers(
  ids: Array<string | null | undefined>,
): Promise<Map<string, ResponsibleUserFacts> | null> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return new Map();
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from('internal_users')
      .select('id, access_status, roles(key)')
      .in('id', unique);
    if (error || !Array.isArray(data)) return null;
    return new Map(
      data.map((row) => {
        const roles = (row as { roles?: unknown }).roles;
        const role = (Array.isArray(roles) ? roles[0] : roles) as { key?: string | null } | null | undefined;
        return [
          String((row as { id: string }).id),
          { active: (row as { access_status?: string }).access_status === 'active', roleKey: role?.key ?? null },
        ];
      }),
    );
  } catch {
    return null;
  }
}

/** Lo mínimo de una candidata para saber si le falta responsable. */
export interface CandidateResponsibleRow {
  id: string;
  status: string | null;
  assignedTo: string | null;
  batchOwnerId: string | null;
  batchCreatedBy: string | null;
}

/**
 * Cuáles de estas candidatas por revisar no se pueden aprobar todavía porque les
 * falta responsable: la misma regla que `checkCandidateApproval`, para que la
 * pantalla lo avise antes. Si no se puede leer, vacío: la pantalla no bloquea y
 * el servidor decide al aprobar.
 */
export async function findCandidatesNeedingAssignee(rows: readonly CandidateResponsibleRow[]): Promise<Set<string>> {
  const pending = rows.filter((row) => row.status === 'needs_review');
  if (pending.length === 0) return new Set();
  const users = await readResponsibleUsers(pending.flatMap((row) => [row.assignedTo, row.batchOwnerId, row.batchCreatedBy]));
  if (!users) return new Set();
  return new Set(
    pending
      .filter((row) => !decideApprovalResponsible({ ...row, lookup: (userId) => users.get(userId) }).ok)
      .map((row) => row.id),
  );
}

/**
 * ¿Puede quien pide APROBAR esta candidata? Dos preguntas, en orden:
 *  1. ¿le toca? Admin y Growth, siempre. Su dueño (con las reglas encendidas),
 *     solo si está limpia: un posible duplicado o una coincidencia con HubSpot
 *     pasa a Growth.
 *  2. ¿tiene responsable? Siempre, también para admin y Growth y con las reglas
 *     apagadas: lo de una búsqueda masiva se asigna antes de aprobarse, para que la
 *     empresa no quede a nombre de quien prospecta en masa.
 * Falla cerrado.
 */
export async function checkCandidateApproval(candidateId: string): Promise<CandidateReviewDecision> {
  const access = await getAccessSnapshot();
  const enforced = isRoleCapabilitiesEnabled();
  if (!access.userId || !candidateId) return { ok: false, reason: 'not_allowed' };
  const reviewsAll = hasCapability(access, 'revisarTodasLasCandidatas', { enforced });
  if (!reviewsAll && !enforced) return { ok: false, reason: 'not_allowed' };

  const facts = await readCandidateReviewFacts(candidateId);
  if (!facts) return { ok: false, reason: 'not_allowed' };
  if (!reviewsAll) {
    const decision = decideCandidateApproval(access, facts.owner, facts.signals, { enforced });
    if (!decision.ok) return decision;
  }
  // Ya convertida: la empresa ya tiene dueño; reintentar responde como siempre (idempotente).
  if (facts.status === 'converted_to_account') return { ok: true };

  const users = await readResponsibleUsers([
    facts.owner.assignedTo,
    facts.owner.batchOwnerId,
    facts.owner.batchCreatedBy,
  ]);
  if (!users) return { ok: false, reason: 'needs_assignee' };
  const responsible = decideApprovalResponsible({
    assignedTo: facts.owner.assignedTo,
    batchOwnerId: facts.owner.batchOwnerId,
    batchCreatedBy: facts.owner.batchCreatedBy,
    lookup: (userId) => users.get(userId),
  });
  return responsible.ok ? { ok: true } : responsible;
}

/** El texto para cada rechazo de aprobación. */
export function approvalDeniedMessage(decision: CandidateReviewDecision): string | null {
  if (decision.ok) return null;
  if (decision.reason === 'needs_growth_review') return NEEDS_GROWTH_REVIEW_MESSAGE;
  if (decision.reason === 'needs_assignee') return NEEDS_ASSIGNEE_MESSAGE;
  return CAPABILITY_DENIED_MESSAGE.revisarTodasLasCandidatas;
}
