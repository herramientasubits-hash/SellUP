// ============================================================
// Decidir una cotización desde Slack (aprobación de descuentos del cotizador).
// El clic viene firmado por Slack; se identifica a quien pulsa por su correo,
// y con SU sesión se llama la misma acción de la pestaña «Por aprobar»
// (`decideSalesQuote`): ella comprueba que sea aprobador o admin, que no sea su
// propia cotización y que nadie la haya decidido antes. Nunca lanza.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { runAsUser } from '@/lib/supabase/borrowed-session.server';
import { decodeQuoteDecision } from '@/modules/notifications/quote-approval-slack';
import { decideSalesQuote } from '@/modules/sales-quote/quote-actions';
import { getSlackUserEmail, respondToSlackInteraction } from '@/server/services/slack-connection';
import { findInternalUserBySlackEmail } from './asker-lookup.server';

export async function handleQuoteDecisionClick(input: {
  actionId: string | undefined;
  value: string | undefined;
  clickerSlackId: string;
  responseUrl: string;
}): Promise<void> {
  try {
    const decision = decodeQuoteDecision(input.actionId, input.value);
    if (!decision) {
      await respondToSlackInteraction(input.responseUrl, 'No pude leer esta cotización. Decídela en SellUp › Cotizador › Por aprobar.', { replaceOriginal: false });
      return;
    }
    const email = await getSlackUserEmail(input.clickerSlackId);
    const person = email
      ? await findInternalUserBySlackEmail<{ auth_user_id: string | null; access_status: string }>(
          createSupabaseAdminClient(),
          email,
          'auth_user_id, access_status',
        )
      : null;
    if (!person?.auth_user_id || person.access_status !== 'active') {
      await respondToSlackInteraction(input.responseUrl, 'No pude confirmar tu acceso activo a SellUp. No se decidió nada.', { replaceOriginal: false });
      return;
    }

    const run = await runAsUser(person.auth_user_id, () =>
      decideSalesQuote({ quoteId: decision.quoteId, decision: decision.decision }),
    );
    if (!run.ok) {
      await respondToSlackInteraction(input.responseUrl, 'No pude abrir tu sesión de SellUp. Decídela en SellUp › Cotizador › Por aprobar.', { replaceOriginal: false });
      return;
    }
    if (!run.value.success) {
      // Sin permiso, ya decidida por otra persona, etc.: sólo se le cuenta a quien pulsó.
      await respondToSlackInteraction(input.responseUrl, run.value.error ?? 'No se pudo decidir la cotización.', { replaceOriginal: false });
      return;
    }
    await respondToSlackInteraction(
      input.responseUrl,
      decision.decision === 'approve'
        ? '✓ Aprobaste el descuento. Ya le avisamos a quien cotizó.'
        : '✓ Rechazaste el descuento. Ya le avisamos a quien cotizó.',
    );
  } catch (error) {
    console.error('[slack-assistant] decisión de cotización', error instanceof Error ? error.message : 'error');
    await respondToSlackInteraction(input.responseUrl, 'Algo falló. Revisa la cotización en SellUp antes de repetir.', { replaceOriginal: false });
  }
}
