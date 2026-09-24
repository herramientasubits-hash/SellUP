/**
 * lusha-page-cursor.ts — por qué página empieza cada rama de una búsqueda de
 * Lusha.
 *
 * AGENT1-LUSHA-PAGE-CURSOR-1.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 *
 * Cada corrida arrancaba en la página 0. Para la misma búsqueda, Lusha devuelve
 * SIEMPRE las mismas empresas en la misma página, así que la página 0 de una
 * búsqueda repetida es la que más probablemente ya se conoce. El 2026-09-24 venía
 * ya vista en un 92-100%: 4 créditos en páginas 0 dieron 1 útil, frente a 10
 * útiles en 4 créditos de páginas 1. La firma `ba24968a63` (CO × Tecnología)
 * pagó las páginas 0 y 1 el 22-09, y la pierna de la cascada del 23-09 volvió a
 * pagar la 0.
 *
 * 🔴 El cursor NO pide más páginas ni gasta más: con el mismo número de páginas
 * por corrida, elige QUÉ páginas. El techo de peticiones, el de filas crudas y
 * la reserva siguen mandando antes.
 *
 * ── Reglas ───────────────────────────────────────────────────────────────────
 *
 *   · la corrida empieza en la página siguiente a la última YA PAGADA de esa
 *     rama, en cualquier corrida anterior de la misma búsqueda (misma firma);
 *   · «pagada» incluye lo que PUDO cobrarse (`indeterminate`, `unknown`,
 *     `dispatch_unsafe`, o un estado que el cursor no conoce): ante la duda no
 *     se vuelve a pedir, que es la dirección que protege el dinero;
 *   · si la última página pagada vino INCOMPLETA —menos filas que el tamaño de
 *     página, vacía incluida—, el universo se acabó: se vuelve a la 0;
 *   · nunca se pasa de `LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX`: al llegar, vuelta a la 0.
 *
 * Puro: sin env, sin I/O, sin reloj.
 */

/**
 * Último índice de página que el cursor puede pedir. 40 páginas × 25 = 1.000
 * empresas por rama. Es un tope de seguridad, no una estimación del universo:
 * Lusha no publica un total verificado para esta ruta (`totalAvailable` sigue
 * sin confirmar), así que no hay señal fiable para ir más allá.
 */
export const LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX = 39;

/** Estados de la valla que dicen, con certeza, que la página NO se cobró. */
const NOT_CONSUMED_STATES: ReadonlySet<string> = new Set(['definitely_not_charged', 'prepared']);

/**
 * Una página de una corrida anterior, tal como la guarda la valla de peticiones.
 * 🔴 Se esperan en orden CRONOLÓGICO (de la más antigua a la más reciente).
 */
export type LushaPageHistoryRow = {
  branchIndex: number;
  pageIndex: number;
  state: string;
  /** `null` = no se sabe cuántas filas volvieron (p. ej. desenlace incierto). */
  resultsReturned: number | null;
};

export type LushaBranchCursorReason =
  /** La búsqueda nunca pagó una página de esta rama. */
  | 'no_history'
  /** Arranca en la siguiente a la última pagada. */
  | 'next_unconsumed_page'
  /** La última pagada vino incompleta: no quedan páginas nuevas. */
  | 'universe_exhausted_restart'
  /** La siguiente corrida se pasaría del tope de página. */
  | 'cap_restart';

export type LushaBranchCursorDecision = {
  branchIndex: number;
  startPage: number;
  reason: LushaBranchCursorReason;
  lastConsumedPage: number | null;
  /** Páginas DISTINTAS ya pagadas de esta rama. */
  consumedPages: number;
};

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function resolveLushaBranchStartPages(input: {
  branchCount: number;
  history: readonly LushaPageHistoryRow[];
  pageSize: number;
  pagesPerRun: number;
  maxPageIndex?: number;
}): LushaBranchCursorDecision[] {
  const maxPageIndex = input.maxPageIndex ?? LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX;
  const branchCount = isIndex(input.branchCount) ? input.branchCount : 0;

  // Por rama: página → la fila con MÁS información sobre si vino llena.
  const consumed = new Map<number, Map<number, number | null>>();
  for (const row of input.history) {
    if (!isIndex(row.branchIndex) || !isIndex(row.pageIndex)) continue;
    if (row.branchIndex >= branchCount) continue;
    if (NOT_CONSUMED_STATES.has(row.state)) continue;
    const pages = consumed.get(row.branchIndex) ?? new Map<number, number | null>();
    const results = isIndex(row.resultsReturned) ? row.resultsReturned : null;
    const previous = pages.get(row.pageIndex);
    // El historial llega en orden cronológico: el conteo MÁS RECIENTE gana,
    // porque el universo de una búsqueda puede encogerse. Un conteo incierto
    // (`null`) no borra uno conocido.
    pages.set(row.pageIndex, results ?? previous ?? null);
    consumed.set(row.branchIndex, pages);
  }

  const decisions: LushaBranchCursorDecision[] = [];
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    const pages = consumed.get(branchIndex);
    if (!pages || pages.size === 0) {
      decisions.push({
        branchIndex,
        startPage: 0,
        reason: 'no_history',
        lastConsumedPage: null,
        consumedPages: 0,
      });
      continue;
    }
    const lastConsumedPage = Math.max(...pages.keys());
    const lastResults = pages.get(lastConsumedPage) ?? null;
    const base = { branchIndex, lastConsumedPage, consumedPages: pages.size };

    if (lastResults !== null && lastResults < input.pageSize) {
      decisions.push({ ...base, startPage: 0, reason: 'universe_exhausted_restart' });
      continue;
    }
    const next = lastConsumedPage + 1;
    if (next + Math.max(1, input.pagesPerRun) - 1 > maxPageIndex) {
      decisions.push({ ...base, startPage: 0, reason: 'cap_restart' });
      continue;
    }
    decisions.push({ ...base, startPage: next, reason: 'next_unconsumed_page' });
  }
  return decisions;
}

// ─── Contexto de una corrida ─────────────────────────────────────────────────

/**
 * Lo que la ejecución sabe del cursor. El ejecutor sólo arranca fuera de la
 * página 0 con `loaded`; en los otros dos casos se comporta exactamente como
 * antes del cursor.
 */
export type LushaPageCursorContext =
  /** La bandera está apagada: el comportamiento anterior, página 0. */
  | { status: 'disabled' }
  /** La bandera está encendida pero el historial no se pudo leer: página 0. */
  | { status: 'history_unavailable'; reason: string }
  | { status: 'loaded'; history: readonly LushaPageHistoryRow[] };

/**
 * Resuelve el contexto del cursor para una corrida.
 *
 * 🔴 Fail-open hacia el comportamiento ANTERIOR, nunca hacia el gasto: si leer el
 * historial falla, la corrida arranca en la página 0 como siempre y el motivo
 * queda registrado. Un fallo de lectura no puede hacer pagar de más.
 */
export async function resolveLushaPageCursorContext(input: {
  enabled: boolean;
  signatureVersion: string;
  signatureHash: string | null;
  operationId: string | null;
  loadHistory: (query: {
    signatureVersion: string;
    signatureHash: string;
    excludeOperationId: string | null;
  }) => Promise<LushaPageHistoryRow[]>;
}): Promise<LushaPageCursorContext> {
  if (!input.enabled) return { status: 'disabled' };
  if (!input.signatureHash) return { status: 'history_unavailable', reason: 'signature_missing' };
  try {
    const history = await input.loadHistory({
      signatureVersion: input.signatureVersion,
      signatureHash: input.signatureHash,
      excludeOperationId: input.operationId,
    });
    return { status: 'loaded', history };
  } catch (error) {
    return {
      status: 'history_unavailable',
      reason: error instanceof Error ? error.message.slice(0, 200) : 'history_load_failed',
    };
  }
}
