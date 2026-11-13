// ============================================================
// Interacciones de Slack (botones) → acciones confirmadas del asistente
// (dueña 11-11). Slack exige respuesta en menos de 3 segundos: se verifica la
// firma, se responde 200 al instante y la acción corre después (`after`); el
// resultado reemplaza el mensaje por su `response_url`.
// Configuración: «Interactivity & Shortcuts» de la app de Slack apunta aquí.
// ============================================================

import { after, NextResponse } from 'next/server';
import { isValidSlackSignature } from '@/server/slack-assistant/signature';
import { handleSlackActionClick, type SlackBlockActionPayload } from '@/server/slack-assistant/execute-action.server';
import { handleCreditDecisionClick } from '@/server/slack-assistant/credit-decision.server';
import { CREDIT_APPROVE_ACTION_ID, CREDIT_REJECT_ACTION_ID } from '@/modules/notifications/credit-approval-slack';
import { slackIdentityMismatch, slackPayloadIdentity } from '@/server/slack-assistant/events';
import { getSlackWorkspaceIdentity } from '@/server/services/slack-connection';

/** Aprobar varias empresas (con HubSpot) puede tardar: corre dentro de `after`. */
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const valid = isValidSlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signature: request.headers.get('x-slack-signature'),
    rawBody,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!valid) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });

  let payload: SlackBlockActionPayload;
  try {
    payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '') as SlackBlockActionPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (payload?.type === 'block_actions') {
    // Otro espacio de trabajo u otra app (con el mismo secreto): no se ejecuta nada.
    const mismatch = slackIdentityMismatch(slackPayloadIdentity(payload), await getSlackWorkspaceIdentity());
    if (mismatch) {
      console.error('[slack-assistant] interacción de otro espacio o app', mismatch);
      return new Response(null, { status: 200 });
    }
    const clicked = payload.actions?.[0];
    if (clicked?.action_id === CREDIT_APPROVE_ACTION_ID || clicked?.action_id === CREDIT_REJECT_ACTION_ID) {
      // Solicitud de créditos: decide quien pulsa (si es aprobador), con su sesión.
      after(() =>
        handleCreditDecisionClick({
          actionId: clicked.action_id,
          value: clicked.value,
          clickerSlackId: payload.user?.id ?? '',
          responseUrl: payload.response_url ?? '',
        }),
      );
    } else {
      after(() => handleSlackActionClick(payload));
    }
  }
  // Cuerpo vacío: Slack no cambia el mensaje por esta respuesta (lo hace la response_url).
  return new Response(null, { status: 200 });
}
