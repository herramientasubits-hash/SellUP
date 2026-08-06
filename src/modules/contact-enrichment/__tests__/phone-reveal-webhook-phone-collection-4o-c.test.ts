/**
 * Agente 2A — WEBHOOK: captura de TODOS los teléfonos Apollo
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * El core del webhook con la dep del writer inyectada. Sin red, sin Supabase,
 * sin proveedores y sin créditos: la persistencia es el doble en memoria.
 *
 * Contrato verificado aquí:
 *   * los N teléfonos del payload se persisten, no solo el elegido;
 *   * `contact_enrichment_candidates.phone` conserva EXACTAMENTE el teléfono que
 *     escribía antes del hito;
 *   * escalar y principal nunca discrepan;
 *   * un fallo del writer no produce un éxito silencioso;
 *   * los caminos no terminales no escriben colección;
 *   * ni el usage-log ni el resultado contienen un teléfono.
 *
 * Todos los números son sintéticos 555.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import { FakeCandidatePhoneStore } from './candidate-phone-collection-fake-store';

const NOW = '2026-08-06T10:00:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-4oc';
const CANDIDATE_ID = 'cand-4oc';

const MOBILE = '+15550000001';
const DIRECT = '+15550000002';
const WORK = '+15550000003';
const HQ = '+15550000004';

/**
 * Apollo person id sintético (24 hex). Es un id OPACO de correlación, no PII, y
 * hace falta para que la comprobación de supresión por persona sea EVALUABLE:
 * sin él el guard devuelve `not_evaluable` y no bloquea nada.
 */
const PERSON_ID = '0123456789abcdef01234567';

interface Harness {
  store: FakeCandidatePhoneStore;
  patches: Array<{ candidateId: string; patch: WebhookRevealPersistencePatch }>;
  logs: WebhookUsageLogEntry[];
  deps: ApolloPhoneRevealWebhookDeps;
}

function harness(
  options: {
    candidate?: Partial<WebhookCandidateRecord>;
    withCollectionWriter?: boolean;
    store?: FakeCandidatePhoneStore;
    waterfallRunId?: string | null;
  } = {},
): Harness {
  const store = options.store ?? new FakeCandidatePhoneStore();
  const patches: Harness['patches'] = [];
  const logs: WebhookUsageLogEntry[] = [];
  const candidate: WebhookCandidateRecord = {
    id: CANDIDATE_ID,
    accountId: 'acct-1',
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    ...options.candidate,
  };

  const deps: ApolloPhoneRevealWebhookDeps = {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () => candidate,
    persist: async (candidateId, patch) => {
      patches.push({ candidateId, patch });
    },
    logUsage: async (entry) => {
      logs.push(entry);
    },
    // Sin tombstone registrado: la supresión por PERSONA no interfiere aquí.
    lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
    ...(options.withCollectionWriter === false
      ? {}
      : { persistCandidatePhoneCollection: store.persist }),
    ...(options.waterfallRunId
      ? { resolveWaterfallRunId: async () => options.waterfallRunId! }
      : {}),
  };

  return { store, patches, logs, deps };
}

function run(
  payload: ApolloPhoneRevealWebhookPayload,
  h: Harness,
): ReturnType<typeof runApolloPhoneRevealWebhook> {
  return runApolloPhoneRevealWebhook(
    { tokenProvided: TOKEN, payload: { request_id: REQUEST_ID, ...payload } },
    h.deps,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Captura completa
// ═══════════════════════════════════════════════════════════════════

describe('4O-C webhook — captura completa', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('1 teléfono móvil ⇒ 1 canónico, 1 procedencia, principal móvil', async () => {
    const result = await run(
      { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      h,
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 1);
    assert.equal(h.store.sourcesFor(CANDIDATE_ID).length, 1);
    assert.equal(h.store.primaryOf(CANDIDATE_ID)?.phoneType, 'mobile');
    assert.equal(h.patches[0].patch.phone, MOBILE);
  });

  it('DIRECT + MOBILE ⇒ 2 canónicos, escalar MÓVIL, DIRECT ya no se pierde', async () => {
    const result = await run(
      {
        phone_numbers: [
          { sanitized_number: DIRECT, type_cd: 'direct_dial', credits_consumed: 4 },
          { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
        ],
      },
      h,
    );
    assert.equal(result.outcome, 'revealed');
    // Lo que ya se veía NO cambia…
    assert.equal(h.patches[0].patch.phone, MOBILE);
    assert.equal(h.patches[0].patch.enrichment_metadata?.phone?.type, 'mobile');
    // …y lo que se perdía ahora está guardado.
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 2);
    assert.ok(
      h.store.livePhones(CANDIDATE_ID).some((row) => row.displayPhone === DIRECT),
    );
    // Costo total real, sin repartir por número.
    assert.equal(h.patches[0].patch.phone_reveal_cost_credits, 8);
    assert.equal(h.patches[0].patch.phone_reveal_cost_source, 'reported');
  });

  it('WORK + HQ + MOBILE ⇒ 3 canónicos y principal móvil', async () => {
    await run(
      {
        phone_numbers: [
          { sanitized_number: WORK, type_cd: 'work' },
          { sanitized_number: HQ, type_cd: 'hq' },
          { sanitized_number: MOBILE, type_cd: 'mobile' },
        ],
      },
      h,
    );
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 3);
    assert.equal(h.store.primaryOf(CANDIDATE_ID)?.displayPhone, MOBILE);
    assert.equal(h.patches[0].patch.phone, MOBILE);
  });

  it('el mismo teléfono en raíz y person ⇒ 1 canónico y 1 procedencia', async () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 };
    await run(
      { phone_numbers: [{ ...entry }], person: { phone_numbers: [{ ...entry }] } },
      h,
    );
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 1);
    assert.equal(h.store.sourcesFor(CANDIDATE_ID).length, 1);
    // Y el cargo se cuenta UNA vez, no dos.
    assert.equal(h.patches[0].patch.phone_reveal_cost_credits, 4);
  });

  it('el mismo número con tipos distintos ⇒ 1 canónico, 2 procedencias con su raw_type', async () => {
    await run(
      {
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'work' }],
        person: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      },
      h,
    );
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 1);
    assert.deepEqual(
      h.store
        .sourcesFor(CANDIDATE_ID)
        .map((source) => source.rawProviderType)
        .sort(),
      ['mobile', 'work'],
    );
  });

  it('un número inválido se persiste pero NO es principal', async () => {
    await run(
      {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'invalid' },
          { sanitized_number: WORK, type_cd: 'work', status_cd: 'valid' },
        ],
      },
      h,
    );
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(h.store.primaryOf(CANDIDATE_ID)?.displayPhone, WORK);
    // Escalar y principal coinciden: no existe el par «principal A / escalar B».
    assert.equal(h.patches[0].patch.phone, WORK);
  });

  it('sin fila elegible como principal el escalar conserva el valor heredado', async () => {
    // Un único número demasiado corto para una forma canónica: la migración
    // prohíbe marcarlo principal, pero seguir mostrándolo es lo que se hacía y
    // dejar de guardarlo sería perder un dato ya pagado.
    await run({ phone_numbers: [{ sanitized_number: '555', type_cd: 'mobile' }] }, h);
    assert.equal(h.patches[0].patch.phone, '555');
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 1);
    assert.equal(h.store.primaryOf(CANDIDATE_ID), null);
  });

  it('la corrida del waterfall queda en la procedencia, y el modo sigue siendo `reveal`', async () => {
    const wf = harness({ waterfallRunId: 'wf-run-1' });
    await run({ phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }, wf);
    const source = wf.store.sourcesFor(CANDIDATE_ID)[0];
    assert.equal(source.waterfallRunId, 'wf-run-1');
    assert.equal(source.acquisitionMode, 'reveal');
    assert.equal(source.provider, 'apollo');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotencia y supresión
// ═══════════════════════════════════════════════════════════════════

describe('4O-C webhook — idempotencia y tombstones', () => {
  it('reprocesar el MISMO webhook no duplica filas ni procedencias', async () => {
    const store = new FakeCandidatePhoneStore();
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile' },
        { sanitized_number: WORK, type_cd: 'work' },
      ],
    };
    await run(payload, harness({ store }));
    const firstPrimary = store.primaryOf(CANDIDATE_ID)?.dedupeKey ?? null;
    await run(payload, harness({ store }));

    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, 2);
    assert.equal(store.primaryOf(CANDIDATE_ID)?.dedupeKey, firstPrimary);
  });

  it('un número suprimido NO resucita, NO vuelve a ser principal y NO añade procedencia', async () => {
    const store = new FakeCandidatePhoneStore();
    await run({ phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }, harness({ store }));
    const key = store.livePhones(CANDIDATE_ID)[0].dedupeKey;
    const sourcesBefore = store.sourcesFor(CANDIDATE_ID).length;
    store.suppress(CANDIDATE_ID, key, '2026-08-06T11:00:00.000Z');

    // El mismo número vuelve a llegar, ahora acompañado de otro.
    const h = harness({ store });
    await run(
      {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile' },
          { sanitized_number: WORK, type_cd: 'work' },
        ],
      },
      h,
    );

    const tombstone = store.rowFor(CANDIDATE_ID, key)!;
    assert.notEqual(tombstone.suppressedAt, null);
    assert.equal(tombstone.normalizedPhone, null);
    assert.equal(tombstone.displayPhone, null);
    assert.equal(tombstone.isPrimary, false);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, sourcesBefore + 1);
    // El principal pasa al superviviente, y el escalar lo sigue.
    assert.equal(store.primaryOf(CANDIDATE_ID)?.displayPhone, WORK);
    assert.equal(h.patches[0].patch.phone, WORK);
    // El reveal sigue cerrando terminal: la supresión no lo convierte en error.
    assert.equal(h.patches[0].patch.phone_reveal_status, 'revealed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fallo del writer
// ═══════════════════════════════════════════════════════════════════

describe('4O-C webhook — el writer falla', () => {
  it('no hay éxito silencioso: sin patch terminal, sin escalar y outcome propio', async () => {
    const store = new FakeCandidatePhoneStore();
    store.failNextWrite = true;
    const h = harness({ store });
    const result = await run(
      { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 }] },
      h,
    );

    assert.equal(result.outcome, 'collection_persistence_unavailable');
    // HTTP 200: un 5xx solo haría reintentar a Apollo sin resolver la causa.
    assert.equal(result.httpStatus, 200);
    // NADA del candidato se tocó ⇒ sigue en vuelo y recuperable con 0 créditos.
    assert.deepEqual(h.patches, []);
    assert.equal(store.livePhones(CANDIDATE_ID).length, 0);
    // Queda rastro explícito, con el costo real que Apollo reportó.
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].status, 'error');
    assert.equal(h.logs[0].errorCode, 'collection_persistence_unavailable');
    assert.equal(h.logs[0].metadata.phone_revealed, false);
    assert.equal(h.logs[0].metadata.credits_used, 4);
    assert.equal(h.logs[0].metadata.phone_collection?.collection_persisted, false);
  });

  it('el waterfall NO se continúa: el reveal no ha concluido, solo no se ha guardado', async () => {
    const store = new FakeCandidatePhoneStore();
    store.failNextWrite = true;
    const continued: unknown[] = [];
    const h = harness({ store, waterfallRunId: 'wf-run-1' });
    h.deps.continueWaterfall = async (args) => {
      continued.push(args);
    };
    await run({ phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }, h);
    assert.deepEqual(continued, []);
  });

  it('un fallo posterior del writer no revive un candidato ya terminal', async () => {
    const store = new FakeCandidatePhoneStore();
    store.failNextWrite = true;
    const h = harness({ store, candidate: { phoneRevealStatus: 'revealed' } });
    const result = await run(
      { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      h,
    );
    assert.equal(result.outcome, 'already_terminal');
    assert.deepEqual(store.writes, []);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Estados terminales que NO deben escribir colección
// ═══════════════════════════════════════════════════════════════════

describe('4O-C webhook — caminos que NO escriben colección', () => {
  it('no_phone_found ⇒ 0 filas, 0 procedencias, sin phone_revealed_at', async () => {
    const h = harness();
    const result = await run({ phone_numbers: [] }, h);
    assert.equal(result.outcome, 'no_phone_found');
    assert.deepEqual(h.store.writes, []);
    assert.equal(h.store.phones.length, 0);
    assert.equal(h.patches[0].patch.phone_revealed_at, undefined);
    assert.equal(h.patches[0].patch.phone_reveal_completed_at, NOW);
  });

  it('bloqueado por supresión de la PERSONA ⇒ 0 filas', async () => {
    const h = harness();
    h.deps.lookupPhoneCacheSuppression = async () => ({ suppressedAt: NOW });
    const result = await run(
      {
        person: { id: PERSON_ID },
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
      },
      h,
    );
    assert.equal(result.outcome, 'blocked_suppressed');
    assert.deepEqual(h.store.writes, []);
    assert.equal(h.patches[0].patch.phone, undefined);
  });

  it('supresión no verificable ⇒ 0 filas y candidato en vuelo', async () => {
    const h = harness();
    h.deps.lookupPhoneCacheSuppression = async () => {
      throw new Error('unreachable');
    };
    const result = await run(
      {
        person: { id: PERSON_ID },
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
      },
      h,
    );
    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.deepEqual(h.store.writes, []);
    assert.deepEqual(h.patches, []);
  });

  it('candidato desconocido o ya terminal ⇒ el writer no se llama', async () => {
    const unknown = harness();
    unknown.deps.loadCandidateByRequestId = async () => null;
    await run({ phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }, unknown);
    assert.deepEqual(unknown.store.writes, []);

    const terminal = harness({ candidate: { phoneRevealStatus: 'no_phone_found' } });
    await run({ phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }, terminal);
    assert.deepEqual(terminal.store.writes, []);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sin la dep cableada: comportamiento previo al hito
// ═══════════════════════════════════════════════════════════════════

describe('4O-C webhook — sin el writer cableado', () => {
  it('el reveal cierra igual que antes y la metadata no gana claves nuevas', async () => {
    const h = harness({ withCollectionWriter: false });
    const result = await run(
      {
        phone_numbers: [
          { sanitized_number: DIRECT, type_cd: 'direct_dial' },
          { sanitized_number: MOBILE, type_cd: 'mobile' },
        ],
      },
      h,
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(h.patches[0].patch.phone, MOBILE);
    assert.equal(h.store.phones.length, 0);
    assert.equal('phone_collection' in h.logs[0].metadata, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contabilidad y privacidad
// ═══════════════════════════════════════════════════════════════════

describe('4O-C webhook — contabilidad', () => {
  it('N teléfonos NO multiplican reservas, usage-logs ni costo', async () => {
    const h = harness();
    await run(
      {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
          { sanitized_number: WORK, type_cd: 'work', credits_consumed: 4 },
          { sanitized_number: HQ, type_cd: 'hq' },
        ],
      },
      h,
    );
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 3);
    // UN usage-log, UN patch, UN costo total.
    assert.equal(h.logs.length, 1);
    assert.equal(h.patches.length, 1);
    assert.equal(h.logs[0].creditsUsed, 8);
    assert.equal(h.patches[0].patch.phone_reveal_cost_credits, 8);
    // Ninguna fila lleva costo: el dinero vive en la reserva y el usage-log.
    for (const row of h.store.livePhones(CANDIDATE_ID)) {
      assert.equal('costCredits' in row, false);
      assert.equal('credits' in row, false);
    }
  });
});

describe('4O-C webhook — privacidad', () => {
  it('ni el usage-log ni el resultado contienen teléfono ni dedupe_key', async () => {
    const h = harness();
    const result = await run(
      {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
          { sanitized_number: WORK, type_cd: 'work' },
        ],
      },
      h,
    );
    const serialized = JSON.stringify({ logs: h.logs, result });
    for (const number of [MOBILE, WORK, '5550000001', '5550000003']) {
      assert.equal(serialized.includes(number), false, `no debe aparecer ${number}`);
    }
    for (const row of h.store.livePhones(CANDIDATE_ID)) {
      assert.equal(serialized.includes(row.dedupeKey), false, 'sin dedupe_key');
    }
    // Lo que SÍ se registra son cifras y banderas, de forma cerrada.
    assert.deepEqual(Object.keys(h.logs[0].metadata.phone_collection ?? {}).sort(), [
      'canonical_phone_count',
      'collection_persisted',
      'duplicate_phone_count',
      'primary_persisted',
      'source_count',
      'suppressed_skipped_count',
    ]);
    assert.equal(h.logs[0].metadata.phone_collection?.canonical_phone_count, 2);
    assert.equal(h.logs[0].metadata.phone_collection?.collection_persisted, true);
    assert.equal(h.logs[0].metadata.phone_collection?.primary_persisted, true);
  });
});
