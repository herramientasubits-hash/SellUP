/**
 * AGENT1-PROVIDER-SEEN-MEMORY-3 — la memoria provider-seen, ENCENDIDA.
 *
 * El gate anterior dejó el esquema escrito y el runtime en no-op a propósito: § 13
 * exige aplicar la tabla ANTES de apuntar nada a ella. La migración 123 ya está en
 * Producción (`20260820153919`, tabla y RPC verificadas, 0 filas), así que aquí se
 * demuestra lo único que cambia —que el resolutor devuelve el store PERSISTENTE— y,
 * sobre todo, todo lo que NO puede cambiar con él encendido.
 *
 * 🔴 La pregunta que estas pruebas contestan no es «¿escribe?». Es «¿puede escribir
 * de más, cobrar de más, pedir de más o callarse un fallo?». Una memoria que ahorra
 * créditos y a cambio repite una petición pagada sería peor que no tenerla.
 *
 * 🔴 Datos SINTÉTICOS. Offline: sin red, sin DB, sin cliente de proveedor, 0
 * créditos. El doble de Supabase registra lo que se le pide y no abre conexión.
 */

import { describe, it } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type LushaMultiBranchExecution,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { buildProviderSeenMemory } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { normalizeExclusionDomain } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import { LUSHA_EXCLUSION_CAPABILITY } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { runPrePaidNoveltyGate } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import {
  CLIENT_UNAVAILABLE_PROVIDER_SEEN_STORE,
  NO_OP_PROVIDER_SEEN_STORE,
  PROVIDER_SEEN_LOAD_LIMIT,
  PROVIDER_SEEN_PERSISTENCE_STATUS,
  PROVIDER_SEEN_WRITE_SKIPPED_CLIENT_UNAVAILABLE,
  resolveProviderSeenStore,
  type ProviderSeenStore,
} from '../provider-seen-store';
import {
  createSupabaseProviderSeenStore,
  PROVIDER_SEEN_RECORD_RPC,
  PROVIDER_SEEN_TABLE,
} from '../provider-seen-supabase-store';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
const ROOT = path.resolve(__dirname, '../../../../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// ─── Doble de Supabase ────────────────────────────────────────────────────────

type RpcCall = { fn: string; args: Record<string, unknown> };
type QueryCall = { table: string; limit: number | null };

function createClientDouble(options: {
  rows?: unknown[] | null;
  selectError?: unknown;
  rpcError?: unknown;
  throwOn?: 'select' | 'rpc';
} = {}) {
  const rpcs: RpcCall[] = [];
  const queries: QueryCall[] = [];

  const client = {
    from(table: string) {
      const call: QueryCall = { table, limit: null };
      queries.push(call);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        async limit(value: number) {
          call.limit = value;
          if (options.throwOn === 'select') throw new Error('conexión caída');
          return { data: options.rows ?? null, error: options.selectError ?? null };
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (options.throwOn === 'rpc') throw new Error('conexión caída');
      return {
        data: options.rpcError
          ? null
          : { new_ids_recorded: 0, new_domains_recorded: 0, refreshed_count: 0 },
        error: options.rpcError ?? null,
      };
    },
  };

  return {
    store: createSupabaseProviderSeenStore(
      client as unknown as Parameters<typeof createSupabaseProviderSeenStore>[0],
    ),
    rpcs,
    queries,
  };
}

// ─── Arnés del ejecutor real ──────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
const ACTOR = { internalUserId: 'user-1' };

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa Sintetica',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function distinct(count: number, prefix: string, overrides: Partial<LushaPreviewCompany> = {}) {
  return Array.from({ length: count }, (_, i) =>
    company({
      providerCompanyId: `${prefix}-${i}`,
      name: `Sintetica ${prefix} ${i}`,
      domain: `${prefix}-${i}.example`,
      ...overrides,
    }),
  );
}

function successResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

/** 🔴 `results` POBLADO: si la validez se dedujera del tamaño, esto grabaría memoria. */
function failureResult(): LushaPreviewResult {
  return {
    ok: false,
    status: 'error',
    results: distinct(3, 'fantasma'),
    error: 'HTTP 429',
    billing: { creditsCharged: null, resultsReturned: null, expectedMaxCredits: 1 },
    warnings: [],
  } as unknown as LushaPreviewResult;
}

function exactDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'existing_in_sellup',
    confidence: 100,
    input,
    matches: [{ source: 'sellup', status: 'existing_in_sellup', confidence: 100, reason: 'domain' }],
    summary: 'duplicado',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function noDuplicate(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

type Harness = {
  deps: PersistLushaPendingReviewDeps;
  calls: number[];
  persistedNames: string[];
};

function makeHarness(
  script: LushaPreviewResult[],
  options: {
    checker?: (input: DuplicateCheckInput) => DuplicateCheckResult;
    activeDomains?: string[];
  } = {},
): Harness {
  const calls: number[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const persistedNames: string[] = [];

  return {
    calls,
    persistedNames,
    deps: {
      runSearch: async () => {
        calls.push(calls.length + 1);
        return script[calls.length - 1] ?? successResult([]);
      },
      insertBatch: async (row) => {
        batches.push(row);
        return { id: `batch-${batches.length}` };
      },
      // CUT-3B4-CORRECCIÓN — la valla es OBLIGATORIA; esta prueba modela la 126
      // SIN aplicar por la ÚNICA puerta legítima: la respuesta de la BASE.
      insertCandidatesFenced: preM126FencedInsert,
      insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
        persistedNames.push(...rows.map((r) => r.name));
        return { insertedCount: rows.length };
      },
      checkCompanyDuplicate: async (input) => (options.checker ?? noDuplicate)(input),
      fetchActiveCandidates: async (domains) =>
        (options.activeDomains ?? [])
          .filter((d) => domains.includes(d))
          .map((domain) => ({
            id: `active-${domain}`,
            name: domain,
            domain,
            normalizedName: domain,
            countryCode: 'CO',
            status: 'needs_review',
            batchId: 'batch-historico',
          })) as never,
    },
  };
}

/**
 * La opción de memoria del ejecutor, cableada al store PERSISTENTE — no a un doble
 * de conveniencia. Ésta es la diferencia entera de este hito: lo que antes se
 * demostraba contra un `record` de mentira ahora atraviesa el transporte real hasta
 * el RPC.
 */
function persistentProviderSeen(
  store: ProviderSeenStore,
  known: { ids?: string[]; domains?: string[] } = {},
): NonNullable<LushaMultiBranchExecution['providerSeen']> {
  return {
    memory: buildProviderSeenMemory([
      ...(known.ids ?? []).map((id) => ({ providerEntityId: id, normalizedDomain: null })),
      ...(known.domains ?? []).map((domain) => ({
        providerEntityId: null,
        normalizedDomain: domain,
      })),
    ]),
    record: (input) => store.record(input),
    now: () => '2026-08-20T10:00:00.000Z',
    correlationId: 'run-sintetica-1',
  };
}

function plan(count: 1 | 2): LushaMultiBranchExecution['plan'] {
  const branches = [
    { mainIndustryId: 11, label: 'Healthcare' },
    { mainIndustryId: 12, subIndustryId: 71, label: 'Pharmaceuticals Manufacturing' },
  ].slice(0, count);
  return { macroKey: 'health_pharma', branches };
}

/** Identidades que el RPC recibió, en orden. */
function recordedIds(rpcs: RpcCall[]): string[] {
  return rpcs.flatMap((call) =>
    (call.args.p_observations as Array<{ provider_entity_id: string | null; normalized_domain: string | null }>)
      .map((o) => o.provider_entity_id ?? `domain:${o.normalized_domain}`),
  );
}

// ─── 1/2 — el resolutor ───────────────────────────────────────────────────────

describe('§ 13 — el resolutor de Producción, ya encendido', () => {
  const KEYS = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VERCEL_ENV',
    'ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD',
  ] as const;

  function withEnv<T>(overrides: Partial<Record<(typeof KEYS)[number], string | undefined>>, run: () => T): T {
    const previous = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const key of KEYS) {
        const value = overrides[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      return run();
    } finally {
      for (const key of KEYS) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it('(1) con credencial segura devuelve el store PERSISTENTE, no un puerto vacío', () => {
    const store = withEnv(
      {
        // 🔴 Proyecto sintético a propósito: la factoría aprobada falla CERRADA si
        // un entorno que no es Producción resuelve al proyecto de Producción.
        NEXT_PUBLIC_SUPABASE_URL: 'https://proyecto-sintetico.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'clave-sintetica',
        VERCEL_ENV: undefined,
        ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD: undefined,
      },
      () => resolveProviderSeenStore(),
    );

    assert.notEqual(store, NO_OP_PROVIDER_SEEN_STORE, 'ya no es el puerto de «autoridad pendiente»');
    assert.notEqual(store, CLIENT_UNAVAILABLE_PROVIDER_SEEN_STORE, 'la credencial se construyó');
  });

  it('(1) sin credencial NO lanza: degrada, y con su propio motivo', async () => {
    const store = withEnv(
      {
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        VERCEL_ENV: undefined,
        ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD: undefined,
      },
      () => resolveProviderSeenStore(),
    );

    assert.equal(store, CLIENT_UNAVAILABLE_PROVIDER_SEEN_STORE);
    // 🔴 Y NO el motivo de «no hay tabla»: la tabla existe. Mandar a quien depure a
    // buscar una migración ya aplicada cuesta una tarde.
    const written = await store.record({ observations: [], correlationId: null, observedAt: 'x' });
    assert.equal(written.written, false);
    assert.equal(written.skippedReason, PROVIDER_SEEN_WRITE_SKIPPED_CLIENT_UNAVAILABLE);
    assert.deepEqual([...(await store.load({ provider: 'lusha', limit: 10 }))], []);
  });

  it('(2) «la tabla no existe» ya no es un supuesto válido: la 123 está aplicada', () => {
    assert.equal(PROVIDER_SEEN_PERSISTENCE_STATUS, 'schema_applied');

    const migrations = readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) =>
      f.toLowerCase().includes('provider_seen'),
    );
    assert.deepEqual(migrations, ['123_provider_seen_entities.sql']);
    const sql = read(`supabase/migrations/${migrations[0]}`);
    assert.ok(!sql.includes('APPLIED IN PRODUCTION: NO'));
    assert.ok(sql.includes('20260820153919'), 'con la versión EXACTA del ledger');
  });
});

// ─── 3-9 — lo que se recuerda, ahora contra el RPC real ───────────────────────

describe('§ 4 — con el store persistente, se recuerda todo lo pagado', () => {
  it('(3) una empresa RECHAZADA POR MACRO llega al RPC igualmente', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([successResult(distinct(3, 'offmacro', { industry: 'Construction' }))]);

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.ok(res.precisionRejectedTotal! > 0, 'la precisión rechazó');
    assert.equal(res.usefulCandidatesCount, 0, 'no se persistió ninguna');
    // 🔴 Y aun así las tres viajaron a la memoria: ése es el defecto que este
    // subsistema existe para cerrar.
    assert.deepEqual(recordedIds(rpcs), ['offmacro-0', 'offmacro-1', 'offmacro-2']);
    assert.equal(rpcs[0]!.fn, PROVIDER_SEEN_RECORD_RPC);
  });

  it('(4) un DUPLICADO EXACTO llega al RPC', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([successResult(distinct(4, 'dup'))], { checker: exactDuplicate });

    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.deepEqual(recordedIds(rpcs), ['dup-0', 'dup-1', 'dup-2', 'dup-3']);
    assert.deepEqual(harness.persistedNames, []);
  });

  it('(5) un CANDIDATO HISTÓRICO ACTIVO llega al RPC', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([successResult(distinct(2, 'hist'))], {
      activeDomains: ['hist-0.example', 'hist-1.example'],
    });

    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.deepEqual(recordedIds(rpcs), ['hist-0', 'hist-1']);
  });

  it('(6) el SOBRANTE de objetivo llega al RPC', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([successResult(distinct(5, 'over'))]);

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 2,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(res.usefulCandidatesCount, 2, 'el objetivo exacto se respeta');
    // Las 5 se pagaron; las 5 se recuerdan. Recordar sólo las aceptadas repetiría el
    // defecto en otra capa.
    assert.equal(recordedIds(rpcs).length, 5);
  });

  it('(7) una empresa SIN dominio se recuerda por su id', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([
      successResult([company({ providerCompanyId: 'v1.solo-id', name: 'Sin Web', domain: null })]),
    ]);

    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    const observations = rpcs[0]!.args.p_observations as Array<Record<string, unknown>>;
    assert.equal(observations[0]!.provider_entity_id, 'v1.solo-id');
    assert.equal(observations[0]!.normalized_domain, null);
  });

  it('(8) sin llamada al proveedor NO hay RPC', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([successResult([])]);

    await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(harness.calls.length, 1, 'la petición se emitió y volvió vacía');
    assert.equal(rpcs.length, 0, 'una respuesta válida y vacía no tiene identidad que guardar');
  });

  it('(9) una respuesta INVÁLIDA no escribe, ni con cuerpo poblado', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([failureResult()]);

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(res.ok, false);
    assert.equal(harness.calls.length, 1);
    assert.equal(rpcs.length, 0, 'un error no es «cero empresas»: es ninguna información');
  });
});

// ─── 10 — el fallo de escritura ───────────────────────────────────────────────

describe('§ 3 — un fallo de memoria no vuelve a pagar', () => {
  /**
   * 🔴 El número de peticiones NO se afirma en crudo: cuántas páginas compra una
   * rama es asunto de #310 y depende de la novedad, no de la memoria. Lo que hay que
   * demostrar es que el fallo de escritura no AÑADE ni una. Así que se corre dos
   * veces el MISMO guion —una con la memoria sana y otra con la memoria rota— y se
   * comparan. Fijar «1 petición» habría puesto esta prueba en rojo el día que el
   * ejecutor cambiara de paginación por motivos que no tienen nada que ver con esto.
   */
  async function runWith(store: ProviderSeenStore) {
    const harness = makeHarness([successResult(distinct(3, 'ok'))]);
    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });
    return { harness, res };
  }

  it('(10) el RPC falla ⇒ NO se repite la petición al proveedor, y se reporta', async () => {
    const sana = createClientDouble();
    const rota = createClientDouble({ rpcError: { message: 'permission denied' } });

    const control = await runWith(sana.store);
    const fallo = await runWith(rota.store);

    assert.equal(
      fallo.harness.calls.length,
      control.harness.calls.length,
      '🔴 el fallo de memoria no provoca ni una petición más al proveedor',
    );
    assert.equal(rota.rpcs.length, sana.rpcs.length, 'y tampoco reintenta la escritura');
    assert.equal(fallo.res.ok, true, 'la página ya estaba pagada: no se pierde lo comprado');
    assert.equal(fallo.res.usefulCandidatesCount, control.res.usefulCandidatesCount);

    // 🔴 Y no se calla: sin este contador, «0 nuevas» es indistinguible de «no se
    // guardó nada», y la memoria podría estar rota durante semanas pareciendo
    // simplemente aburrida.
    const summary = fallo.res.multiBranch!.providerSeen!;
    assert.ok(summary.writeFailures > 0, 'el fallo queda contado');
    assert.equal(summary.lastWriteSkippedReason, 'persistence_error');
    assert.equal(summary.newIdsRecorded, 0);
    assert.equal(control.res.multiBranch!.providerSeen!.writeFailures, 0, 'y sólo cuando lo hay');
  });

  it('(10) el transporte revienta ⇒ mismo desenlace, sin excepción que suba', async () => {
    const sana = createClientDouble();
    const rota = createClientDouble({ throwOn: 'rpc' });

    const control = await runWith(sana.store);
    const fallo = await runWith(rota.store);

    assert.equal(fallo.harness.calls.length, control.harness.calls.length);
    assert.equal(fallo.res.ok, true);
    // El store atrapa la excepción y la convierte en un motivo; nunca sube al
    // ejecutor, así que su `catch` no llega a marcarse.
    assert.ok(fallo.res.multiBranch!.providerSeen!.writeFailures > 0);
    assert.equal(
      fallo.res.multiBranch!.providerSeen!.lastWriteSkippedReason,
      'persistence_error',
    );
  });

  it('una escritura correcta deja el contador de fallos en 0', async () => {
    const { store } = createClientDouble();
    const harness = makeHarness([successResult(distinct(2, 'ok'))]);

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(res.multiBranch!.providerSeen!.writeFailures, 0);
    assert.equal(res.multiBranch!.providerSeen!.lastWriteSkippedReason, null);
  });
});

// ─── 11/14 — la carga, y lo que NO toca ───────────────────────────────────────

describe('§ 6 — la carga alimenta la exclusión y nada más', () => {
  const GATE_INPUT = {
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    requestedTarget: 10,
    provider: 'lusha' as const,
  };

  it('(11) una lectura ROTA degrada a memoria vacía y al gasto de siempre', async () => {
    const { store } = createClientDouble({ throwOn: 'select' });
    const roto = await runPrePaidNoveltyGate(GATE_INPUT, { providerSeenStore: store });

    assert.equal(roto.providerSeen.loaded, false);
    assert.deepEqual([...roto.providerExclusionPlan.domains.sent], []);

    // 🔴 La comparación que importa: el resultado tiene que ser el MISMO que sin
    // memoria. Una memoria ilegible no puede cambiar ni un crédito.
    const sinMemoria = await runPrePaidNoveltyGate(GATE_INPUT, {});
    assert.equal(roto.context.residualGap, sinMemoria.context.residualGap);
    assert.equal(roto.context.providerRequired, sinMemoria.context.providerRequired);
    assert.deepEqual(
      [...roto.providerExclusionPlan.domains.sent],
      [...sinMemoria.providerExclusionPlan.domains.sent],
    );
  });

  it('(14) lo YA VISTO no recorta el hueco: visto no es nuestro', async () => {
    const { store } = createClientDouble({
      rows: Array.from({ length: 6 }, (_, i) => ({
        provider: 'lusha',
        provider_entity_type: 'company',
        provider_entity_id: `v1.vista-${i}`,
        normalized_domain: `vista-${i}.example`,
        first_seen_at: '2026-08-01T00:00:00.000Z',
        last_seen_at: '2026-08-10T00:00:00.000Z',
        first_seen_correlation: null,
        last_seen_correlation: null,
      })),
    });

    const conMemoria = await runPrePaidNoveltyGate(GATE_INPUT, { providerSeenStore: store });
    const sinMemoria = await runPrePaidNoveltyGate(GATE_INPUT, {});

    assert.equal(conMemoria.providerSeen.loaded, true);
    assert.equal(conMemoria.providerSeen.domainsAvailable, 6);

    // 🔴 6 empresas conocidas por el proveedor y el hueco NO baja ni una: una
    // empresa que Lusha ya nos mostró y que rechazamos NO es una empresa nuestra.
    // Restarla del objetivo entregaría menos de lo que la usuaria pidió.
    assert.equal(conMemoria.context.residualGap, sinMemoria.context.residualGap);
    assert.equal(conMemoria.context.residualGap, GATE_INPUT.requestedTarget);
    assert.equal(conMemoria.context.acceptedBeforeProvider, 0);

    // Lo que sí cambia —y lo único— es la pista de exclusión.
    assert.equal(conMemoria.providerExclusionPlan.domains.sent.length, 6);
    assert.equal(sinMemoria.providerExclusionPlan.domains.sent.length, 0);
  });

  it('(5 del enunciado) la normalización de dominio es la MISMA al escribir, al leer y al enviar', async () => {
    // La tabla guarda ya normalizado (CHECK que espeja `normalizeExclusionDomain`),
    // así que la lectura es verbatim y el envío vuelve a pasar por la misma función.
    // La propiedad que hay que demostrar es que ese segundo paso es IDEMPOTENTE: si
    // no lo fuera, el dominio que viaja no sería el que está guardado y la exclusión
    // sería memoria inerte —nunca coincidiría con nada.
    const guardados = ['vista-0.example', 'clinica-andes.com.co', 'sub.dominio.example'];
    for (const domain of guardados) {
      assert.equal(normalizeExclusionDomain(domain), domain, `${domain} no es un punto fijo`);
    }

    const { store } = createClientDouble({
      rows: guardados.map((domain, i) => ({
        provider: 'lusha',
        provider_entity_type: 'company',
        provider_entity_id: `v1.x-${i}`,
        normalized_domain: domain,
        first_seen_at: '2026-08-01T00:00:00.000Z',
        last_seen_at: '2026-08-10T00:00:00.000Z',
        first_seen_correlation: null,
        last_seen_correlation: null,
      })),
    });

    const gate = await runPrePaidNoveltyGate(GATE_INPUT, { providerSeenStore: store });
    assert.deepEqual([...gate.providerExclusionPlan.domains.sent].sort(), [...guardados].sort());
  });

  it('la carga sigue ACOTADA: una memoria sin cota encarecería lo gratuito', async () => {
    const { store, queries } = createClientDouble({ rows: [] });
    await runPrePaidNoveltyGate(GATE_INPUT, { providerSeenStore: store });

    assert.equal(queries.length, 1);
    assert.equal(queries[0]!.table, PROVIDER_SEEN_TABLE);
    assert.equal(queries[0]!.limit, PROVIDER_SEEN_LOAD_LIMIT);
  });
});

// ─── 12/13/15/16/17/18 — lo que encender no puede haber tocado ────────────────

const PROVIDER_SEEN_SOURCES = [
  ...readdirSync(path.join(ROOT, 'src/modules/prospect-batches/provider-seen'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `src/modules/prospect-batches/provider-seen/${f}`),
  ...readdirSync(path.join(ROOT, 'src/server/prospect-batches/provider-seen'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `src/server/prospect-batches/provider-seen/${f}`),
];

test('(12) M121 intacta: encender la memoria no la acerca a la liquidación', () => {
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of [
      'settleReservationObservably',
      'wizard_budget_reservations',
      'wizard_monthly_budget_periods',
      'creditsReserved',
      'creditsConsumed',
    ]) {
      assert.ok(!code.includes(needle), `${rel} alcanza la autoridad económica (${needle})`);
    }
  }
});

test('(13) `provider_usage_logs` intacta: la memoria no es observabilidad de gasto', () => {
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of ['provider_usage_logs', 'logProviderUsage', 'billing_state', 'usage_key']) {
      assert.ok(!code.includes(needle), `${rel} escribe uso de proveedor (${needle})`);
    }
  }
});

test('(15) el store no puede alcanzar un cliente de proveedor ni la red', () => {
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of [
      'executeLushaPreview',
      'buildLushaPreviewRequest',
      'lusha-preview',
      'apollo-client',
      'getLushaApiKey',
      'getApolloApiKey',
      'fetch(',
      'axios',
    ]) {
      assert.ok(!code.includes(needle), `${rel} alcanza un proveedor (${needle})`);
    }
  }
});

test('(16) ninguna escritura a HubSpot: la memoria no toca el CRM', () => {
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    // 🔴 Se buscan superficies de ESCRITURA y de API, no la palabra «hubspot»: el
    // planificador de exclusión nombra `hubspotLocalDomains`, que es una PROCEDENCIA
    // de dominios YA locales —lo contrario de tocar el CRM— y prohibir la palabra
    // convertiría esta guarda en un falso positivo permanente.
    for (const needle of [
      'crm/v3',
      'hubspotClient',
      'getHubspotClient',
      'createHubspotContact',
      'createHubspotCompany',
      'upsertHubspot',
      'HUBSPOT_ACCESS_TOKEN',
      'HUBSPOT_API',
      'api.hubapi.com',
    ]) {
      assert.ok(!code.includes(needle), `${rel} toca HubSpot (${needle})`);
    }
  }
});

test('(17) `supportsIdExclusion` sigue en false: el contrato de Lusha está CONGELADO', () => {
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.supportsIdExclusion, false);
  assert.equal(LUSHA_EXCLUSION_CAPABILITY.idCap, 0);
  assert.equal(
    LUSHA_EXCLUSION_CAPABILITY.idExclusionUnsupportedReason,
    'lusha_exclude_ids_contract_unconfirmed',
  );

  // 🔴 Y la petición real sigue emitiendo SÓLO dominios. Encender la memoria da MÁS
  // ids que nunca —es justo lo que la tabla guarda— y ésa es exactamente la razón
  // por la que esta guarda importa más hoy que ayer: la tentación de enviarlos
  // existe por primera vez.
  const preview = stripTsComments(read('src/server/prospect-batches/lusha-preview.ts'));
  assert.ok(preview.includes('exclude: { domains: excludeDomains }'));
  for (const forbidden of ['exclude.ids', 'exclude: { ids', 'excludeIds', 'excludeCompanyIds']) {
    assert.ok(!preview.includes(forbidden), `contrato de ids roto (${forbidden})`);
  }
});

test('(18) ningún supuesto nuevo sobre backfill, paginación o topes del proveedor', () => {
  for (const rel of PROVIDER_SEEN_SOURCES) {
    const code = stripTsComments(read(rel));
    for (const needle of ['backfill', 'maxExcludeIds', 'EXCLUDE_IDS_LIMIT', 'chunkSize', 'CHUNK_SIZE']) {
      assert.ok(!code.includes(needle), `${rel} inventa un supuesto de contrato (${needle})`);
    }
    // Los únicos números de tres cifras permitidos siguen siendo los DECLARADOS.
    for (const match of code.matchAll(/(?<![\w.])(\d{3,})(?![\w.])/g)) {
      assert.ok(
        new Set(['100', '500']).has(match[1]!),
        `${rel} introduce un límite sin declarar: ${match[1]}`,
      );
    }
  }
});

// ─── 19/20/21 — los hitos anteriores, con la memoria encendida ────────────────

describe('§§ 7, 8 — encender la memoria no degrada lo ya mergeado', () => {
  it('(19) #306 intacto: el objetivo EXACTO se sigue respetando', async () => {
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([successResult(distinct(6, 'exact'))]);

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 3,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(res.usefulCandidatesCount, 3, 'ni una más que el objetivo');
    assert.equal(harness.persistedNames.length, 3);
    // Y las 6 pagadas se recordaron: aceptar 3 no es haber visto 3.
    assert.equal(recordedIds(rpcs).length, 6);
  });

  it('(20) #302 intacto: el duplicado entre RAMAS se sigue eliminando', async () => {
    const shared = company({
      providerCompanyId: 'v1.compartida',
      name: 'Compartida',
      domain: 'compartida.example',
    });
    const { store, rpcs } = createClientDouble();
    const harness = makeHarness([
      successResult([shared, ...distinct(1, 'a')]),
      successResult([shared, ...distinct(1, 'b')]),
    ]);

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(2),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(res.crossBranchDuplicatesRemoved, 1);
    assert.equal(res.usefulCandidatesCount, 3, 'la compartida cuenta UNA vez');
    // 🔴 Pero la memoria la ve las DOS veces: recordar es anterior al dedupe, y el
    // dedupe local sigue siendo la única autoridad sobre qué se persiste.
    assert.equal(recordedIds(rpcs).filter((id) => id === 'v1.compartida').length, 2);
  });

  it('(21) #310 intacto: una página sin novedad útil para la rama', async () => {
    const { store } = createClientDouble();
    // Página 1 entera duplicada ⇒ 0 novedad útil ⇒ la rama no compra su página 2.
    const harness = makeHarness([successResult(distinct(3, 'seca')), successResult(distinct(3, 'b'))], {
      checker: exactDuplicate,
    });

    const res = await persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, {
      plan: plan(1),
      targetGap: 5,
      providerSeen: persistentProviderSeen(store),
    });

    assert.equal(harness.calls.length, 1, 'la segunda página NO se compró');
    assert.equal(res.usefulCandidatesCount, 0);
  });
});
