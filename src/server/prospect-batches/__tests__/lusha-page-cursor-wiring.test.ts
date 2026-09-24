/**
 * AGENT1-LUSHA-PAGE-CURSOR-1 — el cursor CABLEADO: ejecutor, petición y acción.
 *
 * Lo que estas pruebas fijan, dicho como defecto:
 *
 *   · con el cursor encendido y la firma ya pagada en las páginas 0 y 1, la
 *     corrida siguiente pide la 2 y la 3 — y la valla durable, la telemetría y
 *     las disposiciones ven la página REAL, no el desplazamiento;
 *   · sin cursor (bandera apagada, historial ilegible o ausente) todo sigue
 *     EXACTAMENTE como antes: páginas 0 y 1, sin techo de página nuevo;
 *   · `clampLushaPreviewPage` recortaba en silencio toda página > 1: el techo
 *     mayor sólo lo autoriza el servidor, acotado, y el navegador no puede
 *     mandarlo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaMultiBranchExecution,
} from '../lusha-pending-review';
import {
  buildLushaPreviewRequest,
  clampLushaPreviewPage,
  resolveLushaAuthorizedMaxPage,
  LUSHA_PREVIEW_MAX_PAGE,
  type BuildLushaPreviewRequestInput,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from '../lusha-preview';
import {
  LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX,
  resolveLushaPageCursorContext,
  type LushaPageCursorContext,
  type LushaPageHistoryRow,
} from '../lusha-page-cursor';
import { toLushaRunTelemetryMetadata } from '../lusha-multibranch-execution';
import {
  AGENT1_LUSHA_PAGE_CURSOR_FLAG,
  isAgent1LushaPageCursorEnabled,
} from '../../../lib/feature-flags.server';
import { preM126FencedInsert } from './support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from './support/lusha-batch-epoch-snapshot';

function company(i: number): LushaPreviewCompany {
  return {
    providerCompanyId: `co-${i}`,
    name: `Empresa ${i}`,
    domain: `empresa-${i}.example`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Technology',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
  };
}

type SearchCall = {
  page: number | null | undefined;
  authorizedMaxPage: number | null | undefined;
  hasAuthorizedMaxPage: boolean;
  coordinates: { branchIndex: number; page: number } | undefined;
};

/**
 * Cada página devuelve empresas NUEVAS (página llena de 25), para que la
 * política de novedad no cierre la rama y se vean las dos páginas de la corrida.
 */
function recordingDeps(): { deps: PersistLushaPendingReviewDeps; calls: SearchCall[] } {
  const calls: SearchCall[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  let next = 0;
  return {
    calls,
    deps: {
      runSearch: async (input, coordinates) => {
        const typed = input as LushaPreviewInput;
        calls.push({
          page: typed.page,
          authorizedMaxPage: typed.authorizedMaxPage,
          hasAuthorizedMaxPage: Object.prototype.hasOwnProperty.call(typed, 'authorizedMaxPage'),
          coordinates: coordinates as SearchCall['coordinates'],
        });
        const results = Array.from({ length: 25 }, () => company(next++));
        const result: LushaPreviewResult = {
          ok: true,
          status: 'success',
          results,
          billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
          warnings: [],
          requestSummary: {
            country: 'Colombia',
            countryCode: 'CO',
            sector: 'Tecnología',
            industryKey: 'technology',
            macroIndustryKey: 'technology',
            mainIndustriesIds: [4],
            subIndustryId: null,
            sizeBand: { min: 200 },
            hasSearchText: false,
          },
        };
        return result;
      },
      reserveBatch: async (row: LushaPendingReviewBatchRow) => {
        batches.push(row);
        return { id: `batch-${batches.length}`, adopted: false, identityEpoch: 0 };
      },
      insertCandidatesFenced: preM126FencedInsert,
      readBatchIdentityEpoch: preM126BatchEpochSnapshot,
      insertCandidates: async (rows) => ({ insertedCount: rows.length }),
      checkCompanyDuplicate: async (input) => ({
        status: 'new_candidate',
        confidence: 85,
        input,
        matches: [],
        summary: 'nuevo',
        checkedSources: ['sellup', 'hubspot'],
      }),
      fetchActiveCandidates: async () => [],
    },
  };
}

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'technology',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '33333333-3333-4333-8333-333333333333',
  // Objetivo alto: que el objetivo no corte la rama antes de la segunda página.
  requestedTarget: 200,
};

function execution(pageCursor?: LushaPageCursorContext | null): LushaMultiBranchExecution {
  return {
    plan: {
      macroKey: 'technology',
      branches: [{ mainIndustryId: 4, subIndustryId: null, label: 'Technology' }],
    },
    targetGap: 200,
    creditsReserved: 2,
    ...(pageCursor !== undefined ? { pageCursor } : {}),
  };
}

function paid(branchIndex: number, pageIndex: number): LushaPageHistoryRow {
  return { branchIndex, pageIndex, state: 'succeeded', resultsReturned: 25 };
}

async function run(pageCursor?: LushaPageCursorContext | null) {
  const { deps, calls } = recordingDeps();
  const res = await persistLushaPendingReviewBatch(
    deps,
    INPUT,
    ACTOR,
    undefined,
    execution(pageCursor),
  );
  return { res, calls };
}

describe('§ 1 — el ejecutor con el cursor cargado', () => {
  it('🔴 el caso del 22/23-09: pagadas 0 y 1 ⇒ esta corrida pide la 2 y la 3', async () => {
    const { calls } = await run({ status: 'loaded', history: [paid(0, 0), paid(0, 1)] });
    assert.deepEqual(
      calls.map((c) => c.page),
      [2, 3],
    );
  });

  it('🔴 la valla durable recibe la página REAL, no el desplazamiento', async () => {
    const { calls } = await run({ status: 'loaded', history: [paid(0, 0), paid(0, 1)] });
    assert.deepEqual(
      calls.map((c) => c.coordinates),
      [
        { branchIndex: 0, page: 2 },
        { branchIndex: 0, page: 3 },
      ],
    );
  });

  it('autoriza el techo del cursor en cada petición', async () => {
    const { calls } = await run({ status: 'loaded', history: [paid(0, 0), paid(0, 1)] });
    for (const call of calls)
      assert.equal(call.authorizedMaxPage, LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX);
  });

  it('no pide MÁS páginas que sin cursor: el número por corrida no cambia', async () => {
    const withCursor = await run({ status: 'loaded', history: [paid(0, 0), paid(0, 1)] });
    const without = await run();
    assert.equal(withCursor.calls.length, without.calls.length);
  });

  it('la telemetría y la observación por página registran la página real', async () => {
    const { res } = await run({ status: 'loaded', history: [paid(0, 0), paid(0, 1)] });
    assert.ok(res.multiBranch);
    assert.deepEqual(
      (res.multiBranch.pageRequests ?? []).map((r) => r.page),
      [2, 3],
    );
    const meta = toLushaRunTelemetryMetadata(res.multiBranch);
    const cursor = meta['page_cursor'] as {
      status: string;
      decisions: { branch_index: number; start_page: number; reason: string }[];
    };
    assert.equal(cursor.status, 'loaded');
    assert.deepEqual(cursor.decisions, [
      {
        branch_index: 0,
        start_page: 2,
        reason: 'next_unconsumed_page',
        last_consumed_page: 1,
        consumed_pages: 2,
      },
    ]);
  });

  it('historial cargado pero vacío ⇒ página 0, con la decisión registrada', async () => {
    const { res, calls } = await run({ status: 'loaded', history: [] });
    assert.deepEqual(
      calls.map((c) => c.page),
      [0, 1],
    );
    const meta = toLushaRunTelemetryMetadata(res.multiBranch!);
    const cursor = meta['page_cursor'] as { decisions: { reason: string }[] };
    assert.equal(cursor.decisions[0]!.reason, 'no_history');
  });
});

describe('§ 2 — sin cursor, el comportamiento de siempre', () => {
  const cases: [string, LushaPageCursorContext | null | undefined][] = [
    ['sin contexto', undefined],
    ['contexto nulo', null],
    ['bandera apagada', { status: 'disabled' }],
    ['historial ilegible', { status: 'history_unavailable', reason: 'boom' }],
  ];
  for (const [label, ctx] of cases) {
    it(`${label} ⇒ páginas 0 y 1, sin techo nuevo`, async () => {
      const { calls } = await run(ctx);
      assert.deepEqual(
        calls.map((c) => c.page),
        [0, 1],
      );
      for (const call of calls) assert.equal(call.hasAuthorizedMaxPage, false);
    });
  }

  it('historial ilegible queda a la vista en la telemetría, con su motivo', async () => {
    const { res } = await run({ status: 'history_unavailable', reason: 'boom' });
    const meta = toLushaRunTelemetryMetadata(res.multiBranch!);
    assert.deepEqual(meta['page_cursor'], {
      status: 'history_unavailable',
      reason: 'boom',
      decisions: [],
    });
  });

  it('bandera apagada ⇒ `page_cursor.status = disabled`', async () => {
    const { res } = await run();
    const meta = toLushaRunTelemetryMetadata(res.multiBranch!);
    assert.equal((meta['page_cursor'] as { status: string }).status, 'disabled');
  });
});

describe('§ 3 — el techo de página lo autoriza el servidor, acotado', () => {
  it('sin techo autorizado la página se recorta a 1, como siempre', () => {
    assert.equal(clampLushaPreviewPage(2), LUSHA_PREVIEW_MAX_PAGE);
    assert.equal(clampLushaPreviewPage(2, null), LUSHA_PREVIEW_MAX_PAGE);
  });

  it('con el techo del cursor, la página 2 pasa', () => {
    assert.equal(clampLushaPreviewPage(2, LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX), 2);
  });

  it('🔴 un techo absurdo no pasa del tope del cursor', () => {
    assert.equal(resolveLushaAuthorizedMaxPage(10_000), LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX);
    assert.equal(clampLushaPreviewPage(500, 10_000), LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX);
  });

  it('un techo inválido o menor vuelve al de siempre', () => {
    for (const value of [Number.NaN, 2.5, -3, 0]) {
      assert.equal(resolveLushaAuthorizedMaxPage(value), LUSHA_PREVIEW_MAX_PAGE, String(value));
    }
  });

  it('la petición construida lleva la página autorizada', () => {
    const base: BuildLushaPreviewRequestInput = {
      countryName: 'Colombia',
      mainIndustriesIds: [4],
      subIndustryId: null,
    };
    assert.equal(buildLushaPreviewRequest({ ...base, page: 3 }).pagination?.page, 1);
    assert.equal(
      buildLushaPreviewRequest({
        ...base,
        page: 3,
        authorizedMaxPage: LUSHA_PAGE_CURSOR_MAX_PAGE_INDEX,
      }).pagination?.page,
      3,
    );
  });
});

describe('§ 4 — el contexto del cursor falla hacia el comportamiento anterior', () => {
  const base = {
    signatureVersion: 'v1',
    signatureHash: 'ba24968a63',
    operationId: 'op-actual',
  };

  it('bandera apagada ⇒ `disabled` y NO se lee el historial', async () => {
    let loads = 0;
    const ctx = await resolveLushaPageCursorContext({
      ...base,
      enabled: false,
      loadHistory: async () => {
        loads++;
        return [];
      },
    });
    assert.deepEqual(ctx, { status: 'disabled' });
    assert.equal(loads, 0);
  });

  it('bandera encendida ⇒ lee por firma y excluye la operación en curso', async () => {
    const queries: unknown[] = [];
    const ctx = await resolveLushaPageCursorContext({
      ...base,
      enabled: true,
      loadHistory: async (query) => {
        queries.push(query);
        return [paid(0, 0)];
      },
    });
    assert.deepEqual(queries, [
      { signatureVersion: 'v1', signatureHash: 'ba24968a63', excludeOperationId: 'op-actual' },
    ]);
    assert.equal(ctx.status, 'loaded');
  });

  it('🔴 la lectura falla ⇒ `history_unavailable`, nunca una excepción', async () => {
    const ctx = await resolveLushaPageCursorContext({
      ...base,
      enabled: true,
      loadHistory: async () => {
        throw new Error('permission denied for table lusha_prospecting_request_fence');
      },
    });
    assert.equal(ctx.status, 'history_unavailable');
    assert.match((ctx as { reason: string }).reason, /permission denied/);
  });

  it('sin firma ⇒ `history_unavailable` sin leer', async () => {
    let loads = 0;
    const ctx = await resolveLushaPageCursorContext({
      ...base,
      signatureHash: null,
      enabled: true,
      loadHistory: async () => {
        loads++;
        return [];
      },
    });
    assert.deepEqual(ctx, { status: 'history_unavailable', reason: 'signature_missing' });
    assert.equal(loads, 0);
  });
});

describe('§ 5 — el navegador no puede mover el techo; la acción lo cablea tras la bandera', () => {
  const root = path.resolve(__dirname, '../../../..');
  const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

  function schemaBody(source: string, name: string): string {
    const start = source.indexOf(`const ${name} = z.object(`);
    assert.ok(start >= 0, `${name} existe`);
    const end = source.indexOf('});', start);
    return source.slice(start, end);
  }

  it('🔴 ningún esquema de entrada declara `authorizedMaxPage` ni `page`, ni deja pasar claves', () => {
    for (const [file, schema] of [
      ['src/modules/prospect-batches/lusha-pending-review-actions.ts', 'GenerateInputSchema'],
      ['src/modules/prospect-batches/lusha-preview-actions.ts', 'PreviewInputSchema'],
    ] as const) {
      const body = schemaBody(read(file), schema);
      assert.equal(
        body.includes('authorizedMaxPage'),
        false,
        `${schema} declara authorizedMaxPage`,
      );
      assert.equal(/\bpage\s*:/.test(body), false, `${schema} declara page`);
      assert.equal(body.includes('passthrough'), false, `${schema} usa passthrough`);
    }
  });

  it('la acción resuelve el cursor con la bandera y lo entrega al ejecutor', () => {
    const source = read('src/modules/prospect-batches/lusha-pending-review-actions.ts');
    assert.match(source, /enabled:\s*isAgent1LushaPageCursorEnabled\(\)/);
    assert.match(source, /loadHistory:\s*\(query\)\s*=>\s*loadLushaPageHistory\(query\)/);
    assert.match(source, /signatureHash:\s*args\.operationSignatureHash/);
    const resolveAt = source.indexOf('resolveLushaPageCursorContext({');
    const persistAt = source.indexOf('persistLushaPendingReviewBatch(', resolveAt);
    assert.ok(resolveAt > 0 && persistAt > resolveAt, 'el cursor se resuelve antes de ejecutar');
    // El contexto viaja en la ejecución (5.º argumento) de ESA llamada.
    const handoffAt = source.indexOf('pageCursor,', persistAt);
    const nextFunctionAt = source.indexOf('\nasync function ', persistAt);
    assert.ok(handoffAt > persistAt, 'la ejecución lleva `pageCursor`');
    assert.ok(nextFunctionAt < 0 || handoffAt < nextFunctionAt, 'y dentro de la misma función');
  });

  it('la bandera nace APAGADA: sólo `true` explícito la enciende', () => {
    const previous = process.env[AGENT1_LUSHA_PAGE_CURSOR_FLAG];
    try {
      delete process.env[AGENT1_LUSHA_PAGE_CURSOR_FLAG];
      assert.equal(isAgent1LushaPageCursorEnabled(), false);
      for (const value of ['', 'false', '0', 'off', 'si']) {
        process.env[AGENT1_LUSHA_PAGE_CURSOR_FLAG] = value;
        assert.equal(isAgent1LushaPageCursorEnabled(), false, value);
      }
      process.env[AGENT1_LUSHA_PAGE_CURSOR_FLAG] = 'true';
      assert.equal(isAgent1LushaPageCursorEnabled(), true);
    } finally {
      if (previous === undefined) delete process.env[AGENT1_LUSHA_PAGE_CURSOR_FLAG];
      else process.env[AGENT1_LUSHA_PAGE_CURSOR_FLAG] = previous;
    }
  });
});
