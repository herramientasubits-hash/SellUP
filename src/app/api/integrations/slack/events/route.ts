// ============================================================
// Eventos de Slack → asistente de SellUp (dueña 11-11).
// Slack exige respuesta en menos de 3 segundos: se verifica la firma, se
// responde 200 al instante y la pregunta se atiende después (`after`).
// Configuración: Event Subscriptions de la app de Slack apunta aquí, con los
// eventos `message.im` y `app_mention`; `SLACK_SIGNING_SECRET` en Vercel.
// ============================================================

import { after, NextResponse } from 'next/server';
import { isValidSlackSignature } from '@/server/slack-assistant/signature';
import { parseSlackEvent, slackIdentityMismatch, slackPayloadIdentity } from '@/server/slack-assistant/events';
import { handleSlackQuestion } from '@/server/slack-assistant/handle-question.server';
import { getSlackWorkspaceIdentity } from '@/server/services/slack-connection';

/** La respuesta (varias vueltas con Claude) corre dentro de `after`. */
export const maxDuration = 60;

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

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const action = parseSlackEvent(payload);
  if (action.kind === 'url_verification') {
    return NextResponse.json({ challenge: action.challenge });
  }

  // Slack reintenta si no recibió el 200 a tiempo: el primer intento ya se está atendiendo.
  if (action.kind === 'question' && !request.headers.get('x-slack-retry-num')) {
    // Otro espacio de trabajo u otra app (con el mismo secreto): no se atiende.
    const mismatch = slackIdentityMismatch(slackPayloadIdentity(payload), await getSlackWorkspaceIdentity());
    if (mismatch) {
      console.error('[slack-assistant] evento de otro espacio o app', mismatch);
      return NextResponse.json({ ok: true });
    }
    after(() => handleSlackQuestion(action));
  }
  return NextResponse.json({ ok: true });
}
