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
import { getContactsByAccount } from '@/modules/contacts/actions';
import { moveAccountStage } from '@/modules/pipeline/actions';
import { toFirstCallContactOptions, type FirstCallContactOption } from './first-call-contacts';
import { isBriefFresh } from './first-call-state';
import { mapBriefRow, mapPackRow } from '@/server/agents/first-call/row-mappers';
import { RESEARCH_RUNNING_STALE_MS } from '@/server/agents/first-call/run-first-call.server';
import type { FirstCallPack, FirstCallPackStatus, ResearchBrief, ResearchProgressStage } from '@/server/agents/first-call/types';
import { FIRST_CONTACT_OUTCOMES, type FirstContactOutcome } from '@/server/agents/first-call/approaches';

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
const PACKS_LIMIT = 60;

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

/** ¿Está encendido el Agente 3? Para los paneles que cargan sus datos por su cuenta. */
export interface FirstContactLaunchData {
  accountId: string;
  accountName: string;
  contacts: FirstCallContactOption[];
  hasFreshBrief: boolean;
}

/**
 * Lo que necesita el panel del Agente 3 para abrirse desde una lista (menú de la
 * fila, Pipeline): el nombre, los decisores elegibles y si hay investigación vigente.
 * `null` si el agente está apagado, la empresa no es visible o está archivada.
 */
export async function getFirstContactLaunchData(accountId: string): Promise<FirstContactLaunchData | null> {
  if (!isAgent3FirstCallEnabled()) return null;
  const account = await getAccountById(accountId);
  if (!account || account.pipeline_status === 'archived') return null;
  const [state, contacts] = await Promise.all([getFirstCallState(accountId), getContactsByAccount(accountId).catch(() => [])]);
  return {
    accountId,
    accountName: account.name,
    contacts: toFirstCallContactOptions(contacts),
    hasFreshBrief: isBriefFresh(state.brief, Date.now()),
  };
}

export async function getFirstCallEnabled(): Promise<boolean> {
  return isAgent3FirstCallEnabled();
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

async function loadOwnPack(
  packId: string,
): Promise<{ accountId: string; status: FirstCallPackStatus; hasContent: boolean; pack: Record<string, unknown> | null } | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('first_call_packs').select('account_id, status, pack').eq('id', packId).maybeSingle();
  const row = data as { account_id: string; status: FirstCallPackStatus; pack: Record<string, unknown> | null } | null;
  if (!row?.account_id) return null;
  if (!(await getAccountById(row.account_id))) return null;
  return { accountId: row.account_id, status: row.status, hasContent: !!row.pack && 'callScript' in row.pack, pack: row.pack };
}

/** Desde qué estados se puede hacer cada acción. */
const ALLOWED_FROM: Readonly<Record<'used' | 'discarded' | 'edit' | 'outcome', readonly FirstCallPackStatus[]>> = {
  used: ['draft', 'needs_review'],
  outcome: ['used'],
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

/** El resultado del contacto va dentro del JSON de la preparación (sin migración). */
async function packWithOutcome(packId: string, outcome: FirstContactOutcome): Promise<Record<string, unknown> | null> {
  if (!FIRST_CONTACT_OUTCOMES.includes(outcome)) return null;
  const own = await loadOwnPack(packId);
  if (!own?.pack) return null;
  return { ...own.pack, outcome: { result: outcome, at: new Date().toISOString() } };
}

/**
 * El vendedor usó la preparación y dice qué pasó (reunión, interesado, no por ahora…).
 * Así se aprende qué enfoque, canal y cargo funcionan en Latinoamérica.
 * Si lo pide, la empresa pasa a «Lista para contacto».
 */
export async function markFirstCallPackUsed(
  packId: string,
  moveToReady: boolean,
  outcome: FirstContactOutcome | null = null,
): Promise<PackActionResult> {
  const pack = outcome ? await packWithOutcome(packId, outcome) : null;
  if (outcome && !pack) return { success: false, error: 'No encontramos esa preparación.' };
  const result = await updatePack(packId, 'used', {
    status: 'used',
    used_at: new Date().toISOString(),
    ...(pack ? { pack } : {}),
  });
  if (!result.success || !moveToReady) return result;
  const own = await loadOwnPack(packId);
  if (!own) return result;
  const account = await getAccountById(own.accountId);
  if (!account || account.pipeline_status === 'ready_for_outreach' || account.pipeline_status === 'archived') return result;
  const moved = await moveAccountStage(own.accountId, 'ready_for_outreach');
  return moved.success ? result : { success: false, error: 'Se marcó como usada, pero no pudimos mover la empresa de etapa.' };
}

/** Cambiar el resultado de una preparación ya usada (p. ej. «interesado» → «reunión agendada»). */
export async function setFirstCallPackOutcome(packId: string, outcome: FirstContactOutcome): Promise<PackActionResult> {
  const pack = await packWithOutcome(packId, outcome);
  if (!pack) return { success: false, error: 'No encontramos esa preparación.' };
  return updatePack(packId, 'outcome', { pack });
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
