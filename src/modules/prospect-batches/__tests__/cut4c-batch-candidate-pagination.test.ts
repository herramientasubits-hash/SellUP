/**
 * AGENT1-CUT4-C — PRUEBA FUNCIONAL DE PAGINACIÓN DEL LECTOR DURABLE.
 *
 * La suite estática de CUT4-C ya fija que `getCandidatesByBatch` CITA el
 * contrato durable, que llama a `.range(...)` y que agotar el tope es un error.
 * Citar no es ejecutar: inspeccionar el texto de la función no demuestra que la
 * carga ATRAVIESE de verdad más de una página, ni que combine las páginas sin
 * perder ni duplicar filas, ni que el tope falle CERRADO.
 *
 * Este archivo ejecuta el lector REAL contra un PostgREST simulado que sirve
 * ventanas de verdad, y prueba lo que sólo se ve corriendo:
 *
 *   1. MULTI-PÁGINA. Con un conjunto mayor que una página, hace las lecturas
 *      necesarias, las combina en orden, no pierde ni duplica filas, y el total
 *      devuelto es el conjunto entero.
 *
 *   2. EL CLASIFICADOR NO VUELVE EN LA SEGUNDA PÁGINA. Las filas que
 *      `isUsefulReviewCandidate` descarta —CO sin NIT— y las de procedencia
 *      histórica (`record_origin` NULL) o `import` se colocan A PROPÓSITO en la
 *      SEGUNDA página: si el recorte de calidad se reintrodujera en cualquier
 *      punto del bucle, desaparecerían justo ahí.
 *
 *   3. FRONTERA EXACTA. Una primera página EXACTAMENTE llena no acredita fin de
 *      conjunto: `length === PAGE_SIZE` es indistinguible de «hay más». El
 *      lector debe emitir la SIGUIENTE lectura antes de concluir.
 *
 *   4. TOPE DE PÁGINAS. Con páginas siempre llenas el lector debe LANZAR, no
 *      devolver en silencio las primeras N páginas. Un truncado mudo se leería
 *      río abajo como «el lote no tiene más», que es la mentira exacta que
 *      CUT-4 cierra.
 *
 * El PAGE_SIZE no se codifica a mano: se DESCUBRE de la primera ventana que
 * pide la implementación real, así que cambiarlo en el producto no puede dejar
 * esta prueba verde por accidente sobre un tamaño que ya no existe.
 *
 * Estrategia de mocks (sólo el I/O real):
 *   - `@/lib/supabase/server` → doble local que sirve ventanas `.range()`.
 *   - `next/cache` / `next/navigation` → no-ops.
 *
 * El lector, el contrato durable y el clasificador corren de VERDAD.
 *
 * Cero red, cero Apollo, cero Lusha, cero HubSpot, cero créditos, cero
 * migraciones, cero escrituras.
 *
 * Correr: node --import tsx --experimental-test-module-mocks --test <este archivo>
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { isUsefulReviewCandidate } from '@/modules/prospect-batches/types';
import { DURABLE_PROSPECT_CANDIDATE_STATUSES } from '@/server/prospect-batches/batch-durable-candidates';

// ─── Estado observable del PostgREST simulado ───────────────────────────────

type FakeRow = Record<string, unknown>;

type Observed = {
  /** Conjunto que el backend simulado tiene para el lote. */
  dataset: FakeRow[];
  /**
   * Cuando NO es null, toda ventana devuelve ESTA página completa, sin importar
   * el offset: simula un conjunto inagotable para provocar el tope.
   */
  alwaysFullPage: FakeRow[] | null;
  /** Cada ventana pedida, en orden. Es la evidencia de cuántas lecturas hubo. */
  ranges: Array<{ from: number; to: number }>;
  /** Filtros `in` de cada lectura: fija que el contrato durable viaja SIEMPRE. */
  inFilters: Array<[string, readonly unknown[]]>;
  /** Filtros `eq` de cada lectura sobre candidatos. */
  eqFilters: Array<[string, unknown]>;
};

const observed: Observed = {
  dataset: [],
  alwaysFullPage: null,
  ranges: [],
  inFilters: [],
  eqFilters: [],
};

function reset(): void {
  observed.dataset = [];
  observed.alwaysFullPage = null;
  observed.ranges.length = 0;
  observed.inFilters.length = 0;
  observed.eqFilters.length = 0;
}

mock.module('next/cache', { namedExports: { revalidatePath: () => {} } });
mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`redirect inesperado a ${to}`);
    },
  },
});

mock.module('@/lib/supabase/server', {
  namedExports: { createClient: async () => makeFakeSupabase() },
});

function makeFakeSupabase(): unknown {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
    from(table: string) {
      if (table === 'internal_users') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          limit: () => chain,
          single: async () => ({ data: { id: 'internal-user-1' }, error: null }),
        };
        return chain;
      }

      if (table === 'prospect_candidates') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            observed.eqFilters.push([column, value]);
            return chain;
          },
          in: (column: string, values: readonly unknown[]) => {
            observed.inFilters.push([column, values]);
            return chain;
          },
          order: () => chain,
          range: async (from: number, to: number) => {
            observed.ranges.push({ from, to });
            if (observed.alwaysFullPage) {
              return { data: observed.alwaysFullPage, error: null };
            }
            return { data: observed.dataset.slice(from, to + 1), error: null };
          },
        };
        return chain;
      }

      throw new Error(`tabla no simulada: ${table}`);
    },
  };
}

// La red se rompe a propósito: cualquier llamada real revienta el test.
globalThis.fetch = (async () => {
  throw new Error('este test no debe hacer red');
}) as typeof globalThis.fetch;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const BATCH_ID = '00000000-0000-4000-8000-0000000000c4';

/** Fila durable corriente: útil para el clasificador y de procedencia limpia. */
function row(index: number, overrides: FakeRow = {}): FakeRow {
  return {
    id: `cand-${String(index).padStart(6, '0')}`,
    batch_id: BATCH_ID,
    name: `Empresa ${index} SAS`,
    legal_name: `Empresa ${index} SAS`,
    country_code: 'MX',
    tax_identifier: `RFC${index}`,
    status: 'needs_review',
    duplicate_status: null,
    record_origin: 'production',
    source_primary: 'apollo',
    created_at: '2026-08-25T00:00:00.000Z',
    reviewer: null,
    ...overrides,
  };
}

/** El disparador real de CUT-4: el clasificador la descarta, el lote la tiene. */
const CO_WITHOUT_NIT: FakeRow = row(900001, {
  id: 'cand-co-sin-nit',
  name: 'Colombiana Sin NIT SAS',
  country_code: 'CO',
  tax_identifier: null,
  source_primary: 'apollo',
});

/** Fila histórica anterior a la procedencia canónica. */
const NULL_ORIGIN: FakeRow = row(900002, {
  id: 'cand-origen-null',
  name: 'Histórica Sin Procedencia SA',
  record_origin: null,
});

/** Procedencia de importación: se ve, y su accionabilidad la decide otra capa. */
const IMPORT_ORIGIN: FakeRow = row(900003, {
  id: 'cand-origen-import',
  name: 'Importada SA de CV',
  record_origin: 'import',
});

const SECOND_PAGE_MARKERS = [CO_WITHOUT_NIT, NULL_ORIGIN, IMPORT_ORIGIN];

async function loadReader() {
  const { getCandidatesByBatch } = await import('../actions');
  return getCandidatesByBatch;
}

function ids(rows: ReadonlyArray<{ id?: unknown }>): string[] {
  return rows.map((r) => String(r.id));
}

// ─── PAGE_SIZE descubierto de la implementación real ────────────────────────

/**
 * No se codifica a mano: es la anchura de la PRIMERA ventana que pide el lector
 * real. Si el producto cambia el tamaño de página, estas pruebas se mueven con
 * él en vez de quedarse verdes sobre un tamaño que ya no existe.
 */
let PAGE_SIZE = 0;

before(async () => {
  reset();
  const getCandidatesByBatch = await loadReader();
  const rows = await getCandidatesByBatch(BATCH_ID);
  assert.equal(rows.length, 0, 'un lote vacío no puede devolver filas');
  assert.equal(observed.ranges.length, 1, 'el conjunto vacío se cierra en una sola lectura');
  PAGE_SIZE = observed.ranges[0].to - observed.ranges[0].from + 1;
  assert.ok(PAGE_SIZE > 1, `PAGE_SIZE descubierto inválido: ${PAGE_SIZE}`);
});

// ─── § 20.1 — la carga atraviesa más de una página ──────────────────────────

describe('CUT4-C § 20 — la carga durable del lote atraviesa varias páginas', () => {
  const SECOND_PAGE_EXTRA = 137;

  beforeEach(reset);

  it('combina página 1 + página 2 y devuelve TODAS las filas', async () => {
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => row(i));
    const secondPage = [
      ...SECOND_PAGE_MARKERS,
      ...Array.from({ length: SECOND_PAGE_EXTRA - SECOND_PAGE_MARKERS.length }, (_, i) =>
        row(PAGE_SIZE + SECOND_PAGE_MARKERS.length + i),
      ),
    ];
    observed.dataset = [...firstPage, ...secondPage];

    const getCandidatesByBatch = await loadReader();
    const rows = await getCandidatesByBatch(BATCH_ID);

    // 1. Hizo las lecturas necesarias: llena, parcial, vacía.
    assert.equal(observed.ranges.length, 3, 'se esperaban tres lecturas: llena, parcial, vacía');
    assert.deepEqual(observed.ranges[0], { from: 0, to: PAGE_SIZE - 1 });
    assert.deepEqual(observed.ranges[1], { from: PAGE_SIZE, to: 2 * PAGE_SIZE - 1 });
    assert.deepEqual(observed.ranges[2], {
      from: PAGE_SIZE + SECOND_PAGE_EXTRA,
      to: PAGE_SIZE + SECOND_PAGE_EXTRA + PAGE_SIZE - 1,
    });

    // 2. El total visible coincide con TODO lo suministrado.
    assert.equal(
      rows.length,
      PAGE_SIZE + SECOND_PAGE_EXTRA,
      'el total devuelto debe ser el conjunto entero, no una sola página',
    );

    // 3. Ni pérdida ni duplicación: mismos ids, mismo orden, sin repetidos.
    assert.deepEqual(ids(rows), ids(observed.dataset), 'las páginas deben combinarse en orden');
    assert.equal(new Set(ids(rows)).size, rows.length, 'ninguna fila puede venir duplicada');

    // 4. No cortó al terminar exactamente la primera página.
    assert.ok(rows.length > PAGE_SIZE, 'no puede cortar en la primera página');
  });

  it('la SEGUNDA página tampoco reincorpora el clasificador como filtro', async () => {
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => row(i));
    observed.dataset = [...firstPage, ...SECOND_PAGE_MARKERS];

    const getCandidatesByBatch = await loadReader();
    const rows = await getCandidatesByBatch(BATCH_ID);
    const visible = new Set(ids(rows));

    // El clasificador de CALIDAD sigue diciendo que NO es útil...
    assert.equal(
      isUsefulReviewCandidate(CO_WITHOUT_NIT as never),
      false,
      'la fixture debe ser justo la que el clasificador descarta, o la prueba no prueba nada',
    );
    // ...y aun así la fila DURABLE se ve, en la segunda página.
    assert.ok(visible.has('cand-co-sin-nit'), 'CO sin NIT debe verse en la segunda página');
    assert.ok(visible.has('cand-origen-null'), 'record_origin NULL histórico debe verse');
    assert.ok(visible.has('cand-origen-import'), 'record_origin import debe verse');

    assert.equal(
      rows.length,
      PAGE_SIZE + SECOND_PAGE_MARKERS.length,
      'ninguna fila puede desaparecer entre páginas',
    );
  });

  it('cada lectura lleva el MISMO contrato durable y el MISMO lote', async () => {
    observed.dataset = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => row(i));

    const getCandidatesByBatch = await loadReader();
    await getCandidatesByBatch(BATCH_ID);

    const candidateIn = observed.inFilters;
    assert.equal(
      candidateIn.length,
      observed.ranges.length,
      'toda ventana debe filtrar por estados durables, no sólo la primera',
    );
    for (const [column, values] of candidateIn) {
      assert.equal(column, 'status');
      assert.deepEqual([...values], [...DURABLE_PROSPECT_CANDIDATE_STATUSES]);
    }
    const batchFilters = observed.eqFilters.filter(([column]) => column === 'batch_id');
    assert.equal(batchFilters.length, observed.ranges.length, 'toda ventana se acota al lote');
    for (const [, value] of batchFilters) assert.equal(value, BATCH_ID);
  });
});

// ─── § 20.2 — frontera: primera página EXACTAMENTE llena ────────────────────

describe('CUT4-C § 20 — una página exactamente llena no acredita fin de conjunto', () => {
  beforeEach(reset);

  it('con exactamente PAGE_SIZE filas emite la SIGUIENTE lectura antes de concluir', async () => {
    observed.dataset = Array.from({ length: PAGE_SIZE }, (_, i) => row(i));

    const getCandidatesByBatch = await loadReader();
    const rows = await getCandidatesByBatch(BATCH_ID);

    assert.equal(
      observed.ranges.length,
      2,
      '«me devolvió PAGE_SIZE» es indistinguible de «hay más»: sólo una página vacía cierra',
    );
    assert.deepEqual(observed.ranges[1], { from: PAGE_SIZE, to: 2 * PAGE_SIZE - 1 });
    assert.equal(rows.length, PAGE_SIZE);
    assert.equal(new Set(ids(rows)).size, PAGE_SIZE, 'la segunda lectura vacía no puede duplicar');
  });

  it('con PAGE_SIZE + 1 filas la segunda página aporta la fila que faltaba', async () => {
    observed.dataset = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => row(i));

    const getCandidatesByBatch = await loadReader();
    const rows = await getCandidatesByBatch(BATCH_ID);

    assert.equal(observed.ranges.length, 3);
    assert.equal(rows.length, PAGE_SIZE + 1);
    assert.deepEqual(ids(rows), ids(observed.dataset));
  });
});

// ─── § 20.3 — el tope de páginas falla CERRADO ──────────────────────────────

describe('CUT4-C § 20 — alcanzar el tope de páginas es un error, no un truncado mudo', () => {
  beforeEach(reset);

  it('con páginas siempre llenas LANZA en vez de devolver las primeras N', async () => {
    // Fixture mínima reutilizable: la MISMA página completa se sirve en cada
    // ventana. Fabricar decenas de miles de filas distintas no probaría nada
    // adicional — lo que se prueba es que el bucle no puede terminar callado.
    observed.alwaysFullPage = Array.from({ length: PAGE_SIZE }, (_, i) => row(i));

    const getCandidatesByBatch = await loadReader();

    let thrown: unknown = null;
    let returned: unknown = undefined;
    try {
      returned = await getCandidatesByBatch(BATCH_ID);
    } catch (error) {
      thrown = error;
    }

    assert.equal(returned, undefined, 'no puede devolver un conjunto parcial');
    assert.ok(thrown instanceof Error, 'agotar el tope debe lanzar');
    assert.match(
      (thrown as Error).message,
      /Carga de candidatos abortada/,
      'el error debe nombrar la carga abortada, no un fallo genérico',
    );

    // El tope observado es la CANTIDAD de lecturas antes de rendirse, y el
    // mensaje debe declarar el volumen real que se rehusó a truncar.
    const pageCap = observed.ranges.length;
    assert.ok(pageCap > 1, `tope de páginas inválido: ${pageCap}`);
    assert.match(
      (thrown as Error).message,
      new RegExp(`más de ${pageCap * PAGE_SIZE} filas`),
      'el mensaje debe declarar el volumen real del tope',
    );
  });
});
