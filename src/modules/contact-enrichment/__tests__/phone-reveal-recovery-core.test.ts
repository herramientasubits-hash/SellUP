/**
 * Agente 2A — Apollo Phone Reveal RECOVERY core
 * (APOLLO-PHONE-RECOVERY-AUTOMATION-1)
 *
 * Recuperación SEGURA de reveals Apollo en vuelo (requested/pending) cuando el
 * webhook no llegó. Contrato confirmado por Apollo (ASYNC-21/22/23):
 *
 *   - Endpoint recovery: GET /api/v1/webhook_result/{apollo_http_request_id}
 *     (NUNCA POST /people/match, NUNCA POST /people/match/result).
 *   - recovery id = apollo_http_request_id (top-level request_id / x-http-request-id),
 *     NO phone_enrichment.request_id (ese devuelve 404).
 *   - Soporta el signed integer negativo como string (-4594297923800105423).
 *   - 404 NUNCA es no_phone_found; 401/403 NUNCA es terminal de negocio.
 *   - Recovery NO depende de ENABLE_APOLLO_PHONE_REVEAL (no crea reveals).
 *
 * Puro/DI: sin red, sin Supabase, sin env, sin cron, sin logs, sin PII.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  RECOVERY_REVEAL_PHASE,
  DEFAULT_BATCH_MAX_CANDIDATES,
  MAX_BATCH_MAX_CANDIDATES,
  DEFAULT_BATCH_MIN_AGE_MINUTES,
  type RecoveryCandidateRecord,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryUsageLogEntry,
  type RecoveryPersistencePatch,
  type RecoveryOutcome,
  type StaleRecoveryQuery,
} from '../phone-reveal-recovery-core';
import type { PollFetchResult } from '../phone-reveal-poll-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** recovery id real pendiente (signed 64-bit int como string). */
const RECOVERY_ID = '-4594297923800105423';
/** phone_enrichment.request_id: NO sirve para recovery (devuelve 404). */
const ENRICHMENT_ID = '6a6826ba804c600014ead739';
const NOW = '2026-07-28T12:00:00.000Z';

function candidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    source: 'lusha',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

interface Captured {
  patches: Array<{ id: string; patch: RecoveryPersistencePatch }>;
  logs: RecoveryUsageLogEntry[];
  fetchCalls: string[];
}

function makeDeps(args: {
  candidate?: RecoveryCandidateRecord | null;
  recoveryId?: string | null;
  fetch: (rid: string) => Promise<PollFetchResult>;
  captured: Captured;
}): RecoverApolloPhoneRevealDeps {
  const cand = args.candidate === undefined ? candidate() : args.candidate;
  return {
    nowIso: NOW,
    loadCandidate: async () => cand,
    resolveRecoveryRequestId: async () =>
      args.recoveryId === undefined ? RECOVERY_ID : args.recoveryId,
    fetchWebhookResult: async (rid) => {
      args.captured.fetchCalls.push(rid);
      return args.fetch(rid);
    },
    persist: async (id, patch) => {
      args.captured.patches.push({ id, patch });
    },
    logUsage: async (entry) => {
      args.captured.logs.push(entry);
    },
  };
}

function emptyCaptured(): Captured {
  return { patches: [], logs: [], fetchCalls: [] };
}

const mobilePayload: ApolloPhoneRevealWebhookPayload = {
  request_id: RECOVERY_ID,
  phone_numbers: [
    { sanitized_number: '+573001112233', type_cd: 'mobile', credits_consumed: 8 },
  ],
};

// ── 1. Candidate eligibility ───────────────────────────────────

describe('recovery — candidate eligibility', () => {
  it('solo procesa requested/pending (requested → hace poll)', async () => {
    for (const status of ['requested', 'pending']) {
      const captured = emptyCaptured();
      const res = await recoverApolloPhoneRevealForCandidate(
        { candidateId: 'cand-1' },
        makeDeps({
          candidate: candidate({ phoneRevealStatus: status }),
          fetch: async () => ({ kind: 'no_result_yet' }),
          captured,
        }),
      );
      assert.equal(captured.fetchCalls.length, 1);
      assert.equal(res.outcome, 'still_pending');
    }
  });

  it('no procesa revealed (already_revealed, sin poll)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        candidate: candidate({ phoneRevealStatus: 'revealed' }),
        fetch: async () => ({ kind: 'result', payload: mobilePayload }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'already_revealed');
    assert.equal(captured.fetchCalls.length, 0);
    assert.equal(captured.patches.length, 0);
  });

  it('no procesa no_phone_found (already_no_phone_found, sin poll)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        candidate: candidate({ phoneRevealStatus: 'no_phone_found' }),
        fetch: async () => ({ kind: 'result', payload: mobilePayload }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'already_no_phone_found');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('no procesa error terminal por defecto (terminal_error_skipped)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        candidate: candidate({ phoneRevealStatus: 'error' }),
        fetch: async () => ({ kind: 'result', payload: mobilePayload }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'terminal_error_skipped');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('no procesa si ya hay teléfono persistido (columna)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        candidate: candidate({ existingPhone: '+573001112233' }),
        fetch: async () => ({ kind: 'result', payload: mobilePayload }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'already_has_phone');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('no procesa si ya hay teléfono de apollo_reveal en metadata', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        candidate: candidate({
          enrichmentMetadata: { phone: { number: '+57...', source: 'apollo_reveal' } },
        }),
        fetch: async () => ({ kind: 'result', payload: mobilePayload }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'already_has_phone');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('no procesa candidato de proveedor no-apollo (not_apollo_provider)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        candidate: candidate({ phoneRevealProvider: 'lusha' }),
        fetch: async () => ({ kind: 'result', payload: mobilePayload }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'not_apollo_provider');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('candidato inexistente → candidate_not_found, sin poll', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ candidate: null, fetch: async () => ({ kind: 'no_result_yet' }), captured }),
    );
    assert.equal(res.outcome, 'candidate_not_found');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('candidateId vacío → invalid_candidate', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: '   ' },
      makeDeps({ fetch: async () => ({ kind: 'no_result_yet' }), captured }),
    );
    assert.equal(res.outcome, 'invalid_candidate');
    assert.equal(captured.fetchCalls.length, 0);
  });

  it('sin recovery id (apollo_http_request_id) → missing_recovery_request_id, sin poll', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ recoveryId: null, fetch: async () => ({ kind: 'no_result_yet' }), captured }),
    );
    assert.equal(res.outcome, 'missing_recovery_request_id');
    assert.equal(res.recoveryRequestIdPresent, false);
    assert.equal(captured.fetchCalls.length, 0);
  });
});

// ── 2. Polling contract ────────────────────────────────────────

describe('recovery — polling usa apollo_http_request_id (no enrichment id)', () => {
  it('el poll recibe el recovery id (apollo_http_request_id), NO el enrichment id', async () => {
    const captured = emptyCaptured();
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'no_result_yet' }), captured }),
    );
    assert.equal(captured.fetchCalls.length, 1);
    assert.equal(captured.fetchCalls[0], RECOVERY_ID);
    assert.notEqual(captured.fetchCalls[0], ENRICHMENT_ID);
  });

  it('soporta el signed integer negativo como string', async () => {
    const captured = emptyCaptured();
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        recoveryId: '-4594297923800105423',
        fetch: async () => ({ kind: 'no_result_yet' }),
        captured,
      }),
    );
    assert.equal(captured.fetchCalls[0], '-4594297923800105423');
    assert.ok(captured.fetchCalls[0].startsWith('-'));
  });
});

// ── 3. Result handling ─────────────────────────────────────────

describe('recovery — result handling', () => {
  it('200 con mobile → revealed + phone persistido + status revealed', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1', actorUserId: 'user-9' },
      makeDeps({ fetch: async () => ({ kind: 'result', payload: mobilePayload }), captured }),
    );
    assert.equal(res.outcome, 'revealed');
    assert.equal(res.phoneRevealed, true);
    assert.equal(res.creditsUsed, 8);
    const { patch } = captured.patches[0];
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.phone, '+573001112233');
    assert.equal(patch.phone_reveal_error_code, null);
    assert.equal(patch.phone_reveal_completed_at, NOW);
    assert.equal(patch.phone_revealed_at, NOW);
    assert.equal(patch.phone_reveal_last_checked_at, NOW);
    assert.equal(patch.phone_reveal_provider, 'apollo');
    assert.equal(patch.enrichment_metadata?.phone?.source, 'apollo_reveal');
    assert.equal(patch.enrichment_metadata?.phone?.type, 'mobile');
  });

  it('NUNCA fija phone_reveal_webhook_received_at (el teléfono no vino por webhook)', async () => {
    const captured = emptyCaptured();
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'result', payload: mobilePayload }), captured }),
    );
    const { patch } = captured.patches[0];
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, 'phone_reveal_webhook_received_at'),
      false,
    );
  });

  it('200 con direct_dial → persiste el tipo correcto', async () => {
    const captured = emptyCaptured();
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [
        { sanitized_number: '+13334445566', type_cd: 'direct_dial', credits_consumed: 8 },
      ],
    };
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'result', payload }), captured }),
    );
    const { patch } = captured.patches[0];
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.enrichment_metadata?.phone?.type, 'direct_dial');
    assert.equal(captured.logs[0].metadata.phone_type, 'direct_dial');
  });

  it('200 sin teléfono (payload entregado) → no_phone_found (evidencia clara)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        fetch: async () => ({ kind: 'result', payload: { phone_numbers: [] } }),
        captured,
      }),
    );
    assert.equal(res.outcome, 'no_phone_found');
    assert.equal(captured.patches[0].patch.phone_reveal_status, 'no_phone_found');
    assert.equal(captured.patches[0].patch.phone_reveal_completed_at, NOW);
  });

  it('404 NO se trata como no_phone_found (candidato sigue en vuelo)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'not_found' }), captured }),
    );
    assert.equal(res.outcome, 'not_found_or_pending_ambiguous');
    // Solo se marca last_checked; NUNCA se fija un status terminal.
    const { patch } = captured.patches[0];
    assert.equal(patch.phone_reveal_last_checked_at, NOW);
    assert.equal(patch.phone_reveal_status, undefined);
  });

  it('401/403 → possible_missing_webhook_result_read_scope (error técnico, no terminal)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'unauthorized' }), captured }),
    );
    assert.equal(res.outcome, 'possible_missing_webhook_result_read_scope');
    assert.equal(captured.patches[0].patch.phone_reveal_status, undefined);
    assert.equal(captured.logs[0].status, 'error');
    assert.equal(captured.logs[0].errorCode, 'possible_missing_webhook_result_read_scope');
  });

  it('5xx/network → provider_error_transient (no terminal)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'error', code: 'HTTP_500' }), captured }),
    );
    assert.equal(res.outcome, 'provider_error_transient');
    assert.equal(captured.patches[0].patch.phone_reveal_status, undefined);
    assert.equal(captured.logs[0].status, 'error');
  });

  it('no_result_yet → still_pending (no terminal)', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'no_result_yet' }), captured }),
    );
    assert.equal(res.outcome, 'still_pending');
    assert.equal(captured.patches[0].patch.phone_reveal_status, undefined);
    assert.equal(captured.logs[0].status, 'success');
  });

  it('credits numéricos se persisten; si no vienen, null', async () => {
    const captured = emptyCaptured();
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({
        fetch: async () => ({
          kind: 'result',
          payload: { phone_numbers: [{ sanitized_number: '+573001112233', type_cd: 'mobile' }] },
        }),
        captured,
      }),
    );
    assert.equal(captured.patches[0].patch.phone_reveal_cost_credits, null);
    assert.equal(captured.logs[0].metadata.credits_used, null);
  });
});

// ── 4. Logs / privacy ──────────────────────────────────────────

describe('recovery — usage log (recovery_poll, sin PII)', () => {
  it('emite reveal_phase = recovery_poll con apollo_http_request_id, sin teléfono', async () => {
    const captured = emptyCaptured();
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1', actorUserId: 'user-9', reason: 'webhook lost' },
      makeDeps({ fetch: async () => ({ kind: 'result', payload: mobilePayload }), captured }),
    );
    const log = captured.logs[0];
    assert.equal(log.metadata.reveal_phase, RECOVERY_REVEAL_PHASE);
    assert.equal(log.metadata.reveal_phase, 'recovery_poll');
    assert.equal(log.metadata.apollo_http_request_id, RECOVERY_ID);
    assert.equal(log.metadata.request_id, RECOVERY_ID);
    assert.equal(log.triggeredBy, 'user-9');
    assert.equal(log.metadata.has_reason, true);
    assert.equal(log.metadata.phone_present, true);
    assert.equal(log.metadata.phone_type, 'mobile');
    assert.equal(log.metadata.credits_used, 8);
  });

  it('el log NO contiene el número, raw_number, sanitized_number ni el payload crudo', async () => {
    const captured = emptyCaptured();
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'result', payload: mobilePayload }), captured }),
    );
    const serialized = JSON.stringify(captured.logs[0]);
    assert.equal(serialized.includes('+573001112233'), false);
    assert.equal(serialized.includes('raw_number'), false);
    assert.equal(serialized.includes('sanitized_number'), false);
    assert.equal(serialized.includes('phone_numbers'), false);
  });

  it('reason no se persiste como texto (solo has_reason boolean)', async () => {
    const captured = emptyCaptured();
    const secret = 'contactar a Juan Perez juan@acme.com';
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1', reason: secret },
      makeDeps({ fetch: async () => ({ kind: 'no_result_yet' }), captured }),
    );
    const serialized = JSON.stringify(captured.logs[0]);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('juan@acme.com'), false);
    assert.equal(captured.logs[0].metadata.has_reason, true);
  });

  it('el resultado devuelto no expone el teléfono', async () => {
    const captured = emptyCaptured();
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      makeDeps({ fetch: async () => ({ kind: 'result', payload: mobilePayload }), captured }),
    );
    assert.equal(JSON.stringify(res).includes('+573001112233'), false);
  });
});

// ── 5. Batch recovery ──────────────────────────────────────────

describe('recovery batch — recoverStaleApolloPhoneRevealRequests', () => {
  it('dryRun por defecto: selecciona pero NO hace poll (todo skipped)', async () => {
    let recoverCalls = 0;
    const summary = await recoverStaleApolloPhoneRevealRequests(
      {},
      {
        nowIso: NOW,
        findStaleCandidateIds: async () => ['a', 'b', 'c'],
        recoverOne: async () => {
          recoverCalls += 1;
          return 'revealed';
        },
      },
    );
    assert.equal(summary.dryRun, true);
    assert.equal(recoverCalls, 0);
    assert.equal(summary.checked, 3);
    assert.equal(summary.skipped, 3);
    assert.equal(summary.recovered, 0);
  });

  it('respeta minAgeMinutes y maxCandidates en la query (con clamp del cap)', async () => {
    let seen: StaleRecoveryQuery | null = null;
    await recoverStaleApolloPhoneRevealRequests(
      { maxCandidates: 999, minAgeMinutes: 30, dryRun: true },
      {
        nowIso: NOW,
        findStaleCandidateIds: async (q) => {
          seen = q;
          return [];
        },
        recoverOne: async () => 'revealed',
      },
    );
    assert.equal(seen!.minAgeMinutes, 30);
    assert.equal(seen!.maxCandidates, MAX_BATCH_MAX_CANDIDATES); // 999 → cap 10
    assert.equal(seen!.nowIso, NOW);
  });

  it('defaults seguros: max=5, minAge=15, dryRun=true', async () => {
    let seen: StaleRecoveryQuery | null = null;
    const summary = await recoverStaleApolloPhoneRevealRequests(
      {},
      {
        nowIso: NOW,
        findStaleCandidateIds: async (q) => {
          seen = q;
          return [];
        },
        recoverOne: async () => 'revealed',
      },
    );
    assert.equal(seen!.maxCandidates, DEFAULT_BATCH_MAX_CANDIDATES);
    assert.equal(seen!.maxCandidates, 5);
    assert.equal(seen!.minAgeMinutes, DEFAULT_BATCH_MIN_AGE_MINUTES);
    assert.equal(seen!.minAgeMinutes, 15);
    assert.equal(summary.dryRun, true);
  });

  it('no dryRun: tabula outcomes por categoría (sin PII en el summary)', async () => {
    const outcomes: Record<string, RecoveryOutcome> = {
      a: 'revealed',
      b: 'no_phone_found',
      c: 'still_pending',
      d: 'not_found_or_pending_ambiguous',
      e: 'possible_missing_webhook_result_read_scope',
      f: 'provider_error_transient',
      g: 'already_revealed',
    };
    const summary = await recoverStaleApolloPhoneRevealRequests(
      { dryRun: false, maxCandidates: 10 },
      {
        nowIso: NOW,
        findStaleCandidateIds: async () => Object.keys(outcomes),
        recoverOne: async (id) => outcomes[id],
      },
    );
    assert.equal(summary.checked, 7);
    assert.equal(summary.recovered, 1);
    assert.equal(summary.no_phone_found, 1);
    assert.equal(summary.still_pending, 2); // still_pending + 404 ambiguo
    assert.equal(summary.failed, 2); // scope + transient
    assert.equal(summary.skipped, 1); // already_revealed (inelegible)
    // Summary es solo conteos: nada que parezca PII.
    const keys = Object.keys(summary).sort();
    assert.deepEqual(keys, [
      'checked',
      'dryRun',
      'failed',
      'maxCandidates',
      'minAgeMinutes',
      'no_phone_found',
      'recovered',
      'skipped',
      'still_pending',
    ]);
  });

  it('maxCandidates < 1 se sube a 1', async () => {
    let seen: StaleRecoveryQuery | null = null;
    await recoverStaleApolloPhoneRevealRequests(
      { maxCandidates: 0, dryRun: true },
      {
        nowIso: NOW,
        findStaleCandidateIds: async (q) => {
          seen = q;
          return [];
        },
        recoverOne: async () => 'revealed',
      },
    );
    assert.equal(seen!.maxCandidates, 1);
  });
});

// ── 6. Pureza + contrato estático ──────────────────────────────

describe('recovery — pureza + contrato estático', () => {
  const raw = readFileSync(
    join(REPO_ROOT, 'src/modules/contact-enrichment/phone-reveal-recovery-core.ts'),
    'utf8',
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('sin fetch / red directa', () => {
    assert.equal(/\bfetch\s*\(/.test(code), false);
  });

  it('sin Supabase / env / logs', () => {
    assert.equal(/supabase|process\.env|console\.\w+\s*\(/i.test(code), false);
  });

  it('sin cron / setInterval / setTimeout (no hay job automático)', () => {
    assert.equal(/setInterval|setTimeout|cron/i.test(code), false);
  });

  it('NO lee el flag ENABLE_APOLLO_PHONE_REVEAL (recovery no crea reveals)', () => {
    assert.equal(/ENABLE_APOLLO_PHONE_REVEAL/.test(code), false);
  });

  it('NO usa people/match ni people/match/result (recovery es GET webhook_result)', () => {
    assert.equal(/people\/match/.test(code), false);
  });

  it('NO referencia phone_enrichment.request_id como id de polling', () => {
    assert.equal(/phone_enrichment\.request_id/.test(code), false);
  });

  it('NO imprime raw_number ni sanitized_number en persistencia de log', () => {
    // El código no debe construir metadata con raw_number/sanitized_number.
    assert.equal(/metadata[\s\S]{0,400}raw_number/.test(code), false);
  });
});
