/**
 * Agente 1 · «Competidores de una empresa» — caché de la FICHA de la referencia
 * (puro).
 *
 * Auditoría 21-10: editar o rechazar la referencia, o que otra vendedora busque la
 * misma empresa, volvía a pagar la ficha (≈ US$0,03 con búsqueda web). La ficha ya
 * pagada queda en su fila de Uso de IA (`metadata.reference_card`) con una clave
 * (`metadata.reference_key`): la cuenta de SellUp o el texto buscado. Una ficha de
 * los últimos 30 días con la misma clave se reutiliza sin llamar a Claude.
 *
 * Sin migración: es la fila de uso que ya se escribía.
 */

import type { ReferenceCompanyCard } from '@/server/agents/prospecting-toolkit/claude-classifier/reference-company';
import { detectPromptInjection } from '@/modules/industry-catalog/schema';
import {
  COMPETITOR_REFERENCE_LIMITS,
  collapseReferenceText,
  normalizeReferenceDomain,
  normalizeReferenceKeywords,
} from './competitor-reference';

/** Cuánto vale una ficha ya pagada: lo que vende una empresa no cambia en semanas. */
export const REFERENCE_CARD_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * La clave de la ficha: la cuenta (si salió de Cuentas) o el texto buscado en
 * minúsculas, sin tildes ni espacios de más. «Alpina » y «alpina» son la misma.
 */
export function buildReferenceCardKey(input: { accountId: string | null; query: string }): string {
  if (input.accountId) return `account:${input.accountId}`;
  const text = collapseReferenceText(input.query.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  return `query:${text}`;
}

/** Lo que se guarda en la fila de uso: sólo la ficha, sin nada de la persona. */
export function toCachedReferenceCard(card: ReferenceCompanyCard): Record<string, unknown> {
  return {
    name: card.name,
    domain: card.domain,
    country_code: card.countryCode,
    industry_name: card.industryName,
    description: card.description,
    keywords: card.keywords,
  };
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = collapseReferenceText(value);
  if (text.length === 0 || text.length > max || detectPromptInjection(text)) return null;
  return text;
}

/**
 * Lee una ficha guardada. Cualquier campo raro ⇒ `null` (se paga una ficha nueva):
 * la fila es de la base, pero su texto termina dentro de un prompt.
 */
export function readCachedReferenceCard(
  value: unknown,
  countries: ReadonlyArray<{ code: string }>,
): ReferenceCompanyCard | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = cleanText(record.name, COMPETITOR_REFERENCE_LIMITS.nameMaxChars);
  if (!name) return null;
  const countryCode =
    typeof record.country_code === 'string' && countries.some((c) => c.code === record.country_code)
      ? record.country_code
      : null;
  return {
    name,
    domain: normalizeReferenceDomain(typeof record.domain === 'string' ? record.domain : null),
    countryCode,
    industryName: cleanText(record.industry_name, 120),
    description: cleanText(record.description, COMPETITOR_REFERENCE_LIMITS.descriptionMaxChars),
    keywords: normalizeReferenceKeywords(record.keywords),
  };
}
