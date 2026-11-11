// ============================================================
// Asistente de Slack — ejecutar una acción CONFIRMADA (dueña 11-11).
// 1) el clic viene firmado por Slack (lo verificó la ruta);
// 2) quien pulsa es quien pidió, la propuesta no venció y la persona sigue
//    activa en SellUp;
// 3) se ejecuta con la SESIÓN de esa persona las MISMAS acciones que los
//    botones de la pantalla (mismos permisos, HubSpot, auditoría, avisos);
// 4) el resultado se lee de la base (no se confía sólo en la respuesta) y
//    reemplaza el mensaje con los botones.
// Nunca lanza.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runAsUser } from '@/lib/supabase/borrowed-session.server';
import { approveAndConvertPendingReviewCandidateAction } from '@/modules/prospect-review/approve-and-convert-actions';
import { discardPendingReviewCandidateAction } from '@/modules/prospect-review/discard-actions';
import { assignCandidatesToUser } from '@/modules/prospect-review/assign-actions';
import { assignAccountsToUser } from '@/modules/accounts/actions';
import { moveAccountStage } from '@/modules/pipeline/actions';
import { bulkReactivate, bulkSuspend } from '@/modules/access/actions';
import { resolveCommercialScopeForUser } from '@/modules/access/commercial-scope-core.server';
import { notifySlackUsers } from '@/modules/notifications/slack-notify.server';
import { pendingFor } from './digests/digests.server';
import { isAgent3FirstCallEnabled } from '@/lib/feature-flags.server';
import { parseFirstCallRequest } from '@/modules/speech/first-call-request';
import { runFirstCall } from '@/server/agents/first-call/run-first-call';
import { buildLiveFirstCallDeps } from '@/server/agents/first-call/run-first-call.server';
import { createContactEnrichmentRequestAction } from '@/modules/contact-enrichment/actions';
import { runAutomaticContactEnrichmentForRequestCore } from '@/modules/contact-enrichment/automatic-routing-action-core';
import { completeContactSearch } from '@/modules/contact-enrichment/contact-search-follow-up.server';
import { reminderText } from './digests/reminders';
import { getSlackUserEmail, respondToSlackInteraction } from '@/server/services/slack-connection';
import {
  CANCEL_ACTION_ID,
  CONFIRM_ACTION_ID,
  confirmationProblem,
  decodeActionValue,
  outcomeText,
  type DecodedAction,
  type ItemOutcome,
} from './action-proposal';
import { verifyOutcomes, type VerifiedState } from './action-verify';

export interface SlackBlockActionPayload {
  type?: string;
  user?: { id?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
}

/** Por qué no se pudo, dicho para la persona (motivos de las acciones de la plataforma). */
const REASON_TEXT: Record<string, string> = {
  not_found: 'no se encontró',
  not_allowed: 'no tienes permiso sobre este prospecto',
  needs_growth_review: 'lo decide Growth (posible duplicado o ya en HubSpot)',
  needs_assignee: 'primero hay que asignarle un responsable',
  conversion_failed: 'no se pudo crear la empresa',
  discard_failed: 'no se pudo descartar',
  invalid_reason: 'el motivo no es válido',
  unexpected_error: 'error inesperado',
};

function reasonText(reason: string | undefined, message?: string): string {
  return message?.trim() || (reason ? REASON_TEXT[reason] ?? `no se pudo (${reason})` : 'no se pudo');
}

/** Corre la acción con la sesión de la persona y devuelve lo que cada acción respondió. */
async function runPlatformActions(action: DecodedAction, userId: string): Promise<Map<string, string>> {
  const failures = new Map<string, string>();
  if (action.kind === 'rumbo' || action.kind === 'find_contacts') {
    await runSpendActions(action, userId, failures);
    return failures;
  }
  if (action.kind === 'approve') {
    for (const id of action.ids) {
      const result = await approveAndConvertPendingReviewCandidateAction(id, {
        // Al confirmar, la persona confirmó también estas advertencias (como en el panel).
        confirmPossibleDuplicate: action.possibleDuplicateIds.has(id),
        confirmHubSpotMatch: action.hubSpotMatchIds.has(id),
      });
      if (!result.ok) failures.set(id, reasonText(result.reason, result.message));
    }
  } else if (action.kind === 'discard') {
    for (const id of action.ids) {
      const result = await discardPendingReviewCandidateAction(id, { reason: action.reason ?? '' });
      if (!result.ok) failures.set(id, reasonText(result.reason, result.message));
    }
  } else if (action.kind === 'set_stage' || action.kind === 'add_note') {
    // Mismo camino que el Flujo de prospección: la nota se anexa a la ficha.
    const { data } = await createSupabaseAdminClient().from('accounts').select('id, pipeline_status').in('id', action.ids);
    const current = new Map(((data ?? []) as Array<{ id: string; pipeline_status: string }>).map((r) => [r.id, r.pipeline_status]));
    for (const id of action.ids) {
      const status = action.kind === 'set_stage' ? action.stage : current.get(id);
      if (!status || status === 'archived') {
        failures.set(id, 'la empresa está archivada o no existe');
        continue;
      }
      const result = await moveAccountStage(id, status as never, { kind: action.kind === 'set_stage' ? 'none' : 'paste', text: action.reason ?? '' });
      if (!result.success) failures.set(id, result.error);
    }
  } else if (action.kind === 'activate_users' || action.kind === 'deactivate_users') {
    const result = action.kind === 'activate_users' ? await bulkReactivate(action.ids) : await bulkSuspend(action.ids);
    if (!result.success) for (const id of action.ids) failures.set(id, result.error ?? 'no se pudo');
  } else {
    const result =
      action.kind === 'assign_prospects'
        ? await assignCandidatesToUser(action.ids, action.targetUserId!)
        : await assignAccountsToUser(action.ids, action.targetUserId!);
    if (!result.success) for (const id of action.ids) failures.set(id, result.error);
  }
  return failures;
}

async function readState(action: DecodedAction): Promise<Map<string, VerifiedState>> {
  const admin = createSupabaseAdminClient();
  const state = new Map<string, VerifiedState>();
  if (action.kind === 'assign_accounts' || action.kind === 'set_stage' || action.kind === 'add_note') {
    const { data } = await admin.from('accounts').select('id, name, owner_id, pipeline_status, notes').in('id', action.ids);
    for (const r of (data ?? []) as Array<{ id: string; name: string; owner_id: string | null; pipeline_status: string | null; notes: string | null }>) {
      state.set(r.id, { name: r.name, status: r.pipeline_status, owner: r.owner_id, convertedAccountId: null, notes: r.notes });
    }
  } else if (action.kind === 'activate_users' || action.kind === 'deactivate_users') {
    const { data } = await admin.from('internal_users').select('id, full_name, email, access_status').in('id', action.ids);
    for (const r of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; access_status: string }>) {
      state.set(r.id, { name: r.full_name ?? r.email ?? r.id, status: r.access_status, owner: null, convertedAccountId: null });
    }
  } else {
    const { data } = await admin
      .from('prospect_candidates')
      .select('id, name, status, assigned_to, converted_account_id, batch:prospect_batches!prospect_candidates_batch_id_fkey(owner_id)')
      .in('id', action.ids);
    for (const r of (data ?? []) as unknown as Array<{
      id: string;
      name: string;
      status: string;
      assigned_to: string | null;
      converted_account_id: string | null;
      batch: { owner_id: string | null } | null;
    }>) {
      // Responsable efectivo (como la pantalla): el asignado o, si no hay, el dueño de la búsqueda.
      state.set(r.id, { name: r.name, status: r.status, owner: r.assigned_to ?? r.batch?.owner_id ?? null, convertedAccountId: r.converted_account_id });
    }
  }
  return state;
}

/** Atiende un clic en Confirmar / Cancelar. */
export async function handleSlackActionClick(payload: SlackBlockActionPayload): Promise<void> {
  const responseUrl = payload.response_url ?? '';
  const clicked = payload.actions?.[0];
  const clickerSlackId = payload.user?.id ?? '';
  if (payload.type !== 'block_actions' || !clicked || !responseUrl || !clickerSlackId) return;

  try {
    if (clicked.action_id === CANCEL_ACTION_ID) {
      await respondToSlackInteraction(responseUrl, 'Cancelado. No se hizo nada.');
      return;
    }
    if (clicked.action_id !== CONFIRM_ACTION_ID) return;

    const action = decodeActionValue(clicked.value);
    if (!action) {
      await respondToSlackInteraction(responseUrl, 'No pude leer esta propuesta. Pídemela de nuevo.');
      return;
    }
    const problem = confirmationProblem(action, clickerSlackId, Math.floor(Date.now() / 1000));
    if (problem) {
      // Quien no la pidió no la toca: sólo se le avisa a él.
      const ownProposal = clickerSlackId === action.askerSlackId;
      await respondToSlackInteraction(responseUrl, problem, { replaceOriginal: ownProposal });
      return;
    }

    // Quien confirma sigue siendo esa persona activa de SellUp.
    const email = await getSlackUserEmail(clickerSlackId);
    const admin = createSupabaseAdminClient();
    const { data: user } = email
      ? await admin.from('internal_users').select('id, auth_user_id, access_status').ilike('email', email).maybeSingle()
      : { data: null };
    const person = user as { id: string; auth_user_id: string | null; access_status: string } | null;
    if (!person || person.id !== action.askerId || person.access_status !== 'active' || !person.auth_user_id) {
      await respondToSlackInteraction(responseUrl, 'No pude confirmar que seas la persona que pidió la acción, o tu acceso no está activo. No se hizo nada.');
      return;
    }

    if (action.kind === 'remind') {
      await respondToSlackInteraction(responseUrl, outcomeText('remind', [await sendReminder(action, person.id)]));
      return;
    }

    // Sin botones mientras corre: un segundo clic no repite nada.
    await respondToSlackInteraction(responseUrl, `Procesando ${action.ids.length} elemento${action.ids.length === 1 ? '' : 's'}…`);

    const run = await runAsUser(person.auth_user_id, () => runPlatformActions(action, person.id));
    if (!run.ok) {
      await respondToSlackInteraction(responseUrl, 'No pude abrir tu sesión de SellUp para hacerlo. No se hizo nada; inténtalo de nuevo o hazlo en SellUp.');
      return;
    }

    const outcomes: ItemOutcome[] =
      action.kind === 'rumbo' || action.kind === 'find_contacts'
        ? await spendOutcomes(action, run.value)
        : verifyOutcomes(action, await readState(action), run.value);
    await respondToSlackInteraction(responseUrl, outcomeText(action.kind, outcomes));
  } catch (error) {
    console.error('[slack-assistant] acción', error instanceof Error ? error.message : 'error');
    await respondToSlackInteraction(
      responseUrl,
      'Algo falló al hacerlo. Revisa en SellUp qué quedó hecho antes de repetirlo.',
    );
  }
}

/**
 * Recordatorio de parte de quien confirma: sólo a alguien de su alcance (se
 * vuelve a comprobar al enviar), con sus pendientes leídos en ese momento.
 */
async function sendReminder(action: DecodedAction, askerId: string): Promise<ItemOutcome> {
  const admin = createSupabaseAdminClient();
  const targetId = action.targetUserId!;
  const { data: people } = await admin
    .from('internal_users')
    .select('id, full_name, email, group_id, access_status, roles(key)')
    .in('id', [askerId, targetId]);
  const rows = (people ?? []) as unknown as Array<{ id: string; full_name: string | null; email: string | null; group_id: string | null; access_status: string; roles: { key: string } | null }>;
  const asker = rows.find((r) => r.id === askerId);
  const target = rows.find((r) => r.id === targetId);
  const targetName = target?.full_name ?? target?.email ?? 'la persona';
  if (!asker || !target || target.access_status !== 'active') return { nombre: targetName, ok: false, detalle: 'no es un usuario activo' };
  const scope = await resolveCommercialScopeForUser(admin, { id: asker.id, email: asker.email, groupId: asker.group_id, roleKey: asker.roles?.key ?? null });
  if (!scope.canViewAll && !scope.allowedUserIds.includes(targetId)) return { nombre: targetName, ok: false, detalle: 'no está en tu equipo' };
  const pending = await pendingFor(admin, targetId);
  const sent = await notifySlackUsers([targetId], {
    title: 'Recordatorio de SellUp',
    message: reminderText({ personName: target.full_name, pending, fromName: asker.full_name ?? asker.email, note: action.reason }),
    actionLabel: 'Ver por revisar',
    actionUrl: `/accounts?tab=prospectos&userId=${encodeURIComponent(targetId)}`,
  });
  return sent > 0
    ? { nombre: targetName, ok: true, detalle: `le llegó (${pending.total} por revisar)` }
    : { nombre: targetName, ok: false, detalle: 'no le llegó por Slack (¿no está en el Slack de UBITS?)' };
}

/** Rumbo y buscar contactos: las mismas funciones que sus rutas, con la sesión de la persona. */
async function runSpendActions(action: DecodedAction, userId: string, failures: Map<string, string>): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (action.kind === 'rumbo') {
    const accountId = action.ids[0];
    if (!isAgent3FirstCallEnabled()) {
      failures.set(accountId, 'Rumbo (primer contacto) no está activo en SellUp');
      return;
    }
    const { data: contacts } = await admin
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .is('archived_at', null)
      .eq('contact_status', 'active')
      .order('is_primary', { ascending: false })
      .limit(2);
    const parsed = parseFirstCallRequest({
      accountId,
      contactIds: ((contacts ?? []) as Array<{ id: string }>).map((c) => c.id),
      channels: action.channels.length ? action.channels : ['call'],
      goals: ['book_meeting'],
    });
    if (!parsed.ok) {
      failures.set(accountId, 'no se pudo armar la preparación');
      return;
    }
    const result = await runFirstCall(parsed.request, buildLiveFirstCallDeps(userId, { agentRunId: null }));
    if (!result.ok) failures.set(accountId, result.message ?? 'Rumbo no pudo prepararlo');
    else failures.set(`ok:${accountId}`, `${result.packIds.length} preparación${result.packIds.length === 1 ? '' : 'es'} lista${result.packIds.length === 1 ? '' : 's'}${result.budgetStopped ? ' (se acabó el presupuesto a mitad)' : ''}`);
    return;
  }

  const { data: accounts } = await admin.from('accounts').select('id, name, domain, country_code').in('id', action.ids);
  for (const account of (accounts ?? []) as Array<{ id: string; name: string; domain: string | null; country_code: string | null }>) {
    const created = await createContactEnrichmentRequestAction({
      source: 'sellup',
      sellupAccountId: account.id,
      name: account.name,
      domain: account.domain,
      countryCode: account.country_code,
      matchConfidence: 1,
    });
    if (!created.success || !created.requestId) {
      failures.set(account.id, created.error ?? 'no se pudo crear la búsqueda');
      continue;
    }
    const routed = await runAutomaticContactEnrichmentForRequestCore(created.requestId, userId, new Date().toISOString());
    await completeContactSearch(created.requestId, routed);
    failures.set(`ok:${account.id}`, 'búsqueda hecha: revisa Contactos › Por revisar');
  }
}

/** Resultado de Rumbo / contactos: lo que respondió cada ejecución (no hay un estado simple que releer). */
async function spendOutcomes(action: DecodedAction, notes: Map<string, string>): Promise<ItemOutcome[]> {
  const { data } = await createSupabaseAdminClient().from('accounts').select('id, name').in('id', action.ids);
  const names = new Map(((data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]));
  return action.ids.map((id) => {
    const okNote = notes.get(`ok:${id}`);
    return okNote
      ? { nombre: names.get(id) ?? id, ok: true, detalle: okNote }
      : { nombre: names.get(id) ?? id, ok: false, detalle: notes.get(id) ?? 'no se pudo' };
  });
}
