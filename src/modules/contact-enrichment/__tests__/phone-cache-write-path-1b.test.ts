/**
 * Agente 2A — Apollo Phone Cache WRITE PATH (APOLLO-PHONE-CACHE-1b)
 *
 * Pruebas offline/DI de la escritura de caché desde los dos caminos que
 * producen un teléfono real: el WEBHOOK de Apollo y el RECOVERY poll. Ambos
 * cores son puros y todas sus dependencias se inyectan, así que no hay red,
 * Supabase ni proveedor.
 *
 * Invariantes protegidas:
 *   - Solo el desenlace `revealed` escribe caché. no_phone_found / error /
 *     terminal / desconocido NUNCA escriben.
 *   - La escritura ocurre DESPUÉS de persistir el reveal (best-effort): un fallo
 *     de caché no puede perder un teléfono ya pagado.
 *   - Sin id Apollo válido, sin cuenta o sin país ISO-2 no se cachea.
 *   - Se cachea siempre con phone_source=apollo_reveal y TTL de 90 días.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
} from '../phone-reveal-recovery-core';
import {
  buildPhoneCacheWriteDecision,
  computePhoneCacheExpiresAt,
  type PhoneCacheWriteInput,
} from '../phone-cache-core';

// ── Fixtures ───────────────────────────────────────────────────

const NOW = '2026-07-29T12:00:00.000Z';
const TOKEN = 'shared-secret-token';
const PERSON_ID = '6a6826ba804c600014ead739';
const LUSHA_ID = 'v1.abcdefghijklmnop';
const ACCOUNT_A = 'acct-aaaa-1111';
const CANDIDATE_ID = 'cand-0001';
const REQUEST_ID = 'apollo-req-123';
const RECOVERY_ID = '-4594297923800105423';
/** Teléfono ficticio de prueba. Nunca un número real. */
const FAKE_PHONE = '+570000000000';

let cacheWrites: PhoneCacheWriteInput[];
let persisted: Array<Record<string, unknown>>;

beforeEach(() => {
  cacheWrites = [];
  persisted = [];
});

// ── WEBHOOK ────────────────────────────────────────────────────

function webhookCandidate(
  overrides: Partial<WebhookCandidateRecord> = {},
): WebhookCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_A,
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    candidateCountry: 'CO',
    runCompanyCountryCode: 'CO',
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
      persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async () => {},
    cacheRevealedPhone: async (input) => {
      cacheWrites.push(input);
      return { written: true };
    },
    ...overrides,
  };
}

function payloadWithPhone(
  overrides: Partial<ApolloPhoneRevealWebhookPayload> = {},
): ApolloPhoneRevealWebhookPayload {
  return {
    request_id: REQUEST_ID,
    people: [
      {
        id: PERSON_ID,
        phone_numbers: [
          { sanitized_number: FAKE_PHONE, type_cd: 'mobile', credits_consumed: 8 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('CACHE-1b write path — WEBHOOK', () => {
  it('un reveal `revealed` escribe la caché con la política aprobada', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cacheWrites.length, 1);
    const write = cacheWrites[0];
    assert.equal(write.provider, 'apollo');
    assert.equal(write.providerPersonId, PERSON_ID);
    assert.equal(write.accountId, ACCOUNT_A);
    assert.equal(write.countryCode, 'CO');
    assert.equal(write.normalizedPhone, FAKE_PHONE);
    assert.equal(write.phoneSource, 'apollo_reveal');
    assert.equal(write.originalRevealedAt, NOW);
    assert.equal(write.sourceCandidateId, CANDIDATE_ID);
  });

  it('la decisión resultante fija un TTL de 90 días', async () => {
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(),
    );
    const decision = buildPhoneCacheWriteDecision(cacheWrites[0], true);
    assert.equal(decision.write, true);
    assert.equal(
      decision.write === true && decision.row.expiresAt,
      computePhoneCacheExpiresAt(NOW),
    );
  });

  it('la caché se escribe DESPUÉS de persistir el reveal', async () => {
    const order: string[] = [];
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(webhookCandidate(), {
        persist: async () => {
          order.push('persist');
        },
        cacheRevealedPhone: async () => {
          order.push('cache');
        },
      }),
    );
    assert.deepEqual(order, ['persist', 'cache']);
  });

  it('un fallo de caché NO rompe el webhook ni pierde el teléfono', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(webhookCandidate(), {
        cacheRevealedPhone: async () => {
          throw new Error('cache down');
        },
      }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(result.httpStatus, 200);
    assert.equal(persisted[0]?.phone, FAKE_PHONE);
  });

  it('no_phone_found NO escribe caché', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: { request_id: REQUEST_ID, phone_numbers: [] } },
      webhookDeps(),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cacheWrites.length, 0);
  });

  it('un candidato ya terminal NO escribe caché', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(webhookCandidate({ phoneRevealStatus: 'revealed' })),
    );
    assert.equal(result.outcome, 'already_terminal');
    assert.equal(cacheWrites.length, 0);
  });

  it('un token inválido NO escribe caché', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: 'wrong', payload: payloadWithPhone() },
      webhookDeps(),
    );
    assert.equal(result.outcome, 'unauthorized');
    assert.equal(cacheWrites.length, 0);
  });

  it('sin la dep de caché el webhook se comporta exactamente igual que antes', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(webhookCandidate(), { cacheRevealedPhone: undefined }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cacheWrites.length, 0);
    assert.equal(persisted[0]?.phone, FAKE_PHONE);
  });

  it('un id Lusha `v1.*` no produce una entrada cacheable', async () => {
    await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: payloadWithPhone({
          people: [
            {
              id: LUSHA_ID,
              phone_numbers: [{ sanitized_number: FAKE_PHONE, type_cd: 'mobile' }],
            },
          ],
        }),
      },
      webhookDeps(),
    );
    assert.equal(cacheWrites.length, 1);
    assert.equal(cacheWrites[0].providerPersonId, null);
    const decision = buildPhoneCacheWriteDecision(cacheWrites[0], true);
    assert.equal(decision.write === false && decision.reason, 'invalid_person_id');
  });

  it('un país no resoluble no produce una entrada cacheable', async () => {
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(
        webhookCandidate({ candidateCountry: 'Colombia', runCompanyCountryCode: null }),
      ),
    );
    const decision = buildPhoneCacheWriteDecision(cacheWrites[0], true);
    assert.equal(decision.write === false && decision.reason, 'unknown_country');
  });

  it('sin cuenta no produce una entrada cacheable', async () => {
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithPhone() },
      webhookDeps(webhookCandidate({ accountId: null })),
    );
    const decision = buildPhoneCacheWriteDecision(cacheWrites[0], true);
    assert.equal(decision.write === false && decision.reason, 'missing_account');
  });
});

// ── RECOVERY ───────────────────────────────────────────────────

function recoveryCandidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_A,
    phoneRevealProvider: 'apollo',
    source: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: PERSON_ID,
    candidateCountry: 'CO',
    runCompanyCountryCode: 'CO',
    ...overrides,
  };
}

function recoveryDeps(
  record: RecoveryCandidateRecord = recoveryCandidate(),
  payload: ApolloPhoneRevealWebhookPayload | null = payloadWithPhone(),
  overrides: Partial<RecoverApolloPhoneRevealDeps> = {},
): RecoverApolloPhoneRevealDeps {
  return {
    nowIso: NOW,
    loadCandidate: async () => record,
    resolveRecoveryRequestId: async () => RECOVERY_ID,
    fetchWebhookResult: async () =>
      payload ? { kind: 'result', payload } : { kind: 'no_result_yet' },
    persist: async (_id, patch) => {
      persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async () => {},
    cacheRevealedPhone: async (input) => {
      cacheWrites.push(input);
      return { written: true };
    },
    ...overrides,
  };
}

describe('CACHE-1b write path — RECOVERY', () => {
  it('un recovery `revealed` escribe la caché con la misma política', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cacheWrites.length, 1);
    assert.equal(cacheWrites[0].providerPersonId, PERSON_ID);
    assert.equal(cacheWrites[0].accountId, ACCOUNT_A);
    assert.equal(cacheWrites[0].countryCode, 'CO');
    assert.equal(cacheWrites[0].phoneSource, 'apollo_reveal');
  });

  it('usa el apollo_person_id ya persistido cuando el payload no lo trae', async () => {
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate(),
        payloadWithPhone({
          people: [{ phone_numbers: [{ sanitized_number: FAKE_PHONE, type_cd: 'mobile' }] }],
        }),
      ),
    );
    assert.equal(cacheWrites[0].providerPersonId, PERSON_ID);
  });

  it('no_phone_found NO escribe caché', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), { request_id: REQUEST_ID, phone_numbers: [] }),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.equal(cacheWrites.length, 0);
  });

  it('still_pending NO escribe caché', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), null),
    );
    assert.equal(result.outcome, 'still_pending');
    assert.equal(cacheWrites.length, 0);
  });

  it('un candidato ya terminal NO escribe caché', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate({ phoneRevealStatus: 'error' })),
    );
    assert.equal(result.outcome, 'terminal_error_skipped');
    assert.equal(cacheWrites.length, 0);
  });

  it('un dryRun NO escribe caché (ni consulta Apollo)', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID, dryRun: true },
      recoveryDeps(),
    );
    assert.equal(result.outcome, 'dry_run_eligible');
    assert.equal(cacheWrites.length, 0);
  });

  it('un fallo de caché NO rompe la recuperación', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), payloadWithPhone(), {
        cacheRevealedPhone: async () => {
          throw new Error('cache down');
        },
      }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(result.phoneRevealed, true);
  });

  it('un candidato con teléfono servido desde caché ya no es recuperable', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate({
          enrichmentMetadata: {
            phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_cache' },
          } as never,
        }),
      ),
    );
    assert.equal(result.outcome, 'already_has_phone');
    assert.equal(cacheWrites.length, 0);
  });

  it('sin la dep de caché el recovery se comporta exactamente igual que antes', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate(), payloadWithPhone(), {
        cacheRevealedPhone: undefined,
      }),
    );
    assert.equal(result.outcome, 'revealed');
    assert.equal(cacheWrites.length, 0);
  });
});
