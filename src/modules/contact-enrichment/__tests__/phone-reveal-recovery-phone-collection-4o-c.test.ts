/**
 * Agente 2A — RECOVERY: captura de TODOS los teléfonos Apollo
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * El core del recovery con la dep del writer inyectada. Sin red, sin Supabase,
 * sin Apollo y sin créditos: el poll y la persistencia son dobles en memoria.
 *
 * El recovery tiene que producir EXACTAMENTE la misma colección que el webhook
 * para el mismo payload —mismo normalizador, mismo ranking, misma contabilidad—
 * y solo debe diferenciarse en la fase de la procedencia. Eso es lo que se fija
 * aquí; la equivalencia entre los dos caminos se prueba en la suite cross-path.
 *
 * Todos los números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  RECOVERY_REVEAL_PHASE,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';
import { FakeCandidatePhoneStore } from './candidate-phone-collection-fake-store';

const NOW = '2026-08-06T10:00:00.000Z';
const RECOVERY_ID = '-4594297923800105423';
const CANDIDATE_ID = 'cand-4oc';

const MOBILE = '+15550000001';
const DIRECT = '+15550000002';
const WORK = '+15550000003';
const PERSON_ID = '0123456789abcdef01234567';

interface Harness {
  store: FakeCandidatePhoneStore;
  patches: Array<{ id: string; patch: RecoveryPersistencePatch }>;
  logs: RecoveryUsageLogEntry[];
  deps: RecoverApolloPhoneRevealDeps;
}

function harness(
  options: {
    payload?: ApolloPhoneRevealWebhookPayload | null;
    candidate?: Partial<RecoveryCandidateRecord>;
    store?: FakeCandidatePhoneStore;
    withCollectionWriter?: boolean;
    waterfallRunId?: string | null;
  } = {},
): Harness {
  const store = options.store ?? new FakeCandidatePhoneStore();
  const patches: Harness['patches'] = [];
  const logs: RecoveryUsageLogEntry[] = [];
  const candidate: RecoveryCandidateRecord = {
    id: CANDIDATE_ID,
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...options.candidate,
  };

  const deps: RecoverApolloPhoneRevealDeps = {
    nowIso: NOW,
    loadCandidate: async () => candidate,
    resolveRecoveryRequestId: async () => RECOVERY_ID,
    fetchWebhookResult: async () => ({
      kind: 'result',
      payload: options.payload ?? {},
    }),
    persist: async (id, patch) => {
      patches.push({ id, patch });
    },
    logUsage: async (entry) => {
      logs.push(entry);
    },
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

function recover(h: Harness) {
  return recoverApolloPhoneRevealForCandidate({ candidateId: CANDIDATE_ID }, h.deps);
}

// ═══════════════════════════════════════════════════════════════════
// Captura completa
// ═══════════════════════════════════════════════════════════════════

describe('4O-C recovery — captura completa', () => {
  it('múltiples teléfonos ⇒ todos persistidos, principal móvil, escalar sin cambios', async () => {
    const h = harness({
      payload: {
        phone_numbers: [
          { sanitized_number: DIRECT, type_cd: 'direct_dial', credits_consumed: 4 },
          { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
          { sanitized_number: WORK, type_cd: 'work' },
        ],
      },
    });
    const result = await recover(h);
    assert.equal(result.outcome, 'revealed');
    assert.equal(result.phoneRevealed, true);
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 3);
    assert.equal(h.store.primaryOf(CANDIDATE_ID)?.displayPhone, MOBILE);
    assert.equal(h.patches[0].patch.phone, MOBILE);
    assert.equal(h.patches[0].patch.phone_revealed_at, NOW);
    assert.equal(result.creditsUsed, 8);
  });

  it('el mismo registro repetido en raíz y person ⇒ 1 canónico, 1 procedencia, 1 cargo', async () => {
    const entry = { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 };
    const h = harness({
      payload: {
        phone_numbers: [{ ...entry }],
        person: { phone_numbers: [{ ...entry }] },
      },
    });
    await recover(h);
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 1);
    assert.equal(h.store.sourcesFor(CANDIDATE_ID).length, 1);
    assert.equal(h.patches[0].patch.phone_reveal_cost_credits, 4);
  });

  it('la procedencia queda marcada como recovery_poll, no como webhook', async () => {
    const h = harness({
      payload: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
    });
    await recover(h);
    const key = h.store.sourcesFor(CANDIDATE_ID)[0].sourceEventKey;
    assert.ok(key.includes(RECOVERY_REVEAL_PHASE));
    assert.equal(key.includes(':webhook:'), false);
  });

  it('un número inválido se persiste y nunca es principal', async () => {
    const h = harness({
      payload: {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'invalid' },
          { sanitized_number: WORK, type_cd: 'work' },
        ],
      },
    });
    await recover(h);
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(h.store.primaryOf(CANDIDATE_ID)?.displayPhone, WORK);
    assert.equal(h.patches[0].patch.phone, WORK);
  });

  it('sin sanitized pero con raw utilizable ⇒ se captura igualmente', async () => {
    const h = harness({
      payload: { phone_numbers: [{ raw_number: '(555) 000-0001', type_cd: 'mobile' }] },
    });
    await recover(h);
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 1);
    assert.equal(h.patches[0].patch.phone, '(555) 000-0001');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Idempotencia
// ═══════════════════════════════════════════════════════════════════

describe('4O-C recovery — idempotencia', () => {
  it('dos recuperaciones del MISMO payload no duplican nada', async () => {
    const store = new FakeCandidatePhoneStore();
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [
        { sanitized_number: MOBILE, type_cd: 'mobile' },
        { sanitized_number: WORK, type_cd: 'work' },
      ],
    };
    await recover(harness({ payload, store }));
    const primary = store.primaryOf(CANDIDATE_ID)?.dedupeKey ?? null;
    await recover(harness({ payload, store }));

    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, 2);
    assert.equal(store.primaryOf(CANDIDATE_ID)?.dedupeKey, primary);
  });

  it('un número suprimido no resucita por una recuperación', async () => {
    const store = new FakeCandidatePhoneStore();
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
    };
    await recover(harness({ payload, store }));
    const key = store.livePhones(CANDIDATE_ID)[0].dedupeKey;
    store.suppress(CANDIDATE_ID, key, '2026-08-06T11:00:00.000Z');

    const h = harness({ payload, store });
    await recover(h);
    const tombstone = store.rowFor(CANDIDATE_ID, key)!;
    assert.notEqual(tombstone.suppressedAt, null);
    assert.equal(tombstone.normalizedPhone, null);
    assert.equal(tombstone.isPrimary, false);
    assert.equal(store.primaryOf(CANDIDATE_ID), null);
    // Sin principal vivo el escalar cae al heredado: el número ya se pagó y el
    // producto lo mostraba. El tombstone gobierna la COLECCIÓN, que es donde se
    // registró la supresión.
    assert.equal(h.patches[0].patch.phone, MOBILE);
    assert.equal(h.logs[0].metadata.phone_collection?.suppressed_skipped_count, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fallo del writer
// ═══════════════════════════════════════════════════════════════════

describe('4O-C recovery — el writer falla', () => {
  it('no terminaliza: solo sella last_checked_at y el candidato sigue recuperable', async () => {
    const store = new FakeCandidatePhoneStore();
    store.failNextWrite = true;
    const h = harness({
      store,
      payload: {
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 }],
      },
    });
    const result = await recover(h);

    assert.equal(result.outcome, 'collection_persistence_unavailable');
    assert.equal(result.phoneRevealed, false);
    assert.equal(h.patches.length, 1);
    // El ÚNICO campo tocado es la marca de verificación: nada terminal.
    assert.deepEqual(Object.keys(h.patches[0].patch), ['phone_reveal_last_checked_at']);
    assert.equal(store.livePhones(CANDIDATE_ID).length, 0);
    assert.equal(h.logs[0].status, 'error');
    assert.equal(h.logs[0].errorCode, 'collection_persistence_unavailable');
    assert.equal(h.logs[0].metadata.phone_collection?.collection_persisted, false);
  });

  it('el waterfall NO se continúa cuando la colección no se pudo escribir', async () => {
    const store = new FakeCandidatePhoneStore();
    store.failNextWrite = true;
    const continued: unknown[] = [];
    const h = harness({
      store,
      waterfallRunId: 'wf-run-1',
      payload: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
    });
    h.deps.continueWaterfall = async (args) => {
      continued.push(args);
    };
    await recover(h);
    assert.deepEqual(continued, []);
  });

  it('en el batch cuenta como `failed`, no como `skipped`', async () => {
    const summary = await recoverStaleApolloPhoneRevealRequests(
      { dryRun: false, maxCandidates: 1 },
      {
        nowIso: NOW,
        findStaleCandidateIds: async () => ['a'],
        recoverOne: async () => 'collection_persistence_unavailable',
      },
    );
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.recovered, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Caminos que NO escriben colección
// ═══════════════════════════════════════════════════════════════════

describe('4O-C recovery — caminos que NO escriben colección', () => {
  it('no_phone_found ⇒ 0 filas', async () => {
    const h = harness({ payload: { phone_numbers: [] } });
    const result = await recover(h);
    assert.equal(result.outcome, 'no_phone_found');
    assert.deepEqual(h.store.writes, []);
  });

  it('todavía procesando ⇒ 0 filas y sigue no terminal', async () => {
    const h = harness({ payload: { status: 'pending', retry_after_seconds: 30 } });
    const result = await recover(h);
    assert.equal(result.outcome, 'still_pending');
    assert.deepEqual(h.store.writes, []);
  });

  it('404 / 401 / error del proveedor ⇒ 0 filas', async () => {
    for (const fetchResult of [
      { kind: 'not_found' as const },
      { kind: 'unauthorized' as const },
      { kind: 'error' as const, code: 'boom' },
    ]) {
      const h = harness();
      h.deps.fetchWebhookResult = async () => fetchResult;
      await recover(h);
      assert.deepEqual(h.store.writes, []);
    }
  });

  it('candidato inelegible (ya terminal, otro proveedor, con teléfono) ⇒ 0 filas', async () => {
    for (const overrides of [
      { phoneRevealStatus: 'revealed' },
      { phoneRevealProvider: 'lusha' },
      { existingPhone: MOBILE },
    ] as Array<Partial<RecoveryCandidateRecord>>) {
      const h = harness({
        candidate: overrides,
        payload: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
      });
      await recover(h);
      assert.deepEqual(h.store.writes, []);
    }
  });

  it('bloqueado por supresión de la PERSONA ⇒ 0 filas', async () => {
    const h = harness({
      payload: {
        person: { id: PERSON_ID },
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
      },
    });
    h.deps.lookupPhoneCacheSuppression = async () => ({ suppressedAt: NOW });
    const result = await recover(h);
    assert.equal(result.outcome, 'blocked_suppressed');
    assert.deepEqual(h.store.writes, []);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sin la dep cableada, contabilidad y privacidad
// ═══════════════════════════════════════════════════════════════════

describe('4O-C recovery — sin el writer cableado', () => {
  it('se comporta como antes del hito y no añade claves a la metadata', async () => {
    const h = harness({
      withCollectionWriter: false,
      payload: {
        phone_numbers: [
          { sanitized_number: DIRECT, type_cd: 'direct_dial' },
          { sanitized_number: MOBILE, type_cd: 'mobile' },
        ],
      },
    });
    const result = await recover(h);
    assert.equal(result.outcome, 'revealed');
    assert.equal(h.patches[0].patch.phone, MOBILE);
    assert.equal(h.store.phones.length, 0);
    assert.equal('phone_collection' in h.logs[0].metadata, false);
  });
});

describe('4O-C recovery — contabilidad y privacidad', () => {
  it('N teléfonos ⇒ UN usage-log y UN costo, sin costo por número', async () => {
    const h = harness({
      payload: {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
          { sanitized_number: WORK, type_cd: 'work', credits_consumed: 4 },
        ],
      },
    });
    await recover(h);
    assert.equal(h.store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0].creditsUsed, 8);
    assert.equal(h.patches[0].patch.phone_reveal_cost_credits, 8);
    assert.equal(h.patches[0].patch.phone_reveal_cost_source, 'reported');
  });

  it('ni el usage-log ni el resultado contienen teléfono ni dedupe_key', async () => {
    const h = harness({
      payload: {
        phone_numbers: [
          { sanitized_number: MOBILE, type_cd: 'mobile' },
          { sanitized_number: WORK, type_cd: 'work' },
        ],
      },
    });
    const result = await recover(h);
    const serialized = JSON.stringify({ logs: h.logs, result });
    for (const value of [MOBILE, WORK, '5550000001', '5550000003']) {
      assert.equal(serialized.includes(value), false, `no debe aparecer ${value}`);
    }
    for (const row of h.store.livePhones(CANDIDATE_ID)) {
      assert.equal(serialized.includes(row.dedupeKey), false, 'sin dedupe_key');
    }
    assert.deepEqual(Object.keys(h.logs[0].metadata.phone_collection ?? {}).sort(), [
      'canonical_phone_count',
      'collection_persisted',
      'duplicate_phone_count',
      'primary_persisted',
      'source_count',
      'suppressed_skipped_count',
    ]);
  });
});
