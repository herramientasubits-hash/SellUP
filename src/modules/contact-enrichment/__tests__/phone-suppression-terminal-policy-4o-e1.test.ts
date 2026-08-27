/**
 * Tests — política TERMINAL de supresión, ruptura del bucle y preservación del costo
 * (Agente 2A · AGENT2A-PHONE-REVEAL-4O-E1)
 *
 * ── QUÉ ESTABA ROTO ────────────────────────────────────────────
 *
 * Las transacciones de las migraciones 110/111 responden `suppressed` cuando TODOS
 * los números de un evento son tombstones: escriben 0 filas y NO cierran el
 * candidato. Hasta este hito los tres caminos agrupaban esa respuesta con los
 * FALLOS de escritura (`collection_persistence_unavailable`), y el resultado era el
 * peor de los mundos posibles:
 *
 *   * el candidato se quedaba `requested`/`pending` ⇒ el cron lo volvía a
 *     seleccionar en cada pasada, indefinidamente, sobre una respuesta que nunca iba
 *     a poder persistirse (y desplazando a candidatos que sí se pueden recuperar);
 *   * la corrida del waterfall seguía activa y su reserva seguía `reserved`, aunque
 *     el proveedor YA hubiera cobrado ⇒ exposición bloqueada para siempre;
 *   * ni la decisión de privacidad ni el gasto quedaban registrados en el candidato.
 *
 * Y en la pata Lusha había además un borrado de costo: `mapLushaLegResultToWaterfallPatch`
 * anulaba `lushaCostCredits` para CUALQUIER status distinto de revealed/no_phone_found,
 * así que una llamada pagada bloqueada por privacidad se registraba como si Lusha no
 * hubiera cobrado nada — y esa columna es la única lectura de la que dispone la
 * liquidación de la reserva.
 *
 * ── QUÉ FIJA ESTE ARCHIVO ──────────────────────────────────────
 *
 *   § 15.1  pre-call: 0 llamadas, 0 créditos, corrida `aborted`, rastro en el candidato
 *   § 15.2  Apollo post-pago: candidato terminal, costo conservado, 0 filas nuevas
 *   § 15.3  Lusha post-pago: costo REAL en la corrida, nunca null
 *   § 15.4  costo no reportado ⇒ `assumed_cap`, nunca 0 ni release
 *   § 15.6  revisión manual L3 sobre un candidato terminal ⇒ 0 llamadas
 *   § 15.7  ninguna continuación del waterfall tras un cierre terminal
 *   § 15.8  carrera: `revealed` concurrente sobrevive; `pending` sí se terminaliza
 *   § 15.9  `stale_event` / `candidate_not_eligible` / fallo ⇒ NO se terminaliza
 *   § 15.10 privacidad: ni número, ni dedupe_key, ni email, ni nombre, ni LinkedIn
 *   § 12    un candidato ya terminal NO es elegible para otro reveal pagado
 *   § 17    reserva: liberada si la pata no se intentó, confirmada si sí
 *
 * Offline y puro: sin red, sin Supabase, sin proveedores, 0 créditos. Todos los
 * números son sintéticos 555.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import {
  applyTerminalPhoneSuppression,
  buildTerminalPhoneSuppressionPatch,
  IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES,
  SUPPRESSION_BLOCKED_ERROR_CODE,
  type TerminalPhoneSuppressionPatch,
} from '../phone-reveal-suppression-guard';
import {
  continuePhoneRevealWaterfall,
  mapLushaLegResultToWaterfallPatch,
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE,
  type ContinuePhoneRevealWaterfallDeps,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
} from '../phone-reveal-waterfall-core';
import {
  decidePhoneRevealCreditSettlement,
  type PhoneRevealCreditReservedLeg,
} from '../phone-reveal-credit-reservation-core';
import {
  evaluateManualRecoveryEligibility,
  type ManualRecoveryCandidateSnapshot,
} from '../phone-reveal-manual-recovery-core';
import { evaluateLushaPhoneFallbackEligibility } from '../lusha-phone-fallback-eligibility';
import {
  LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE,
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import type {
  CandidateLushaPhoneCollectionWriteResult,
  CandidateLushaPhoneCollectionWriteRequest,
} from '../candidate-lusha-phone-collection-writer';
import type { CandidatePhoneCollectionWriteResult } from '../candidate-phone-collection-writer';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import { FakeCandidatePhoneStore } from './candidate-phone-collection-fake-store';

const NOW = '2026-08-10T12:00:00.000Z';
const TOKEN = 'webhook-secret-token-e1';
const REQUEST_ID = 'apollo-req-e1';
const RECOVERY_ID = '-4594297923800105423';
const CANDIDATE_ID = 'cand-e1';
const RUN_ID = 'run-e1';
const ACTOR = 'user-admin-e1';
const ACCOUNT_ID = 'acct-e1';

/** Apollo person id sintético (24 hex). Id opaco de correlación, NO PII. */
const PERSON_ID = '0123456789abcdef01234567';

const MOBILE = '+15550000001';
const WORK = '+15550000002';

const APOLLO_CREDITS = 8;

/** Payload de Apollo con teléfono y créditos reportados: llamada YA pagada. */
const paidPayload: ApolloPhoneRevealWebhookPayload = {
  request_id: REQUEST_ID,
  person: { id: PERSON_ID },
  phone_numbers: [
    { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: APOLLO_CREDITS },
  ],
};

// ═══════════════════════════════════════════════════════════════
// Doble de la escritura terminal por supresión
// ═══════════════════════════════════════════════════════════════

interface TerminalWriteCall {
  candidateId: string;
  patch: TerminalPhoneSuppressionPatch;
}

/**
 * Doble de `persistTerminalPhoneSuppression` con la MISMA regla condicional que la
 * implementación real: solo aplica si la fila sigue en uno de los estados esperados.
 * Es lo que permite modelar la carrera sin base de datos.
 */
class FakeTerminalSuppressionWriter {
  readonly calls: TerminalWriteCall[] = [];
  /** Estado observable de la fila. La carrera se simula cambiándolo. */
  status: string;
  errorCode: string | null = null;
  failNext = false;

  constructor(status: string) {
    this.status = status;
  }

  readonly persist = async (
    candidateId: string,
    patch: TerminalPhoneSuppressionPatch,
  ): Promise<{ applied: boolean }> => {
    this.calls.push({ candidateId, patch });
    if (this.failNext) throw new Error('driver exploded');
    if (!patch.expectedStatuses.includes(this.status)) return { applied: false };
    this.status = patch.phone_reveal_status;
    this.errorCode = patch.phone_reveal_error_code;
    return { applied: true };
  };
}

// ═══════════════════════════════════════════════════════════════
// Harness del WEBHOOK con colección suprimible
// ═══════════════════════════════════════════════════════════════

interface WebhookHarness {
  deps: ApolloPhoneRevealWebhookDeps;
  patches: WebhookRevealPersistencePatch[];
  logs: WebhookUsageLogEntry[];
  writer: FakeTerminalSuppressionWriter;
  continuations: Array<{ apolloOutcome: string; apolloCostCredits: number | null }>;
  collectionWrites: number;
}

/**
 * Resultado de la transacción con el veredicto que se quiera modelar. Un
 * `suppressed` real escribe 0 filas y no terminaliza, así que el doble refleja
 * exactamente eso.
 */
function collectionResult(
  status: CandidatePhoneCollectionWriteResult['status'],
): CandidatePhoneCollectionWriteResult {
  const terminalized = status === 'persisted' || status === 'idempotent';
  return {
    status,
    inserted_phone_count: terminalized ? 1 : 0,
    updated_phone_count: 0,
    inserted_source_count: terminalized ? 1 : 0,
    suppressed_skipped_count: status === 'suppressed' ? 1 : 0,
    primary_dedupe_key: terminalized ? 'sha-mobile' : null,
    primary_persisted: terminalized,
    candidate_terminalized: terminalized,
  };
}

function webhookHarness(opts: {
  collection: CandidatePhoneCollectionWriteResult['status'];
  candidateStatus?: string;
  withTerminalWriter?: boolean;
  writerFails?: boolean;
  rowStatus?: string;
}): WebhookHarness {
  const patches: WebhookRevealPersistencePatch[] = [];
  const logs: WebhookUsageLogEntry[] = [];
  const continuations: WebhookHarness['continuations'] = [];
  const candidateStatus = opts.candidateStatus ?? 'requested';
  const writer = new FakeTerminalSuppressionWriter(opts.rowStatus ?? candidateStatus);
  writer.failNext = opts.writerFails === true;
  const harness: WebhookHarness = {
    patches,
    logs,
    writer,
    continuations,
    collectionWrites: 0,
    deps: {} as ApolloPhoneRevealWebhookDeps,
  };
  const candidate: WebhookCandidateRecord = {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    enrichmentMetadata: {},
    phoneRevealStatus: candidateStatus,
    apolloPersonId: PERSON_ID,
  };
  harness.deps = {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () => candidate,
    persist: async (_id, patch) => {
      patches.push(patch);
    },
    logUsage: async (entry) => {
      logs.push(entry);
    },
    // Sin tombstone POR PERSONA: el bloqueo que se prueba aquí es el del NÚMERO,
    // que solo la transacción conoce.
    lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
    persistCandidatePhoneCollection: async () => {
      harness.collectionWrites += 1;
      return collectionResult(opts.collection);
    },
    ...(opts.withTerminalWriter === false
      ? {}
      : { persistTerminalSuppression: writer.persist }),
    resolveWaterfallRunId: async () => RUN_ID,
    continueWaterfall: async (args) => {
      continuations.push({
        apolloOutcome: args.apolloOutcome,
        apolloCostCredits: args.apolloCostCredits,
      });
    },
  };
  return harness;
}

// ═══════════════════════════════════════════════════════════════
// Harness del RECOVERY con colección suprimible
// ═══════════════════════════════════════════════════════════════

interface RecoveryHarness {
  deps: RecoverApolloPhoneRevealDeps;
  patches: RecoveryPersistencePatch[];
  logs: RecoveryUsageLogEntry[];
  writer: FakeTerminalSuppressionWriter;
  continuations: Array<{ apolloOutcome: string; apolloCostCredits: number | null }>;
}

function recoveryHarness(opts: {
  collection: CandidatePhoneCollectionWriteResult['status'];
  withTerminalWriter?: boolean;
  rowStatus?: string;
}): RecoveryHarness {
  const patches: RecoveryPersistencePatch[] = [];
  const logs: RecoveryUsageLogEntry[] = [];
  const continuations: RecoveryHarness['continuations'] = [];
  const writer = new FakeTerminalSuppressionWriter(opts.rowStatus ?? 'requested');
  const candidate: RecoveryCandidateRecord = {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    phoneRevealProvider: 'apollo',
    source: 'lusha',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: PERSON_ID,
  };
  return {
    patches,
    logs,
    writer,
    continuations,
    deps: {
      nowIso: NOW,
      loadCandidate: async () => candidate,
      resolveRecoveryRequestId: async () => RECOVERY_ID,
      fetchWebhookResult: async () => ({ kind: 'result', payload: paidPayload }),
      persist: async (_id, patch) => {
        patches.push(patch);
      },
      logUsage: async (entry) => {
        logs.push(entry);
      },
      lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
      persistCandidatePhoneCollection: async () => collectionResult(opts.collection),
      ...(opts.withTerminalWriter === false
        ? {}
        : { persistTerminalSuppression: writer.persist }),
      resolveWaterfallRunId: async () => RUN_ID,
      continueWaterfall: async (args) => {
        continuations.push({
          apolloOutcome: args.apolloOutcome,
          apolloCostCredits: args.apolloCostCredits,
        });
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Harness de la CONTINUACIÓN del waterfall (gate pre-call)
// ═══════════════════════════════════════════════════════════════

function activeRun(
  overrides: Partial<PhoneRevealWaterfallRunRecord> = {},
): PhoneRevealWaterfallRunRecord {
  return {
    id: RUN_ID,
    candidateId: CANDIDATE_ID,
    status: 'apollo_in_flight',
    runMode: 'full_waterfall',
    authorizedAt: NOW,
    authorizedBy: ACTOR,
    authorizedByRole: 'admin',
    maxCreditsAuthorized: 13,
    apolloAttemptedAt: NOW,
    apolloOutcome: null,
    apolloCostCredits: null,
    apolloCostSource: null,
    lushaEligible: true,
    lushaSkippedReason: null,
    lushaAttemptedAt: null,
    lushaOutcome: null,
    lushaCostCredits: null,
    lushaCostSource: null,
    finalProvider: null,
    completedAt: null,
    errorCode: null,
    creditReservationGroupId: 'group-e1',
    ...overrides,
  };
}

interface ContinueHarness {
  deps: ContinuePhoneRevealWaterfallDeps;
  runPatches: PhoneRevealWaterfallRunPatch[];
  lushaCalls: number;
  terminalizeCalls: Array<{ candidateId: string; expectedStatuses: readonly string[] }>;
}

function continueHarness(opts: {
  suppression: 'clear' | 'blocked_suppressed' | 'do_not_contact' | 'check_unavailable';
  candidateStatus?: string;
  withTerminalize?: boolean;
}): ContinueHarness {
  const runPatches: PhoneRevealWaterfallRunPatch[] = [];
  const terminalizeCalls: ContinueHarness['terminalizeCalls'] = [];
  const harness: ContinueHarness = {
    runPatches,
    terminalizeCalls,
    lushaCalls: 0,
    deps: {} as ContinuePhoneRevealWaterfallDeps,
  };
  harness.deps = {
    flagEnabled: true,
    lushaFallbackFlagEnabled: true,
    nowIso: NOW,
    findActiveRun: async () => activeRun(),
    loadCandidate: async () => ({
      id: CANDIDATE_ID,
      source: 'lusha',
      sourceContactId: 'v1.abcdef1234567890',
      hasPhone: false,
      // El estado REAL del candidato al llegar al gate: Apollo ya persistió su
      // desenlace terminal antes de invocar la continuación.
      phoneRevealStatus: opts.candidateStatus ?? 'no_phone_found',
    }),
    updateRun: async (_runId, patch) => {
      runPatches.push(patch);
    },
    checkSuppressionAndDoNotContact: async () => opts.suppression,
    claimLushaAttempt: async () => true,
    callLushaLeg: async () => {
      harness.lushaCalls += 1;
      return { status: 'revealed', creditsCharged: 5, errorCode: null };
    },
    ...(opts.withTerminalize === false
      ? {}
      : {
          terminalizeSuppressedCandidate: async (args) => {
            terminalizeCalls.push(args);
            return { applied: true };
          },
        }),
  };
  return harness;
}

// ═══════════════════════════════════════════════════════════════
// Harness de la pata LUSHA
// ═══════════════════════════════════════════════════════════════

const LUSHA_CANDIDATE: LushaPhoneFallbackCandidateRecord = {
  id: CANDIDATE_ID,
  status: 'pending_review',
  source: 'lusha',
  sourceContactId: 'v1.abcdef1234567890',
  existingPhone: null,
  // Precondición dura del gate: Apollo ya se agotó.
  phoneRevealStatus: 'no_phone_found',
  phoneRevealAttemptCount: 1,
  enrichmentMetadata: {},
};

const LUSHA_CREDITS = 5;

function lushaClientResult(): LushaPhoneFallbackClientResult {
  return {
    ok: true,
    httpStatus: 200,
    phones: [
      { number: MOBILE, phoneType: 'mobile', rawType: 'mobile' },
      { number: WORK, phoneType: 'work', rawType: 'work' },
    ],
    phoneNumber: MOBILE,
    phoneType: 'mobile',
    phoneRawType: 'mobile',
    creditsCharged: LUSHA_CREDITS,
    candidateStatus: 'revealed',
    usageStatus: 'success',
    costSource: 'reported',
    errorCode: null,
    availabilitySource: null,
    phonesReturned: 2,
  } as LushaPhoneFallbackClientResult;
}

function lushaWrite(
  status: CandidateLushaPhoneCollectionWriteResult['status'],
): CandidateLushaPhoneCollectionWriteResult {
  const terminalized = status === 'persisted' || status === 'idempotent';
  return {
    status,
    inserted_phone_count: terminalized ? 2 : 0,
    updated_phone_count: 0,
    inserted_source_count: terminalized ? 2 : 0,
    suppressed_skipped_count: status === 'suppressed' ? 2 : 0,
    primary_dedupe_key: terminalized ? 'sha-mobile' : null,
    primary_persisted: terminalized,
    candidate_scalar_updated: terminalized,
    candidate_terminalized: terminalized,
  };
}

interface LushaHarness {
  deps: LushaPhoneFallbackCoreDeps;
  persisted: LushaPhoneFallbackPersistencePatch[];
  logs: LushaPhoneFallbackUsageLogEntry[];
  writes: CandidateLushaPhoneCollectionWriteRequest[];
  writer: FakeTerminalSuppressionWriter;
}

function lushaHarness(opts: {
  write: CandidateLushaPhoneCollectionWriteResult['status'];
  withTerminalWriter?: boolean;
  rowStatus?: string;
}): LushaHarness {
  const persisted: LushaPhoneFallbackPersistencePatch[] = [];
  const logs: LushaPhoneFallbackUsageLogEntry[] = [];
  const writes: CandidateLushaPhoneCollectionWriteRequest[] = [];
  const writer = new FakeTerminalSuppressionWriter(
    opts.rowStatus ?? LUSHA_CANDIDATE.phoneRevealStatus ?? '',
  );
  return {
    persisted,
    logs,
    writes,
    writer,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: ACTOR, roleKey: 'admin' },
      nowIso: NOW,
      waterfallMode: true,
      phoneRevealWaterfallId: RUN_ID,
      loadCandidate: async () => LUSHA_CANDIDATE,
      callLusha: async () => lushaClientResult(),
      persist: async (_id, patch) => {
        persisted.push(patch);
      },
      logUsage: async (entry) => {
        logs.push(entry);
      },
      persistPhoneCollection: async (request) => {
        writes.push(request);
        return lushaWrite(opts.write);
      },
      phoneCollectionReservationId: null,
      ...(opts.withTerminalWriter === false
        ? {}
        : { persistTerminalSuppression: writer.persist }),
    } as LushaPhoneFallbackCoreDeps,
  };
}

const LUSHA_INPUT = {
  candidateId: CANDIDATE_ID,
  confirmCost: true,
  expectedMaxCredits: LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
};

// ═══════════════════════════════════════════════════════════════
// § 15.2 — Apollo POST-PAGO: supresión confirmada por la transacción
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.2 · webhook Apollo: respuesta pagada + supresión', () => {
  it('cierra el candidato error + blocked_suppressed conservando el costo', async () => {
    const h = webhookHarness({ collection: 'suppressed' });

    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(result.outcome, 'blocked_suppressed');
    assert.equal(result.httpStatus, 200);

    // El candidato queda TERMINAL, con el vocabulario existente de la columna.
    assert.equal(h.writer.calls.length, 1);
    const patch = h.writer.calls[0].patch;
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(h.writer.status, 'error');
    assert.equal(h.writer.errorCode, 'blocked_suppressed');

    // Costo REAL preservado: la llamada existió y se pagó.
    assert.equal(patch.phone_reveal_cost_credits, APOLLO_CREDITS);
    assert.equal(patch.phone_reveal_cost_source, 'reported');

    // NO se escribe `no_phone_found` (haría elegible el fallback pagado de Lusha)
    // y NO se usa un estado nuevo.
    assert.notEqual(patch.phone_reveal_status as string, 'no_phone_found');
    assert.notEqual(patch.phone_reveal_status as string, 'suppressed');
  });

  it('NO escribe el candidato por el camino incondicional (`persist`)', async () => {
    const h = webhookHarness({ collection: 'suppressed' });
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );
    // `deps.persist` es el UPDATE sin condición de estado. El cierre por supresión
    // NO puede pasar por ahí: pisaría un resultado concurrente.
    assert.deepEqual(h.patches, []);
  });

  it('registra el gasto en el usage-log con el desenlace de privacidad', async () => {
    const h = webhookHarness({ collection: 'suppressed' });
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(h.logs.length, 1);
    const log = h.logs[0];
    assert.equal(log.status, 'success');
    assert.equal(log.errorCode, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(log.metadata.reveal_status, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(log.metadata.phone_revealed, false);
    assert.equal(log.metadata.phone_type, null);
    // El gasto NO desaparece porque el número no se guardara.
    assert.equal(log.creditsUsed, APOLLO_CREDITS);
    assert.equal(log.metadata.credits_used, APOLLO_CREDITS);
    // El veredicto de la transacción queda consultable sin necesitar un número.
    assert.equal(log.metadata.phone_collection?.persistence_status, 'suppressed');
    // La comprobación POR PERSONA sí se ejecutó y no encontró tombstone: el log no
    // afirma lo contrario.
    assert.equal(log.metadata.suppression_state, 'checked_not_suppressed');
  });

  it('aborta la corrida y liquida: la reserva no puede quedarse reservada', async () => {
    const h = webhookHarness({ collection: 'suppressed' });
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    // La continuación es el ÚNICO camino que cierra la corrida (y, con ella,
    // dispara la liquidación de la exposición reservada).
    assert.deepEqual(h.continuations, [
      { apolloOutcome: 'blocked_suppressed', apolloCostCredits: APOLLO_CREDITS },
    ]);
  });

  it('no añade filas a la colección ni un segundo registro de uso', async () => {
    const h = webhookHarness({ collection: 'suppressed' });
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );
    assert.equal(h.collectionWrites, 1, 'una sola llamada a la transacción');
    assert.equal(h.logs.length, 1, 'un solo usage-log: no hay doble contabilidad');
  });

  it('sin la dep cableada conserva el camino anterior al hito', async () => {
    const h = webhookHarness({ collection: 'suppressed', withTerminalWriter: false });
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(result.outcome, 'collection_persistence_unavailable');
    assert.deepEqual(h.patches, [], 'nada terminal se escribe');
    assert.deepEqual(h.continuations, [], 'la corrida no se cierra');
  });
});

describe('4O-E1 § 15.2 · recovery Apollo: respuesta pagada + supresión', () => {
  it('cierra terminal, conserva el costo y no usa el camino no terminal', async () => {
    const h = recoveryHarness({ collection: 'suppressed' });

    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID, actorUserId: null },
      h.deps,
    );

    assert.equal(result.outcome, 'blocked_suppressed');
    assert.equal(result.phoneRevealed, false);
    assert.equal(result.creditsUsed, APOLLO_CREDITS);

    assert.equal(h.writer.calls.length, 1);
    const patch = h.writer.calls[0].patch;
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(patch.phone_reveal_cost_credits, APOLLO_CREDITS);
    // La recuperación sella su comprobación, nunca la llegada de un callback.
    assert.equal(patch.phone_reveal_last_checked_at, NOW);
    assert.equal(patch.phone_reveal_webhook_received_at, undefined);

    // `finalizeNonTerminal` habría escrito SOLO `phone_reveal_last_checked_at` por
    // `deps.persist`, dejando el estado en vuelo. Ese camino no se usa.
    assert.deepEqual(h.patches, []);
  });

  it('aborta la corrida con el costo de Apollo', async () => {
    const h = recoveryHarness({ collection: 'suppressed' });
    await recoverApolloPhoneRevealForCandidate({ candidateId: CANDIDATE_ID }, h.deps);
    assert.deepEqual(h.continuations, [
      { apolloOutcome: 'blocked_suppressed', apolloCostCredits: APOLLO_CREDITS },
    ]);
  });

  it('sin la dep cableada conserva el camino no terminal anterior', async () => {
    const h = recoveryHarness({ collection: 'suppressed', withTerminalWriter: false });
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      h.deps,
    );
    assert.equal(result.outcome, 'collection_persistence_unavailable');
    assert.equal(h.patches.length, 1);
    assert.deepEqual(Object.keys(h.patches[0]), ['phone_reveal_last_checked_at']);
    assert.deepEqual(h.continuations, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.8 — Carrera: un resultado concurrente no se pisa
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.8 · carrera con otro actor', () => {
  it('`revealed` concurrente sobrevive: la escritura afecta 0 filas', async () => {
    // La transacción respondió `suppressed`, pero entre tanto otro callback reveló
    // el teléfono. La fila ya no está en un estado esperado.
    const h = webhookHarness({ collection: 'suppressed', rowStatus: 'revealed' });

    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(h.writer.calls.length, 1, 'se intentó');
    assert.equal(h.writer.status, 'revealed', 'y NO se pisó');
    assert.equal(h.writer.errorCode, null);
    // Se cae al camino no terminal de siempre: nada se da por cerrado.
    assert.equal(result.outcome, 'collection_persistence_unavailable');
    assert.deepEqual(h.continuations, []);
  });

  it('`pending` sí se terminaliza: error + blocked_suppressed gana', async () => {
    const h = webhookHarness({
      collection: 'suppressed',
      candidateStatus: 'pending',
      rowStatus: 'pending',
    });

    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(result.outcome, 'blocked_suppressed');
    assert.equal(h.writer.status, 'error');
    assert.equal(h.writer.errorCode, 'blocked_suppressed');
  });

  it('un fallo del driver NO se lee como cierre', async () => {
    const h = webhookHarness({ collection: 'suppressed', writerFails: true });
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );
    assert.equal(result.outcome, 'collection_persistence_unavailable');
    assert.deepEqual(h.continuations, []);
  });

  it('los estados esperados son exactamente los EN VUELO', () => {
    assert.deepEqual(
      [...IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES],
      ['requested', 'pending'],
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.9 — Solo `suppressed` terminaliza
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.9 · estados que NO son una supresión', () => {
  for (const status of ['stale_event', 'candidate_not_eligible'] as const) {
    it(`\`${status}\` NO terminaliza y conserva el camino fail-closed`, async () => {
      const h = webhookHarness({ collection: status });

      const result = await runApolloPhoneRevealWebhook(
        { tokenProvided: TOKEN, payload: paidPayload },
        h.deps,
      );

      assert.equal(result.outcome, 'collection_persistence_unavailable');
      assert.equal(h.writer.calls.length, 0, 'no se intenta terminalizar');
      assert.deepEqual(h.patches, []);
      assert.deepEqual(h.continuations, []);
      assert.equal(h.logs[0].metadata.phone_collection?.persistence_status, status);
    });
  }

  it('`stale_event` en la recuperación tampoco terminaliza', async () => {
    const h = recoveryHarness({ collection: 'stale_event' });
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      h.deps,
    );
    assert.equal(result.outcome, 'collection_persistence_unavailable');
    assert.equal(h.writer.calls.length, 0);
  });

  it('la supresión POR PERSONA terminaliza con la escritura CONDICIONAL', async () => {
    // FIX 3 terminalizaba este caso con `deps.persist`, es decir con un
    // `UPDATE … WHERE id = ?` sobre una decisión leída mucho antes: podía pisar un
    // `revealed` que la recuperación hubiera alcanzado mientras tanto.
    // AGENT2A-PHONE-REVEAL-4O-E3 lo pasa a la MISMA escritura condicional que ya usaba
    // la supresión confirmada por la transacción. El desenlace observable no cambia; lo
    // que cambia es que ahora exige que la fila siga en vuelo.
    const h = webhookHarness({ collection: 'persisted' });
    h.deps.lookupPhoneCacheSuppression = async () => ({ suppressedAt: NOW });

    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(result.outcome, 'blocked_suppressed');
    assert.equal(h.patches.length, 0, 'ya no hay UPDATE incondicional');
    assert.equal(h.writer.calls.length, 1, 'el cierre va por la escritura condicional');
    assert.equal(h.writer.calls[0].patch.phone_reveal_status, 'error');
    assert.equal(h.writer.calls[0].patch.phone_reveal_error_code, 'blocked_suppressed');
    assert.deepEqual(
      [...h.writer.calls[0].patch.expectedStatuses],
      ['requested', 'pending'],
      'un `revealed` concurrente no puede ser pisado por este cierre',
    );
    assert.equal(h.collectionWrites, 0, 'no pasa por el writer de la colección');
  });

  it('la comprobación no verificable sigue siendo NO terminal', async () => {
    const h = webhookHarness({ collection: 'persisted' });
    h.deps.lookupPhoneCacheSuppression = async () => {
      throw new Error('tabla ausente');
    };

    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );

    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.deepEqual(h.patches, [], 'nada terminal');
    assert.equal(h.writer.calls.length, 0);
  });

  it('un `persisted` normal sigue revelando sin tocar nada de 4O-E1', async () => {
    const h = webhookHarness({ collection: 'persisted' });
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(h.writer.calls.length, 0);
    assert.deepEqual(h.continuations, [
      { apolloOutcome: 'revealed', apolloCostCredits: APOLLO_CREDITS },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.1 / § 15.7 — Gate PRE-CALL previo a Lusha
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.1 · supresión ANTES de llamar a Lusha', () => {
  it('0 llamadas, corrida abortada y rastro terminal en el candidato', async () => {
    const h = continueHarness({ suppression: 'blocked_suppressed' });

    const result = await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );

    assert.equal(result.lushaCalled, false);
    assert.equal(h.lushaCalls, 0, '0 llamadas al proveedor ⇒ 0 créditos');
    assert.equal(result.outcome, 'closed_without_lusha');

    // La corrida conserva su registro de siempre.
    assert.equal(h.runPatches.length, 1);
    assert.equal(h.runPatches[0].status, 'aborted');
    assert.equal(h.runPatches[0].lushaSkippedReason, 'suppressed');
    assert.equal(h.runPatches[0].errorCode, 'blocked_suppressed');
    assert.equal(h.runPatches[0].finalProvider, 'none');

    // Y AHORA además el candidato: la decisión de privacidad deja de vivir solo en
    // la corrida, que es una tabla que el gate del fallback pagado no lee.
    assert.equal(h.terminalizeCalls.length, 1);
    assert.equal(h.terminalizeCalls[0].candidateId, CANDIDATE_ID);
    // Condicional sobre el estado REAL observado en este punto: el desenlace
    // terminal que Apollo acababa de persistir.
    assert.deepEqual(h.terminalizeCalls[0].expectedStatuses, ['no_phone_found']);
  });

  it('`do_not_contact` NO usa el cierre por supresión', async () => {
    const h = continueHarness({ suppression: 'do_not_contact' });
    await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(h.runPatches[0].lushaSkippedReason, 'dnc');
    assert.equal(h.terminalizeCalls.length, 0);
    assert.equal(h.lushaCalls, 0);
  });

  it('`check_unavailable` NO afirma una supresión en el candidato', async () => {
    const h = continueHarness({ suppression: 'check_unavailable' });
    await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(h.runPatches[0].lushaSkippedReason, 'suppression_check_unavailable');
    assert.equal(
      h.terminalizeCalls.length,
      0,
      'no se pudo comprobar ≠ está suprimido',
    );
    assert.equal(h.lushaCalls, 0);
  });

  it('`clear` sigue llamando a Lusha y no escribe ningún rastro', async () => {
    const h = continueHarness({ suppression: 'clear' });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.lushaCalled, true);
    assert.equal(h.terminalizeCalls.length, 0);
  });

  it('un fallo del rastro no impide cerrar la corrida ni liquidar', async () => {
    const h = continueHarness({ suppression: 'blocked_suppressed' });
    h.deps.terminalizeSuppressedCandidate = async () => {
      throw new Error('driver exploded');
    };
    const result = await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.runPatches[0].status, 'aborted');
  });

  it('sin la dep cableada el comportamiento es el anterior al hito', async () => {
    const h = continueHarness({
      suppression: 'blocked_suppressed',
      withTerminalize: false,
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.runPatches[0].lushaSkippedReason, 'suppressed');
  });
});

describe('4O-E1 § 15.7 · ninguna continuación tras un cierre terminal', () => {
  it('una corrida ya terminal no vuelve a escribir ni llama a Lusha', async () => {
    const h = continueHarness({ suppression: 'clear' });
    h.deps.findActiveRun = async () => activeRun({ status: 'aborted' });

    const result = await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'no_phone_found' },
      h.deps,
    );

    assert.equal(result.outcome, 'noop');
    assert.equal(result.reason, 'run_already_terminal');
    assert.equal(h.lushaCalls, 0);
    assert.deepEqual(h.runPatches, []);
    assert.equal(h.terminalizeCalls.length, 0);
  });

  it('un desenlace `blocked_suppressed` de Apollo nunca abre la pata Lusha', async () => {
    const h = continueHarness({ suppression: 'clear' });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, apolloOutcome: 'blocked_suppressed', apolloCostCredits: 8 },
      h.deps,
    );
    assert.equal(h.lushaCalls, 0);
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.runPatches[0].status, 'aborted');
    assert.equal(h.runPatches[0].lushaSkippedReason, 'suppressed');
    // El costo real de Apollo viaja al cierre, para que la liquidación lo confirme.
    assert.equal(h.runPatches[0].apolloCostCredits, 8);
    assert.equal(h.runPatches[0].apolloCostSource, 'reported');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.3 / § 10 — Costo REAL de Lusha tras una supresión post-pago
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.3 · la corrida conserva el costo real de Lusha', () => {
  it('phone_suppressed con créditos reportados ⇒ costo REAL, nunca null', () => {
    const patch = mapLushaLegResultToWaterfallPatch(
      {
        status: 'error',
        creditsCharged: LUSHA_CREDITS,
        errorCode: PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE,
      },
      NOW,
    );

    assert.equal(patch.lushaCostCredits, LUSHA_CREDITS);
    assert.notEqual(patch.lushaCostCredits, null);
    assert.equal(patch.lushaCostSource, 'reported');
    assert.equal(patch.lushaOutcome, 'error');
    // Cierre de privacidad, igual que los demás bloqueos por tombstone.
    assert.equal(patch.status, 'aborted');
    assert.equal(patch.errorCode, 'blocked_suppressed');
    assert.equal(patch.finalProvider, 'none');
    // Lusha SÍ se ejecutó: decir que se omitió por supresión sería lo contrario.
    assert.equal(patch.lushaSkippedReason, undefined);
  });

  it('no generaliza: un error sin costo reportado sigue en null + unknown', () => {
    for (const errorCode of ['provider_network_error', 'lusha_leg_threw', null]) {
      const patch = mapLushaLegResultToWaterfallPatch(
        { status: 'error', creditsCharged: null, errorCode },
        NOW,
      );
      assert.equal(patch.lushaCostCredits, null);
      assert.equal(patch.lushaCostSource, 'unknown');
      assert.equal(patch.status, 'error');
    }
  });

  it('phone_suppressed SIN cifra reportada no inventa un costo', () => {
    const patch = mapLushaLegResultToWaterfallPatch(
      {
        status: 'error',
        creditsCharged: null,
        errorCode: PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE,
      },
      NOW,
    );
    assert.equal(patch.lushaCostCredits, null);
    assert.equal(patch.lushaCostSource, 'unknown');
    // Sin evidencia de cifra, se cae al cierre genérico: la liquidación resolverá
    // con el TOPE (`assumed_cap`) porque la pata SÍ está reclamada.
    assert.equal(patch.status, 'error');
  });

  it('revealed y no_phone_found conservan su comportamiento exacto', () => {
    const revealed = mapLushaLegResultToWaterfallPatch(
      { status: 'revealed', creditsCharged: LUSHA_CREDITS, errorCode: null },
      NOW,
    );
    assert.equal(revealed.status, 'completed_lusha');
    assert.equal(revealed.lushaCostCredits, LUSHA_CREDITS);
    assert.equal(revealed.finalProvider, 'lusha');

    const empty = mapLushaLegResultToWaterfallPatch(
      { status: 'no_phone_found', creditsCharged: 0, errorCode: null },
      NOW,
    );
    assert.equal(empty.status, 'exhausted');
    assert.equal(empty.lushaCostCredits, 0);
    assert.equal(empty.finalProvider, 'none');
  });

  it('el código de la pata Lusha y el del waterfall no se separan', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE,
      LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE,
    );
  });
});

describe('4O-E1 § 11 · pata Lusha: supresión después de cobrar', () => {
  it('terminaliza el candidato sin tocar el costo de la pata anterior', async () => {
    const h = lushaHarness({ write: 'suppressed' });

    const result = await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE);
    // El costo real de Lusha viaja al caller, que es quien lo escribe en LA COLUMNA
    // DE LUSHA de la corrida.
    assert.equal(result.creditsCharged, LUSHA_CREDITS);

    assert.equal(h.writer.calls.length, 1);
    const patch = h.writer.calls[0].patch;
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, SUPPRESSION_BLOCKED_ERROR_CODE);
    // Las columnas de costo del candidato describen la pata Apollo que ya se pagó:
    // sobrescribirlas con la cifra de Lusha borraría un gasto real.
    assert.equal(patch.phone_reveal_cost_credits, undefined);
    assert.equal(patch.phone_reveal_cost_source, undefined);
    assert.equal(patch.phone_reveal_provider, undefined);
    // Token de pertenencia: el mismo estado que autorizó esta pata.
    assert.deepEqual(patch.expectedStatuses, ['no_phone_found']);
  });

  it('el usage-log conserva el detalle del proveedor y el gasto', async () => {
    const h = lushaHarness({ write: 'suppressed' });
    await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);

    assert.equal(h.logs.length, 1, 'una sola entrada: no hay doble contabilidad');
    assert.equal(h.logs[0].creditsUsed, LUSHA_CREDITS);
    assert.equal(
      h.logs[0].metadata.phone_collection_error_code,
      LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE,
    );
    // No se reescribe el ledger: `phone_suppressed` sigue siendo el detalle.
    assert.equal(h.logs[0].status, 'success');
  });

  it('no escribe el candidato por el camino incondicional', async () => {
    const h = lushaHarness({ write: 'suppressed' });
    await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);
    assert.deepEqual(h.persisted, []);
  });

  it('`stale_event` de Lusha NO terminaliza por supresión', async () => {
    const h = lushaHarness({ write: 'stale_event' });
    const result = await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);
    assert.equal(result.errorCode, 'collection_stale_event');
    assert.equal(h.writer.calls.length, 0);
  });

  it('un `persisted` normal no toca nada de 4O-E1', async () => {
    const h = lushaHarness({ write: 'persisted' });
    const result = await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);
    assert.equal(result.status, 'revealed');
    assert.equal(h.writer.calls.length, 0);
  });

  it('sin la dep cableada el camino queda como antes del hito', async () => {
    const h = lushaHarness({ write: 'suppressed', withTerminalWriter: false });
    const result = await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);
    assert.equal(result.errorCode, LUSHA_PHONE_COLLECTION_SUPPRESSED_ERROR_CODE);
    assert.equal(h.writer.calls.length, 0);
    assert.deepEqual(h.persisted, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.4 / § 17 — Liquidación de la reserva
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 17 · la reserva no se queda reservada', () => {
  const apolloLeg: PhoneRevealCreditReservedLeg = {
    id: 'res-apollo',
    providerKey: 'apollo',
    creditsReserved: APOLLO_CREDITS,
  };
  const lushaLeg: PhoneRevealCreditReservedLeg = {
    id: 'res-lusha',
    providerKey: 'lusha',
    creditsReserved: PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
  };

  it('pre-call: la pata no intentada se LIBERA', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: APOLLO_CREDITS,
        apolloCostSource: 'reported',
        // Gate pre-call: Lusha nunca se reclamó.
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: null,
      },
      reservedLegs: [lushaLeg],
    });

    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'release');
    assert.equal(
      actions[0].action === 'release' ? actions[0].reason : null,
      'leg_never_attempted',
    );
  });

  it('Apollo post-pago: la pata intentada se CONFIRMA con el costo real', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: APOLLO_CREDITS,
        apolloCostSource: 'reported',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: null,
      },
      reservedLegs: [apolloLeg],
    });

    assert.equal(actions[0].action, 'confirm');
    if (actions[0].action === 'confirm') {
      assert.equal(actions[0].credits, APOLLO_CREDITS);
      assert.equal(actions[0].costTruth, 'reported');
    }
  });

  it('Lusha post-pago suprimido: se CONFIRMA con la cifra que el patch conserva', () => {
    // Es exactamente el efecto del arreglo de § 10: si la columna llegara `null` +
    // `unknown`, la liquidación caería al tope en vez de a la cifra real.
    const patch = mapLushaLegResultToWaterfallPatch(
      {
        status: 'error',
        creditsCharged: LUSHA_CREDITS,
        errorCode: PHONE_REVEAL_WATERFALL_LUSHA_SUPPRESSED_ERROR_CODE,
      },
      NOW,
    );
    const actions = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        lushaAttempted: true,
        lushaCostCredits: patch.lushaCostCredits ?? null,
        lushaCostSource: patch.lushaCostSource ?? null,
      },
      reservedLegs: [lushaLeg],
    });

    assert.equal(actions[0].action, 'confirm');
    if (actions[0].action === 'confirm') {
      assert.equal(actions[0].credits, LUSHA_CREDITS);
      assert.equal(actions[0].costTruth, 'reported');
    }
  });

  it('§ 15.4 · pata intentada sin costo conocido ⇒ assumed_cap, nunca 0', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        lushaAttempted: true,
        lushaCostCredits: null,
        lushaCostSource: 'unknown',
      },
      reservedLegs: [apolloLeg, lushaLeg],
    });

    for (const action of actions) {
      assert.equal(action.action, 'confirm');
      if (action.action === 'confirm') {
        assert.equal(action.costTruth, 'assumed_cap');
        assert.notEqual(action.credits, 0);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.6 / § 12 — Nada vuelve a tocar un candidato ya terminal
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.6 · revisión manual L3 sobre un candidato suprimido', () => {
  function snapshot(
    overrides: Partial<ManualRecoveryCandidateSnapshot> = {},
  ): ManualRecoveryCandidateSnapshot {
    return {
      phoneRevealProvider: 'apollo',
      phoneRevealStatus: 'requested',
      hasPhone: false,
      recoveryIdPresent: true,
      requestedAtIso: '2026-08-10T11:00:00.000Z',
      lastCheckedAtIso: null,
      ...overrides,
    };
  }
  const actor = { internalUserId: ACTOR, roleKey: 'admin' };

  it('un candidato en vuelo SÍ es elegible (la prueba no es vacía)', () => {
    const result = evaluateManualRecoveryEligibility({
      actor,
      snapshot: snapshot(),
      nowIso: NOW,
    });
    assert.equal(result.eligible, true);
  });

  it('error + blocked_suppressed ⇒ not_in_flight y 0 llamadas', () => {
    const result = evaluateManualRecoveryEligibility({
      actor,
      snapshot: snapshot({ phoneRevealStatus: 'error' }),
      nowIso: NOW,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.eligible === false ? result.reason : null, 'not_in_flight');
  });

  it('el recovery core también lo rechaza sin consultar a Apollo', async () => {
    let fetches = 0;
    const h = recoveryHarness({ collection: 'persisted' });
    h.deps.loadCandidate = async () => ({
      id: CANDIDATE_ID,
      accountId: ACCOUNT_ID,
      phoneRevealProvider: 'apollo',
      source: 'lusha',
      phoneRevealStatus: 'error',
      existingPhone: null,
      enrichmentMetadata: {},
      phoneProcessingBasis: 'legitimate_interest_b2b',
    });
    h.deps.fetchWebhookResult = async () => {
      fetches += 1;
      return { kind: 'result', payload: paidPayload };
    };

    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      h.deps,
    );

    assert.equal(result.outcome, 'terminal_error_skipped');
    assert.equal(fetches, 0, '0 llamadas al proveedor');
    assert.deepEqual(h.patches, []);
  });
});

describe('4O-E1 § 12 · un candidato terminal no compra otro reveal', () => {
  function gate(phoneRevealStatus: string | null) {
    return evaluateLushaPhoneFallbackEligibility({
      candidateStatus: 'pending_review',
      candidateReviewStatus: null,
      candidateArchivedAt: null,
    // AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG — línea base sin destino registrado.
      officialContactId: null,
      phoneRevealStatus,
      hasExistingPhone: false,
      hasLushaContactId: true,
      lushaContactIdReuseConfirmed: true,
      lushaPhoneEntitlementConfirmed: true,
      featureFlagEnabled: true,
      actorRole: 'admin',
      hasConfirmedCost: true,
      isBulkAction: false,
    });
  }

  it('`no_phone_found` SÍ es elegible: es la puerta que el rastro cierra', () => {
    assert.equal(gate('no_phone_found').eligible, true);
  });

  it('`error` (blocked_suppressed) NO es elegible', () => {
    const result = gate('error');
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, 'apollo_not_exhausted');
  });

  it('el core del fallback rechaza el candidato terminal antes de llamar', async () => {
    let lushaCalls = 0;
    const h = lushaHarness({ write: 'persisted' });
    h.deps.loadCandidate = async () => ({
      ...LUSHA_CANDIDATE,
      phoneRevealStatus: 'error',
    });
    h.deps.callLusha = async () => {
      lushaCalls += 1;
      return lushaClientResult();
    };

    const result = await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'apollo_not_exhausted');
    assert.equal(lushaCalls, 0, '0 llamadas ⇒ 0 créditos');
    assert.deepEqual(h.logs, [], 'no hay gasto que registrar');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 4 — El contrato compartido, aislado
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 4 · applyTerminalPhoneSuppression', () => {
  const patch = buildTerminalPhoneSuppressionPatch({
    expectedStatuses: ['requested', 'pending'],
    nowIso: NOW,
    cost: { credits: APOLLO_CREDITS, source: 'reported' },
    provider: 'apollo',
  });

  it('dep ausente ⇒ not_wired, sin excepción', async () => {
    const out = await applyTerminalPhoneSuppression({
      candidateId: CANDIDATE_ID,
      patch,
    });
    assert.deepEqual(out, { applied: false, reason: 'not_wired' });
  });

  it('sin estados esperados no escribe (nunca degrada a incondicional)', async () => {
    let calls = 0;
    const out = await applyTerminalPhoneSuppression({
      candidateId: CANDIDATE_ID,
      patch: { ...patch, expectedStatuses: [] },
      persist: async () => {
        calls += 1;
        return { applied: true };
      },
    });
    assert.equal(out.applied, false);
    assert.equal(calls, 0);
  });

  it('0 filas ⇒ concurrent_state_change; excepción ⇒ write_failed', async () => {
    const stale = await applyTerminalPhoneSuppression({
      candidateId: CANDIDATE_ID,
      patch,
      persist: async () => ({ applied: false }),
    });
    assert.deepEqual(stale, { applied: false, reason: 'concurrent_state_change' });

    const failed = await applyTerminalPhoneSuppression({
      candidateId: CANDIDATE_ID,
      patch,
      persist: async () => {
        throw new Error('boom');
      },
    });
    assert.deepEqual(failed, { applied: false, reason: 'write_failed' });
  });

  it('1 fila ⇒ applied', async () => {
    const out = await applyTerminalPhoneSuppression({
      candidateId: CANDIDATE_ID,
      patch,
      persist: async () => ({ applied: true }),
    });
    assert.deepEqual(out, { applied: true, reason: 'applied' });
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15.10 — Privacidad
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 15.10 · ni un dato personal en logs ni en patches', () => {
  /** Todo lo que jamás puede aparecer en un log, un patch o un resultado. */
  const FORBIDDEN = [
    MOBILE,
    WORK,
    MOBILE.replace('+', ''),
    'sha-mobile',
    'x@example.com',
    'linkedin.com',
  ];

  function assertClean(label: string, payload: unknown): void {
    const serialized = JSON.stringify(payload ?? null);
    for (const needle of FORBIDDEN) {
      assert.equal(
        serialized.includes(needle),
        false,
        `${label} no puede contener "${needle}"`,
      );
    }
  }

  it('webhook: usage-log, patch terminal y resultado quedan limpios', async () => {
    const h = webhookHarness({ collection: 'suppressed' });
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      h.deps,
    );
    assertClean('usage-log', h.logs);
    assertClean('patch terminal', h.writer.calls);
    assertClean('resultado', result);
  });

  it('recovery: usage-log, patch terminal y resultado quedan limpios', async () => {
    const h = recoveryHarness({ collection: 'suppressed' });
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID, reason: 'DSAR de Ana Pérez' },
      h.deps,
    );
    assertClean('usage-log', h.logs);
    assertClean('patch terminal', h.writer.calls);
    assertClean('resultado', result);
    // El texto del motivo NUNCA se persiste: solo su presencia.
    assert.equal(JSON.stringify(h.logs).includes('Ana Pérez'), false);
    assert.equal(h.logs[0].metadata.has_reason, true);
  });

  it('pata Lusha: usage-log y patch terminal quedan limpios', async () => {
    const h = lushaHarness({ write: 'suppressed' });
    const result = await runLushaPhoneFallbackReveal(LUSHA_INPUT, h.deps);
    assertClean('usage-log', h.logs);
    assertClean('patch terminal', h.writer.calls);
    assertClean('resultado', result);
  });

  it('el patch terminal solo lleva estados, fechas y cifras', () => {
    const patch = buildTerminalPhoneSuppressionPatch({
      expectedStatuses: ['requested'],
      nowIso: NOW,
      cost: { credits: APOLLO_CREDITS, source: 'reported' },
      provider: 'apollo',
      webhookReceivedAt: NOW,
      lastCheckedAt: NOW,
    });
    assert.deepEqual(Object.keys(patch).sort(), [
      'expectedStatuses',
      'phone_reveal_completed_at',
      'phone_reveal_cost_credits',
      'phone_reveal_cost_source',
      'phone_reveal_error_code',
      'phone_reveal_last_checked_at',
      'phone_reveal_provider',
      'phone_reveal_status',
      'phone_reveal_webhook_received_at',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 16 — El bucle, con la transacción REAL simulada
// ═══════════════════════════════════════════════════════════════

describe('4O-E1 § 16 · un candidato suprimido deja de estar en vuelo', () => {
  /**
   * Doble de la transacción con las MISMAS reglas de tombstone que la migración
   * (candidate-phone-collection-fake-store.ts): se escriben los teléfonos, una DSAR
   * los suprime, y la siguiente observación del MISMO evento devuelve `suppressed`.
   */
  it('la transacción responde suppressed y el estado pasa a error', async () => {
    const store = new FakeCandidatePhoneStore();
    const patches: WebhookRevealPersistencePatch[] = [];
    const logs: WebhookUsageLogEntry[] = [];
    const writer = new FakeTerminalSuppressionWriter('requested');
    store.registerCandidate(CANDIDATE_ID, {
      phoneRevealStatus: 'requested',
      phoneRevealRequestId: REQUEST_ID,
    });

    const deps: ApolloPhoneRevealWebhookDeps = {
      expectedToken: TOKEN,
      nowIso: NOW,
      loadCandidateByRequestId: async () => ({
        id: CANDIDATE_ID,
        accountId: ACCOUNT_ID,
        enrichmentMetadata: {},
        phoneRevealStatus: 'requested',
        apolloPersonId: PERSON_ID,
      }),
      persist: async (_id, patch) => {
        patches.push(patch);
      },
      logUsage: async (entry) => {
        logs.push(entry);
      },
      lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
      persistCandidatePhoneCollection: store.persist,
      persistTerminalSuppression: writer.persist,
    };

    // 1ª entrega: se persiste con normalidad.
    const first = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      deps,
    );
    assert.equal(first.outcome, 'revealed');
    const row = store.livePhones(CANDIDATE_ID)[0];
    assert.ok(row, 'se esperaba una fila canónica');

    // Llega la DSAR: el número se convierte en tombstone y el candidato vuelve a
    // quedar en vuelo (un reveal nuevo, o una entrega tardía del anterior).
    store.suppress(CANDIDATE_ID, row.dedupeKey, NOW);
    store.registerCandidate(CANDIDATE_ID, {
      phoneRevealStatus: 'requested',
      phoneRevealRequestId: REQUEST_ID,
    });
    writer.status = 'requested';

    // 2ª entrega del MISMO payload: la transacción no puede escribir nada.
    const second = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: paidPayload },
      deps,
    );

    assert.equal(second.outcome, 'blocked_suppressed');
    assert.equal(writer.status, 'error');
    assert.equal(writer.errorCode, 'blocked_suppressed');
    // El tombstone no resucita: 0 números vivos.
    assert.equal(store.livePhones(CANDIDATE_ID).length, 0);
  });
});
