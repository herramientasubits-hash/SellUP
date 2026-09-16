/**
 * waterfall-cut5a-batch-correlation.test.ts
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 5A — LOTE CANÓNICO Y CORRELACIÓN.
 *
 * ── 🔴 Qué defiende esta suite ───────────────────────────────────────────────
 *
 * El requisito M: UN `wizard_run_id` tiene que poder reconstruir Apollo R1,
 * Apollo R2 y Lusha R1. Hasta el corte 4 no podía: la acción de Lusha resolvía
 * su lote por `(created_by, client_request_id)` con la identidad DERIVADA de la
 * pierna, así que la pierna aterrizaba en un lote propio y acuñaba su propio
 * `wizard_run_id`. Una búsqueda de la persona quedaba partida en dos lotes y dos
 * corridas inconexas.
 *
 * Lo que NO puede romperse al cerrarlo, y por eso está aquí:
 *
 *   · la pierna sigue teniendo `clientRequestId` PROPIO — es la clave de
 *     idempotencia de SU reserva de créditos, y compartir la de Apollo la haría
 *     correr a cuenta de una reserva ajena ya liquidada;
 *   · Lusha STANDALONE se comporta byte por byte como antes;
 *   · adoptar un lote NO puede convertirse en «escribo en el lote que me digan»:
 *     el dueño se comprueba y el par (corrida, identidad de reserva) también.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createAdoptedLushaBatchResolver,
  createCanonicalLushaBatchResolver,
  readLushaAdoptedBatchIdentity,
  LUSHA_ADOPTED_BATCH_NOT_FOUND,
  LUSHA_ADOPTED_BATCH_NOT_OWNED,
  type LushaAdoptedBatchDbClient,
} from '@/server/prospect-batches/lusha-canonical-batch';
import {
  buildWizardRunCorrelation,
  buildWizardRunId,
  matchUsageRowToRun,
  withResolvedIds,
} from '../wizard-run-correlation';
import { deriveLushaWaterfallClientRequestId } from '../waterfall-leg-identity';
import { decideLushaWaterfallLeg } from '../wizard-lusha-waterfall';
import { runLushaWaterfallLeg } from '../wizard-lusha-waterfall.server';

const ROOT = path.join(process.cwd(), 'src');
const ACTION_REL = 'modules/prospect-batches/lusha-pending-review-actions.ts';

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Los comentarios NOMBRAN cosas; el código las HACE. Sólo el código cuenta. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const USER = 'user-1111';
const OTHER_USER = 'user-2222';
const WIZARD_CLIENT_REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const CANONICAL_BATCH_ID = 'b7f1c3d2-0a44-4f9e-9c31-8d6e5a2b1c07';
const TARGET = 5;

// ── A/C · el lote canónico se ADOPTA: nunca se crea un segundo ───────────────

describe('CORTE 5A § A — adoptar el lote de la corrida no escribe una fila nueva', () => {
  function adopted(overrides: { owner?: string; epoch?: number } = {}) {
    let reads = 0;
    const resolver = createAdoptedLushaBatchResolver({
      batchId: CANONICAL_BATCH_ID,
      expectedOwnerUserId: USER,
      readIdentity: async () => {
        reads += 1;
        return {
          createdByUserId: overrides.owner ?? USER,
          identityEpoch: overrides.epoch ?? 3,
        };
      },
    });
    return { resolver, reads: () => reads };
  }

  test('devuelve EL lote que se le pasó, declarado como adoptado', async () => {
    const { resolver } = adopted();
    const reservation = await resolver.resolve();
    assert.deepEqual(reservation, {
      id: CANONICAL_BATCH_ID,
      adopted: true,
      identityEpoch: 3,
    });
  });

  test('dos materializaciones de la misma corrida NO producen dos lotes', async () => {
    const { resolver, reads } = adopted();
    // La mitad gratuita y la de pago preguntan por separado, como en producción.
    const [free, paid] = await Promise.all([resolver.resolve(), resolver.resolve()]);
    const third = await resolver.resolve();

    assert.equal(free.id, CANONICAL_BATCH_ID);
    assert.equal(paid.id, CANONICAL_BATCH_ID);
    assert.equal(third.id, CANONICAL_BATCH_ID);
    assert.equal(reads(), 1, 'la identidad se lee UNA vez y se memoiza');
  });

  test('la contribución descriptiva NO puede reescribir el lote de Apollo', async () => {
    const { resolver } = adopted();
    const reservation = await resolver.resolve({
      name: 'nombre de la pierna Lusha',
      country: 'XX',
      country_code: 'XX',
      industry: 'otra',
      search_depth: 'standard',
      status: 'draft',
      source: 'ai_generated',
      metadata: { pisado: true },
    } as never);
    // El resolutor no escribe nada: no hay writer al que la contribución pudiera
    // llegar. Lo único que devuelve es el id que ya existía.
    assert.equal(reservation.id, CANONICAL_BATCH_ID);
    assert.equal(reservation.adopted, true);
  });

  test('lote de OTRA persona ⇒ lanza, no adopta y no crea', async () => {
    const { resolver } = adopted({ owner: OTHER_USER });
    await assert.rejects(() => resolver.resolve(), new RegExp(LUSHA_ADOPTED_BATCH_NOT_OWNED));
  });

  test('lote inexistente ⇒ lanza; NUNCA cae a crear uno nuevo', async () => {
    const resolver = createAdoptedLushaBatchResolver({
      batchId: CANONICAL_BATCH_ID,
      expectedOwnerUserId: USER,
      readIdentity: async () => null,
    });
    await assert.rejects(() => resolver.resolve(), new RegExp(LUSHA_ADOPTED_BATCH_NOT_FOUND));
  });

  test('un fallo de lectura NO se memoiza: la misma corrida puede reintentar', async () => {
    let calls = 0;
    const resolver = createAdoptedLushaBatchResolver({
      batchId: CANONICAL_BATCH_ID,
      expectedOwnerUserId: USER,
      readIdentity: async () => {
        calls += 1;
        if (calls === 1) throw new Error('red caída');
        return { createdByUserId: USER, identityEpoch: 0 };
      },
    });
    await assert.rejects(() => resolver.resolve());
    const second = await resolver.resolve();
    assert.equal(second.id, CANONICAL_BATCH_ID);
  });

  test('la lectura falla CERRADO: un error de base no se lee como «no existe»', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }),
          }),
        }),
      }),
    } as unknown as LushaAdoptedBatchDbClient;
    await assert.rejects(() => readLushaAdoptedBatchIdentity(CANONICAL_BATCH_ID, db));
  });

  test('sin `identity_epoch` en el esquema se cae a la época fresca, no a `null`', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { created_by: USER }, error: null }),
          }),
        }),
      }),
    } as unknown as LushaAdoptedBatchDbClient;
    const identity = await readLushaAdoptedBatchIdentity(CANONICAL_BATCH_ID, db);
    assert.deepEqual(identity, { createdByUserId: USER, identityEpoch: 0 });
  });
});

// ── D · corrida NUEVA ⇒ identidad NUEVA ─────────────────────────────────────

describe('CORTE 5A § D — un wizard run nuevo no hereda nada del anterior', () => {
  const OTHER_WIZARD_REQUEST = '99999999-8888-4777-8666-555555555555';

  test('cambia el `clientRequestId` de la pierna', () => {
    assert.notEqual(
      deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID),
      deriveLushaWaterfallClientRequestId(OTHER_WIZARD_REQUEST),
    );
  });

  test('cambia el `wizard_run_id` que la pierna publica', () => {
    assert.notEqual(
      buildWizardRunId(USER, WIZARD_CLIENT_REQUEST_ID),
      buildWizardRunId(USER, OTHER_WIZARD_REQUEST),
    );
  });

  test('y sigue siendo estable para el MISMO wizard run (reintento)', () => {
    assert.equal(
      deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID),
      deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID),
    );
    assert.equal(
      buildWizardRunId(USER, WIZARD_CLIENT_REQUEST_ID),
      buildWizardRunId(USER, WIZARD_CLIENT_REQUEST_ID),
    );
  });
});

// ── F · las tres piernas bajo UN wizard_run_id ──────────────────────────────

describe('CORTE 5A § F — Apollo R1 + R2 + Lusha comparten corrida', () => {
  /** Lo que `wizard-execution-actions` construye para Apollo. */
  const apollo = withResolvedIds(
    buildWizardRunCorrelation({
      userId: USER,
      clientRequestId: WIZARD_CLIENT_REQUEST_ID,
      reservationId: null,
      providerKey: 'apollo_organizations',
      requestSignature: 'CO|v2|1|',
    }),
    { batchId: CANONICAL_BATCH_ID },
  );

  /** Lo que la acción de Lusha construye cuando la pierna le pasa el contexto. */
  const lusha = withResolvedIds(
    buildWizardRunCorrelation({
      userId: USER,
      clientRequestId: deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID),
      overrideWizardRunId: buildWizardRunId(USER, WIZARD_CLIENT_REQUEST_ID),
      providerKey: 'lusha',
      requestSignature: 'CO|technology|2',
    }),
    { batchId: CANONICAL_BATCH_ID, reservationId: 'res-lusha' },
  );

  test('mismo `wizard_run_id`', () => {
    assert.equal(lusha.wizardRunId, apollo.wizardRunId);
  });

  test('mismo `batch_id`', () => {
    assert.equal(lusha.batchId, apollo.batchId);
    assert.equal(lusha.batchId, CANONICAL_BATCH_ID);
  });

  test('DISTINTO `client_request_id`: cada pierna paga lo suyo', () => {
    assert.notEqual(lusha.clientRequestId, apollo.clientRequestId);
  });

  test('DISTINTA clave de reconciliación: no se pisan las liquidaciones', () => {
    assert.notEqual(lusha.idempotencyKey, apollo.idempotencyKey);
  });

  test('la reconciliación de Apollo RECHAZA una fila de Lusha del mismo lote', () => {
    // Comparten `batch_id` y `wizard_run_id`; discrepan en `client_request_id`.
    // Ése es exactamente el eje por el que el gasto NO debe mezclarse.
    const verdict = matchUsageRowToRun(
      {
        batch_id: CANONICAL_BATCH_ID,
        wizard_run_id: lusha.wizardRunId,
        client_request_id: lusha.clientRequestId,
        reservation_id: 'res-lusha',
      },
      apollo,
    );
    assert.deepEqual(verdict, { matched: false, reason: 'contradicts_correlation' });
  });

  test('y sigue aceptando las suyas', () => {
    const verdict = matchUsageRowToRun(
      {
        batch_id: CANONICAL_BATCH_ID,
        wizard_run_id: apollo.wizardRunId,
        client_request_id: apollo.clientRequestId,
      },
      apollo,
    );
    assert.equal(verdict.matched, true);
  });

  test('sin override, la corrección desaparece: es el override lo que cierra M', () => {
    const sinOverride = buildWizardRunCorrelation({
      userId: USER,
      clientRequestId: deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID),
      providerKey: 'lusha',
      requestSignature: 'CO|technology|2',
    });
    assert.notEqual(sinOverride.wizardRunId, apollo.wizardRunId);
  });
});

// ── E · Lusha STANDALONE intacto ────────────────────────────────────────────

describe('CORTE 5A § E — la superficie Lusha de siempre no cambia', () => {
  test('sin override el `wizard_run_id` se sigue derivando de la propia corrida', () => {
    const standalone = buildWizardRunCorrelation({
      userId: USER,
      clientRequestId: WIZARD_CLIENT_REQUEST_ID,
      providerKey: 'lusha',
      requestSignature: 'CO|technology|2',
    });
    assert.equal(standalone.wizardRunId, buildWizardRunId(USER, WIZARD_CLIENT_REQUEST_ID));
  });

  test('`waterfall` es OPCIONAL en la acción: el clic de siempre no lo manda', () => {
    const code = stripComments(read(ACTION_REL));
    assert.match(
      code,
      /waterfall: z\s*\n?\s*\.object\(\{[\s\S]*?\}\)\s*\n?\s*\.optional\(\),/,
      'un bloque obligatorio rompería la superficie Lusha existente',
    );
  });

  test('sin `waterfall` se usa el reserve-or-return de siempre', () => {
    const code = stripComments(read(ACTION_REL));
    assert.match(
      code,
      /waterfall !== null\s*\n?\s*\?\s*createAdoptedLushaBatchResolver\(/,
      'la adopción por id sólo puede alcanzarse con contexto de waterfall',
    );
    assert.match(code, /:\s*createCanonicalLushaBatchResolver\(/);
  });

  test('sin `waterfall` el objetivo sigue siendo el de la superficie', () => {
    const code = stripComments(read(ACTION_REL));
    assert.match(
      code,
      /const requestedTarget =\s*\n?\s*waterfall !== null \? waterfall\.targetGap : LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES;/,
    );
  });
});

// ── Contratos que NO se tocan (§§ 11, 14) ───────────────────────────────────

describe('CORTE 5A — lo que este corte NO cambia', () => {
  const code = stripComments(read(ACTION_REL));

  test('la reserva de Lusha sigue anclada en SU `clientRequestId`', () => {
    assert.match(
      code,
      /reserveLushaRunCredits\(\{ userId: internalUserId, clientRequestId, requiredCredits \}\)/,
      'reservar con el clientRequestId del wizard haría a Lusha gastar de la reserva de Apollo',
    );
  });

  test('sigue habiendo UNA sola RPC de reserva y es la de siempre', () => {
    assert.match(code, /reserveWizardPilotCredits\(/);
    assert.doesNotMatch(code, /budget_rule/);
  });

  test('el `targetGap` del waterfall no puede exceder el objetivo del producto', () => {
    assert.match(code, /\.max\(LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES\)/);
    assert.match(code, /\.min\(1\)/);
  });

  test('el `wizard_run_id` NO se acepta del cliente: se deriva del actor', () => {
    assert.doesNotMatch(
      code,
      /wizardRunId: z\./,
      'aceptarlo permitiría colgar el gasto propio de la corrida de otra persona',
    );
    assert.match(code, /buildWizardRunId\(internalUserId, waterfall\.wizardClientRequestId\)/);
  });

  test('el par (corrida del wizard, identidad de la pierna) se VERIFICA', () => {
    assert.match(
      code,
      /deriveLushaWaterfallClientRequestId\(waterfall\.wizardClientRequestId\) !== clientRequestId/,
    );
  });
});

// ── G · dedupe cross-provider: la semilla de identidad ve lo de Apollo ──────

describe('CORTE 5A § G — Apollo y Lusha en el mismo lote no duplican empresa', () => {
  test('la siembra de identidad usa el lote canónico cuando la capa gratuita no aportó', () => {
    const code = stripComments(read(ACTION_REL));
    assert.match(
      code,
      /const identitySeedBatchId = prePaid\.batchId \?\? waterfall\?\.canonicalBatchId \?\? null;/,
      'sin esto Lusha admitiría una empresa que Apollo ya escribió en el MISMO lote',
    );
    assert.match(code, /loadBatchIdentityRegistry\(supabase, identitySeedBatchId\)/);
  });

  test('el dedupe compartido sigue cableado y no se sustituye por `provider_seen`', () => {
    const code = stripComments(read(ACTION_REL));
    assert.match(code, /checkCompanyDuplicate/);
    assert.match(code, /fetchActiveCandidatesForGuard/);
    assert.match(code, /loadBatchIdentityRegistry/);
  });
});

// ── La decisión pura: sin lote, no hay pierna ───────────────────────────────

describe('CORTE 5A — fail-closed sin lote canónico', () => {
  function decisionInput(overrides: Record<string, unknown> = {}) {
    return {
      waterfallEnabled: true,
      lushaAvailable: true,
      apolloTerminal: true,
      target: TARGET,
      usefulAccumulated: 2,
      macroIndustryKey: 'technology',
      canonicalBatchId: CANONICAL_BATCH_ID,
      ...overrides,
    } as Parameters<typeof decideLushaWaterfallLeg>[0];
  }

  test('con lote, corre y lo lleva consigo', () => {
    const decision = decideLushaWaterfallLeg(decisionInput());
    assert.equal(decision.run, true);
    assert.equal(decision.run === true && decision.canonicalBatchId, CANONICAL_BATCH_ID);
    assert.equal(decision.run === true && decision.gap, 3);
  });

  test('sin lote, NO corre', () => {
    for (const value of [null, '', '   ']) {
      const decision = decideLushaWaterfallLeg(decisionInput({ canonicalBatchId: value }));
      assert.deepEqual(decision, { run: false, reason: 'canonical_batch_unresolved' });
    }
  });

  test('«objetivo cubierto» sigue ganando: no se reporta un lote ausente sin necesidad', () => {
    const decision = decideLushaWaterfallLeg(
      decisionInput({ usefulAccumulated: TARGET, canonicalBatchId: null }),
    );
    assert.deepEqual(decision, { run: false, reason: 'target_reached' });
  });

  test('sin lote no sale NI UNA llamada a Lusha', async () => {
    const calls: unknown[] = [];
    const outcome = await runLushaWaterfallLeg(
      {
        wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
        canonicalBatchId: null,
        countryCode: 'CO',
        macroIndustryKey: 'technology',
        subIndustryId: null,
        target: TARGET,
        usefulAccumulated: 0,
        apolloTerminal: true,
      },
      {
        waterfallEnabled: () => true,
        lushaAvailable: () => true,
        runLushaBatch: async (input) => {
          calls.push(input);
          throw new Error('no debería llamarse');
        },
      },
    );
    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'canonical_batch_unresolved');
  });
});

// ── La pierna PASA el contexto, no lo adivina ───────────────────────────────

describe('CORTE 5A — la correlación viaja EXPLÍCITA hasta la acción', () => {
  test('la pierna entrega lote, corrida y hueco', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const outcome = await runLushaWaterfallLeg(
      {
        wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
        canonicalBatchId: CANONICAL_BATCH_ID,
        countryCode: 'CO',
        macroIndustryKey: 'technology',
        subIndustryId: null,
        target: TARGET,
        usefulAccumulated: 2,
        apolloTerminal: true,
      },
      {
        waterfallEnabled: () => true,
        lushaAvailable: () => true,
        runLushaBatch: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return { status: 'success', batchId: CANONICAL_BATCH_ID } as never;
        },
      },
    );

    assert.equal(calls.length, 1);
    // 🔴 Igualdad ESTRICTA: es lo que impide que un campo del bloque de
    // correlación se caiga por el camino sin que nadie lo note.
    assert.deepEqual(calls[0]?.waterfall, {
      wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
      canonicalBatchId: CANONICAL_BATCH_ID,
      targetGap: 3,
    });
    // 🔴 Y la identidad de reserva sigue siendo la DERIVADA, no la del wizard.
    assert.equal(
      calls[0]?.clientRequestId,
      deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID),
    );
    assert.notEqual(calls[0]?.clientRequestId, WIZARD_CLIENT_REQUEST_ID);
    assert.equal(outcome.executed, true);
  });

  test('dos ejecuciones del MISMO waterfall entregan el MISMO contexto', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const deps = {
      waterfallEnabled: () => true,
      lushaAvailable: () => true,
      runLushaBatch: async (input: unknown) => {
        seen.push(input as Record<string, unknown>);
        return { status: 'success', batchId: CANONICAL_BATCH_ID } as never;
      },
    };
    const input = {
      wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
      canonicalBatchId: CANONICAL_BATCH_ID,
      countryCode: 'CO',
      macroIndustryKey: 'technology',
      subIndustryId: null,
      target: TARGET,
      usefulAccumulated: 2,
      apolloTerminal: true,
    };

    await runLushaWaterfallLeg(input, deps);
    await runLushaWaterfallLeg(input, deps);

    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], seen[1], 'un reintento no puede acuñar lote ni reserva nuevos');
  });
});

// ── El resolutor de siempre sigue siendo el de siempre ──────────────────────

describe('CORTE 5A — el reserve-or-return no cambió de comportamiento', () => {
  test('sigue creando el lote cuando nadie lo materializó', async () => {
    const rows: unknown[] = [];
    const resolver = createCanonicalLushaBatchResolver(
      async (row) => {
        rows.push(row);
        return { id: 'nuevo', adopted: false, identityEpoch: 0 };
      },
      {
        createdByUserId: USER,
        clientRequestId: WIZARD_CLIENT_REQUEST_ID,
        requestedTarget: TARGET,
        defaults: {
          name: 'x',
          country: 'Colombia',
          country_code: 'CO',
          industry: 'technology',
          search_depth: 'standard',
          status: 'draft',
          source: 'ai_generated',
          metadata: {},
        } as never,
      },
    );
    const reservation = await resolver.resolve();
    assert.equal(reservation.id, 'nuevo');
    assert.equal(reservation.adopted, false);
    assert.equal(rows.length, 1);
  });
});
