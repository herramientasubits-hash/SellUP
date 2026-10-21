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
// Sólo dos campos del resultado (no el objeto con su historial).
const COLUMNS =
  'channel, status, approach:pack->>approach, outcome_result:pack->outcome->>result, outcome_approach:pack->outcome->>approach, accounts!inner(country_code)';
/** Lo que aprende el redactor se reutiliza unos minutos (cambia cuando alguien marca «La usé»). */
const LEARNED_CACHE_MS = 5 * 60_000;
const learnedCache = new Map<string, { atMs: number; rows: ApproachResultRow[] }>();

type AdminClient = Pick<ReturnType<typeof createSupabaseAdminClient>, 'from'>;

export interface ApproachResultsQuery {
  /** Desde cuándo (ISO). Por defecto, el último año. */
  sinceIso?: string;
  /** Sólo las usadas con resultado (lo que aprende el redactor). */
  onlyWithOutcome?: boolean;
  countryCode?: string | null;
  /** Sólo estos canales (lo que aprende el redactor mira el canal que va a escribir). */
  channels?: readonly string[];
}

export interface ApproachResultsRead {
  rows: ApproachResultRow[];
  /** Se llegó al tope de filas: hay más de las que se leyeron. */
  truncated: boolean;
}

export async function readApproachResults(query: ApproachResultsQuery = {}, client?: AdminClient): Promise<ApproachResultsRead> {
  const sinceIso = query.sinceIso ?? new Date(Date.now() - APPROACH_RESULTS_LOOKBACK_DAYS * 86_400_000).toISOString();
  const admin = client ?? createSupabaseAdminClient();
  const rows: ApproachResultRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let request = admin.from('first_call_packs').select(COLUMNS).gte('created_at', sinceIso);
    if (query.onlyWithOutcome) request = request.eq('status', 'used').not('pack->outcome', 'is', null);
    if (query.countryCode) request = request.eq('accounts.country_code', query.countryCode.toUpperCase());
    if (query.channels && query.channels.length > 0) request = request.in('channel', [...query.channels]);
    // El id desempata: con sólo la fecha, las preparaciones de una misma corrida (misma
    // fecha) podían repetirse o saltarse entre páginas.
    const { data, error } = await request
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`approach_results_read_failed:${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const raw of page) {
      const row = mapApproachResultRow(raw);
      if (row) rows.push(row);
    }
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/**
 * Lo que aprende el redactor: las usadas con resultado de esos canales (de todos los
 * países, para el respaldo regional), en caché unos minutos por instancia.
 */
export async function readLearnedApproachResults(channels: readonly string[], nowMs: number = Date.now()): Promise<ApproachResultRow[]> {
  const key = [...channels].sort().join(',');
  const cached = learnedCache.get(key);
  if (cached && nowMs - cached.atMs < LEARNED_CACHE_MS) return cached.rows;
  const { rows } = await readApproachResults({ onlyWithOutcome: true, channels });
  learnedCache.set(key, { atMs: nowMs, rows });
  return rows;
}
