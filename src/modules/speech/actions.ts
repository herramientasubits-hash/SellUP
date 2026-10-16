'use server';

/**
 * Agente 3 · Primera llamada — lectura de la ficha y los paquetes, y lo que el
 * vendedor hace con un paquete (usarlo, descartarlo, guardar su versión).
 *
 * Siempre detrás del alcance comercial: `getAccountById` devuelve `null` si la
 * empresa no está en la cartera de quien mira. Las tablas se escriben con el
 * cliente de servicio DESPUÉS de esa comprobación (RLS: escritura sólo service_role).
 */

import { revalidatePath } from 'next/cache';
import { isAgent3FirstCallEnabled } from '@/lib/feature-flags.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getAccountById } from '@/modules/accounts/actions';
import { moveAccountStage } from '@/modules/pipeline/actions';
import { mapBriefRow, mapPackRow } from '@/server/agents/first-call/row-mappers';
import { RESEARCH_RUNNING_STALE_MS } from '@/server/agents/first-call/run-first-call.server';
import type { FirstCallPack, FirstCallPackStatus, ResearchBrief, ResearchProgressStage } from '@/server/agents/first-call/types';

/**
 * Qué ficha mostrar, con la MISMA regla que el servidor al reusar: una investigación
 * en curso reciente; si no, la última ficha útil (suficiente o parcial, aunque esté
 * vencida); si no, la última. Una «en curso» de hace más de 5 minutos se cayó.
 */
function pickBriefToShow(rows: Record<string, unknown>[], nowMs: number): Record<string, unknown> | undefined {
  const fresh = (row: Record<string, unknown>) => nowMs - Date.parse(row.created_at as string) < RESEARCH_RUNNING_STALE_MS;
  return (
    rows.find((row) => row.status === 'running' && fresh(row)) ??
    rows.find((row) => row.status === 'sufficient' || row.status === 'partial') ??
    rows.find((row) => row.status !== 'running')
  );
}

export interface FirstCallState {
  enabled: boolean;
  brief: ResearchBrief | null;
  packs: FirstCallPack[];
}

/** Paquetes que se muestran en el historial de una empresa. */
const PACKS_LIMIT = 20;

export async function getFirstCallState(accountId: string): Promise<FirstCallState> {
  const enabled = isAgent3FirstCallEnabled();
  const account = await getAccountById(accountId);
  if (!account) return { enabled, brief: null, packs: [] };

  const admin = createSupabaseAdminClient();
  const [briefs, packs] = await Promise.all([
    admin
      .from('account_research_briefs')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(5),
    admin
      .from('first_call_packs')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(PACKS_LIMIT),
  ]);
  // Sin la migración 153 las tablas no existen: la pestaña se ve vacía, no rota.
  const briefRow = pickBriefToShow((briefs.data ?? []) as Record<string, unknown>[], Date.now());
  return {
    enabled,
    brief: briefRow ? mapBriefRow(briefRow) : null,
    packs: ((packs.data ?? []) as Record<string, unknown>[]).map(mapPackRow),
  };
}

/** Avance de la investigación en curso (lo lee el formulario cada pocos segundos). */
export async function getFirstCallProgress(accountId: string): Promise<ResearchProgressStage | null> {
  if (!(await getAccountById(accountId))) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('account_research_briefs')
    .select('progress_stage')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data as { progress_stage: ResearchProgressStage | null } | null)?.progress_stage) ?? null;
}

export type PackActionResult = { success: true } | { success: false; error: string };

const DISABLED: PackActionResult = { success: false, error: 'La preparación de la primera llamada no está activada.' };

async function loadOwnPack(packId: string): Promise<{ accountId: string; status: FirstCallPackStatus; hasContent: boolean } | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('first_call_packs').select('account_id, status, pack').eq('id', packId).maybeSingle();
  const row = data as { account_id: string; status: FirstCallPackStatus; pack: Record<string, unknown> | null } | null;
  if (!row?.account_id) return null;
  if (!(await getAccountById(row.account_id))) return null;
  return { accountId: row.account_id, status: row.status, hasContent: !!row.pack && 'callScript' in row.pack };
}

/** Desde qué estados se puede hacer cada acción. */
const ALLOWED_FROM: Readonly<Record<'used' | 'discarded' | 'edit', readonly FirstCallPackStatus[]>> = {
  used: ['draft', 'needs_review'],
  discarded: ['draft', 'needs_review', 'failed'],
  edit: ['draft', 'needs_review', 'used'],
};

async function updatePack(
  packId: string,
  action: keyof typeof ALLOWED_FROM,
  patch: Record<string, unknown>,
): Promise<PackActionResult> {
  if (!isAgent3FirstCallEnabled()) return DISABLED;
  const own = await loadOwnPack(packId);
  if (!own) return { success: false, error: 'No encontramos esa preparación.' };
  if (!ALLOWED_FROM[action].includes(own.status) || (action !== 'discarded' && !own.hasContent)) {
    return { success: false, error: 'Esta preparación ya no admite ese cambio.' };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('first_call_packs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', packId);
  if (error) return { success: false, error: 'No pudimos guardar el cambio. Vuelve a intentarlo.' };
  revalidatePath(`/accounts/${own.accountId}`);
  return { success: true };
}

/** El vendedor usó el paquete; si lo pide, la empresa pasa a «Lista para contacto». */
export async function markFirstCallPackUsed(packId: string, moveToReady: boolean): Promise<PackActionResult> {
  const result = await updatePack(packId, 'used', { status: 'used', used_at: new Date().toISOString() });
  if (!result.success || !moveToReady) return result;
  const own = await loadOwnPack(packId);
  if (!own) return result;
  const account = await getAccountById(own.accountId);
  if (!account || account.pipeline_status === 'ready_for_outreach' || account.pipeline_status === 'archived') return result;
  const moved = await moveAccountStage(own.accountId, 'ready_for_outreach');
  return moved.success ? result : { success: false, error: 'Se marcó como usada, pero no pudimos mover la empresa de etapa.' };
}

export async function discardFirstCallPack(packId: string): Promise<PackActionResult> {
  return updatePack(packId, 'discarded', { status: 'discarded', discarded_at: new Date().toISOString() });
}

/** Tope de la versión editada del guion (un guion largo no es un guion). */
const EDITED_SCRIPT_MAX_CHARS = 3_000;

export async function saveFirstCallScriptEdit(packId: string, editedScript: string): Promise<PackActionResult> {
  const text = editedScript.trim();
  if (text.length > EDITED_SCRIPT_MAX_CHARS) return { success: false, error: 'El guion es demasiado largo.' };
  return updatePack(packId, 'edit', { edited_script: text.length > 0 ? text : null });
}
