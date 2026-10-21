/**
 * Agente 3 · el tablero de resultados del primer contacto (sólo servidor): cuántas
 * preparaciones se usaron y qué pasó, por enfoque, canal y país. Sólo cuentas; no lee
 * textos ni nombres. Ver `approach-results.ts`.
 */

import 'server-only';
import { resolvePeriodStart } from '@/modules/ai-usage/usage-filter-semantics';
import type { UsageFilters } from '@/modules/ai-usage/queries';
import { buildApproachResultsDashboard, type ApproachResultsDashboard } from '@/server/agents/first-call/approach-results';
import { readApproachResults } from '@/server/agents/first-call/approach-results.server';

export type Agent3ResultsPanelResult = { status: 'ok'; dashboard: ApproachResultsDashboard } | { status: 'error' };

export async function getAgent3ResultsDashboard(
  filters: Pick<UsageFilters, 'period' | 'country'>,
  countryLabel: (code: string) => string,
): Promise<Agent3ResultsPanelResult> {
  try {
    // «Todo» es todo; sin periodo elegido, el último año (como lo que aprende el redactor).
    const sinceIso = filters.period === 'all' ? new Date(0).toISOString() : resolvePeriodStart(filters.period) ?? undefined;
    const rows = await readApproachResults({ sinceIso, countryCode: filters.country ?? null });
    return { status: 'ok', dashboard: buildApproachResultsDashboard(rows, countryLabel) };
  } catch (err) {
    console.error('[agent3] results dashboard failed:', err instanceof Error ? err.message : err);
    return { status: 'error' };
  }
}
