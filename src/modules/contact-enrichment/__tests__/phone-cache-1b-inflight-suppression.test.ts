/**
 * Agente 2A — APOLLO-PHONE-CACHE-1b · FIX 3 — SUPRESIÓN EN VUELO
 *
 * FIX 2 cerró el START: el reveal consulta el tombstone antes de llamar a Apollo,
 * con `ENABLE_APOLLO_PHONE_CACHE` encendido o apagado. Quedaba el hueco temporal:
 * un reveal Apollo es ASÍNCRONO, así que si una DSAR/supresión se registra ENTRE el
 * START y la llegada del teléfono, el webhook o el recovery lo persistían igual.
 *
 * Estas pruebas son offline y deterministas (sin red, sin Supabase, sin proveedores,
 * sin flags reales: todo se inyecta) y fijan el contrato:
 *
 *   1. WEBHOOK con tombstone ⇒ NO persiste teléfono, NO escribe caché, cierra
 *      bloqueado y no consume créditos nuevos.
 *   2. RECOVERY con tombstone ⇒ idéntico.
 *   3. La lectura del tombstone falla (o la dep no está cableada) ⇒ fail-closed:
 *      sin teléfono, sin caché, estado seguro y reintentable, sin 500.
 *   4. Sin tombstone ⇒ comportamiento actual intacto (persiste, caché best-effort).
 *   5. Sin `provider_person_id` resoluble ⇒ NO se evalúa y NO se bloquea por
 *      inferencia (nunca por teléfono/email/nombre/LinkedIn); queda en auditoría.
 *   6. Flag de caché APAGADO ⇒ la supresión se respeta igual y no se escribe caché.
 *   7. Flag de caché ENCENDIDO ⇒ la supresión se respeta igual; sin tombstone la
 *      escritura de caché sigue las reglas existentes.
 *
 * Ningún dato de contacto real aparece aquí: los teléfonos son del rango sintético
 * +1555…, y los ids son opacos e inventados.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import { runAdminSingleCandidateRecovery } from '../phone-reveal-recovery-runtime-core';
import {
  describeInFlightSuppression,
  evaluateInFlightPhoneSuppression,
  resolveInFlightSuppressionPersonId,
  SUPPRESSION_BLOCKED_ERROR_CODE,
  SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
} from '../phone-reveal-suppression-guard';
import {
  PHONE_CACHE_PROVIDER,
  type PhoneCacheSuppressionLookupKey,
  type PhoneCacheWriteInput,
} from '../phone-cache-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const NOW = '2026-07-29T18:00:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-fix3';
const RECOVERY_ID = '-4594297923800105423';
const CANDIDATE_ID = 'cand-fix3';
const ACCOUNT_ID = 'acct-fix3';
/** Id Apollo válido (24 hex), opaco e inventado. */
const PERSON_ID = 'a1b2c3d4e5f60718293a4b5c';
/** Id de OTRO proveedor (Lusha): nunca puede usarse como clave Apollo. */
const LUSHA_ID = 'v1.7f3c9a2b';
/** Teléfono sintético (rango reservado +1555). No es de nadie. */
const PHONE = '+15550100001';
const SUPPRESSED_AT = '2026-07-29T17:30:00.000Z';

// ── Capturas ───────────────────────────────────────────────────

interface Capture {
  persisted: Array<Record<string, unknown>>;
  webhookLogs: WebhookUsageLogEntry[];
  recoveryLogs: RecoveryUsageLogEntry[];
  cacheWrites: PhoneCacheWriteInput[];
  lookupKeys: PhoneCacheSuppressionLookupKey[];
  unavailableMessages: string[];
}

let cap: Capture;
beforeEach(() => {
  cap = {
    persisted: [],
    webhookLogs: [],
    recoveryLogs: [],
    cacheWrites: [],
    lookupKeys: [],
    unavailableMessages: [],
  };
});

/** Serializa TODO lo observable para auditar ausencia de PII. */
function observable(): string {
  return JSON.stringify({
    persisted: cap.persisted,
    webhookLogs: cap.webhookLogs,
    recoveryLogs: cap.recoveryLogs,
    cacheWrites: cap.cacheWrites,
    unavailableMessages: cap.unavailableMessages,
  });
}

function assertNoPhoneAnywhere(): void {
  const dump = observable();
  assert.equal(dump.includes(PHONE), false, 'el teléfono no puede aparecer');
  assert.equal(dump.includes('5550100001'), false, 'ni el número sin prefijo');
}

// ── Fábricas WEBHOOK ───────────────────────────────────────────

function webhookCandidate(
  overrides: Partial<WebhookCandidateRecord> = {},
): WebhookCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    candidateCountry: 'Colombia',
    runCompanyCountryCode: 'CO',
    apolloPersonId: PERSON_ID,
    source: 'apollo',
    ...overrides,
  };
}

function webhookPayload(
  overrides: Partial<ApolloPhoneRevealWebhookPayload> = {},
): ApolloPhoneRevealWebhookPayload {
  return {
    request_id: REQUEST_ID,
    person: { id: PERSON_ID, phone_numbers: [{ sanitized_number: PHONE, type_cd: 'mobile' }] },
    ...overrides,
  };
}

function webhookDeps(
  record: WebhookCandidateRecord = webhookCandidate(),
  overrides: Partial<ApolloPhoneRevealWebhookDeps> = {},
): ApolloPhoneRevealWebhookDeps {
  return {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () => record,
    persist: async (_id, patch) => {
      cap.persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async (entry) => {
      cap.webhookLogs.push(entry);
    },
    // Simula el flag de caché ENCENDIDO (la dep existe y captura la escritura).
    cacheRevealedPhone: async (input) => {
      cap.cacheWrites.push(input);
      return { written: true };
    },
    lookupPhoneCacheSuppression: async (key) => {
      cap.lookupKeys.push(key);
      return null;
    },
    onSuppressionCheckUnavailable: (message) => {
      cap.unavailableMessages.push(message);
    },
    ...overrides,
  };
}

/** Dep de tombstone presente: la persona está suprimida en esta cuenta. */
function suppressedLookup() {
  return async (key: PhoneCacheSuppressionLookupKey) => {
    cap.lookupKeys.push(key);
    return { suppressedAt: SUPPRESSED_AT };
  };
}

// ── Fábricas RECOVERY ──────────────────────────────────────────

function recoveryCandidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    phoneRevealProvider: 'apollo',
    source: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: PERSON_ID,
    candidateCountry: 'Colombia',
    runCompanyCountryCode: 'CO',
    ...overrides,
  };
}

function recoveryDeps(
  record: RecoveryCandidateRecord = recoveryCandidate(),
  payload: ApolloPhoneRevealWebhookPayload | null = webhookPayload(),
  overrides: Partial<RecoverApolloPhoneRevealDeps> = {},
): RecoverApolloPhoneRevealDeps {
  return {
    nowIso: NOW,
    loadCandidate: async () => record,
    resolveRecoveryRequestId: async () => RECOVERY_ID,
    fetchWebhookResult: async () =>
      payload ? { kind: 'result', payload } : { kind: 'no_result_yet' },
    persist: async (_id, patch) => {
      cap.persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async (entry) => {
      cap.recoveryLogs.push(entry);
    },
    cacheRevealedPhone: async (input) => {
      cap.cacheWrites.push(input);
      return { written: true };
    },
    lookupPhoneCacheSuppression: async (key) => {
      cap.lookupKeys.push(key);
      return null;
    },
    onSuppressionCheckUnavailable: (message) => {
      cap.unavailableMessages.push(message);
    },
    ...overrides,
  };
}

// ── Guarda pura ────────────────────────────────────────────────

describe('FIX 3 — guarda pura de supresión en vuelo', () => {
  it('resuelve el person id: payload → columna → source_contact_id (Apollo)', () => {
    assert.equal(
      resolveInFlightSuppressionPersonId({ payloadPersonId: PERSON_ID }),
      PERSON_ID,
    );
    assert.equal(
      resolveInFlightSuppressionPersonId({ candidateApolloPersonId: PERSON_ID }),
      PERSON_ID,
    );
    assert.equal(
      resolveInFlightSuppressionPersonId({
        candidateSource: 'apollo',
        candidateSourceContactId: PERSON_ID,
      }),
      PERSON_ID,
    );
  });

  it('NUNCA usa un id de otro proveedor (Lusha v1.*) como clave', () => {
    assert.equal(resolveInFlightSuppressionPersonId({ payloadPersonId: LUSHA_ID }), null);
    assert.equal(
      resolveInFlightSuppressionPersonId({ candidateApolloPersonId: LUSHA_ID }),
      null,
    );
    assert.equal(
      resolveInFlightSuppressionPersonId({
        candidateSource: 'lusha',
        candidateSourceContactId: LUSHA_ID,
      }),
      null,
    );
  });

  it('sin person id o sin cuenta ⇒ not_evaluable, y NO consulta nada', async () => {
    let called = 0;
    const lookup = async () => {
      called += 1;
      return null;
    };
    assert.deepEqual(
      await evaluateInFlightPhoneSuppression({
        personId: null,
        accountId: ACCOUNT_ID,
        lookup,
      }),
      { kind: 'not_evaluable', reason: 'missing_provider_person_id' },
    );
    assert.deepEqual(
      await evaluateInFlightPhoneSuppression({
        personId: PERSON_ID,
        accountId: null,
        lookup,
      }),
      { kind: 'not_evaluable', reason: 'missing_account_id' },
    );
    assert.equal(called, 0, 'sin clave no puede haber lectura');
  });

  it('la clave del tombstone es (apollo, persona, cuenta) — SIN país', async () => {
    const keys: PhoneCacheSuppressionLookupKey[] = [];
    await evaluateInFlightPhoneSuppression({
      personId: PERSON_ID,
      accountId: ACCOUNT_ID,
      lookup: async (key) => {
        keys.push(key);
        return null;
      },
    });
    assert.deepEqual(keys, [
      { provider: PHONE_CACHE_PROVIDER, providerPersonId: PERSON_ID, accountId: ACCOUNT_ID },
    ]);
    assert.equal('countryCode' in keys[0], false, 'el país no entra en la clave');
  });

  it('dep ausente ⇒ check_unavailable (fail-closed, no "no suprimido")', async () => {
    const decision = await evaluateInFlightPhoneSuppression({
      personId: PERSON_ID,
      accountId: ACCOUNT_ID,
    });
    assert.equal(decision.kind, 'check_unavailable');
  });

  it('lectura que lanza ⇒ check_unavailable con mensaje REDACTADO', async () => {
    const decision = await evaluateInFlightPhoneSuppression({
      personId: PERSON_ID,
      accountId: ACCOUNT_ID,
      lookup: async () => {
        throw new Error(`duplicate key (phone)=(${PHONE}) person=${PERSON_ID}`);
      },
    });
    assert.equal(decision.kind, 'check_unavailable');
    const message = decision.kind === 'check_unavailable' ? decision.message : '';
    assert.equal(message.includes(PHONE), false, 'sin teléfono');
    assert.equal(message.includes(PERSON_ID), false, 'sin person id en claro');
    assert.match(message, /redacted/);
  });

  it('fila con suppressed_at ⇒ blocked_suppressed; sin fila ⇒ allowed', async () => {
    assert.deepEqual(
      await evaluateInFlightPhoneSuppression({
        personId: PERSON_ID,
        accountId: ACCOUNT_ID,
        lookup: async () => ({ suppressedAt: SUPPRESSED_AT }),
      }),
      { kind: 'blocked_suppressed' },
    );
    assert.deepEqual(
      await evaluateInFlightPhoneSuppression({
        personId: PERSON_ID,
        accountId: ACCOUNT_ID,
        lookup: async () => null,
      }),
      { kind: 'allowed' },
    );
    // Fila viva sin supresión tampoco bloquea.
    assert.deepEqual(
      await evaluateInFlightPhoneSuppression({
        personId: PERSON_ID,
        accountId: ACCOUNT_ID,
        lookup: async () => ({ suppressedAt: null }),
      }),
      { kind: 'allowed' },
    );
  });

  it('la etiqueta de auditoría es mecánica y sin PII', () => {
    assert.equal(describeInFlightSuppression({ kind: 'allowed' }), 'checked_not_suppressed');
    assert.equal(
      describeInFlightSuppression({ kind: 'blocked_suppressed' }),
      'blocked_suppressed',
    );
    assert.equal(
      describeInFlightSuppression({ kind: 'check_unavailable', message: 'boom' }),
      'check_unavailable',
    );
    assert.equal(
      describeInFlightSuppression({
        kind: 'not_evaluable',
        reason: 'missing_provider_person_id',
      }),
      'not_evaluable_missing_provider_person_id',
    );
    assert.equal(
      describeInFlightSuppression({ kind: 'not_evaluable', reason: 'missing_account_id' }),
      'not_evaluable_missing_account_id',
    );
  });
});

// ── WEBHOOK ────────────────────────────────────────────────────

describe('FIX 3 — WEBHOOK: el tombstone bloquea la persistencia tardía', () => {
  it('con tombstone NO persiste teléfono, NO cachea y cierra bloqueado', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate(), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );

    assert.equal(result.outcome, 'blocked_suppressed');
    // 200: la respuesta de Apollo era correcta; el bloqueo es de privacidad.
    assert.equal(result.httpStatus, 200);

    assert.equal(cap.persisted.length, 1);
    const patch = cap.persisted[0];
    assert.equal('phone' in patch, false, 'nunca escribe la columna phone');
    assert.equal(
      'enrichment_metadata' in patch,
      false,
      'nunca escribe metadata.phone',
    );
    assert.equal(
      'apollo_person_id' in patch,
      false,
      'no añade datos nuevos de una persona suprimida',
    );
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, SUPPRESSION_BLOCKED_ERROR_CODE);

    assert.deepEqual(cap.cacheWrites, [], 'NO se escribe caché');

    assert.equal(cap.webhookLogs.length, 1);
    const log = cap.webhookLogs[0];
    assert.equal(log.metadata.reveal_status, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(log.metadata.suppression_state, 'blocked_suppressed');
    assert.equal(log.metadata.phone_revealed, false);
    assert.equal(log.metadata.phone_type, null);
    // No se registra ningún hit de caché.
    assert.equal(JSON.stringify(log).includes('person_phone_cache_hit'), false);

    assertNoPhoneAnywhere();
  });

  it('usa el apollo_person_id del candidato cuando el payload no lo trae', async () => {
    await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: {
          request_id: REQUEST_ID,
          phone_numbers: [{ sanitized_number: PHONE, type_cd: 'mobile' }],
        },
      },
      webhookDeps(webhookCandidate(), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );

    assert.deepEqual(cap.lookupKeys, [
      { provider: PHONE_CACHE_PROVIDER, providerPersonId: PERSON_ID, accountId: ACCOUNT_ID },
    ]);
    assert.deepEqual(cap.cacheWrites, []);
    assert.equal(cap.persisted[0].phone_reveal_error_code, SUPPRESSION_BLOCKED_ERROR_CODE);
  });

  it('la lectura del tombstone falla ⇒ fail-closed sin teléfono y SIN 500', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate(), {
        lookupPhoneCacheSuppression: async () => {
          throw new Error(`relation "phone_reveal_cache" does not exist (${PHONE})`);
        },
      }),
    );

    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.equal(result.httpStatus, 200, 'no escala a 500');
    assert.deepEqual(cap.persisted, [], 'no persiste NADA: sigue en vuelo');
    assert.deepEqual(cap.cacheWrites, []);

    assert.equal(cap.webhookLogs.length, 1);
    assert.equal(cap.webhookLogs[0].status, 'error');
    assert.equal(
      cap.webhookLogs[0].errorCode,
      SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
    );
    assert.equal(cap.webhookLogs[0].metadata.suppression_state, 'check_unavailable');

    assert.equal(cap.unavailableMessages.length, 1);
    assertNoPhoneAnywhere();
  });

  it('sin la dep de supresión cableada ⇒ fail-closed (no hay reveal sin comprobar)', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate(), { lookupPhoneCacheSuppression: undefined }),
    );
    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.deepEqual(cap.persisted, []);
    assert.deepEqual(cap.cacheWrites, []);
  });

  it('SIN tombstone el comportamiento actual queda intacto', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(),
    );

    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.persisted.length, 1);
    assert.equal(cap.persisted[0].phone, PHONE);
    assert.equal(cap.persisted[0].phone_reveal_status, 'revealed');
    assert.equal(cap.persisted[0].phone_reveal_error_code, null);
    // Flag simulado ON ⇒ la escritura de caché sigue las reglas existentes.
    assert.equal(cap.cacheWrites.length, 1);
    assert.equal(cap.webhookLogs[0].metadata.suppression_state, 'checked_not_suppressed');
  });

  it('sin person id resoluble NO bloquea por inferencia y lo deja auditado', async () => {
    const result = await runApolloPhoneRevealWebhook
      (
        {
          tokenProvided: TOKEN,
          payload: {
            request_id: REQUEST_ID,
            // Sin person.id válido, y con un id Lusha que NO puede servir de clave.
            person: { id: LUSHA_ID, phone_numbers: [{ sanitized_number: PHONE }] },
          },
        },
        webhookDeps(
          webhookCandidate({
            apolloPersonId: null,
            source: 'lusha',
            sourceContactId: LUSHA_ID,
          }),
          { lookupPhoneCacheSuppression: suppressedLookup() },
        ),
      );

    assert.equal(result.outcome, 'revealed', 'comportamiento actual conservado');
    assert.deepEqual(cap.lookupKeys, [], 'no se consulta: no hay clave');
    assert.equal(
      cap.webhookLogs[0].metadata.suppression_state,
      'not_evaluable_missing_provider_person_id',
    );
  });

  it('sin account_id tampoco se evalúa (y se reporta el motivo exacto)', async () => {
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate({ accountId: null }), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );
    assert.deepEqual(cap.lookupKeys, []);
    assert.equal(
      cap.webhookLogs[0].metadata.suppression_state,
      'not_evaluable_missing_account_id',
    );
  });

  it('sin teléfono en el payload NO se consulta el tombstone (camino idéntico)', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: { request_id: REQUEST_ID, phone_numbers: [] } },
      webhookDeps(webhookCandidate(), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.deepEqual(cap.lookupKeys, [], 'sin número no hay nada que suprimir');
    assert.equal(cap.webhookLogs[0].metadata.suppression_state, undefined);
  });

  it('flag de caché APAGADO: la supresión se respeta igual y no se cachea', async () => {
    // Flag OFF se modela como en producción: sin dep de escritura de caché. La dep
    // de supresión SÍ está: no depende del flag.
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate(), {
        cacheRevealedPhone: undefined,
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );
    assert.equal(result.outcome, 'blocked_suppressed');
    assert.deepEqual(cap.cacheWrites, []);
    assert.equal('phone' in cap.persisted[0], false);
    assertNoPhoneAnywhere();
  });

  it('flag de caché APAGADO y sin tombstone: persiste y NO cachea', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate(), { cacheRevealedPhone: undefined }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.persisted[0].phone, PHONE);
    assert.deepEqual(cap.cacheWrites, [], 'flag OFF ⇒ ninguna escritura de caché');
  });

  it('un candidato ya terminal sigue siendo no-op idempotente (sin lecturas)', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate({ phoneRevealStatus: 'revealed' }), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );
    assert.equal(result.outcome, 'already_terminal');
    assert.deepEqual(cap.persisted, []);
    assert.deepEqual(cap.lookupKeys, []);
  });
});

// ── RECOVERY ───────────────────────────────────────────────────

describe('FIX 3 — RECOVERY: el tombstone bloquea la persistencia tardía', () => {
  it('con tombstone NO persiste teléfono, NO cachea y cierra bloqueado', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), webhookPayload(), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );

    assert.equal(result.outcome, 'blocked_suppressed');
    assert.equal(result.phoneRevealed, false);
    assert.equal(result.phoneType, null, 'ni la etiqueta de tipo del número');

    assert.equal(cap.persisted.length, 1);
    const patch = cap.persisted[0];
    assert.equal('phone' in patch, false);
    assert.equal('enrichment_metadata' in patch, false);
    assert.equal('apollo_person_id' in patch, false);
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(patch.phone_reveal_last_checked_at, NOW);

    assert.deepEqual(cap.cacheWrites, []);

    assert.equal(cap.recoveryLogs.length, 1);
    assert.equal(cap.recoveryLogs[0].metadata.reveal_status, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(cap.recoveryLogs[0].metadata.recovery_outcome, 'blocked_suppressed');
    assert.equal(cap.recoveryLogs[0].metadata.suppression_state, 'blocked_suppressed');
    assert.equal(cap.recoveryLogs[0].metadata.phone_present, false);

    assertNoPhoneAnywhere();
  });

  it('la lectura del tombstone falla ⇒ no terminal, recuperable y sin teléfono', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), webhookPayload(), {
        lookupPhoneCacheSuppression: async () => {
          throw new Error(`timeout reading cache for ${PHONE}`);
        },
      }),
    );

    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.equal(result.phoneRevealed, false);

    // Solo se marca la última verificación: el status sigue en vuelo.
    assert.deepEqual(cap.persisted, [{ phone_reveal_last_checked_at: NOW }]);
    assert.deepEqual(cap.cacheWrites, []);
    assert.equal(cap.recoveryLogs[0].status, 'error');
    assert.equal(
      cap.recoveryLogs[0].errorCode,
      SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
    );
    assert.equal(cap.recoveryLogs[0].metadata.suppression_state, 'check_unavailable');
    assert.equal(cap.unavailableMessages.length, 1);
    assertNoPhoneAnywhere();
  });

  it('sin la dep de supresión cableada ⇒ fail-closed', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), webhookPayload(), {
        lookupPhoneCacheSuppression: undefined,
      }),
    );
    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.deepEqual(cap.persisted, [{ phone_reveal_last_checked_at: NOW }]);
    assert.deepEqual(cap.cacheWrites, []);
  });

  it('SIN tombstone el comportamiento actual queda intacto', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.persisted[0].phone, PHONE);
    assert.equal(cap.cacheWrites.length, 1);
    assert.equal(cap.recoveryLogs[0].metadata.suppression_state, 'checked_not_suppressed');
  });

  it('sin person id resoluble NO bloquea por inferencia y lo deja auditado', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate({
          apolloPersonId: null,
          source: 'lusha',
          sourceContactId: LUSHA_ID,
        }),
        { request_id: REQUEST_ID, phone_numbers: [{ sanitized_number: PHONE }] },
        { lookupPhoneCacheSuppression: suppressedLookup() },
      ),
    );
    assert.equal(result.outcome, 'revealed');
    assert.deepEqual(cap.lookupKeys, []);
    assert.equal(
      cap.recoveryLogs[0].metadata.suppression_state,
      'not_evaluable_missing_provider_person_id',
    );
  });

  it('flag de caché APAGADO: la supresión se respeta igual y no se cachea', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), webhookPayload(), {
        cacheRevealedPhone: undefined,
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );
    assert.equal(result.outcome, 'blocked_suppressed');
    assert.deepEqual(cap.cacheWrites, []);
    assert.equal('phone' in cap.persisted[0], false);
    assertNoPhoneAnywhere();
  });

  it('un payload sin teléfono no consulta el tombstone (camino idéntico)', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate(),
        { request_id: REQUEST_ID, phone_numbers: [] },
        { lookupPhoneCacheSuppression: suppressedLookup() },
      ),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.deepEqual(cap.lookupKeys, []);
    assert.equal(cap.recoveryLogs[0].metadata.suppression_state, undefined);
  });

  it('dryRun no consulta el tombstone (no hay payload que persistir)', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID, dryRun: true },
      recoveryDeps(recoveryCandidate(), webhookPayload(), {
        lookupPhoneCacheSuppression: suppressedLookup(),
      }),
    );
    assert.equal(result.outcome, 'dry_run_eligible');
    assert.deepEqual(cap.persisted, []);
    assert.deepEqual(cap.lookupKeys, []);
  });
});

// ── Contabilidad de batch y runtime admin ──────────────────────

describe('FIX 3 — batch y runtime clasifican los nuevos outcomes', () => {
  it('batch: blocked_suppressed ⇒ skipped; check_unavailable ⇒ failed', async () => {
    const summary = await recoverStaleApolloPhoneRevealRequests(
      { dryRun: false, maxCandidates: 3 },
      {
        nowIso: NOW,
        findStaleCandidateIds: async () => ['a', 'b', 'c'],
        recoverOne: async (id) => {
          if (id === 'a') return 'blocked_suppressed';
          if (id === 'b') return 'suppression_check_unavailable';
          return 'revealed';
        },
      },
    );
    assert.equal(summary.checked, 3);
    assert.equal(summary.skipped, 1, 'bloqueado por supresión no es un fallo');
    assert.equal(summary.failed, 1, 'no verificable sí es una condición a resolver');
    assert.equal(summary.recovered, 1);
  });

  it('runtime admin: blocked ⇒ skipped, no verificable ⇒ error', async () => {
    const blocked = await runAdminSingleCandidateRecovery(
      { candidateId: CANDIDATE_ID, dryRun: false },
      {
        actor: { internalUserId: 'admin-1', roleKey: 'admin' },
        recoverCandidate: async () => ({
          outcome: 'blocked_suppressed',
          phoneRevealed: false,
          creditsUsed: null,
          recoveryRequestIdPresent: true,
          phoneType: null,
        }),
      },
    );
    assert.equal(blocked.status, 'skipped');
    assert.equal(blocked.phonePersisted, false);
    assert.equal(blocked.message, 'blocked_suppressed');

    const unavailable = await runAdminSingleCandidateRecovery(
      { candidateId: CANDIDATE_ID, dryRun: false },
      {
        actor: { internalUserId: 'admin-1', roleKey: 'admin' },
        recoverCandidate: async () => ({
          outcome: 'suppression_check_unavailable',
          phoneRevealed: false,
          creditsUsed: null,
          recoveryRequestIdPresent: true,
          phoneType: null,
        }),
      },
    );
    assert.equal(unavailable.status, 'error');
    assert.equal(unavailable.phonePersisted, false);
  });
});

// ── Guardas estáticas ──────────────────────────────────────────

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * Quita comentarios de bloque y de línea. Las guardas de abajo hablan del CÓDIGO:
 * la documentación sí nombra `ENABLE_APOLLO_PHONE_CACHE` o `email` justamente para
 * explicar por qué NO se usan, y un grep sobre el texto crudo confundiría la
 * explicación con la infracción.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('FIX 3 — contrato estático', () => {
  const guard = read('src/modules/contact-enrichment/phone-reveal-suppression-guard.ts');
  const webhookCore = read('src/modules/contact-enrichment/phone-reveal-webhook-core.ts');
  const recoveryCore = read('src/modules/contact-enrichment/phone-reveal-recovery-core.ts');
  const webhookRoute = read(
    'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
  );
  const recoveryActions = read(
    'src/modules/contact-enrichment/phone-reveal-recovery-actions.ts',
  );

  const guardCode = code(guard);

  it('la guarda es pura: sin fetch, sin Supabase, sin env, sin console', () => {
    assert.equal(/\bfetch\s*\(/.test(guardCode), false);
    assert.equal(/supabase/i.test(guardCode), false);
    assert.equal(/process\.env/.test(guardCode), false);
    assert.equal(/console\./.test(guardCode), false);
  });

  it('la guarda NO lee el flag de caché: la supresión es independiente', () => {
    assert.equal(guardCode.includes('ENABLE_APOLLO_PHONE_CACHE'), false);
    assert.equal(guardCode.includes('isApolloPhoneCacheEnabled'), false);
    assert.equal(/\bcacheEnabled\b/.test(guardCode), false);
  });

  it('la guarda NO empareja por teléfono/email/nombre/linkedin (sin fuzzy match)', () => {
    for (const forbidden of ['normalizedPhone', 'email', 'linkedin', 'fullName']) {
      assert.equal(
        guardCode.includes(forbidden),
        false,
        `la clave de supresión no puede usar ${forbidden}`,
      );
    }
  });

  it('el webhook comprueba la supresión ANTES de persistir el teléfono', () => {
    const revealedBlock = webhookCore.split('if (best) {')[1] ?? '';
    assert.notEqual(revealedBlock, '', 'falta el camino con teléfono');
    const checkAt = revealedBlock.indexOf('evaluateInFlightPhoneSuppression');
    const persistAt = revealedBlock.indexOf('const revealed: ClassifiedPhone');
    assert.notEqual(checkAt, -1, 'el webhook debe comprobar la supresión');
    assert.ok(
      checkAt < persistAt,
      'la comprobación va antes de construir/persistir el teléfono',
    );
  });

  it('el recovery comprueba la supresión ANTES de persistir el teléfono', () => {
    const revealedBlock = recoveryCore.split('if (best) {')[1] ?? '';
    const checkAt = revealedBlock.indexOf('evaluateInFlightPhoneSuppression');
    const persistAt = revealedBlock.indexOf('const revealed: ClassifiedPhone');
    assert.notEqual(checkAt, -1, 'el recovery debe comprobar la supresión');
    assert.ok(checkAt < persistAt);
  });

  it('el bloqueo usa vocabulario existente de phone_reveal_status (no un enum nuevo)', () => {
    for (const core of [webhookCore, recoveryCore]) {
      assert.match(core, /phone_reveal_status:\s*'error'/);
      assert.match(core, /phone_reveal_error_code:\s*SUPPRESSION_BLOCKED_ERROR_CODE/);
    }
  });

  it('los wrappers cablean la lectura del tombstone SIN condicionarla al flag', () => {
    for (const wrapper of [webhookRoute, recoveryActions]) {
      assert.match(wrapper, /lookupPhoneCacheSuppression:\s*readPhoneCacheSuppression/);
      // El wiring no puede quedar dentro de un ternario/condicional de flag.
      assert.equal(
        /lookupPhoneCacheSuppression:\s*isApolloPhoneCacheEnabled/.test(wrapper),
        false,
      );
      assert.match(wrapper, /onSuppressionCheckUnavailable/);
    }
  });

  it('el bloqueo no escribe apollo_person_id ni caché en los cores', () => {
    for (const core of [webhookCore, recoveryCore]) {
      const blockedBlock =
        core.split("suppression.kind === 'blocked_suppressed'")[1]?.split('\n    }')[0] ??
        '';
      assert.notEqual(blockedBlock, '', 'falta el camino blocked_suppressed');
      assert.equal(blockedBlock.includes('apollo_person_id:'), false);
      assert.equal(blockedBlock.includes('cacheRevealedPhone'), false);
      assert.equal(blockedBlock.includes('buildRevealPhoneCacheWriteInput'), false);
    }
  });
});
