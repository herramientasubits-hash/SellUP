/**
 * Tests — cableado REAL del cierre terminal por supresión y ruptura del bucle
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-E1)
 *
 * Los cores puros se prueban en phone-suppression-terminal-policy-4o-e1.test.ts.
 * Este archivo prueba las DOS piezas de infraestructura de las que depende que el
 * bucle se rompa de verdad, y que un test de core no puede demostrar:
 *
 *   1. `persistTerminalPhoneSuppression` — que el UPDATE sea CONDICIONAL. Se
 *      inspeccionan los filtros que realmente se envían al driver: sin la condición
 *      de estado, una carrera con un `revealed` legítimo lo convertiría en `error`.
 *      También que 1 fila afectada ⇒ `applied`, 0 filas ⇒ NO aplicado, y que las
 *      columnas de costo solo se toquen cuando el patch las trae.
 *
 *   2. `findStaleApolloPhoneRevealCandidateIds` — la query REAL del cron. La
 *      propiedad que cierra el bucle es que un candidato terminalizado deje de
 *      seleccionarse, y se prueba de forma NO vacía: 5 suprimidos ocupando el tope
 *      del lote junto a 1 candidato en vuelo legítimo, que es el que debe salir.
 *
 * Offline por construcción: sin red, sin Supabase real, sin proveedores, 0 créditos.
 * Los números son sintéticos 555 y ninguno llega a un filtro ni a una aserción.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// Driver simulado: registra los filtros y los APLICA a filas en memoria
// ═══════════════════════════════════════════════════════════════

/** Un filtro tal y como el código lo pidió. Es la evidencia del test. */
interface RecordedFilter {
  op: 'eq' | 'in' | 'is' | 'not' | 'lte' | 'gt' | 'order' | 'limit';
  column: string;
  value: unknown;
}

interface RecordedQuery {
  table: string;
  kind: 'select' | 'update';
  payload: Record<string, unknown> | null;
  filters: RecordedFilter[];
}

let queries: RecordedQuery[] = [];
/** Filas de `contact_enrichment_candidates` visibles para el driver simulado. */
let candidateRows: Record<string, unknown>[] = [];
/** Error que devuelve el driver, para el camino «la escritura falla». */
let driverError: { message: string } | null = null;

function passes(row: Record<string, unknown>, filter: RecordedFilter): boolean {
  const actual = row[filter.column];
  switch (filter.op) {
    case 'eq':
      return actual === filter.value;
    case 'in':
      return (filter.value as unknown[]).includes(actual);
    case 'is':
      // Solo se usa con null en este subsistema.
      return actual === null || actual === undefined;
    case 'not':
      // `.not(col, 'is', null)` ⇒ la columna tiene que estar presente.
      return actual !== null && actual !== undefined;
    case 'lte':
      return String(actual) <= String(filter.value);
    case 'gt':
      return String(actual) > String(filter.value);
    default:
      return true;
  }
}

function matchingRows(query: RecordedQuery): Record<string, unknown>[] {
  const predicates = query.filters.filter(
    (f) => f.op !== 'order' && f.op !== 'limit',
  );
  const matched = candidateRows.filter((row) =>
    predicates.every((filter) => passes(row, filter)),
  );
  const order = query.filters.find((f) => f.op === 'order');
  const sorted = order
    ? [...matched].sort((a, b) =>
        String(a[order.column]) < String(b[order.column]) ? -1 : 1,
      )
    : matched;
  const limit = query.filters.find((f) => f.op === 'limit');
  return typeof limit?.value === 'number' ? sorted.slice(0, limit.value) : sorted;
}

/**
 * Cadena PostgREST simulada. Registra cada filtro y, al resolverse, aplica los
 * registrados a `candidateRows`. Es lo que hace el test no vacío: no comprueba «se
 * pidió excluir error», comprueba QUÉ FILAS salen con los filtros reales.
 */
function chainFor(query: RecordedQuery): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  const record = (op: RecordedFilter['op']) =>
    (column: string, value?: unknown) => {
      query.filters.push({ op, column, value });
      return self;
    };
  self.select = () => self;
  self.eq = record('eq');
  self.in = record('in');
  self.is = record('is');
  self.lte = record('lte');
  self.gt = record('gt');
  self.not = (column: string, _op: string, value: unknown) => {
    query.filters.push({ op: 'not', column, value });
    return self;
  };
  self.order = (column: string) => {
    query.filters.push({ op: 'order', column, value: null });
    return self;
  };
  self.limit = (value: number) => {
    query.filters.push({ op: 'limit', column: '', value });
    return self;
  };
  self.then = (resolve: (v: unknown) => unknown): unknown => {
    if (driverError) return resolve({ data: null, error: driverError });
    const rows = matchingRows(query);
    return resolve({
      data: rows.map((row) => ({ id: row.id })),
      error: null,
    });
  };
  return self;
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => ({
        select: () => {
          const query: RecordedQuery = { table, kind: 'select', payload: null, filters: [] };
          queries.push(query);
          return chainFor(query);
        },
        update: (payload: Record<string, unknown>) => {
          const query: RecordedQuery = { table, kind: 'update', payload, filters: [] };
          queries.push(query);
          return chainFor(query);
        },
      }),
    }),
  },
});

// Los proveedores se mockean para que un error de import no los alcance nunca.
// Ninguna de estas funciones puede ejecutarse en este archivo.
mock.module('@/server/integrations/apollo-client', {
  namedExports: {
    fetchApolloPhoneRevealWebhookResult: async () => {
      throw new Error('BUG: Apollo fue llamado en el selector del cron');
    },
  },
});
mock.module('@/modules/usage-tracking/logging', {
  namedExports: { logProviderUsage: async () => true },
});

type SuppressionPersistence = typeof import('../candidate-phone-suppression-persistence');
type SuppressionGuard = typeof import('../phone-reveal-suppression-guard');
type RecoveryDeps = typeof import('../phone-reveal-recovery-deps');

let persistence: SuppressionPersistence;
let guard: SuppressionGuard;
let recoveryDeps: RecoveryDeps;

before(async () => {
  persistence = await import('../candidate-phone-suppression-persistence');
  guard = await import('../phone-reveal-suppression-guard');
  recoveryDeps = await import('../phone-reveal-recovery-deps');
});

const NOW = '2026-08-10T12:00:00.000Z';
const CANDIDATE_ID = 'cand-e1-runtime';

function inFlightPatch() {
  return guard.buildTerminalPhoneSuppressionPatch({
    expectedStatuses: ['requested', 'pending'],
    nowIso: NOW,
    cost: { credits: 8, source: 'reported' },
    provider: 'apollo',
    webhookReceivedAt: NOW,
  });
}

beforeEach(() => {
  queries = [];
  candidateRows = [];
  driverError = null;
});

// ═══════════════════════════════════════════════════════════════
// 1. La escritura terminal es CONDICIONAL
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 · persistTerminalPhoneSuppression — UPDATE condicional', () => {
  it('exige el id, el estado observado Y la ausencia de teléfono', async () => {
    candidateRows = [
      { id: CANDIDATE_ID, phone_reveal_status: 'requested', phone: null },
    ];

    const result = await persistence.persistTerminalPhoneSuppression(CANDIDATE_ID, inFlightPatch());

    assert.equal(result.applied, true);
    const update = queries.find((q) => q.kind === 'update');
    assert.ok(update, 'se esperaba un UPDATE');
    assert.equal(update.table, 'contact_enrichment_candidates');

    // La condición de estado es lo que impide pisar un resultado concurrente. Sin
    // ella el UPDATE sería el `.eq('id', …)` a secas que este hito prohíbe.
    const statusFilter = update.filters.find(
      (f) => f.column === 'phone_reveal_status',
    );
    assert.ok(statusFilter, 'el UPDATE debe condicionarse al estado observado');
    assert.equal(statusFilter.op, 'in');
    assert.deepEqual(statusFilter.value, ['requested', 'pending']);

    // Defensa en profundidad: nunca se marca terminal una fila que ya muestra número.
    const phoneFilter = update.filters.find((f) => f.column === 'phone');
    assert.ok(phoneFilter, 'el UPDATE debe exigir que no haya teléfono visible');
    assert.equal(phoneFilter.op, 'is');

    assert.ok(update.filters.some((f) => f.op === 'eq' && f.column === 'id'));
  });

  it('escribe el estado terminal, el código de bloqueo y el costo real', async () => {
    candidateRows = [
      { id: CANDIDATE_ID, phone_reveal_status: 'pending', phone: null },
    ];

    await persistence.persistTerminalPhoneSuppression(CANDIDATE_ID, inFlightPatch());

    const update = queries.find((q) => q.kind === 'update');
    assert.deepEqual(update?.payload, {
      phone_reveal_status: 'error',
      phone_reveal_error_code: 'blocked_suppressed',
      phone_reveal_completed_at: NOW,
      phone_reveal_cost_credits: 8,
      phone_reveal_cost_source: 'reported',
      phone_reveal_provider: 'apollo',
      phone_reveal_webhook_received_at: NOW,
    });
  });

  it('NO toca las columnas de costo cuando el patch no las trae', async () => {
    candidateRows = [
      { id: CANDIDATE_ID, phone_reveal_status: 'no_phone_found', phone: null },
    ];

    await persistence.persistTerminalPhoneSuppression(
      CANDIDATE_ID,
      guard.buildTerminalPhoneSuppressionPatch({
        expectedStatuses: ['no_phone_found'],
        nowIso: NOW,
      }),
    );

    const payload = queries.find((q) => q.kind === 'update')?.payload ?? {};
    // Preservar el costo real ya incurrido = no escribir estas columnas. La cifra
    // que ya llevaba la fila describe la pata que sí se pagó.
    assert.equal('phone_reveal_cost_credits' in payload, false);
    assert.equal('phone_reveal_cost_source' in payload, false);
    assert.equal('phone_reveal_provider' in payload, false);
    assert.deepEqual(payload, {
      phone_reveal_status: 'error',
      phone_reveal_error_code: 'blocked_suppressed',
      phone_reveal_completed_at: NOW,
    });
  });

  it('un `revealed` concurrente NO se pisa: 0 filas ⇒ no aplicado', async () => {
    // Otro actor legítimo reveló el teléfono entre la respuesta de la RPC y esta
    // escritura. La fila ya no está en un estado esperado ⇒ el UPDATE no casa.
    candidateRows = [
      { id: CANDIDATE_ID, phone_reveal_status: 'revealed', phone: '+15550000001' },
    ];

    const result = await persistence.persistTerminalPhoneSuppression(CANDIDATE_ID, inFlightPatch());

    assert.equal(result.applied, false);
    assert.equal(candidateRows[0].phone_reveal_status, 'revealed');
  });

  it('sin estados que exigir no escribe nada (nunca degrada a incondicional)', async () => {
    candidateRows = [
      { id: CANDIDATE_ID, phone_reveal_status: 'requested', phone: null },
    ];

    const result = await persistence.persistTerminalPhoneSuppression(CANDIDATE_ID, {
      ...inFlightPatch(),
      expectedStatuses: [],
    });

    assert.equal(result.applied, false);
    assert.equal(queries.length, 0, 'no debe llegar ninguna consulta al driver');
  });

  it('propaga el fallo del driver (el caller lo trata como no aplicado)', async () => {
    driverError = { message: 'permission denied for table' };
    await assert.rejects(
      () => persistence.persistTerminalPhoneSuppression(CANDIDATE_ID, inFlightPatch()),
      /permission denied/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. El cron deja de seleccionar lo terminalizado (bucle roto)
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 · selector real del cron tras la terminalización', () => {
  const cutoffOld = '2026-08-09T00:00:00.000Z';

  /** Candidato Apollo en vuelo y stale: el caso que el cron SÍ debe recuperar. */
  function inFlightRow(id: string) {
    return {
      id,
      phone_reveal_provider: 'apollo',
      phone_reveal_status: 'requested',
      phone_reveal_request_id: `req-${id}`,
      phone: null,
      phone_reveal_requested_at: cutoffOld,
    };
  }

  /** El MISMO candidato después de que 4O-E1 lo cerrara por supresión. */
  function suppressedRow(id: string) {
    return {
      ...inFlightRow(id),
      phone_reveal_status: 'error',
      phone_reveal_error_code: 'blocked_suppressed',
    };
  }

  it('5 suprimidos NO ocupan el lote: sale el candidato en vuelo legítimo', async () => {
    // Los 5 suprimidos son los MÁS ANTIGUOS, así que con el orden FIFO y un tope de
    // 5 se llevarían el lote entero pasada tras pasada — que es exactamente el bucle
    // que este hito cierra. El candidato en vuelo es el más reciente.
    candidateRows = [
      { ...suppressedRow('sup-1'), phone_reveal_requested_at: '2026-08-01T00:00:00.000Z' },
      { ...suppressedRow('sup-2'), phone_reveal_requested_at: '2026-08-02T00:00:00.000Z' },
      { ...suppressedRow('sup-3'), phone_reveal_requested_at: '2026-08-03T00:00:00.000Z' },
      { ...suppressedRow('sup-4'), phone_reveal_requested_at: '2026-08-04T00:00:00.000Z' },
      { ...suppressedRow('sup-5'), phone_reveal_requested_at: '2026-08-05T00:00:00.000Z' },
      { ...inFlightRow('live-1'), phone_reveal_requested_at: '2026-08-06T00:00:00.000Z' },
    ];

    const ids = await recoveryDeps.findStaleApolloPhoneRevealCandidateIds({
      maxCandidates: 5,
      minAgeMinutes: 15,
      nowIso: NOW,
    });

    assert.deepEqual(ids, ['live-1']);
  });

  it('el mismo candidato SÍ se selecciona mientras sigue en vuelo (no vacío)', async () => {
    candidateRows = [inFlightRow('live-1')];

    const ids = await recoveryDeps.findStaleApolloPhoneRevealCandidateIds({
      maxCandidates: 5,
      minAgeMinutes: 15,
      nowIso: NOW,
    });

    assert.deepEqual(ids, ['live-1']);
  });

  it('y deja de seleccionarse en cuanto queda error + blocked_suppressed', async () => {
    candidateRows = [suppressedRow('live-1')];

    const ids = await recoveryDeps.findStaleApolloPhoneRevealCandidateIds({
      maxCandidates: 5,
      minAgeMinutes: 15,
      nowIso: NOW,
    });

    assert.deepEqual(ids, []);
  });
});
