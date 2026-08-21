/**
 * Agente 2A — Webhook y recovery escribiendo en la MISMA colección
 * (AGENT2A-PHONE-REVEAL-4O-C)
 *
 * POR QUÉ ESTA SUITE. Webhook, cron L2 y revisión manual L3 pueden ver el MISMO
 * resultado de Apollo: el callback llega tarde, el cron ya lo había recuperado, o
 * la operadora pulsa «Revisar resultado ahora». Probar cada camino por separado
 * no dice nada sobre lo único que importa aquí — que los tres converjan a UNA
 * colección sin duplicar filas, procedencias, principales ni costo.
 *
 * Por eso los dos cores comparten el MISMO almacén en memoria en cada escenario.
 *
 * Todos los números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import { FakeCandidatePhoneStore } from './candidate-phone-collection-fake-store';

const NOW_WEBHOOK = '2026-08-06T10:00:00.000Z';
const NOW_RECOVERY = '2026-08-06T10:30:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-4oc';
const RECOVERY_ID = '-4594297923800105423';
const CANDIDATE_ID = 'cand-4oc';
/**
 * Apollo person id sintético (24 hex), opaco e inventado. Necesario para que la
 * comprobación de supresión sea EVALUABLE (AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1):
 * sin él el gate ahora BLOQUEA (`not_evaluable` ⇒ fail-closed), y estas pruebas no
 * son sobre supresión — son sobre la colección de teléfonos.
 */
const PERSON_ID = '0123456789abcdef01234567';

const MOBILE = '+15550000001';
const DIRECT = '+15550000002';
const WORK = '+15550000003';

const PAYLOAD: ApolloPhoneRevealWebhookPayload = {
  request_id: REQUEST_ID,
  phone_numbers: [
    { sanitized_number: DIRECT, type_cd: 'direct_dial', credits_consumed: 4 },
    { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
  ],
};

interface Trace {
  webhookPatches: WebhookRevealPersistencePatch[];
  recoveryPatches: RecoveryPersistencePatch[];
  logs: Array<WebhookUsageLogEntry | RecoveryUsageLogEntry>;
}

function newTrace(): Trace {
  return { webhookPatches: [], recoveryPatches: [], logs: [] };
}

/**
 * Ejecuta el WEBHOOK contra el almacén compartido.
 * `alreadyTerminal` simula que otro camino ya cerró el candidato.
 */
async function runWebhook(
  store: FakeCandidatePhoneStore,
  trace: Trace,
  options: { alreadyTerminal?: boolean } = {},
) {
  const candidate: WebhookCandidateRecord = {
    id: CANDIDATE_ID,
    accountId: 'acct-1',
    enrichmentMetadata: {},
    phoneRevealStatus: options.alreadyTerminal ? 'revealed' : 'requested',
    apolloPersonId: PERSON_ID,
    source: 'apollo',
  };
  // El doble y el fixture son EL MISMO candidato: se sincronizan para que el core
  // y el almacén no discrepen sobre si el reveal sigue en vuelo.
  store.registerCandidate(CANDIDATE_ID, {
    phoneRevealStatus: candidate.phoneRevealStatus,
    phoneRevealRequestId: REQUEST_ID,
  });
  return runApolloPhoneRevealWebhook(
    { tokenProvided: TOKEN, payload: PAYLOAD },
    {
      expectedToken: TOKEN,
      nowIso: NOW_WEBHOOK,
      loadCandidateByRequestId: async () => candidate,
      persist: async (_id, patch) => {
        trace.webhookPatches.push(patch);
      },
      logUsage: async (entry) => {
        trace.logs.push(entry);
      },
      lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
      persistCandidatePhoneCollection: store.persist,
    },
  );
}

/** Ejecuta el RECOVERY contra el mismo almacén. */
async function runRecovery(
  store: FakeCandidatePhoneStore,
  trace: Trace,
  options: { alreadyTerminal?: boolean } = {},
) {
  const candidate: RecoveryCandidateRecord = {
    id: CANDIDATE_ID,
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    phoneRevealStatus: options.alreadyTerminal ? 'revealed' : 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: PERSON_ID,
    source: 'apollo',
  };
  store.registerCandidate(CANDIDATE_ID, {
    phoneRevealStatus: candidate.phoneRevealStatus,
    phoneRevealRequestId: REQUEST_ID,
  });
  return recoverApolloPhoneRevealForCandidate(
    { candidateId: CANDIDATE_ID },
    {
      nowIso: NOW_RECOVERY,
      loadCandidate: async () => candidate,
      resolveRecoveryRequestId: async () => RECOVERY_ID,
      fetchWebhookResult: async () => ({ kind: 'result', payload: PAYLOAD }),
      persist: async (_id, patch) => {
        trace.recoveryPatches.push(patch);
      },
      logUsage: async (entry) => {
        trace.logs.push(entry);
      },
      lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
      persistCandidatePhoneCollection: store.persist,
    },
  );
}

// ═══════════════════════════════════════════════════════════════════
// Convergencia entre caminos
// ═══════════════════════════════════════════════════════════════════

describe('4O-C cross-path — webhook y recovery convergen', () => {
  it('webhook primero, recovery después: sin filas duplicadas', async () => {
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    await runWebhook(store, trace);
    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);

    // El candidato ya está terminal, así que el recovery ni siquiera hace poll.
    const result = await runRecovery(store, trace, { alreadyTerminal: true });
    assert.equal(result.outcome, 'already_revealed');
    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, 2);
  });

  it('recovery primero, webhook después: sin filas duplicadas', async () => {
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    await runRecovery(store, trace);
    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);

    const result = await runWebhook(store, trace, { alreadyTerminal: true });
    assert.equal(result.outcome, 'already_terminal');
    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, 2);
  });

  it('si los DOS caminos llegan a escribir, las FILAS no se duplican', async () => {
    // Escenario de carrera: el webhook y el cron ven el candidato en vuelo. La
    // fila canónica es la misma —la clave es del NÚMERO, no del camino— y solo se
    // añade una procedencia por camino, que es la lectura correcta: son dos
    // observaciones reales del mismo número.
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    await runWebhook(store, trace);
    await runRecovery(store, trace);

    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, 4);
    // Un solo principal, y el mismo en las dos pasadas.
    assert.equal(
      store.phones.filter((row) => row.candidateId === CANDIDATE_ID && row.isPrimary)
        .length,
      1,
    );
    assert.equal(store.primaryOf(CANDIDATE_ID)?.displayPhone, MOBILE);
    // El escalar es el mismo por los dos caminos.
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phone, MOBILE);
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phone, MOBILE);
  });

  it('el mismo camino repetido no añade procedencias (idempotencia por evento)', async () => {
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    await runWebhook(store, trace);
    await runWebhook(store, trace);
    await runWebhook(store, trace);
    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.sourcesFor(CANDIDATE_ID).length, 2);
  });

  it('el principal no cambia sin evidencia nueva', async () => {
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    await runWebhook(store, trace);
    const before = store.primaryOf(CANDIDATE_ID)?.dedupeKey;
    await runRecovery(store, trace);
    assert.equal(store.primaryOf(CANDIDATE_ID)?.dedupeKey, before);
  });

  it('los dos caminos producen la MISMA colección canónica', async () => {
    const viaWebhook = new FakeCandidatePhoneStore();
    const viaRecovery = new FakeCandidatePhoneStore();
    await runWebhook(viaWebhook, newTrace());
    await runRecovery(viaRecovery, newTrace());

    const keys = (store: FakeCandidatePhoneStore) =>
      store
        .livePhones(CANDIDATE_ID)
        .map((row) => `${row.dedupeKey}|${row.phoneType}|${row.phoneStatus}|${row.isPrimary}`)
        .sort();
    // Mismas filas, mismos tipos, mismo principal: solo la FASE de la procedencia
    // distingue un camino del otro.
    assert.deepEqual(keys(viaWebhook), keys(viaRecovery));
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contabilidad entre caminos
// ═══════════════════════════════════════════════════════════════════

describe('4O-C cross-path — contabilidad', () => {
  it('una colección de N teléfonos no multiplica el costo por camino', async () => {
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    await runWebhook(store, trace);
    await runRecovery(store, trace);
    // Cada camino registra SU propia operación con el total real de esa
    // operación; ninguno reparte créditos entre los dos números.
    for (const log of trace.logs) {
      assert.equal(log.creditsUsed, 8);
    }
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phoneRevealCostCredits, 8);
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phoneRevealCostCredits, 8);
  });

  it('ninguna fila de la colección lleva costo', async () => {
    const store = new FakeCandidatePhoneStore();
    await runWebhook(store, newTrace());
    for (const row of store.livePhones(CANDIDATE_ID)) {
      for (const forbidden of ['cost', 'credits', 'costCredits', 'credits_consumed']) {
        assert.equal(forbidden in row, false, `la fila no debe llevar ${forbidden}`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tombstone compartido
// ═══════════════════════════════════════════════════════════════════

describe('4O-C cross-path — tombstone', () => {
  it('un número suprimido no vuelve por NINGUNO de los dos caminos', async () => {
    const store = new FakeCandidatePhoneStore();
    await runWebhook(store, newTrace());
    const mobileRow = store
      .livePhones(CANDIDATE_ID)
      .find((row) => row.displayPhone === MOBILE)!;
    store.suppress(CANDIDATE_ID, mobileRow.dedupeKey, '2026-08-06T10:15:00.000Z');

    const trace = newTrace();
    await runRecovery(store, trace);
    await runWebhook(store, trace);

    const tombstone = store.rowFor(CANDIDATE_ID, mobileRow.dedupeKey)!;
    assert.notEqual(tombstone.suppressedAt, null);
    assert.equal(tombstone.normalizedPhone, null);
    assert.equal(tombstone.displayPhone, null);
    assert.equal(tombstone.isPrimary, false);
    // El principal pasa al superviviente, y ambos caminos escriben ESE escalar.
    assert.equal(store.primaryOf(CANDIDATE_ID)?.displayPhone, DIRECT);
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phone, DIRECT);
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phone, DIRECT);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Convergencia tras un fallo
// ═══════════════════════════════════════════════════════════════════

describe('4O-C cross-path — convergencia tras un fallo del writer', () => {
  it('el webhook falla al escribir y la recuperación posterior completa la colección', async () => {
    // Es la propiedad que sustituye a la transacción: no hay atomicidad, pero el
    // reveal no se cierra si la colección no se guarda, y el reintento converge.
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    store.failNextWrite = true;

    const failed = await runWebhook(store, trace);
    assert.equal(failed.outcome, 'collection_persistence_unavailable');
    assert.deepEqual(trace.webhookPatches, []);
    assert.equal(store.phones.length, 0);

    // El candidato NO quedó terminal, así que el recovery puede reprocesarlo.
    const recovered = await runRecovery(store, trace);
    assert.equal(recovered.outcome, 'revealed');
    assert.equal(store.livePhones(CANDIDATE_ID).length, 2);
    assert.equal(store.primaryOf(CANDIDATE_ID)?.displayPhone, MOBILE);
    assert.equal(store.candidateOf(CANDIDATE_ID)?.phone, MOBILE);
  });

  it('en ningún instante hay escalar escrito con colección vacía', async () => {
    const store = new FakeCandidatePhoneStore();
    const trace = newTrace();
    store.failNextWrite = true;
    await runWebhook(store, trace);
    // Cero patches con `phone` mientras la colección esté vacía.
    assert.equal(
      trace.webhookPatches.filter((patch) => patch.phone !== undefined).length,
      0,
    );
    assert.equal(store.phones.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// El escalar nunca contradice al principal
// ═══════════════════════════════════════════════════════════════════

describe('4O-C cross-path — coherencia escalar / principal', () => {
  it('cuando hay principal, el escalar es EXACTAMENTE ese número', async () => {
    for (const payload of [
      [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
      [
        { sanitized_number: WORK, type_cd: 'work' },
        { sanitized_number: MOBILE, type_cd: 'mobile' },
      ],
      [
        { sanitized_number: MOBILE, type_cd: 'mobile', status_cd: 'invalid' },
        { sanitized_number: WORK, type_cd: 'work' },
      ],
    ]) {
      const store = new FakeCandidatePhoneStore();
      const patches: WebhookRevealPersistencePatch[] = [];
      await runApolloPhoneRevealWebhook(
        { tokenProvided: TOKEN, payload: { request_id: REQUEST_ID, phone_numbers: payload } },
        {
          expectedToken: TOKEN,
          nowIso: NOW_WEBHOOK,
          loadCandidateByRequestId: async () => ({
            id: CANDIDATE_ID,
            accountId: 'acct-1',
            enrichmentMetadata: {},
            phoneRevealStatus: 'requested',
            apolloPersonId: PERSON_ID,
            source: 'apollo',
          }),
          persist: async (_id, patch) => {
            patches.push(patch);
          },
          logUsage: async () => {},
          lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
          persistCandidatePhoneCollection: store.persist,
        },
      );
      const primary = store.primaryOf(CANDIDATE_ID);
      assert.ok(primary, 'estos escenarios siempre dejan un principal');
      assert.equal(store.candidateOf(CANDIDATE_ID)?.phone, primary.displayPhone);
    }
  });
});
