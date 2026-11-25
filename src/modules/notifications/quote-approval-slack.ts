// ============================================================
// Aprobación de descuentos del cotizador por Slack — botones (puro).
// Quien aprueba recibe la solicitud con «Aprobar» / «Rechazar». Al pulsar se
// decide con SU sesión la misma acción de la pestaña «Por aprobar»
// (`decideSalesQuote`), que comprueba que sea aprobador de descuentos o
// admin, que no sea su propia cotización y que siga pendiente.
// ============================================================

export const QUOTE_APPROVE_ACTION_ID = 'sellup_quote_approve';
export const QUOTE_REJECT_ACTION_ID = 'sellup_quote_reject';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QuoteDecisionButton {
  quoteId: string;
  decision: 'approve' | 'reject';
}

export function quoteDecisionButtons(quoteId: string): Array<Record<string, unknown>> {
  return [
    {
      type: 'button',
      style: 'primary',
      text: { type: 'plain_text', text: 'Aprobar' },
      action_id: QUOTE_APPROVE_ACTION_ID,
      value: JSON.stringify({ q: quoteId }),
    },
    {
      type: 'button',
      style: 'danger',
      text: { type: 'plain_text', text: 'Rechazar' },
      action_id: QUOTE_REJECT_ACTION_ID,
      value: JSON.stringify({ q: quoteId }),
    },
  ];
}

/** Lee el botón; `null` si no tiene la forma esperada. */
export function decodeQuoteDecision(actionId: unknown, value: unknown): QuoteDecisionButton | null {
  if (actionId !== QUOTE_APPROVE_ACTION_ID && actionId !== QUOTE_REJECT_ACTION_ID) return null;
  if (typeof value !== 'string' || value.length > 200) return null;
  let parsed: { q?: unknown };
  try {
    parsed = JSON.parse(value) as { q?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.q !== 'string' || !UUID_PATTERN.test(parsed.q)) return null;
  return { quoteId: parsed.q, decision: actionId === QUOTE_APPROVE_ACTION_ID ? 'approve' : 'reject' };
}
