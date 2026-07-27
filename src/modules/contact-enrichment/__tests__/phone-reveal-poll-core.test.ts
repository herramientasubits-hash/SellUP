/**
 * Agente 2A — Apollo Phone Reveal POLL scaffold (APOLLO-PHONE-ASYNC-1)
 *
 * El poll es SOLO scaffold: describe el request de recuperación por request_id
 * sin ejecutar red ni job automático. Estas pruebas verifican la elegibilidad y
 * que el runner DI devuelva el payload recuperado (que el caller pasa al webhook
 * core). Sin red, sin DB, sin env, sin logs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  planApolloPhoneRevealPoll,
  runApolloPhoneRevealPoll,
  APOLLO_PHONE_REVEAL_RESULT_PATH,
  type PollableCandidateRecord,
} from '../phone-reveal-poll-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

function candidate(
  overrides: Partial<PollableCandidateRecord> = {},
): PollableCandidateRecord {
  return {
    id: 'cand-1',
    phoneRevealStatus: 'requested',
    phoneRevealRequestId: 'apollo-req-123',
    ...overrides,
  };
}

describe('ASYNC-1 poll — planApolloPhoneRevealPoll', () => {
  it('requested + request_id → eligible con request POST al result path', () => {
    const plan = planApolloPhoneRevealPoll(candidate());
    assert.equal(plan.eligibility, 'eligible');
    assert.equal(plan.requestId, 'apollo-req-123');
    assert.equal(plan.request?.method, 'POST');
    assert.equal(plan.request?.path, APOLLO_PHONE_REVEAL_RESULT_PATH);
    assert.equal(plan.request?.body.request_id, 'apollo-req-123');
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

  it('requested sin request_id → missing_request_id', () => {
    const plan = planApolloPhoneRevealPoll(candidate({ phoneRevealRequestId: null }));
    assert.equal(plan.eligibility, 'missing_request_id');
    assert.equal(plan.request, null);
  });
});

describe('ASYNC-1 poll — runApolloPhoneRevealPoll (DI)', () => {
  it('no elegible → not_in_flight, sin consultar', async () => {
    let called = 0;
    const res = await runApolloPhoneRevealPoll(candidate({ phoneRevealStatus: 'revealed' }), {
      fetchResultByRequestId: async () => {
        called += 1;
        return null;
      },
    });
    assert.equal(res.outcome, 'not_in_flight');
    assert.equal(called, 0);
  });

  it('sin resultado aún → no_result_yet', async () => {
    const res = await runApolloPhoneRevealPoll(candidate(), {
      fetchResultByRequestId: async () => null,
    });
    assert.equal(res.outcome, 'no_result_yet');
    assert.equal(res.payload, null);
  });

  it('resultado disponible → result_available con payload webhook-shape', async () => {
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: 'apollo-req-123',
      phone_numbers: [{ sanitized_number: '+573001112233', type_cd: 'mobile' }],
    };
    const res = await runApolloPhoneRevealPoll(candidate(), {
      fetchResultByRequestId: async (rid) => {
        assert.equal(rid, 'apollo-req-123');
        return payload;
      },
    });
    assert.equal(res.outcome, 'result_available');
    assert.equal(res.payload, payload);
  });
});

describe('ASYNC-1 poll — pureza (sin job automático)', () => {
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
});
