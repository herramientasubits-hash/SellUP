/**
 * Agente 3 · leer las preparaciones para el tablero de resultados y para lo que aprende
 * el redactor (sólo servidor). Sólo cuentas: canal, enfoque, resultado y país; nunca
 * textos, nombres ni empresas.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { APPROACH_RESULTS_LOOKBACK_DAYS, mapApproachResultRow, type ApproachResultRow } from './approach-results';

const PAGE_SIZE = 1_000;
/** Tope de filas por lectura (cientos de vendedores × un año caben de sobra). */
const MAX_ROWS = 20_000;
const COLUMNS = 'channel, status, approach:pack->>approach, outcome:pack->outcome, accounts!inner(country_code)';

type AdminClient = Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'>;

export interface ApproachResultsQuery {
  /** Desde cuándo (ISO). Por defecto, el último año. */
  sinceIso?: string;
  /** Sólo las usadas con resultado (lo que aprende el redactor). */
  onlyWithOutcome?: boolean;
  countryCode?: string | null;
}

export async function readApproachResults(query: ApproachResultsQuery = {}, client?: AdminClient): Promise<ApproachResultRow[]> {
  const sinceIso = query.sinceIso ?? new Date(Date.now() - APPROACH_RESULTS_LOOKBACK_DAYS * 86_400_000).toISOString();
  const admin = client ?? createSupabaseAdminClient();
  const rows: ApproachResultRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let request = admin.from('first_call_packs').select(COLUMNS).gte('created_at', sinceIso);
    if (query.onlyWithOutcome) request = request.eq('status', 'used').not('pack->outcome', 'is', null);
    if (query.countryCode) request = request.eq('accounts.country_code', query.countryCode.toUpperCase());
    const { data, error } = await request.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`approach_results_read_failed:${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const raw of page) {
      const row = mapApproachResultRow(raw);
      if (row) rows.push(row);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}
