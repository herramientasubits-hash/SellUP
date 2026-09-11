/**
 * AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — escritor de disposiciones de Lusha.
 *
 * Cubre los nueve requisitos del alcance:
 *   1. `source_primary = 'lusha'`.
 *   2. nunca lanza ante un error de la base.
 *   3. `records` vacío ⇒ no escribe.
 *   4. deduplicación DENTRO del payload.
 *   5. `ON CONFLICT DO NOTHING` (`ignoreDuplicates: true`).
 *   6. NUNCA `ON CONFLICT DO UPDATE`.
 *   7. conserva la evidencia.
 *   8. conserva `round_origin`.
 *   9. cuenta las colisiones.
 *
 * Y el TEST CRÍTICO DE COLISIÓN: Apollo y Lusha comparten `batch_id`, así que
 * una fila que Apollo ya escribió NO puede ser reescrita por Lusha.
 *
 * `@supabase/supabase-js` se sustituye por un doble que es la superficie de
 * base de datos COMPLETA alcanzable: cero red, cero proveedor, cero
 * presupuesto.
 *
 * Run: node --import tsx --experimental-test-module-mocks --test <this file>
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  persistLushaRejectedDispositions,
  type LushaDiscardRecordLike,
  type LushaDiscardWriterClientFactory,
} from '../lusha-pipeline-writer.server';

interface UpsertCall {
  table: string;
  payload: Record<string, unknown>[];
  options: { onConflict?: string; ignoreDuplicates?: boolean };
}

let upsertCalls: UpsertCall[] = [];
let upsertShouldFail = false;
/** Filas ya presentes en la tabla, por `source_key`. Modelan DO NOTHING. */
let existingSourceKeys = new Set<string>();
/** `.select()` devuelve `null` sin error — el caso indeterminado. */
let selectReturnsNull = false;
/** Registro de lo que la tabla contiene, para probar que nada se sobrescribe. */
let storedRows: Record<string, Record<string, unknown>> = {};

function resetSpy(): void {
  upsertCalls = [];
  upsertShouldFail = false;
  existingSourceKeys = new Set<string>();
  selectReturnsNull = false;
  storedRows = {};
}

/**
 * 🔴 CUT-C.2 — el doble de base de datos entra por INYECCIÓN, no por
 * `mock.module`.
 *
 * Este fichero mockeaba `@supabase/supabase-js` con `{ namedExports }`. Esa API
 * NO se aplica en Node 24 —la versión del runner de CI—, así que el cliente REAL
 * se construía y salía a la red contra `fake.supabase.local`: 15 pruebas en rojo
 * con `getaddrinfo EAI_AGAIN`, ninguna por un defecto del código. Mientras el
 * fichero no estuvo en CI el problema fue invisible; al entrar, dejó de serlo.
 *
 * `LushaDiscardWriterClientFactory` es la costura que el escritor YA exponía
 * exactamente para esto. Con ella el mismo doble funciona en Node 20 y en 24, y
 * las variables de entorno de Supabase dejan de hacer falta.
 */
function makeClientFactory(): LushaDiscardWriterClientFactory {
  return () => ({
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>[], options: Record<string, unknown>) => {
        upsertCalls.push({ table, payload, options });
        // El doble modela ON CONFLICT DO NOTHING: una fila cuya `source_key`
        // ya existe NO se inserta y NO se altera.
        const inserted: Record<string, unknown>[] = [];
        for (const row of payload) {
          const key = String(row.source_key);
          if (options.ignoreDuplicates === true && existingSourceKeys.has(key)) continue;
          if (!existingSourceKeys.has(key)) {
            existingSourceKeys.add(key);
            storedRows[key] = row;
          } else {
            // Sólo alcanzable con DO UPDATE — el defecto que este archivo veta.
            storedRows[key] = row;
          }
          inserted.push({ id: `row-${key}` });
        }
        return {
          select: () =>
            upsertShouldFail
              ? Promise.resolve({ data: null, error: { message: 'simulated DB failure' } })
              : Promise.resolve({ data: selectReturnsNull ? null : inserted, error: null }),
        };
      },
    }),
  }) as unknown as ReturnType<LushaDiscardWriterClientFactory>;
}

const BATCH_ID = '99999999-9999-4999-8999-999999999999';

function record(overrides: Partial<LushaDiscardRecordLike> = {}): LushaDiscardRecordLike {
  return {
    name: 'Clínica Andes',
    domain: 'clinicaandes.com',
    providerCompanyId: 'pc-1',
    linkedinUrl: 'https://linkedin.com/company/clinicaandes',
    industry: 'Hospitals & Clinics',
    countryCode: 'CO',
    disposition: 'sellup_duplicate',
    reasonCode: null,
    reasonDetail: 'ya existe como candidato activo',
    roundOrigin: 'lusha_branch_0_page_0',
    evidence: { discard_kind: 'active_candidate_guard', branch_index: 0, page: 0 },
    ...overrides,
  };
}

/** § CUT-C.2 — identidad de corrida exigida por el escritor. */
const WIZARD_RUN_ID = 'wizard-run-fixture-1';
const CLIENT_REQUEST_ID = 'client-request-fixture-1';

const baseInput = (records: LushaDiscardRecordLike[]) => ({
  batchId: BATCH_ID,
  wizardRunId: WIZARD_RUN_ID,
  clientRequestId: CLIENT_REQUEST_ID,
  requestedCountryCode: 'CO',
  requestedIndustry: 'health_pharma',
  records,
  clientFactory: makeClientFactory(),
});

describe('persistLushaRejectedDispositions', () => {
  beforeEach(resetSpy);

  // ── 1 ──
  it('escribe `source_primary = "lusha"` en cada fila', async () => {
    const res = await persistLushaRejectedDispositions(
      baseInput([
        record({ name: 'A', domain: 'a.com', providerCompanyId: 'pc-a' }),
        record({ name: 'B', domain: 'b.com', providerCompanyId: 'pc-b' }),
      ]),
    );
    assert.equal(res.attempted, 2);
    assert.equal(res.persisted, 2);
    assert.equal(res.failed, 0);
    assert.equal(upsertCalls.length, 1);
    assert.equal(upsertCalls[0].table, 'prospect_discarded_dispositions');
    for (const row of upsertCalls[0].payload) {
      assert.equal(row.source_primary, 'lusha');
      assert.equal(row.batch_id, BATCH_ID);
    }
  });

  // ── 2 ──
  it('NO lanza cuando la base falla; lo reporta en el resumen', async () => {
    upsertShouldFail = true;
    const res = await persistLushaRejectedDispositions(baseInput([record()]));
    assert.equal(res.failed, 1);
    assert.equal(res.persisted, 0);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /simulated DB failure/);
  });

  it('NO lanza cuando faltan las credenciales de servicio', async () => {
    // 🔴 Esta prueba —y SÓLO ésta— corre SIN `clientFactory`: es el único camino
    // que ejercita `getAdminClient()`, que es justo lo que aquí se prueba. Con el
    // doble inyectado el cliente real nunca se construye y no habría credenciales
    // que faltar.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const { clientFactory: _omitted, ...withoutFactory } = baseInput([record()]);
      void _omitted;
      const res = await persistLushaRejectedDispositions(withoutFactory);
      assert.equal(res.persisted, 0);
      assert.equal(res.errors.length, 1);
      assert.equal(upsertCalls.length, 0);
    } finally {
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });

  // ── 3 ──
  it('`records` vacío ⇒ no toca la base en absoluto', async () => {
    const res = await persistLushaRejectedDispositions(baseInput([]));
    assert.equal(res.attempted, 0);
    assert.equal(res.persisted, 0);
    assert.equal(upsertCalls.length, 0);
  });

  it('un registro sin nombre utilizable se salta y se cuenta', async () => {
    const res = await persistLushaRejectedDispositions(
      baseInput([record({ name: '   ' }), record({ name: 'Real', domain: 'real.com', providerCompanyId: 'pc-r' })]),
    );
    assert.equal(res.skippedWithoutName, 1);
    assert.equal(res.attempted, 1);
    assert.equal(upsertCalls[0].payload.length, 1);
    assert.equal(upsertCalls[0].payload[0].name, 'Real');
  });

  // ── 4 ──
  it('deduplica DENTRO del payload y conserva el PRIMER registro', async () => {
    const res = await persistLushaRejectedDispositions(
      baseInput([
        record({ name: 'Primera', disposition: 'sellup_duplicate', reasonDetail: 'gana' }),
        record({ name: 'Segunda', disposition: 'target_cap_reached', reasonDetail: 'pierde' }),
      ]),
    );
    assert.equal(res.dedupedWithinPayload, 1);
    assert.equal(res.attempted, 1);
    assert.equal(upsertCalls[0].payload.length, 1);
    // Gana el primero: el desenlace más temprano de la corrida.
    assert.equal(upsertCalls[0].payload[0].name, 'Primera');
    assert.equal(upsertCalls[0].payload[0].disposition, 'sellup_duplicate');
    assert.equal(upsertCalls[0].payload[0].reason_detail, 'gana');
  });

  it('la clave de idempotencia es la COMPARTIDA (dominio > proveedor > nombre)', async () => {
    await persistLushaRejectedDispositions(
      baseInput([
        record({ name: 'Con dominio', domain: 'Acme.COM ', providerCompanyId: 'pc-x' }),
        record({ name: 'Sin dominio', domain: null, providerCompanyId: 'pc-y' }),
        record({ name: 'Sólo Nombre Ñ', domain: null, providerCompanyId: null }),
      ]),
    );
    assert.deepEqual(
      upsertCalls[0].payload.map((r) => r.source_key),
      ['domain:acme.com', 'provider:pc-y', 'name:solo-nombre-n'],
    );
  });

  // ── 5 + 6 ──
  it('usa ON CONFLICT DO NOTHING y NUNCA DO UPDATE', async () => {
    await persistLushaRejectedDispositions(baseInput([record()]));
    assert.equal(upsertCalls[0].options.onConflict, 'batch_id,source_key');
    assert.equal(
      upsertCalls[0].options.ignoreDuplicates,
      true,
      'ignoreDuplicates debe ser true: Apollo comparte batch_id',
    );
    assert.notEqual(upsertCalls[0].options.ignoreDuplicates, false);
  });

  it('el CÓDIGO nunca pide un UPDATE en conflicto', () => {
    // Guarda estática además de la de comportamiento: un `ignoreDuplicates:
    // false` reintroducido aquí volvería a autorizar la reescritura del
    // veredicto de Apollo, y el doble de arriba no podría distinguirlo si el
    // lote no tuviera ya la fila.
    const src = readFileSync(
      path.join(__dirname, '..', 'lusha-pipeline-writer.server.ts'),
      'utf8',
    );
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    assert.match(code, /ignoreDuplicates:\s*true/);
    assert.equal(/ignoreDuplicates:\s*false/.test(code), false);
  });

  // ── 7 ──
  it('conserva la evidencia y le añade el contexto de la búsqueda', async () => {
    await persistLushaRejectedDispositions(
      baseInput([
        record({
          evidence: {
            discard_kind: 'exact_duplicate',
            duplicate_source: 'hubspot',
            matched_hubspot_company_id: 'hs-77',
          },
        }),
      ]),
    );
    assert.deepEqual(upsertCalls[0].payload[0].evidence, {
      discard_kind: 'exact_duplicate',
      duplicate_source: 'hubspot',
      matched_hubspot_company_id: 'hs-77',
      requested_country_code: 'CO',
      requested_industry: 'health_pharma',
      // § CUT-C.2 — la identidad de la corrida. `deepEqual` es deliberado: si
      // el escritor empieza a añadir cualquier otra cosa a `evidence`, esta
      // prueba cae en vez de dejarla pasar.
      run_correlation: {
        wizard_run_id: WIZARD_RUN_ID,
        client_request_id: CLIENT_REQUEST_ID,
        batch_id: BATCH_ID,
        provider_key: 'lusha',
      },
    });
  });

  it('el país/industria del registro gana; la búsqueda es sólo respaldo', async () => {
    await persistLushaRejectedDispositions(
      baseInput([
        record({ countryCode: 'MX', industry: 'Retail' }),
        record({ name: 'Sin país', domain: 'b.com', providerCompanyId: 'pc-b', countryCode: null, industry: null }),
      ]),
    );
    assert.equal(upsertCalls[0].payload[0].country_code, 'MX');
    assert.equal(upsertCalls[0].payload[0].industry, 'Retail');
    assert.equal(upsertCalls[0].payload[1].country_code, 'CO');
    assert.equal(upsertCalls[0].payload[1].industry, 'health_pharma');
  });

  // ── 8 ──
  it('conserva `round_origin` identificable por rama y página', async () => {
    await persistLushaRejectedDispositions(
      baseInput([
        record({ roundOrigin: 'lusha_branch_2_page_1' }),
        record({ name: 'Otra', domain: 'otra.com', providerCompanyId: 'pc-o', roundOrigin: null }),
      ]),
    );
    assert.equal(upsertCalls[0].payload[0].round_origin, 'lusha_branch_2_page_1');
    assert.equal(upsertCalls[0].payload[1].round_origin, null);
  });

  // ── 9 ──
  it('cuenta las colisiones sin confundirlas con fallos', async () => {
    existingSourceKeys.add('domain:ya-estaba.com');
    const res = await persistLushaRejectedDispositions(
      baseInput([
        record({ name: 'Ya estaba', domain: 'ya-estaba.com', providerCompanyId: 'pc-1' }),
        record({ name: 'Nueva', domain: 'nueva.com', providerCompanyId: 'pc-2' }),
      ]),
    );
    assert.equal(res.attempted, 2);
    assert.equal(res.persisted, 1);
    assert.equal(res.conflicts, 1);
    assert.equal(res.failed, 0);
    assert.equal(res.errors.length, 0);
  });

  it('cuando la base no devuelve ids, lo DECLARA en vez de inventar 0 conflictos', async () => {
    selectReturnsNull = true;
    const res = await persistLushaRejectedDispositions(baseInput([record()]));
    assert.equal(res.persistedIndeterminate, true);
    assert.equal(res.persisted, 0);
    assert.equal(res.conflicts, 0);
    assert.equal(res.failed, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST CRÍTICO DE COLISIÓN — el veredicto de Apollo sobrevive
// ═══════════════════════════════════════════════════════════════════════════

describe('colisión Apollo/Lusha sobre el MISMO batch_id', () => {
  beforeEach(resetSpy);

  it('la fila de Apollo queda INTACTA y Lusha no hace UPDATE', async () => {
    // Apollo ya escribió su veredicto para example.com en este lote.
    const apolloRow = {
      batch_id: BATCH_ID,
      source_key: 'domain:example.com',
      name: 'Example SAS',
      domain: 'example.com',
      source_primary: 'apollo',
      disposition: 'ownership_domain_rejected',
      reason_code: 'ownership_rejected_final',
      round_origin: 'round_1',
      evidence: { final_disposition: 'ownership_rejected_final' },
    };
    existingSourceKeys.add(apolloRow.source_key);
    storedRows[apolloRow.source_key] = apolloRow;

    // Lusha encuentra la MISMA empresa y le atribuye otra disposición.
    const res = await persistLushaRejectedDispositions(
      baseInput([
        record({
          name: 'Example',
          domain: 'example.com',
          providerCompanyId: 'lusha-1',
          disposition: 'sellup_duplicate',
          roundOrigin: 'lusha_branch_0_page_0',
          evidence: { discard_kind: 'active_candidate_guard' },
        }),
      ]),
    );

    // La escritura se intentó, colisionó, y NO es un fallo.
    assert.equal(res.attempted, 1);
    assert.equal(res.persisted, 0);
    assert.equal(res.conflicts, 1);
    assert.equal(res.failed, 0);
    assert.deepEqual(res.errors, []);

    // 🔴 Y la fila sigue siendo la de Apollo, byte por byte.
    assert.deepEqual(storedRows['domain:example.com'], apolloRow);
    assert.equal(storedRows['domain:example.com'].source_primary, 'apollo');
    assert.equal(storedRows['domain:example.com'].disposition, 'ownership_domain_rejected');
  });

  it('una empresa que Apollo NO vio sí entra, en la misma llamada', async () => {
    existingSourceKeys.add('domain:example.com');
    storedRows['domain:example.com'] = { source_primary: 'apollo' };
    const res = await persistLushaRejectedDispositions(
      baseInput([
        record({ name: 'Example', domain: 'example.com', providerCompanyId: 'l-1' }),
        record({ name: 'Nueva', domain: 'nueva.com', providerCompanyId: 'l-2' }),
      ]),
    );
    assert.equal(res.persisted, 1);
    assert.equal(res.conflicts, 1);
    assert.equal(storedRows['domain:example.com'].source_primary, 'apollo');
    assert.equal(storedRows['domain:nueva.com'].source_primary, 'lusha');
  });

  it('reejecutar la MISMA corrida es idempotente: 0 nuevas, 0 fallos', async () => {
    const records = [
      record({ name: 'A', domain: 'a.com', providerCompanyId: 'pc-a' }),
      record({ name: 'B', domain: 'b.com', providerCompanyId: 'pc-b' }),
    ];
    const first = await persistLushaRejectedDispositions(baseInput(records));
    assert.equal(first.persisted, 2);
    const second = await persistLushaRejectedDispositions(baseInput(records));
    assert.equal(second.attempted, 2);
    assert.equal(second.persisted, 0);
    assert.equal(second.conflicts, 2);
    assert.equal(second.failed, 0);
  });
});
