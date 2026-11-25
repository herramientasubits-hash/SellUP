/**
 * El texto de una solicitud de aprobación de descuento (versión 2027).
 *
 * Lo leen el aprobador en SellUp y en Slack: qué cliente, condiciones, qué
 * líneas bajan del mínimo y por cuánto, y el total propuesto. Quién aprueba no
 * va aquí: lo configura un admin.
 */
import type { Quote2027Input, Quote2027Result } from './engine-2027';
import { findQuoteCountry } from './markets';
import { yearsLabel } from './shared';

/**
 * El cotizador es solo de Ventas (decisión del 25-11: Customer Success no lo
 * usa). La columna `account_type` de la 170 sigue existiendo y siempre guarda
 * 'ventas'; un solo tipo deja la lógica de aprobadores como está.
 */
export const ACCOUNT_TYPES = ['ventas'] as const;
export type QuoteAccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<QuoteAccountType, string> = {
  ventas: 'Ventas',
};

const usd = (value: number) =>
  `USD ${value.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}`;
const pct = (value: number) => `${(Math.round(value * 1000) / 10).toLocaleString('es-CO')} %`;

export interface ApprovalDraft {
  subject: string;
  body: string;
}

export function buildApprovalDraft(input: Quote2027Input, result: Quote2027Result, clientName: string): ApprovalDraft {
  const country = findQuoteCountry(input.country)?.name ?? input.country;
  const client = clientName.trim() || 'cliente sin nombre';
  const lines = result.belowMinimum.map((line) => {
    const gapPerYear = (line.minUnit - line.priceUnit) * line.qty;
    return [
      `- ${line.name} (${line.detail}): lista ${usd(line.listUnit)}, mínimo a ${yearsLabel(input.years)} ${usd(line.minUnit)}, precio propuesto ${usd(line.priceUnit)}.`,
      `  Descuento total ${pct(line.discount)} frente a un máximo sin aprobación de ${pct(line.maxDiscount)}. Diferencia contra el mínimo: ${usd(Math.round(gapPerYear * 10) / 10)} por año, ${usd(Math.round(gapPerYear * input.years * 10) / 10)} en el contrato.`,
    ].join('\n');
  });
  const body = [
    `Solicito aprobación de descuento para ${client}.`,
    '',
    `País: ${country}. Plazo: ${yearsLabel(input.years)}. Pagos: ${input.payments}.`,
    '',
    'Líneas por debajo del mínimo:',
    ...(lines.length ? lines : ['- Ninguna.']),
    '',
    `Total propuesto: ${usd(result.totals.afterPerYear)} por año, ${usd(result.totals.contract)} en el contrato.`,
  ].join('\n');
  return { subject: `Aprobación de descuento · ${client} · ${country}`, body };
}
