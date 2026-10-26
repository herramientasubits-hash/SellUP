// Solo servidor (lee la sesión y process.env): no importarlo desde el cliente.
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser, isCurrentUserAdmin } from '@/modules/access/actions';
import {
  CAPABILITY_DENIED_MESSAGE,
  canReviewCandidate,
  hasCapability,
  type AccessSnapshot,
  type Capability,
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
