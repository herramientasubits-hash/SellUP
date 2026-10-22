/**
 * Agente 1 · «Competidores de una empresa» — aprender de los descartes (puro).
 *
 * Auditoría 21-10 (Fase C): lo que un vendedor ya descartó como «no es
 * competidor» de una referencia vuelve como contraejemplo al juez y a la búsqueda
 * web la próxima vez (QA Prod VECOL 21-10: Pfizer, Novo Nordisk, Grupo Amarey).
 * Sólo nombres: el texto libre del vendedor no entra a ningún prompt.
 */

import { detectPromptInjection } from '@/modules/industry-catalog/schema';

/** Cuántos contraejemplos viajan: los más recientes. */
export const MAX_NOT_COMPETITORS = 20;

/**
 * Motivos de descarte que significan «no compite con la referencia» (la lista de
 * motivos de la app no tiene uno propio; se usó «Fuera del segmento objetivo» con
 * la nota, como el 15-10 y el 21-10). El tamaño NO cuenta: una pequeña sí compite.
 */
export const NOT_COMPETITOR_REVIEW_NOTE_PREFIXES = ['Fuera del segmento objetivo', 'Industria incorrecta'] as const;

export function isNotCompetitorDiscard(reviewNotes: string | null | undefined): boolean {
  const notes = reviewNotes?.trim() ?? '';
  return NOT_COMPETITOR_REVIEW_NOTE_PREFIXES.some((prefix) => notes.startsWith(prefix));
}

/** Nombres limpios, sin repetir, sin instrucciones, hasta el tope. */
export function buildNotCompetitorNames(
  rows: ReadonlyArray<{ name: string | null; review_notes: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (!isNotCompetitorDiscard(row.review_notes)) continue;
    const name = row.name?.replace(/\s+/g, ' ').trim().slice(0, 80) ?? '';
    const key = name.toLowerCase();
    if (name.length < 2 || seen.has(key) || detectPromptInjection(name)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_NOT_COMPETITORS) break;
  }
  return out;
}

/** La línea del mensaje (juez y búsqueda web). `null` ⇒ no hay contraejemplos. */
export function notCompetitorsLine(names: readonly string[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  return `Ya descartadas por el vendedor porque NO compiten (no las incluyas ni a parecidas por la misma razón): ${names.join(', ')}`;
}
