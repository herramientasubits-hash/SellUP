'use server';

// BULK-COMPANY-ASSIGNMENT-1 — «Asignar a…» en Por revisar.
//
// Un líder busca empresas y las reparte entre sus vendedores. Decisiones de la
// dueña (08-10):
//   * Cualquier usuario activo puede asignar, a cualquier usuario activo.
//   * El prospecto pasa a ser del vendedor: es su responsable en «Por revisar»
//     y, al aprobarlo, la empresa queda a su nombre (ver
//     `resolveConversionOwnerUserId` en approveAndConvertCandidateAction).
//   * Quien recibe tiene un aviso en la campanita.
//
// Solo escribe prospect_candidates.assigned_to/by/at (migración 145) y la
// auditoría del prospecto. No cambia estado, lote, reclamos globales de
// identidad (140), presupuesto ni HubSpot. Con el alcance comercial encendido,
// solo se asigna lo que quien asigna puede ver.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/modules/access/actions';
import { resolveCommercialScope } from '@/modules/access/commercial-scope';
import { isCommercialScopeEnabled } from '@/lib/feature-flags.server';
import {
  NON_ASSIGNABLE_CANDIDATE_STATUSES,
  isAssignableCandidateStatus,
  partitionByCurrentOwner,
  resolveCandidateResponsibleId,
  validateAssignmentRequest,
  type AssignmentActionResult,
} from '@/modules/assignment/assignment-core';
import {
  assignmentUserName,
  hasCandidateAssignmentColumn,
  isMissingAssignmentColumnError,
  loadActiveAssignmentUser,
  notifyAssignment,
} from '@/modules/assignment/assignment.server';

const NOT_ACTIVE_YET =
  'Asignar empresas por revisar todavía no está activo: falta aplicar un cambio en la base de datos.';

interface CandidateAssignmentRow {
  id: string;
  name: string | null;
  status: string | null;
  batch_id: string;
  assigned_to: string | null;
  batch: { owner_id: string | null; created_by: string | null } | { owner_id: string | null; created_by: string | null }[] | null;
}

function batchOf(row: CandidateAssignmentRow): { owner_id: string | null; created_by: string | null } | null {
  return Array.isArray(row.batch) ? (row.batch[0] ?? null) : row.batch;
}

/**
 * Misma regla de visibilidad que la lista de «Por revisar»: lo asignado a
 * alguien del alcance o, sin asignar, lo de un lote cuyo dueño o creador está
 * en el alcance.
 */
function isVisibleToScope(
  row: { assignedTo: string | null; batchOwnerId: string | null; batchCreatedBy: string | null },
  visibleUserIds: Set<string>,
): boolean {
  if (row.assignedTo) return visibleUserIds.has(row.assignedTo);
  return (
    (row.batchOwnerId !== null && visibleUserIds.has(row.batchOwnerId)) ||
    (row.batchCreatedBy !== null && visibleUserIds.has(row.batchCreatedBy))
  );
}

/** ids de usuario que quien asigna puede ver; null = sin restricción. */
async function resolveVisibleUserIds(): Promise<Set<string> | null> {
  if (!isCommercialScopeEnabled()) return null;
  const scope = await resolveCommercialScope();
  if (!scope) return new Set();
  if (scope.canViewAll) return null;
  return new Set(scope.allowedUserIds);
}

export async function assignCandidatesToUser(
  candidateIds: string[],
  targetUserId: string,
): Promise<AssignmentActionResult> {
  try {
    const current = await getCurrentUser();
    if (!current || current.access_status !== 'active') {
      return { success: false, error: 'Tu sesión no está activa. Vuelve a entrar.' };
    }

    const request = validateAssignmentRequest({ ids: candidateIds, targetUserId });
    if (!request.ok) return { success: false, error: request.error };

    const supabase = await createClient();
    if (!(await hasCandidateAssignmentColumn(supabase))) {
      return { success: false, error: NOT_ACTIVE_YET };
    }

    const target = await loadActiveAssignmentUser(supabase, request.targetUserId);
    if (!target) return { success: false, error: 'La persona elegida no es un usuario activo.' };

    const { data, error: loadError } = await supabase
      .from('prospect_candidates')
      .select(
        'id, name, status, batch_id, assigned_to, batch:prospect_batches!prospect_candidates_batch_id_fkey(owner_id, created_by)',
      )
      .in('id', request.ids);
    if (loadError) {
      return {
        success: false,
        error: isMissingAssignmentColumnError(loadError) ? NOT_ACTIVE_YET : loadError.message,
      };
    }

    const visibleUserIds = await resolveVisibleUserIds();
    const candidates = ((data ?? []) as unknown as CandidateAssignmentRow[])
      .filter((row) => isAssignableCandidateStatus(row.status))
      .map((row) => {
        const batch = batchOf(row);
        return {
          id: row.id,
          name: row.name ?? '',
          batchId: row.batch_id,
          assignedTo: row.assigned_to,
          batchOwnerId: batch?.owner_id ?? null,
          batchCreatedBy: batch?.created_by ?? null,
          currentOwnerId: resolveCandidateResponsibleId({
            assignedTo: row.assigned_to,
            batchOwnerId: batch?.owner_id,
            batchCreatedBy: batch?.created_by,
          }),
        };
      })
      .filter((row) => visibleUserIds === null || isVisibleToScope(row, visibleUserIds));

    const { toChange, alreadyOwned } = partitionByCurrentOwner(candidates, target.id);

    let changed: typeof toChange = [];
    if (toChange.length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from('prospect_candidates')
        .update({
          assigned_to: target.id,
          assigned_by: current.id,
          assigned_at: new Date().toISOString(),
        })
        .in('id', toChange.map((row) => row.id))
        .not('status', 'in', `(${NON_ASSIGNABLE_CANDIDATE_STATUSES.join(',')})`)
        .select('id');
      if (updateError) {
        return {
          success: false,
          error: isMissingAssignmentColumnError(updateError) ? NOT_ACTIVE_YET : updateError.message,
        };
      }

      const updatedIds = new Set((updated ?? []).map((row) => row.id as string));
      changed = toChange.filter((row) => updatedIds.has(row.id));

      if (changed.length > 0) {
        const { error: auditError } = await supabase.from('prospect_candidate_audit').insert(
          changed.map((row) => ({
            batch_id: row.batchId,
            candidate_id: row.id,
            actor_user_id: current.id,
            action_type: 'candidate_assigned',
            details: {
              from: row.currentOwnerId,
              to: target.id,
              selection_size: request.ids.length,
            },
          })),
        );
        if (auditError) {
          console.error('[assignCandidatesToUser] audit insert failed:', auditError.message);
        }
      }
    }

    await notifyAssignment({
      kind: 'candidates',
      actor: { id: current.id, full_name: current.full_name, email: current.email },
      target,
      count: changed.length,
      sampleNames: changed.map((row) => row.name),
    });

    revalidatePath('/accounts');

    return {
      success: true,
      assigned: changed.length,
      alreadyOwned: alreadyOwned.length,
      skipped: request.ids.length - changed.length - alreadyOwned.length,
      targetName: assignmentUserName(target),
    };
  } catch (err) {
    console.error(
      '[assignCandidatesToUser] unexpected error:',
      err instanceof Error ? err.message : String(err),
    );
    return { success: false, error: 'No se pudo asignar. Inténtalo de nuevo.' };
  }
}
