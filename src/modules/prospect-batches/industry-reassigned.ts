/**
 * Empresas «de otra industria» (AGENT1-CLAUDE-RESCUE-REASSIGN-INDUSTRY-1).
 *
 * Cuando la revisión de la IA ve que una empresa es de OTRA macroindustria, no la
 * descarta (decisión de la dueña, 01-10): le corrige la industria y la deja en
 * «Por revisar» sin contar para la meta. Hasta ahora eso sólo se veía en la
 * ficha; esto es lo que usan las tablas y el lote para decirlo a la vista.
 *
 * Mismo valor que `INDUSTRY_REASSIGNED_CONDITION` del rescate (el test lo ata):
 * se repite aquí para no arrastrar el módulo de servidor al navegador.
 */
export const INDUSTRY_REASSIGNED_REASON = 'industry_reassigned_by_claude';

export const OTHER_INDUSTRY_LABEL = 'Otra industria';

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** ¿La IA le corrigió la industria? Lee `target_completeness` y, si falta, la decisión del rescate. */
export function isIndustryReassigned(metadata: unknown): boolean {
  const meta = asObject(metadata);
  if (!meta) return false;
  const completeness = asObject(meta.target_completeness);
  if (
    stringList(completeness?.review_only_reasons).includes(INDUSTRY_REASSIGNED_REASON) ||
    stringList(completeness?.failed_conditions).includes(INDUSTRY_REASSIGNED_REASON)
  ) {
    return true;
  }
  return asObject(meta.claude_rescue)?.decision === 'reassign';
}

/** Texto del tooltip: de qué industria es, y que no cuenta para la meta. */
export function otherIndustryHint(industry: string | null | undefined): string {
  const real = industry?.trim();
  return real
    ? `Es de ${real}, no de la industria que se buscó. Sigue para revisar, pero no cuenta para la meta.`
    : 'Es de otra industria, no de la que se buscó. Sigue para revisar, pero no cuenta para la meta.';
}

/** «8 de Tecnología · 2 de otra industria», o null si no hay ninguna de otra industria. */
export function describeIndustrySplit(input: {
  total: number;
  reassigned: number;
  requestedIndustry: string | null | undefined;
}): string | null {
  if (input.reassigned <= 0) return null;
  const inRequested = Math.max(0, input.total - input.reassigned);
  const requested = input.requestedIndustry?.trim();
  const first = requested ? `${inRequested} de ${requested}` : `${inRequested} de la industria buscada`;
  return `${first} · ${input.reassigned} de otra industria`;
}
