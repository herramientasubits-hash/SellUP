// ============================================================
// Decidir una solicitud de créditos desde Slack (dueña 11-11).
// El clic viene firmado por Slack; se identifica a quien pulsa por su correo,
// y con SU sesión se llama la misma acción de «Solicitudes de créditos»
// (`decideCreditApproval`): ella comprueba que sea aprobador o admin, que no
// sea su propia solicitud y que nadie la haya decidido antes. Nunca lanza.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runAsUser } from '@/lib/supabase/borrowed-session.server';
import { decideCreditApproval } from '@/modules/credit-approvals/actions';
import { decodeCreditDecision } from '@/modules/notifications/credit-approval-slack';
import { getSlackUserEmail, respondToSlackInteraction } from '@/server/services/slack-connection';

export async function handleCreditDecisionClick(input: {
  actionId: string | undefined;
  value: string | undefined;
  clickerSlackId: string;
  responseUrl: string;
}): Promise<void> {
  try {
    const decision = decodeCreditDecision(input.actionId, input.value);
    if (!decision) {
      await respondToSlackInteraction(input.responseUrl, 'No pude leer esta solicitud. Decídela en SellUp › Solicitudes de créditos.', { replaceOriginal: false });
      return;
    }
    const email = await getSlackUserEmail(input.clickerSlackId);
    const { data } = email
      ? await createSupabaseAdminClient().from('internal_users').select('auth_user_id, access_status').ilike('email', email).maybeSingle()
      : { data: null };
    const person = data as { auth_user_id: string | null; access_status: string } | null;
    if (!person?.auth_user_id || person.access_status !== 'active') {
      await respondToSlackInteraction(input.responseUrl, 'No pude confirmar tu acceso activo a SellUp. No se decidió nada.', { replaceOriginal: false });
      return;
    }

    const run = await runAsUser(person.auth_user_id, () =>
      decideCreditApproval({
        requestId: decision.requestId,
        decision: decision.decision,
        ...(decision.credits ? { credits: decision.credits } : {}),
      }),
    );
    if (!run.ok) {
      await respondToSlackInteraction(input.responseUrl, 'No pude abrir tu sesión de SellUp. Decídela en SellUp › Solicitudes de créditos.', { replaceOriginal: false });
      return;
    }
    if (!run.value.success) {
      // Sin permiso, ya decidida por otra persona, etc.: sólo se le cuenta a quien pulsó.
      await respondToSlackInteraction(input.responseUrl, run.value.error ?? 'No se pudo decidir la solicitud.', { replaceOriginal: false });
      return;
    }
    await respondToSlackInteraction(
      input.responseUrl,
      decision.decision === 'approve'
        ? `✓ Diste ${decision.credits!.toLocaleString('es-CO')} créditos. Ya le avisamos a la persona.`
        : '✓ Rechazaste la solicitud. Ya le avisamos a la persona.',
    );
  } catch (error) {
    console.error('[slack-assistant] decisión de créditos', error instanceof Error ? error.message : 'error');
    await respondToSlackInteraction(input.responseUrl, 'Algo falló. Revisa la solicitud en SellUp antes de repetir.', { replaceOriginal: false });
  }
}
