// BULK-COMPANY-ASSIGNMENT-1 — Piezas de servidor compartidas por «Asignar a…»
// en Empresas y en Por revisar: quién recibe, el aviso en la campanita y si la
// base ya tiene la columna de asignación de prospectos (migración 145).
//
// Sin 'use server': solo se importa desde acciones de servidor.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { buildAssignmentNotification, type AssignmentKind } from './assignment-core';

export interface AssignmentUser {
  id: string;
  full_name: string | null;
  email: string;
}

export function assignmentUserName(user: Pick<AssignmentUser, 'full_name' | 'email'> | null): string {
  return user?.full_name?.trim() || user?.email || 'otra persona';
}

/** El destinatario debe ser un usuario activo de SellUp. */
export async function loadActiveAssignmentUser(
  client: SupabaseClient,
  userId: string,
): Promise<AssignmentUser | null> {
  const { data, error } = await client
    .from('internal_users')
    .select('id, full_name, email')
    .eq('id', userId)
    .eq('access_status', 'active')
    .maybeSingle();
  if (error || !data) return null;
  return data as AssignmentUser;
}

/**
 * Aviso en la campanita para quien recibe. Nunca lanza: la asignación ya se
 * guardó y un aviso que falla no debe deshacerla. No avisa si alguien se asigna
 * algo a sí mismo.
 */
export async function notifyAssignment(input: {
  kind: AssignmentKind;
  actor: AssignmentUser | null;
  target: AssignmentUser;
  count: number;
  sampleNames: readonly string[];
}): Promise<void> {
  if (input.count <= 0 || input.actor?.id === input.target.id) return;
  const notification = buildAssignmentNotification({
    kind: input.kind,
    count: input.count,
    actorName: input.actor ? assignmentUserName(input.actor) : null,
    targetUserId: input.target.id,
    sampleNames: input.sampleNames,
  });
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from('user_notifications').insert({
      recipient_internal_user_id: input.target.id,
      notification_type: input.kind === 'accounts' ? 'accounts_assigned' : 'prospects_assigned',
      title: notification.title,
      message: notification.message,
      action_label: notification.actionLabel,
      action_url: notification.actionUrl,
      entity_type: null,
      entity_id: null,
      is_read: false,
    });
    if (error) {
      console.error('[assignment] notification insert failed:', input.kind, error.message);
    }
  } catch (err) {
    console.error(
      '[assignment] notification failed:',
      input.kind,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Columna de asignación de prospectos (migración 145) ─────────────────
// El código llega a Producción antes de que se aplique la 145. Mientras no
// exista la columna, «Por revisar» sigue funcionando como hoy (responsable =
// dueño del lote) y la acción de asignar avisa que aún no está activa.

const COLUMN_RECHECK_MS = 60_000;
let candidateAssignmentColumnKnown = false;
let candidateAssignmentColumnCheckedAt = 0;

/** Error de PostgREST/Postgres por columna inexistente. */
export function isMissingAssignmentColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  return /assigned_(to|by|at)/.test(error.message ?? '') && /does not exist|could not find/i.test(error.message ?? '');
}

export async function hasCandidateAssignmentColumn(client: SupabaseClient): Promise<boolean> {
  if (candidateAssignmentColumnKnown) return true;
  if (Date.now() - candidateAssignmentColumnCheckedAt < COLUMN_RECHECK_MS) return false;
  candidateAssignmentColumnCheckedAt = Date.now();
  const { error } = await client.from('prospect_candidates').select('assigned_to').limit(1);
  if (!error) {
    candidateAssignmentColumnKnown = true;
    return true;
  }
  if (!isMissingAssignmentColumnError(error)) {
    console.error('[assignment] assignment column probe failed:', error.message);
  }
  return false;
}
