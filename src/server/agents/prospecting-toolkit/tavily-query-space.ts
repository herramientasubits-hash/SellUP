/**
 * AGENT1-TAVILY-QUERY-SPACE-1 — qué búsquedas le tocan a cada corrida (puro).
 *
 * El espacio de un país × industria es término × (nacional + cada región). Cada
 * combinación es una «celda». La selección lee el historial real de las corridas
 * de Tavily del mismo país e industria y:
 *
 *   1. nunca repite una celda usada dentro del enfriamiento (`cooling`): así 20
 *      vendedores al día no pagan las mismas búsquedas;
 *   2. prefiere las celdas nunca usadas (`fresh`), repartidas entre términos y
 *      con un orden distinto por lote, para que dos vendedores en paralelo tomen
 *      regiones distintas;
 *   3. agotadas las nuevas, vuelve a las que rindieron (`revisit`) cuando se
 *      enfriaron: la web cambia y una entidad nueva puede aparecer;
 *   4. retira las que salieron vacías varias veces (`retired`);
 *   5. si no queda nada, lo dice (`exhausted`) en vez de gastar a ciegas.
 *
 * No hay estado propio: el historial se reconstruye de `prospect_batches` y
 * `prospect_candidates`, que ya guardan qué búsqueda trajo cada empresa.
 */

/**
 * Una celda que rindió vuelve pronto: la próxima vez se busca EXCLUYENDO los
 * dominios que ya trajo, así que Tavily devuelve los siguientes resultados (es
 * paginar por exclusión). Sin esto un segmento se consumía en ~15 días y quedaba
 * parado hasta el día 60.
 */
export const TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS = 14;
/** Una celda que no trajo nada útil espera más antes de reintentarse. */
export const TAVILY_EMPTY_CELL_COOLDOWN_DAYS = 60;
/** Dominios por celda que se recuerdan para excluirlos al volver a ella. */
export const TAVILY_CELL_DOMAINS_MAX = 40;
/** Veces que una celda puede salir vacía antes de retirarse. */
export const TAVILY_CELL_RETIRE_AFTER_EMPTY_RUNS = 2;
/** Ventana del historial. Más allá, una celda vuelve a contar como nueva. */
export const TAVILY_QUERY_HISTORY_LOOKBACK_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Estados que NO suman: el historial mide empresas nuevas y útiles. */
const NON_USEFUL_CANDIDATE_STATUSES: ReadonlySet<string> = new Set(['duplicate', 'discarded']);

export type TavilyQueryCell = {
  term: string;
  /** `null` = búsqueda nacional. */
  region: string | null;
  query: string;
  key: string;
  /**
   * AGENT1-TAVILY-FREE-CREDITS-1 — 0 nacional, 1 región principal, 2 resto. Las
   * regiones principales van antes: en Gobierno, las búsquedas en regiones
   * pequeñas traían municipios de menos de 200 empleados (Prod 01-10, 63a87ee1).
   */
  tier?: number;
};

export type TavilyQueryCellHistory = {
  lastUsedAtMs: number;
  timesUsed: number;
  /** Empresas útiles (ni duplicadas ni descartadas) que trajo la celda. */
  persistedCount: number;
  /** Dominios que ya trajo (cualquier estado): se excluyen al volver a la celda. */
  domains?: readonly string[];
};

export type TavilyQueryHistory = ReadonlyMap<string, TavilyQueryCellHistory>;

export type TavilyCellState = 'fresh' | 'revisit' | 'cooling' | 'retired';

export type TavilyQuerySpaceSummary = {
  total: number;
  fresh: number;
  revisit: number;
  cooling: number;
  retired: number;
  /** No queda ninguna celda elegible: la corrida no debe buscar. */
  exhausted: boolean;
  /** Cuándo se enfría la primera celda en `cooling` que rindió; `null` si ninguna. */
  nextAvailableAtMs: number | null;
};

export function normalizeTavilyQueryKey(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyTavilyCell(
  history: TavilyQueryCellHistory | undefined,
  nowMs: number,
): TavilyCellState {
  if (!history) return 'fresh';
  if (history.persistedCount === 0 && history.timesUsed >= TAVILY_CELL_RETIRE_AFTER_EMPTY_RUNS) {
    return 'retired';
  }
  return nowMs - history.lastUsedAtMs < cellCooldownMs(history) ? 'cooling' : 'revisit';
}

function cellCooldownMs(history: TavilyQueryCellHistory): number {
  return (history.persistedCount > 0 ? TAVILY_PRODUCTIVE_CELL_COOLDOWN_DAYS : TAVILY_EMPTY_CELL_COOLDOWN_DAYS) * DAY_MS;
}

/** FNV-1a de 32 bits: determinista y estable entre runtimes. */
export function stableTavilyHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Celdas nuevas repartidas: una por término por vuelta, empezando por la nacional
 * de cada término (en un segmento nuevo trae primero a las más grandes) y luego
 * regiones en un orden propio del lote.
 */
function spreadFreshCells(fresh: readonly TavilyQueryCell[], seedKey: string): TavilyQueryCell[] {
  const byTerm = new Map<string, TavilyQueryCell[]>();
  for (const cell of fresh) {
    const list = byTerm.get(cell.term) ?? [];
    list.push(cell);
    byTerm.set(cell.term, list);
  }
  const rank = (cell: TavilyQueryCell) => stableTavilyHash(`${seedKey}|${cell.key}`);
  const queues = [...byTerm.values()].map((list) =>
    [...list].sort((a, b) => {
      if ((a.region === null) !== (b.region === null)) return a.region === null ? -1 : 1;
      const tierA = a.tier ?? 1;
      const tierB = b.tier ?? 1;
      if (tierA !== tierB) return tierA - tierB;
      return rank(a) - rank(b);
    }),
  );
  if (queues.length === 0) return [];
  const offset = stableTavilyHash(seedKey) % queues.length;
  const ordered = [...queues.slice(offset), ...queues.slice(0, offset)];

  const out: TavilyQueryCell[] = [];
  const longest = Math.max(...ordered.map((q) => q.length));
  for (let i = 0; i < longest; i++) {
    for (const queue of ordered) {
      const cell = queue[i];
      if (cell) out.push(cell);
    }
  }
  return out;
}

export function selectTavilyQueryCells(input: {
  cells: readonly TavilyQueryCell[];
  history: TavilyQueryHistory;
  nowMs: number;
  seedKey: string;
  limit: number;
}): { selected: TavilyQueryCell[]; summary: TavilyQuerySpaceSummary } {
  const fresh: TavilyQueryCell[] = [];
  const revisit: TavilyQueryCell[] = [];
  let cooling = 0;
  let retired = 0;
  let nextAvailableAtMs: number | null = null;

  for (const cell of input.cells) {
    const history = input.history.get(cell.key);
    const state = classifyTavilyCell(history, input.nowMs);
    if (state === 'fresh') fresh.push(cell);
    else if (state === 'revisit') revisit.push(cell);
    else if (state === 'retired') retired++;
    else {
      cooling++;
      if (history) {
        const at = history.lastUsedAtMs + cellCooldownMs(history);
        nextAvailableAtMs = nextAvailableAtMs === null ? at : Math.min(nextAvailableAtMs, at);
      }
    }
  }

  // Las que más rindieron primero; a igual rendimiento, la más antigua.
  const revisitOrdered = [...revisit].sort((a, b) => {
    const ha = input.history.get(a.key)!;
    const hb = input.history.get(b.key)!;
    return hb.persistedCount - ha.persistedCount || ha.lastUsedAtMs - hb.lastUsedAtMs;
  });

  const limit = Math.max(0, Math.floor(input.limit));
  const selected = [...spreadFreshCells(fresh, input.seedKey), ...revisitOrdered].slice(0, limit);

  return {
    selected,
    summary: {
      total: input.cells.length,
      fresh: fresh.length,
      revisit: revisit.length,
      cooling,
      retired,
      exhausted: fresh.length + revisit.length === 0,
      nextAvailableAtMs,
    },
  };
}

// ─── Historial ────────────────────────────────────────────────────────────────

export type TavilyHistoryBatch = {
  id: string;
  createdAtMs: number;
  /** Claves de celda (o, en lotes previos a v2, las consultas emitidas). */
  queries: readonly string[];
  /**
   * Consulta emitida → clave de su celda. Una consulta con criterio adicional
   * («alcaldia Antioquia Colombia salud») pertenece a la celda base.
   */
  emittedToKey?: Readonly<Record<string, string>>;
};

export type TavilyHistoryCandidate = {
  batchId: string;
  status: string | null;
  domain?: string | null;
  /** `metadata.search_trace.query_text`: la consulta que trajo la empresa. */
  queryText: string | null;
};

export function buildTavilyQueryHistory(input: {
  batches: readonly TavilyHistoryBatch[];
  candidates: readonly TavilyHistoryCandidate[];
}): Map<string, TavilyQueryCellHistory> {
  const history = new Map<string, TavilyQueryCellHistory>();
  const batchIds = new Set<string>();
  const emittedByBatch = new Map<string, Map<string, string>>();

  for (const batch of input.batches) {
    batchIds.add(batch.id);
    emittedByBatch.set(
      batch.id,
      new Map(
        Object.entries(batch.emittedToKey ?? {}).map(([emitted, key]) => [
          normalizeTavilyQueryKey(emitted),
          normalizeTavilyQueryKey(key),
        ]),
      ),
    );
    const keys = new Set(batch.queries.map(normalizeTavilyQueryKey).filter((k) => k.length > 0));
    for (const key of keys) {
      const prev = history.get(key);
      history.set(key, {
        lastUsedAtMs: prev ? Math.max(prev.lastUsedAtMs, batch.createdAtMs) : batch.createdAtMs,
        timesUsed: (prev?.timesUsed ?? 0) + 1,
        persistedCount: prev?.persistedCount ?? 0,
      });
    }
  }

  for (const candidate of input.candidates) {
    if (!batchIds.has(candidate.batchId) || !candidate.queryText) continue;
    const emitted = normalizeTavilyQueryKey(candidate.queryText);
    const key = emittedByBatch.get(candidate.batchId)?.get(emitted) ?? emitted;
    const prev = history.get(key);
    if (!prev) continue;
    const useful = !(candidate.status && NON_USEFUL_CANDIDATE_STATUSES.has(candidate.status));
    const domain = candidate.domain?.trim().toLowerCase() || null;
    const domains = prev.domains ?? [];
    const withDomain =
      domain && !domains.includes(domain) && domains.length < TAVILY_CELL_DOMAINS_MAX
        ? [...domains, domain]
        : domains;
    history.set(key, {
      ...prev,
      persistedCount: prev.persistedCount + (useful ? 1 : 0),
      ...(withDomain.length > 0 ? { domains: withDomain } : {}),
    });
  }

  return history;
}
