/**
 * Agente 2A — Apollo Phone Reveal RECOVERY POLL scaffold
 * (APOLLO-PHONE-ASYNC-1, contrato corregido en APOLLO-PHONE-ASYNC-21)
 *
 * El poll es SOLO scaffold: describe el request de recuperación sin ejecutar red
 * ni job automático. Estas pruebas verifican el contrato confirmado por Apollo:
 *
 *   - Endpoint: GET /api/v1/webhook_result/{request_id} (NO POST /people/match/result).
 *   - El id del path es apollo_http_request_id (top-level request_id /
 *     x-http-request-id), NO phone_enrichment.request_id.
 *   - Soporta el signed integer negativo como string (-4594297923800105423).
 *   - Auth X-Api-Key, sin body.
 *   - 401 → possible_missing_webhook_result_read_scope.
 *   - 404 → not_found (NUNCA no_phone_found).
 *
 * Sin red, sin DB, sin env, sin logs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  planApolloPhoneRevealPoll,
  runApolloPhoneRevealPoll,
  buildApolloWebhookResultPath,
  classifyWebhookResultHttpStatus,
  APOLLO_WEBHOOK_RESULT_PATH_PREFIX,
  APOLLO_WEBHOOK_RESULT_AUTH_HEADER,
  type PollableCandidateRecord,
} from '../phone-reveal-poll-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** El request_id de recovery real pendiente (signed 64-bit int como string). */
const RECOVERY_ID = '-4594297923800105423';
/** El phone_enrichment.request_id NO sirve para recovery (devuelve 404). */
const ENRICHMENT_ID = '6a6826ba804c600014ead739';

function candidate(
  overrides: Partial<PollableCandidateRecord> = {},
): PollableCandidateRecord {
  return {
    id: 'cand-1',
    phoneRevealStatus: 'requested',
    apolloHttpRequestId: RECOVERY_ID,
    ...overrides,
  };
}

describe('ASYNC-21 poll — planApolloPhoneRevealPoll (GET webhook_result)', () => {
  it('requested + recovery id → eligible con GET al webhook_result path', () => {
    const plan = planApolloPhoneRevealPoll(candidate());
    assert.equal(plan.eligibility, 'eligible');
    assert.equal(plan.recoveryRequestId, RECOVERY_ID);
    assert.equal(plan.request?.method, 'GET');
    assert.equal(plan.request?.path, `${APOLLO_WEBHOOK_RESULT_PATH_PREFIX}${RECOVERY_ID}`);
    assert.equal(plan.request?.body, null);
    assert.equal(plan.request?.authHeader, APOLLO_WEBHOOK_RESULT_AUTH_HEADER);
    assert.equal(APOLLO_WEBHOOK_RESULT_AUTH_HEADER, 'X-Api-Key');
  });

  it('preserva el signo negativo del signed integer en el path', () => {
    const path = buildApolloWebhookResultPath(RECOVERY_ID);
    assert.equal(path, '/api/v1/webhook_result/-4594297923800105423');
    assert.ok(path.includes('-4594297923800105423'));
  });

  it('el path NO usa POST /people/match/result', () => {
    const plan = planApolloPhoneRevealPoll(candidate());
    assert.equal(/people\/match\/result/.test(plan.request?.path ?? ''), false);
    assert.equal(plan.request?.method, 'GET');
  });

  it('pending también es elegible', () => {
    const plan = planApolloPhoneRevealPoll(candidate({ phoneRevealStatus: 'pending' }));
    assert.equal(plan.eligibility, 'eligible');
  });

  it('status terminal → not_in_flight, sin request', () => {
    for (const status of ['revealed', 'no_phone_found', 'error', 'not_requested', null]) {
      const plan = planApolloPhoneRevealPoll(candidate({ phoneRevealStatus: status }));
      assert.equal(plan.eligibility, 'not_in_flight');
      assert.equal(plan.request, null);
    }
  });

  it('requested sin recovery id → missing_recovery_request_id', () => {
    const plan = planApolloPhoneRevealPoll(candidate({ apolloHttpRequestId: null }));
    assert.equal(plan.eligibility, 'missing_recovery_request_id');
    assert.equal(plan.request, null);
  });
});

describe('ASYNC-21 poll — classifyWebhookResultHttpStatus', () => {
  it('200 → ok', () => {
    assert.equal(classifyWebhookResultHttpStatus(200), 'ok');
  });
  it('404 → not_found (NUNCA no_phone_found)', () => {
    assert.equal(classifyWebhookResultHttpStatus(404), 'not_found');
  });
  it('401 / 403 → unauthorized (posible falta de webhook_result_read scope)', () => {
    assert.equal(classifyWebhookResultHttpStatus(401), 'unauthorized');
    assert.equal(classifyWebhookResultHttpStatus(403), 'unauthorized');
  });
  it('otros → error', () => {
    assert.equal(classifyWebhookResultHttpStatus(500), 'error');
    assert.equal(classifyWebhookResultHttpStatus(429), 'error');
  });
});

describe('ASYNC-21 poll — runApolloPhoneRevealPoll (DI)', () => {
  it('no elegible → not_in_flight, sin consultar', async () => {
    let called = 0;
    const res = await runApolloPhoneRevealPoll(candidate({ phoneRevealStatus: 'revealed' }), {
      fetchWebhookResult: async () => {
        called += 1;
        return { kind: 'no_result_yet' };
      },
    });
    assert.equal(res.outcome, 'not_in_flight');
    assert.equal(called, 0);
  });

  it('usa el recovery id (apollo_http_request_id), no un enrichment id', async () => {
    let usedId: string | null = null;
    await runApolloPhoneRevealPoll(candidate(), {
      fetchWebhookResult: async (rid) => {
        usedId = rid;
        return { kind: 'no_result_yet' };
      },
    });
    assert.equal(usedId, RECOVERY_ID);
    assert.notEqual(usedId, ENRICHMENT_ID);
  });

  it('sin resultado aún → no_result_yet', async () => {
    const res = await runApolloPhoneRevealPoll(candidate(), {
      fetchWebhookResult: async () => ({ kind: 'no_result_yet' }),
    });
    assert.equal(res.outcome, 'no_result_yet');
    assert.equal(res.payload, null);
  });

  it('404 → not_found (NO se interpreta como no_phone_found)', async () => {
    const res = await runApolloPhoneRevealPoll(candidate(), {
      fetchWebhookResult: async () => ({ kind: 'not_found' }),
    });
    assert.equal(res.outcome, 'not_found');
    assert.notEqual(res.outcome, 'no_phone_found' as unknown);
    assert.equal(res.payload, null);
  });

  it('401 → possible_missing_webhook_result_read_scope', async () => {
    const res = await runApolloPhoneRevealPoll(candidate(), {
      fetchWebhookResult: async () => ({ kind: 'unauthorized' }),
    });
    assert.equal(res.outcome, 'possible_missing_webhook_result_read_scope');
  });

  it('resultado disponible → result_available con payload webhook-shape', async () => {
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: RECOVERY_ID,
      phone_numbers: [{ sanitized_number: '+573001112233', type_cd: 'mobile' }],
    };
    const res = await runApolloPhoneRevealPoll(candidate(), {
      fetchWebhookResult: async (rid) => {
        assert.equal(rid, RECOVERY_ID);
        return { kind: 'result', payload };
      },
    });
    assert.equal(res.outcome, 'result_available');
    assert.equal(res.payload, payload);
  });
});

describe('ASYNC-21 poll — pureza + contrato estático', () => {
  const raw = readFileSync(
    join(REPO_ROOT, 'src/modules/contact-enrichment/phone-reveal-poll-core.ts'),
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

  it('el endpoint de recovery es webhook_result y NO people/match/result', () => {
    assert.equal(/webhook_result/.test(code), true);
    assert.equal(/people\/match\/result/.test(code), false);
  });
});
