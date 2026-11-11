// ============================================================
// Solicitudes de créditos por Slack (dueña 11-11) — botones (puro).
// Quien aprueba recibe el pedido con «Dar N créditos» / «Rechazar». Al pulsar
// se decide con SU sesión la misma acción de «Solicitudes de créditos»
// (`decideCreditApproval`), que comprueba que sea aprobador de la regla o
// administrador y que no sea su propia solicitud.
// ============================================================

export const CREDIT_APPROVE_ACTION_ID = 'sellup_credit_approve';
export const CREDIT_REJECT_ACTION_ID = 'sellup_credit_reject';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CREDITS = 1_000_000;

export interface CreditDecisionButton {
  requestId: string;
  decision: 'approve' | 'reject';
  credits: number | null;
}

export function creditDecisionButtons(requestId: string, credits: number): Array<Record<string, unknown>> {
  const n = Math.max(1, Math.min(MAX_CREDITS, Math.ceil(credits)));
  return [
    {
      type: 'button',
      style: 'primary',
      text: { type: 'plain_text', text: `Dar ${n.toLocaleString('es-CO')} créditos` },
      action_id: CREDIT_APPROVE_ACTION_ID,
      value: JSON.stringify({ r: requestId, c: n }),
    },
    {
      type: 'button',
      style: 'danger',
      text: { type: 'plain_text', text: 'Rechazar' },
      action_id: CREDIT_REJECT_ACTION_ID,
      value: JSON.stringify({ r: requestId }),
    },
  ];
}

/** Lee el botón; `null` si no tiene la forma esperada. */
export function decodeCreditDecision(actionId: unknown, value: unknown): CreditDecisionButton | null {
  if (actionId !== CREDIT_APPROVE_ACTION_ID && actionId !== CREDIT_REJECT_ACTION_ID) return null;
  if (typeof value !== 'string' || value.length > 300) return null;
  let parsed: { r?: unknown; c?: unknown };
  try {
    parsed = JSON.parse(value) as { r?: unknown; c?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.r !== 'string' || !UUID_PATTERN.test(parsed.r)) return null;
  if (actionId === CREDIT_REJECT_ACTION_ID) return { requestId: parsed.r, decision: 'reject', credits: null };
  const credits = Number(parsed.c);
  if (!Number.isInteger(credits) || credits < 1 || credits > MAX_CREDITS) return null;
  return { requestId: parsed.r, decision: 'approve', credits };
}
