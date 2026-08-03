/**
 * Tests — hooks del waterfall en los cores terminales de Apollo
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
 *
 * Verifica el CABLEADO, no la decisión (esa vive en
 * phone-reveal-waterfall-core.test.ts):
 *
 *   * deps AUSENTES (flag apagado) ⇒ los cores se comportan exactamente como antes
 *     de este hito: ni una lectura extra, ni una clave extra en la metadata, ni una
 *     continuación;
 *   * deps presentes ⇒ `phone_reveal_waterfall_id` aparece en la metadata del
 *     usage-log y la continuación se invoca UNA vez por desenlace terminal, con el
 *     outcome y el costo correctos;
 *   * `no_phone_found` es el único desenlace que puede abrir la 2ª pata;
 *   * los desenlaces NO terminales (aún procesando, 404, 401) no continúan nada;
 *   * BEST-EFFORT: un hook que LANZA no puede degradar el webhook a 5xx ni romper
 *     una recuperación correcta — eso haría a Apollo reintentar sin resolver nada.
 *
 * Offline y con DI: sin red, sin Supabase, sin proveedores, 0 créditos.
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
  type WebhookWaterfallContinuationArgs,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
  type RecoveryWaterfallContinuationArgs,
} from '../phone-reveal-recovery-core';
import type { PollFetchResult } from '../phone-reveal-poll-core';

const NOW = '2026-08-03T12:00:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-waterfall';
const RUN_ID = 'run-waterfall-1';
const MOBILE = '+573001112233';

// ═══════════════════════════════════════════════════════════════
// Harness del WEBHOOK
// ═══════════════════════════════════════════════════════════════

interface WebhookCapture {
  logs: WebhookUsageLogEntry[];
  persisted: Array<{ id: string; patch: WebhookRevealPersistencePatch }>;
  continuations: WebhookWaterfallContinuationArgs[];
  runIdLookups: string[];
}

function webhookDeps(
  cap: WebhookCapture,
  opts: {
    wireWaterfall?: boolean;
    runIdThrows?: boolean;
    continuationThrows?: boolean;
    candidate?: WebhookCandidateRecord;
  } = {},
): ApolloPhoneRevealWebhookDeps {
  const base: ApolloPhoneRevealWebhookDeps = {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () =>
      opts.candidate ?? {
        id: 'cand-1',
        accountId: 'acct-1',
        enrichmentMetadata: {},
        phoneRevealStatus: 'requested',
      },
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    // Supresión cableada y limpia: este test aísla el waterfall, no la supresión.
    lookupPhoneCacheSuppression: async () => null,
  };
  if (!opts.wireWaterfall) return base;
  return {
    ...base,
    resolveWaterfallRunId: async (candidateId) => {
      cap.runIdLookups.push(candidateId);
      if (opts.runIdThrows) throw new Error('lookup roto con detalle del driver');
      return RUN_ID;
    },
    continueWaterfall: async (args) => {
      cap.continuations.push(args);
      if (opts.continuationThrows) throw new Error('continuación rota');
      return undefined;
    },
  };
}

function emptyWebhookCapture(): WebhookCapture {
  return { logs: [], persisted: [], continuations: [], runIdLookups: [] };
}

function webhookPayload(
  overrides: Partial<ApolloPhoneRevealWebhookPayload> = {},
): ApolloPhoneRevealWebhookPayload {
  return { request_id: REQUEST_ID, ...overrides };
}

const REVEALED_PAYLOAD = webhookPayload({
  phone_numbers: [
    { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 8 },
  ],
});

// ═══════════════════════════════════════════════════════════════
// 1. Webhook con el flag APAGADO (deps ausentes)
// ═══════════════════════════════════════════════════════════════

describe('webhook — flag OFF: sin corrida, sin clave, sin continuación', () => {
  it('no resuelve corrida ni continúa en el camino no_phone_found', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(cap),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cap.runIdLookups.length, 0);
    assert.equal(cap.continuations.length, 0);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        cap.logs[0].metadata,
        'phone_reveal_waterfall_id',
      ),
      false,
      'la metadata debe quedar idéntica a la de antes del hito',
    );
  });

  it('tampoco continúa en el camino revealed', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: REVEALED_PAYLOAD },
      webhookDeps(cap),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.continuations.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Webhook con el flag ENCENDIDO
// ═══════════════════════════════════════════════════════════════

describe('webhook — flag ON: correlación y continuación', () => {
  it('no_phone_found: continúa UNA vez con el outcome y el costo correctos', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: webhookPayload({ phone_numbers: [] }),
      },
      webhookDeps(cap, { wireWaterfall: true }),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cap.continuations.length, 1);
    assert.equal(cap.continuations[0].apolloOutcome, 'no_phone_found');
    assert.equal(cap.continuations[0].candidateId, 'cand-1');
    // Apollo no reportó créditos ⇒ null, NUNCA 0.
    assert.equal(cap.continuations[0].apolloCostCredits, null);
  });

  it('revealed: continúa para CERRAR la corrida (nunca para abrir la 2ª pata)', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: REVEALED_PAYLOAD },
      webhookDeps(cap, { wireWaterfall: true }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.continuations.length, 1);
    assert.equal(cap.continuations[0].apolloOutcome, 'revealed');
    assert.equal(cap.continuations[0].apolloCostCredits, 8);
  });

  it('la metadata del usage-log lleva phone_reveal_waterfall_id en ambos caminos', async () => {
    for (const payload of [webhookPayload({ phone_numbers: [] }), REVEALED_PAYLOAD]) {
      const cap = emptyWebhookCapture();
      await runApolloPhoneRevealWebhook(
        { tokenProvided: TOKEN, payload },
        webhookDeps(cap, { wireWaterfall: true }),
      );
      assert.equal(cap.logs[0].metadata.phone_reveal_waterfall_id, RUN_ID);
    }
  });

  it('la corrida se resuelve UNA sola vez por callback', async () => {
    const cap = emptyWebhookCapture();
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: REVEALED_PAYLOAD },
      webhookDeps(cap, { wireWaterfall: true }),
    );
    assert.equal(cap.runIdLookups.length, 1);
  });

  it('un candidato YA terminal no continúa nada (idempotente)', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: REVEALED_PAYLOAD },
      webhookDeps(cap, {
        wireWaterfall: true,
        candidate: {
          id: 'cand-1',
          accountId: 'acct-1',
          enrichmentMetadata: {},
          phoneRevealStatus: 'no_phone_found',
        },
      }),
    );
    assert.equal(result.outcome, 'already_terminal');
    assert.equal(cap.continuations.length, 0);
    assert.equal(cap.runIdLookups.length, 0);
  });

  it('token inválido: no resuelve corrida ni continúa', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: 'malo', payload: REVEALED_PAYLOAD },
      webhookDeps(cap, { wireWaterfall: true }),
    );
    assert.equal(result.outcome, 'unauthorized');
    assert.equal(cap.continuations.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Webhook: BEST-EFFORT (nunca un 5xx por el waterfall)
// ═══════════════════════════════════════════════════════════════

describe('webhook — best-effort: el waterfall no puede tumbar el callback', () => {
  it('si la continuación LANZA, el webhook sigue devolviendo 200 y el teléfono queda persistido', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: REVEALED_PAYLOAD },
      webhookDeps(cap, { wireWaterfall: true, continuationThrows: true }),
    );
    assert.equal(result.httpStatus, 200);
    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.persisted.length, 1);
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'revealed');
  });

  it('si la resolución de la corrida LANZA, el callback continúa sin la clave', async () => {
    const cap = emptyWebhookCapture();
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: REVEALED_PAYLOAD },
      webhookDeps(cap, { wireWaterfall: true, runIdThrows: true }),
    );
    assert.equal(result.httpStatus, 200);
    assert.equal(result.outcome, 'revealed');
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        cap.logs[0].metadata,
        'phone_reveal_waterfall_id',
      ),
      false,
    );
    // La continuación SÍ se intenta: perder la correlación no cancela la 2ª pata.
    assert.equal(cap.continuations.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Harness del RECOVERY
// ═══════════════════════════════════════════════════════════════

interface RecoveryCapture {
  logs: RecoveryUsageLogEntry[];
  persisted: Array<{ id: string; patch: RecoveryPersistencePatch }>;
  continuations: RecoveryWaterfallContinuationArgs[];
  runIdLookups: string[];
}

function emptyRecoveryCapture(): RecoveryCapture {
  return { logs: [], persisted: [], continuations: [], runIdLookups: [] };
}

function recoveryCandidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

function recoveryDeps(
  cap: RecoveryCapture,
  opts: {
    wireWaterfall?: boolean;
    poll?: PollFetchResult;
    continuationThrows?: boolean;
    candidate?: RecoveryCandidateRecord;
  } = {},
): RecoverApolloPhoneRevealDeps {
  const base: RecoverApolloPhoneRevealDeps = {
    nowIso: NOW,
    loadCandidate: async () => opts.candidate ?? recoveryCandidate(),
    resolveRecoveryRequestId: async () => '-4594297923800105423',
    fetchWebhookResult: async () => opts.poll ?? { kind: 'result', payload: {} },
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    lookupPhoneCacheSuppression: async () => null,
  };
  if (!opts.wireWaterfall) return base;
  return {
    ...base,
    resolveWaterfallRunId: async (candidateId) => {
      cap.runIdLookups.push(candidateId);
      return RUN_ID;
    },
    continueWaterfall: async (args) => {
      cap.continuations.push(args);
      if (opts.continuationThrows) throw new Error('continuación rota');
      return undefined;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. Recovery
// ═══════════════════════════════════════════════════════════════

describe('recovery — flag OFF: sin corrida, sin clave, sin continuación', () => {
  it('no_phone_found recuperado: metadata idéntica a la de antes del hito', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cap.continuations.length, 0);
    assert.equal(cap.runIdLookups.length, 0);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        cap.logs[0].metadata,
        'phone_reveal_waterfall_id',
      ),
      false,
    );
  });
});

describe('recovery — flag ON: correlación y continuación', () => {
  it('no_phone_found: continúa UNA vez y lleva la clave en la metadata', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, { wireWaterfall: true }),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cap.continuations.length, 1);
    assert.equal(cap.continuations[0].apolloOutcome, 'no_phone_found');
    assert.equal(cap.logs[0].metadata.phone_reveal_waterfall_id, RUN_ID);
  });

  it('revealed recuperado: continúa para cerrar la corrida con el costo de Apollo', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, {
        wireWaterfall: true,
        poll: {
          kind: 'result',
          payload: {
            phone_numbers: [
              { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 8 },
            ],
          },
        },
      }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cap.continuations.length, 1);
    assert.equal(cap.continuations[0].apolloOutcome, 'revealed');
    assert.equal(cap.continuations[0].apolloCostCredits, 8);
  });

  it('"aún procesando" NO continúa: no es un desenlace terminal de Apollo', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, {
        wireWaterfall: true,
        poll: {
          kind: 'result',
          payload: { status: 'processing', retry_after_seconds: 60 },
        },
      }),
    );
    assert.equal(result.outcome, 'still_pending');
    assert.equal(cap.continuations.length, 0);
  });

  it('404 y 401 NO continúan (ambiguo / problema de scope, nunca terminal)', async () => {
    for (const poll of [
      { kind: 'not_found' } as PollFetchResult,
      { kind: 'unauthorized' } as PollFetchResult,
    ]) {
      const cap = emptyRecoveryCapture();
      await recoverApolloPhoneRevealForCandidate(
        { candidateId: 'cand-1' },
        recoveryDeps(cap, { wireWaterfall: true, poll }),
      );
      assert.equal(cap.continuations.length, 0, poll.kind);
    }
  });

  it('un candidato inelegible no resuelve corrida ni continúa', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, {
        wireWaterfall: true,
        candidate: recoveryCandidate({ phoneRevealStatus: 'revealed' }),
      }),
    );
    assert.equal(result.outcome, 'already_revealed');
    assert.equal(cap.continuations.length, 0);
    assert.equal(cap.runIdLookups.length, 0);
  });

  it('dryRun no continúa nada (no consulta Apollo ni escribe)', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1', dryRun: true },
      recoveryDeps(cap, { wireWaterfall: true }),
    );
    assert.equal(result.outcome, 'dry_run_eligible');
    assert.equal(cap.continuations.length, 0);
    assert.equal(cap.persisted.length, 0);
    assert.equal(cap.logs.length, 0);
  });

  it('BEST-EFFORT: una continuación que LANZA no rompe la recuperación', async () => {
    const cap = emptyRecoveryCapture();
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, { wireWaterfall: true, continuationThrows: true }),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cap.persisted.length, 1);
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'no_phone_found');
  });
});
