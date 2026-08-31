/**
 * AGENT1-LOCAL-CUT9A-LUSHA-BATCH-OWNERSHIP-SEAM — suite dedicada.
 *
 * Lo que este corte tiene que dejar demostrado:
 *
 *   una ejecución → una identidad canónica → un lote
 *   → la mitad gratuita puede adoptarlo
 *   → la mitad de pago puede reservarlo/adoptarlo
 *   → no hay lote sombra
 *   → no hay mentira de huérfano tras persistir
 *   → el objetivo PEDIDO sigue siendo la autoridad del lote
 *
 * y, simultáneamente:
 *
 *   LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = false
 *
 * 🔴 CUT9A PREPARA la propiedad del lote; NO activa el hueco parcial. Las guardas
 * de activación prematura viven aquí y ponen la suite en ROJO si alguien enciende
 * la bandera durante este corte.
 *
 * Cero Supabase, cero proveedor, cero créditos: dobles locales en todo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_UNAVAILABLE } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '../country-source-discovery/run-prepaid-novelty-discovery.server';
import type { CountrySourceCompany } from '../country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '../country-source-discovery/run-prepaid-novelty-gate';
import { LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED } from '../lusha-pending-review-limits';
import {
  LUSHA_PENDING_REVIEW_BATCH_ADOPTION_SUPPORTED,
  LUSHA_PENDING_REVIEW_BATCH_SOURCE,
  LUSHA_PENDING_REVIEW_BATCH_STATUS,
  type LushaPendingReviewBatchRow,
} from '../lusha-pending-review';
import {
  buildLushaCanonicalBatchRow,
  createCanonicalLushaBatchResolver,
  reserveOrReturnLushaCanonicalBatch,
  LUSHA_CANONICAL_BATCH_FRESH_EPOCH,
  type LushaCanonicalBatchDbClient,
  type LushaCanonicalBatchDescription,
  type LushaCanonicalBatchIdentity,
  type LushaCanonicalBatchReservation,
} from '../lusha-canonical-batch';

const ROOT = process.cwd();
const CLIENT = {} as unknown as SupabaseClient;

const REQUESTED_TARGET = 5;
const USER = 'user-1';
const CLIENT_REQUEST_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_REQUEST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ═══════════════════════════════════════════════════════════════════════════
// § 1 — CUT9A prepara la PROPIEDAD del lote; el valor vivo lo decide CUT-9
//
// 🔴 REANCLADO por AGENT1-LOCAL-CUT9 § 17. Este caso exigía `false` y por tanto
// fijaba una decisión temporal: CUT9A no debía activarla, pero CUT-9 sí. Un
// trinquete que fija el valor defectuoso impide arreglarlo.
//
// Lo que CUT9A promete de verdad —y lo único que se congela aquí— es que el valor
// vivo se decide en UNA sola declaración literal, en su único dueño, y que este
// corte no lo escribe a mano en ningún sitio de llamada. El VALOR es de
// `cut9-lusha-partial-gap-activation.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

test('§ 1 · NEGATIVE_A — el hueco parcial de Lusha se decide en UN solo sitio', () => {
  assert.equal(typeof LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED, 'boolean');
  const limits = readFileSync(
    join(ROOT, 'src/server/prospect-batches/lusha-pending-review-limits.ts'),
    'utf-8',
  );
  const declarations = limits.match(
    /export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = (?:true|false);/g,
  );
  assert.equal(declarations?.length, 1, 'el valor vivo dejó de tener un único dueño');

  // Y el sitio de llamada sigue consumiendo la CONSTANTE, no un literal.
  const action = readFileSync(
    join(ROOT, 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
    'utf-8',
  );
  assert.match(action, /partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,/);
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 2/3 — identidad canónica: `(created_by, client_request_id)`, sin inventar
// ═══════════════════════════════════════════════════════════════════════════

function identity(
  clientRequestId: string,
  overrides: Partial<LushaCanonicalBatchIdentity> = {},
): LushaCanonicalBatchIdentity {
  return {
    createdByUserId: USER,
    clientRequestId,
    requestedTarget: REQUESTED_TARGET,
    defaults: {
      name: 'Búsqueda con IA · health_pharma · Colombia',
      country: 'Colombia',
      country_code: 'CO',
      industry: 'health_pharma',
      search_depth: 'standard',
      status: LUSHA_PENDING_REVIEW_BATCH_STATUS,
      source: LUSHA_PENDING_REVIEW_BATCH_SOURCE,
      metadata: {},
    },
    ...overrides,
  };
}

/** Contribución RICA, como la que construye el núcleo tras pagar al proveedor. */
function paidDescription(): LushaCanonicalBatchDescription {
  return {
    name: 'Búsqueda con IA · Salud · Colombia',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'Salud',
    search_depth: 'standard',
    status: LUSHA_PENDING_REVIEW_BATCH_STATUS,
    source: LUSHA_PENDING_REVIEW_BATCH_SOURCE,
    metadata: { provider: 'lusha', billing: { credits_charged: 4 } },
  };
}

test('§ 3 · NEGATIVE_B — la fila del lote de pago LLEVA client_request_id', () => {
  const row = buildLushaCanonicalBatchRow(identity(CLIENT_REQUEST_A), paidDescription());
  assert.equal(row.client_request_id, CLIENT_REQUEST_A);
  assert.equal(row.created_by, USER);
  assert.equal(row.owner_id, USER);
});

/** Cuerpo EJECUTABLE: sin comentarios. Las cabeceras NOMBRAN lo prohibido. */
function executableBody(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('§ 3 — no se inventa una segunda identidad de ejecución', () => {
  const sources = [
    'src/server/prospect-batches/lusha-canonical-batch.ts',
    'src/server/prospect-batches/lusha-pending-review.ts',
    'src/modules/prospect-batches/lusha-pending-review-actions.ts',
  ].map(executableBody);
  for (const src of sources) {
    for (const forbidden of ['batchExecutionId', 'retryGroupId', 'logicalSearchId']) {
      assert.equal(
        src.includes(forbidden),
        false,
        `apareció una identidad inventada: ${forbidden}`,
      );
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// § 8 — `target_count` = objetivo PEDIDO; un contribuyente NO lo redefine
// ═══════════════════════════════════════════════════════════════════════════

test('CASO 7 · NEGATIVE_E — target_count es la PETICIÓN, no lo persistido', () => {
  // Pedido 10, el contribuyente de pago llega con 4 persistidas.
  const row = buildLushaCanonicalBatchRow(
    identity(CLIENT_REQUEST_A, { requestedTarget: 10 }),
    // 🔴 La contribución intenta imponer su propio objetivo y su propio dueño.
    {
      ...paidDescription(),
      ...({ target_count: 4, created_by: 'otro-usuario' } as unknown as object),
    } as LushaCanonicalBatchDescription,
  );
  assert.equal(row.target_count, 10, 'un contribuyente redefinió la petición');
  assert.equal(row.created_by, USER, 'un contribuyente redefinió la propiedad');
});

test('§ 8 · NEGATIVE_E — el núcleo ya no tiene `persistedCount` con el que falsear el objetivo', () => {
  const core = readFileSync(
    join(ROOT, 'src/server/prospect-batches/lusha-pending-review.ts'),
    'utf-8',
  );
  assert.equal(
    /target_count:\s*persistedCount/.test(core),
    false,
    'volvió `target_count = persistedCount` a la mitad de pago',
  );
  assert.match(
    core,
    /target_count:\s*actor\.requestedTarget/,
    'el objetivo del lote dejó de salir de la autoridad de petición',
  );
  // Estructural: el parámetro desapareció, no sólo dejó de usarse.
  const builderStart = core.indexOf('export function buildLushaPendingReviewBatchRow');
  const signature = core.slice(builderStart, core.indexOf('{', core.indexOf('):', builderStart)));
  assert.equal(
    /persistedCount/.test(signature),
    false,
    'el constructor de la fila recuperó un `persistedCount` con el que falsear la petición',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// § 4 — reserve-or-return: 23505 RELEE, nunca «el último lote»
// ═══════════════════════════════════════════════════════════════════════════

type FakeDb = {
  db: LushaCanonicalBatchDbClient;
  inserts: () => LushaPendingReviewBatchRow[];
  lookups: () => Array<{ createdBy: string; clientRequestId: string }>;
};

/** Base con índice único REAL sobre `(created_by, client_request_id)`. */
function makeDb(seed: { epochByKey?: Record<string, number> } = {}): FakeDb {
  const rows = new Map<string, { id: string; identity_epoch: number }>();
  const inserts: LushaPendingReviewBatchRow[] = [];
  const lookups: Array<{ createdBy: string; clientRequestId: string }> = [];
  let seq = 0;

  for (const [key, epoch] of Object.entries(seed.epochByKey ?? {})) {
    seq += 1;
    rows.set(key, { id: `batch-${seq}`, identity_epoch: epoch });
  }

  const db: LushaCanonicalBatchDbClient = {
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            const typed = row as unknown as LushaPendingReviewBatchRow;
            inserts.push(typed);
            const key = `${typed.created_by}::${typed.client_request_id}`;
            if (rows.has(key)) {
              return { data: null, error: { code: '23505', message: 'duplicate key' } };
            }
            seq += 1;
            const created = { id: `batch-${seq}`, identity_epoch: 0 };
            rows.set(key, created);
            return { data: { id: created.id }, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_c1: string, createdBy: string) => ({
          eq: (_c2: string, clientRequestId: string) => ({
            single: async () => {
              lookups.push({ createdBy, clientRequestId });
              const found = rows.get(`${createdBy}::${clientRequestId}`);
              return found
                ? { data: found, error: null }
                : { data: null, error: { message: 'not found' } };
            },
          }),
        }),
      }),
    }),
  };

  return { db, inserts: () => inserts, lookups: () => lookups };
}

test('§ 4 · NEGATIVE_C — INSERT ok ⇒ reserva fresca; 23505 ⇒ RELECTURA por clave canónica', async () => {
  const { db, lookups } = makeDb();
  const row = buildLushaCanonicalBatchRow(identity(CLIENT_REQUEST_A), paidDescription());

  const first = await reserveOrReturnLushaCanonicalBatch(row, db);
  assert.equal(first.adopted, false);
  assert.equal(first.identityEpoch, LUSHA_CANONICAL_BATCH_FRESH_EPOCH);
  assert.equal(lookups().length, 0, 'un INSERT exitoso no debe releer nada');

  const second = await reserveOrReturnLushaCanonicalBatch(row, db);
  assert.equal(second.id, first.id, 'la MISMA identidad devolvió otro lote');
  assert.equal(second.adopted, true);
  assert.deepEqual(lookups(), [{ createdBy: USER, clientRequestId: CLIENT_REQUEST_A }]);
});

test('§ 4 — un lote ADOPTADO devuelve su época REAL, no la fresca', async () => {
  const { db } = makeDb({ epochByKey: { [`${USER}::${CLIENT_REQUEST_A}`]: 3 } });
  const row = buildLushaCanonicalBatchRow(identity(CLIENT_REQUEST_A), paidDescription());
  const reservation = await reserveOrReturnLushaCanonicalBatch(row, db);
  assert.equal(reservation.adopted, true);
  assert.equal(
    reservation.identityEpoch,
    3,
    'la adopción escribiría contra una época inventada y la corrida caería en `stale`',
  );
});

test('§ 4 · NEGATIVE_H — no hay adopción por recencia («el último lote»)', () => {
  // Sólo el cuerpo ejecutable: la cabecera NOMBRA la heurística para prohibirla.
  const body = executableBody('src/server/prospect-batches/lusha-canonical-batch.ts');
  assert.equal(/created_at/.test(body), false, 'apareció orden por recencia');
  assert.equal(/\border\(/.test(body), false, 'apareció un ORDER BY en la adopción');
  assert.equal(/\blimit\(/.test(body), false, 'apareció un LIMIT en la adopción');
  // La relectura es por la clave canónica, y por ninguna otra.
  assert.match(body, /\.eq\('created_by', row\.created_by\)/);
  assert.match(body, /\.eq\('client_request_id', row\.client_request_id\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
// § 5 — el MISMO resolutor para las dos mitades
// ═══════════════════════════════════════════════════════════════════════════

function makeResolver(clientRequestId: string, fake = makeDb()) {
  const resolver = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(clientRequestId),
  );
  return { resolver, fake };
}

test('CASO 1 — misma ejecución, la mitad GRATUITA pide primero', async () => {
  const { resolver, fake } = makeResolver(CLIENT_REQUEST_A);
  const free = await resolver.resolve(); // sin contribución: usa el defecto
  const paid = await resolver.resolve(paidDescription());
  assert.equal(free.id, paid.id);
  assert.equal(fake.inserts().length, 1, 'apareció un lote sombra');
  // 🔴 La propiedad del lote NO depende del hueco parcial: con la activación de
  // CUT-9 encendida, «una ejecución ⇒ un lote» tiene que seguir siendo cierta.
  assert.equal(typeof LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED, 'boolean');
});

test('CASO 2 — misma ejecución, la mitad de PAGO pide primero: el orden no decide', async () => {
  const { resolver, fake } = makeResolver(CLIENT_REQUEST_A);
  const paid = await resolver.resolve(paidDescription());
  const free = await resolver.resolve();
  assert.equal(paid.id, free.id);
  assert.equal(fake.inserts().length, 1);
  // 🔴 Y la fila materializada conserva la contribución RICA del que llegó primero,
  // con la identidad y la petición estampadas encima.
  const [row] = fake.inserts();
  assert.equal(row.metadata.provider, 'lusha');
  assert.equal(row.target_count, REQUESTED_TARGET);
  assert.equal(row.client_request_id, CLIENT_REQUEST_A);
});

test('CASO 3 — dos materializaciones CONCURRENTES de la misma identidad ⇒ un lote', async () => {
  const { resolver, fake } = makeResolver(CLIENT_REQUEST_A);
  const [a, b] = await Promise.all([resolver.resolve(), resolver.resolve(paidDescription())]);
  assert.equal(a.id, b.id);
  assert.equal(fake.inserts().length, 1, 'la promesa en vuelo no se compartió');
});

test('CASO 3b — concurrencia REAL en la base (dos resolutores, un INSERT gana)', async () => {
  // Modela dos materializaciones que no comparten la promesa en vuelo: la valla es
  // el índice único, no el cierre del resolutor.
  const fake = makeDb();
  const one = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(CLIENT_REQUEST_A),
  );
  const two = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(CLIENT_REQUEST_A),
  );
  const [a, b] = await Promise.all([one.resolve(), two.resolve(paidDescription())]);
  assert.equal(a.id, b.id, 'dos materializaciones de la misma identidad dieron lotes distintos');
  assert.equal(fake.inserts().length, 2, 'las dos lo intentaron…');
  assert.equal(fake.lookups().length, 1, '…y exactamente una releyó tras el 23505');
});

test('CASO 4 · NEGATIVE_I — ejecuciones DISTINTAS no se adoptan entre sí', async () => {
  const fake = makeDb();
  const a = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(CLIENT_REQUEST_A),
  );
  const b = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(CLIENT_REQUEST_B),
  );
  const ra = await a.resolve();
  const rb = await b.resolve();
  assert.notEqual(ra.id, rb.id, 'una ejecución adoptó el lote de otra');
  assert.equal(rb.adopted, false);
  assert.equal(fake.inserts().length, 2);
});

test('CASO 4b · NEGATIVE_I — con DOS lotes del mismo dueño, el 23505 relee el de SU ejecución', async () => {
  // 🔴 CASO 4 no basta: allí las dos ejecuciones INSERTan sin colisionar, así que
  // la relectura ni se ejecuta. Aquí las dos filas YA existen, el INSERT choca, y
  // la adopción tiene que elegir. Adoptar «por dueño» —o por recencia— devolvería
  // el lote de la OTRA ejecución.
  const fake = makeDb({
    epochByKey: {
      [`${USER}::${CLIENT_REQUEST_A}`]: 1,
      [`${USER}::${CLIENT_REQUEST_B}`]: 7,
    },
  });
  const forA = await reserveOrReturnLushaCanonicalBatch(
    buildLushaCanonicalBatchRow(identity(CLIENT_REQUEST_A), paidDescription()),
    fake.db,
  );
  const forB = await reserveOrReturnLushaCanonicalBatch(
    buildLushaCanonicalBatchRow(identity(CLIENT_REQUEST_B), paidDescription()),
    fake.db,
  );
  assert.equal(forA.adopted, true);
  assert.equal(forB.adopted, true);
  assert.notEqual(forA.id, forB.id, 'una ejecución adoptó el lote de la otra');
  assert.equal(forA.identityEpoch, 1, 'se adoptó la época de la ejecución equivocada');
  assert.equal(forB.identityEpoch, 7);
  assert.deepEqual(fake.lookups(), [
    { createdBy: USER, clientRequestId: CLIENT_REQUEST_A },
    { createdBy: USER, clientRequestId: CLIENT_REQUEST_B },
  ]);
});

test('CASO 5 — un NUEVO clic (nuevo clientRequestId) estrena lote: es lo ESPERADO (OPTION_A)', async () => {
  const fake = makeDb();
  const click1 = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(CLIENT_REQUEST_A),
  );
  const click2 = createCanonicalLushaBatchResolver(
    (row) => reserveOrReturnLushaCanonicalBatch(row, fake.db),
    identity(CLIENT_REQUEST_B),
  );
  const first = await click1.resolve();
  const second = await click2.resolve();
  // 🔴 NO es un defecto: el `clientRequestId` gobierna también la reserva económica
  // y se genera nuevo por clic para no reutilizar una reserva ya liquidada.
  assert.notEqual(first.id, second.id);
});

test('§ 5 — el resolutor es PEREZOSO: construirlo no escribe nada', () => {
  const { resolver, fake } = makeResolver(CLIENT_REQUEST_A);
  assert.equal(resolver.isMaterialized(), false);
  assert.equal(fake.inserts().length, 0);
});

test('NEGATIVE_G — un fallo de materialización NO se memoiza para siempre', async () => {
  let calls = 0;
  const resolver = createCanonicalLushaBatchResolver(async () => {
    calls += 1;
    if (calls === 1) throw new Error('fallo transitorio');
    return { id: 'batch-1', adopted: false, identityEpoch: 0 } as LushaCanonicalBatchReservation;
  }, identity(CLIENT_REQUEST_A));

  await assert.rejects(() => resolver.resolve(), /fallo transitorio/);
  assert.equal(resolver.isMaterialized(), false);
  const retried = await resolver.resolve(paidDescription());
  assert.equal(retried.id, 'batch-1', 'un tropiezo transitorio envenenó la ejecución entera');
  assert.equal(calls, 2);
});

test('NEGATIVE_J — el clientRequestId del lote sale de la ejecución, no de un clic anterior', () => {
  const action = readFileSync(
    join(ROOT, 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
    'utf-8',
  );
  // Se destructura de la ENTRADA validada de ESTA llamada y se pasa tal cual.
  assert.match(action, /const \{ clientRequestId, \.\.\.searchInput \} = parsed\.data;/);
  assert.match(action, /clientRequestId,\n\s+\/\/ § 8/);
  // Y no hay ninguna relectura de un clic previo con la que reusar su identidad.
  assert.equal(
    /previousClientRequestId|lastClientRequestId|readPreviousAttempt/.test(action),
    false,
    'la acción empezó a reutilizar el clientRequestId de un clic anterior',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// § 5 — cableado REAL: las dos mitades reciben la MISMA autoridad
// ═══════════════════════════════════════════════════════════════════════════

test('§ 5 · NEGATIVE_F — la acción pasa `resolveBatchId` a la capa gratuita, fail-open intacto', () => {
  const action = readFileSync(
    join(ROOT, 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
    'utf-8',
  );
  assert.match(
    action,
    /resolveBatchId: async \(\) => \(await canonicalBatch\.resolve\(\)\)\.id/,
    'la capa gratuita de Lusha dejó de recibir el lote canónico',
  );
  assert.match(
    action,
    /reserveBatch: \(row: LushaPendingReviewBatchRow\) =>\s*\n\s*canonicalBatch\.resolve\(\{/,
    'la mitad de pago dejó de usar el MISMO resolutor',
  );
  // 🔴 Se construye UNA vez: dos instancias serían dos autoridades.
  assert.equal(
    (action.match(/createCanonicalLushaBatchResolver\(/g) ?? []).length,
    1,
    'apareció un segundo resolutor canónico en la ruta de Lusha',
  );

  // NEGATIVE_F — el seam gratuito preexistente es FAIL-OPEN y sigue siéndolo.
  const runner = readFileSync(
    join(
      ROOT,
      'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts',
    ),
    'utf-8',
  );
  assert.match(
    runner,
    /await input\.resolveBatchId\(\)\.catch\(\(\) => null\)/,
    'la resolución del lote en la capa gratuita dejó de fallar ABIERTO',
  );
});

test('§ 4 — la ruta de Lusha DECLARA que adopta, y su época se RELEE (CUT9A-FIX)', () => {
  assert.equal(LUSHA_PENDING_REVIEW_BATCH_ADOPTION_SUPPORTED, true);
  const core = readFileSync(
    join(ROOT, 'src/server/prospect-batches/lusha-pending-review.ts'),
    'utf-8',
  );
  assert.match(core, /const reservation = await deps\.reserveBatch\(/);

  // 🔴 CUT9A-FIX-ADOPTED-EPOCH-REFRESH — esta aserción estaba INVERTIDA y por eso
  // el defecto pasaba en verde: exigía que `expectedEpoch` saliera de la RESERVA
  // memoizada, que es precisamente la época caduca. La época viaja ahora desde una
  // LECTURA ACTUAL, y la reserva sólo sigue siendo autoridad de IDENTIDAD.
  assert.match(core, /const epochEvidence = await deps\.readBatchIdentityEpoch\(batchId\)/);
  assert.match(core, /expectedEpoch: epochEvidence\.epoch \?\? LUSHA_FRESH_BATCH_IDENTITY_EPOCH/);
  assert.equal(
    /expectedEpoch:\s*reservation\.adopted/.test(core),
    false,
    'la época volvió a salir de la reserva memoizada: eso es el defecto de V9A.1',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// § 6 — el huérfano post-persistencia
// ═══════════════════════════════════════════════════════════════════════════

function freeCompany(key: string): CountrySourceCompany {
  return {
    recordIdentityKey: key,
    legalName: `SINTETICA ${key}`,
    normalizedLegalName: `sintetica ${key}`,
    taxId: `9000${key}`,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: 'Fabricación de productos farmacéuticos',
    industryCode: '2100',
    coarseSector: 'MANUFACTURA',
  };
}

/**
 * La puerta ACEPTA el objetivo entero (⇒ `providerRequired` empieza en `false`) y
 * la persistencia guarda MENOS. Es el único camino, con la bandera apagada, por el
 * que las dos mitades escriben en la MISMA ejecución.
 */
function makePartialPersistenceDeps(input: {
  requestedTarget: number;
  written: number;
  batchId: string | null;
}): { deps: PrePaidNoveltyDiscoveryDeps; persistedBatchIds: () => Array<string | null> } {
  const accepted = Array.from({ length: input.requestedTarget }, (_, i) => freeCompany(`c${i}`));
  const persistedBatchIds: Array<string | null> = [];
  const context = buildPrePaidNoveltyContext({
    requestedTarget: input.requestedTarget,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: input.requestedTarget,
      macroConfirmed: input.requestedTarget,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: input.requestedTarget,
      failed: false,
      failureCode: null,
    },
  });

  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('lusha', {}),
    providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: {},
  };

  return {
    deps: {
      runGate: async () => gateResult,
      persist: async (_client, persistInput) => {
        persistedBatchIds.push(persistInput.batchId ?? null);
        return {
          batchId: input.batchId,
          writtenCount: input.written,
          skippedCount: input.requestedTarget - input.written,
          failed: false,
        };
      },
    },
    persistedBatchIds: () => persistedBatchIds,
  };
}

test('CASO 6 · NEGATIVE_D — con filas escritas, NUNCA se reporta 0 filas ni lote nulo', async () => {
  const { deps, persistedBatchIds } = makePartialPersistenceDeps({
    requestedTarget: 5,
    written: 3,
    batchId: 'batch-canonico',
  });

  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: 5,
      requestedByUserId: USER,
      // 🔴 REANCLADO por AGENT1-LOCAL-CUT9 § 17 — el literal `false`, no la
      // constante viva. Lo que este caso prueba es la RAMA todo-o-nada del runner
      // compartido, que CUT-9 no borra: sigue siendo el comportamiento de cualquier
      // ruta que pase `false`. Leerlo de la constante ataba la cobertura de una
      // rama a una decisión de producto que CUT-9 cambia.
      partialGapSupported: false,
      resolveBatchId: async () => 'batch-canonico',
    },
    deps,
  );

  // Lo que se PRESERVA (lo nuevo): la verdad durable.
  assert.equal(outcome.persistedCount, 3, 'se falsearon a 0 unas filas realmente escritas');
  assert.equal(outcome.batchId, 'batch-canonico', 'un lote REAL se reportó como nulo');

  // Lo que se DESCARTA (sin cambios): la aritmética del objetivo.
  assert.equal(outcome.residualGap, 5, 'la contribución dejó de descartarse: eso es CUT-9');
  assert.equal(outcome.acceptedBeforeProvider, 0);
  assert.equal(outcome.providerRequired, true);

  // Y el lote en el que escribió es el CANÓNICO, no uno propio del writer.
  assert.deepEqual(persistedBatchIds(), ['batch-canonico']);
});

test('CASO 6b — sin filas escritas, «cero» sigue siendo la verdad', async () => {
  const { deps } = makePartialPersistenceDeps({
    requestedTarget: 5,
    written: 0,
    batchId: 'batch-canonico',
  });

  const outcome = await runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: 5,
      requestedByUserId: USER,
      partialGapSupported: false,
      resolveBatchId: async () => 'batch-canonico',
    },
    deps,
  );

  assert.equal(outcome.persistedCount, 0);
  assert.equal(outcome.batchId, null, 'un lote vacío no debe reportarse como aporte');
  assert.equal(outcome.residualGap, 5);
});

// ═══════════════════════════════════════════════════════════════════════════
// § 12 — RLS / propiedad
// ═══════════════════════════════════════════════════════════════════════════

test('§ 12 — misma ejecución + mismo created_by ⇒ adopción permitida', async () => {
  const { resolver, fake } = makeResolver(CLIENT_REQUEST_A);
  const free = await resolver.resolve();
  const paid = await resolver.resolve(paidDescription());
  assert.equal(free.id, paid.id);
  const [row] = fake.inserts();
  assert.equal(row.created_by, USER, 'las dos mitades deben escribir bajo el MISMO dueño');
  assert.equal(row.owner_id, USER);
});

test('§ 12 — la relectura tras 23505 se acota por created_by: otro dueño NO adopta', async () => {
  const fake = makeDb();
  await reserveOrReturnLushaCanonicalBatch(
    buildLushaCanonicalBatchRow(identity(CLIENT_REQUEST_A), paidDescription()),
    fake.db,
  );
  // MISMO clientRequestId, OTRO usuario: la clave es el par, no el uuid suelto.
  const otherOwner = await reserveOrReturnLushaCanonicalBatch(
    buildLushaCanonicalBatchRow(
      identity(CLIENT_REQUEST_A, { createdByUserId: 'user-2' }),
      paidDescription(),
    ),
    fake.db,
  );
  assert.equal(otherOwner.adopted, false, 'otro dueño adoptó un lote que no es suyo');
  assert.equal(fake.lookups().length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 9/10/11 — lo que CUT9A NO toca
// ═══════════════════════════════════════════════════════════════════════════


test('§§ 9/10/11 — ni aceptación de pago, ni economía, ni enrutado cambian', () => {
  // 🔴 Con los COMENTARIOS FUERA, con el helper que esta suite ya tiene: la acción
  // NOMBRA en su prosa las claves prohibidas para explicar por qué NO existen, y
  // leer el cuerpo crudo confundiría «citarlo» con «usarlo».
  const action = executableBody(
    'src/modules/prospect-batches/lusha-pending-review-actions.ts',
  );
  // § 9 — REANCLADO por AGENT1-LOCAL-CUT9 §§ 4, 15.
  //
  // 🔴 Este bucle prohibía `resolveAcceptedForTarget` en la acción, y era correcto
  // mientras la aceptación de pago era territorio de CUT-9. CUT-9 la conecta, así
  // que la prohibición pasó a fijar la ausencia del arreglo.
  //
  // 🔴 REANCLADO por AGENT1-LOCAL-CUT9B.
  //
  // Este bucle prohibía el bloque durable porque no había costura segura:
  // `reserveOrReturnLushaCanonicalBatch` NO actualiza la metadata de un lote
  // adoptado, y abrir un `SELECT metadata` → `UPDATE metadata` sin vallado estaba
  // (y sigue estando) prohibido. CUT9B construye la costura vallada —CAS sobre
  // `identity_epoch`—, así que la prohibición pasó a fijar la ausencia del
  // arreglo, exactamente como le ocurrió a la línea de arriba con CUT-9.
  //
  // Lo que se conserva es el límite REAL: la publicación existe, pero no la abre
  // la acción por su cuenta.
  assert.ok(
    action.includes('toAcceptedForTargetMetadata') &&
      action.includes('ACCEPTED_FOR_TARGET_METADATA_KEY'),
    'la publicación durable de aceptación desapareció de la acción',
  );
  assert.ok(
    action.includes('publishFencedBatchMetadata(') &&
      action.includes('decideBatchMetadataFencePlan('),
    'la acción publica el bloque durable SIN la costura vallada',
  );
  assert.equal(
    /from\('prospect_batches'\)[\s\S]{0,200}\.update\(/.test(action),
    false,
    'la acción abrió una escritura ciega sobre prospect_batches',
  );
  // 🔴 Y la aritmética, cuando exista, tiene que ser LA canónica: una sola llamada
  // y ninguna segunda autoridad con nombre propio.
  assert.equal(
    (action.match(/resolveAcceptedForTarget\(/g) ?? []).length,
    1,
    'apareció una segunda entrada a la aritmética de aceptación',
  );
  for (const forbidden of [
    'lusha_accepted_for_target',
    'lusha_target_truth',
    'pending_review_acceptance',
  ]) {
    assert.equal(action.includes(forbidden), false, `segunda autoridad: ${forbidden}`);
  }
  // § 10 — economía intacta y en el mismo orden.
  assert.match(action, /const requiredCredits = estimateLushaRunCredits\(searchPlan\);/);
  assert.match(action, /guardLushaRunBudget\(/);
  assert.match(action, /reserveLushaRunCredits\(\{ userId: internalUserId, clientRequestId, requiredCredits \}\)/);
  // 🔴 La reserva NO se hace proporcional al hueco.
  assert.equal(
    /estimateLushaRunCredits\([^)]*residualGap/.test(action),
    false,
    'la reserva económica pasó a depender del hueco',
  );
  // § 11 — enrutado/activación intactos.
  assert.match(action, /resolveWizardLushaCriteria|buildLushaRoutingCriteria/);
  assert.match(action, /buildProviderRoutingMetadata\(/);
  assert.match(action, /guardLushaPreviewEnabled/);
});

test('CUT9A no añade migraciones', () => {
  const files = readFileSync(
    join(ROOT, 'src/server/prospect-batches/lusha-canonical-batch.ts'),
    'utf-8',
  );
  assert.match(files, /No hay migración\./, 'el módulo dejó de declarar MIGRATION=NONE');
});
