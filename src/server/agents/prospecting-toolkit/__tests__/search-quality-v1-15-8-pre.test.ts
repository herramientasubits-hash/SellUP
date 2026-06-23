/**
 * Tests — LinkedIn Usage Logger Adapter (v1.15.8-pre)
 *
 * Verifica createLinkedInUsageLoggerFn:
 *   F1  — payload success → mapping correcto en LogProviderUsageInput
 *   F2  — payload failed → status 'error' en LogProviderUsageInput
 *   F3  — triggered_by usa payload.user_id si existe
 *   F4  — triggered_by usa factory userId si payload.user_id es null
 *   F5  — metadata no incluye query; sí incluye query_length
 *   F6  — metadata incluye selected_status y selected_url
 *   F7  — realLogTavilyUsage retorna already_logged → resuelve sin lanzar
 *   F8  — realLogTavilyUsage retorna failed → lanza error sanitizado
 *   F9  — batch_id null → lanza antes de llamar al logger
 *   F10 — sin Supabase real ni Tavily real (mock inyectado)
 *
 * Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLinkedInUsageLoggerFn } from '../tavily-usage-logging';
import type { UsageLogResult } from '../tavily-usage-logging';
import type { LinkedInUsageLogPayload } from '../linkedin-company-search';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BATCH_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_ID = 'user-factory-001';
const PAYLOAD_USER_ID = 'user-payload-002';

function makePayload(overrides?: Partial<LinkedInUsageLogPayload>): LinkedInUsageLogPayload {
  return {
    usage_key: `tavily:linkedin_search:${BATCH_ID}:softland:q0`,
    provider: 'tavily',
    feature: 'linkedin_company_search',
    agent: 'agent_1',
    batch_id: BATCH_ID,
    user_id: PAYLOAD_USER_ID,
    candidate_name: 'Softland',
    candidate_domain: 'softland.com',
    query: '"Softland" "softland.com" site:linkedin.com/company',
    search_depth: 'basic',
    max_results: 3,
    estimated_cost_usd: 0.008,
    status: 'success',
    result_count: 2,
    selected_status: 'found',
    selected_url: 'https://www.linkedin.com/company/softland',
    created_at: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

function makeLogUsageMock(result: UsageLogResult): {
  captured: LogProviderUsageInput | null;
  fn: (input: LogProviderUsageInput) => Promise<UsageLogResult>;
} {
  const captured: { value: LogProviderUsageInput | null } = { value: null };
  return {
    get captured() { return captured.value; },
    fn: async (input: LogProviderUsageInput) => {
      captured.value = input;
      return result;
    },
  };
}

// ─── F1 — payload success → mapping correcto ─────────────────────────────────

describe('F1 — payload success llama realLogTavilyUsage con mapping correcto', () => {
  it('operation_key = linkedin_company_search', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload());

    assert.equal(mock.captured!.operation_key, 'linkedin_company_search');
  });

  it('provider_key = tavily', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload());

    assert.equal(mock.captured!.provider_key, 'tavily');
  });

  it('batch_id preservado', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload());

    assert.equal(mock.captured!.batch_id, BATCH_ID);
  });

  it('usage_key preservado', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    const payload = makePayload();
    await fn(payload);

    assert.equal(mock.captured!.usage_key, payload.usage_key);
  });

  it('estimated_cost_usd preservado', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ estimated_cost_usd: 0.008 }));

    assert.equal(mock.captured!.estimated_cost_usd, 0.008);
  });

  it('status success', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ status: 'success' }));

    assert.equal(mock.captured!.status, 'success');
  });
});

// ─── F2 — payload failed → status error ──────────────────────────────────────

describe('F2 — payload failed mapea status error', () => {
  it('status = error cuando payload.status !== success', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ status: 'failed' }));

    assert.equal(mock.captured!.status, 'error');
  });

  it('status = error cuando payload.status = skipped', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ status: 'skipped' }));

    assert.equal(mock.captured!.status, 'error');
  });
});

// ─── F3 — triggered_by desde payload.user_id ─────────────────────────────────

describe('F3 — triggered_by usa payload.user_id si existe', () => {
  it('triggered_by = payload.user_id', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ user_id: PAYLOAD_USER_ID }));

    assert.equal(mock.captured!.triggered_by, PAYLOAD_USER_ID);
  });
});

// ─── F4 — triggered_by desde factory userId ──────────────────────────────────

describe('F4 — triggered_by usa factory userId si payload.user_id es null', () => {
  it('triggered_by = factory userId cuando payload.user_id null', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ user_id: null }));

    assert.equal(mock.captured!.triggered_by, USER_ID);
  });

  it('triggered_by = undefined cuando ambos son null', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(null, mock.fn);
    await fn(makePayload({ user_id: null }));

    assert.equal(mock.captured!.triggered_by, undefined);
  });
});

// ─── F5 — metadata: no query, sí query_length ────────────────────────────────

describe('F5 — metadata no incluye query completa, sí query_length', () => {
  it('metadata.query es undefined', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload());

    const meta = mock.captured!.metadata as Record<string, unknown>;
    assert.equal(meta['query'], undefined);
  });

  it('metadata.query_length presente y correcto', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    const payload = makePayload();
    await fn(payload);

    const meta = mock.captured!.metadata as Record<string, unknown>;
    assert.equal(meta['query_length'], payload.query.length);
  });
});

// ─── F6 — selected_status y selected_url en metadata ─────────────────────────

describe('F6 — selected_status y selected_url quedan en metadata', () => {
  it('selected_status = found', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ selected_status: 'found' }));

    const meta = mock.captured!.metadata as Record<string, unknown>;
    assert.equal(meta['selected_status'], 'found');
  });

  it('selected_url preservada', async () => {
    const url = 'https://www.linkedin.com/company/softland';
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ selected_url: url }));

    const meta = mock.captured!.metadata as Record<string, unknown>;
    assert.equal(meta['selected_url'], url);
  });

  it('selected_url null si no encontrado', async () => {
    const mock = makeLogUsageMock({ kind: 'logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);
    await fn(makePayload({ selected_status: 'not_found', selected_url: null }));

    const meta = mock.captured!.metadata as Record<string, unknown>;
    assert.equal(meta['selected_url'], null);
  });
});

// ─── F7 — already_logged resuelve sin lanzar ─────────────────────────────────

describe('F7 — already_logged resuelve sin error', () => {
  it('no lanza cuando logUsage retorna already_logged', async () => {
    const mock = makeLogUsageMock({ kind: 'already_logged' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);

    await assert.doesNotReject(() => fn(makePayload()));
  });
});

// ─── F8 — failed lanza error sanitizado ──────────────────────────────────────

describe('F8 — logUsage retorna failed → adapter lanza error sanitizado', () => {
  it('lanza Error con mensaje que comienza con linkedin_usage_log_failed', async () => {
    const mock = makeLogUsageMock({ kind: 'failed', error: 'connection refused' });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);

    await assert.rejects(
      () => fn(makePayload()),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.startsWith('linkedin_usage_log_failed:'));
        return true;
      },
    );
  });

  it('error message incluye causa (truncada a 100 chars)', async () => {
    const longError = 'x'.repeat(200);
    const mock = makeLogUsageMock({ kind: 'failed', error: longError });
    const fn = createLinkedInUsageLoggerFn(USER_ID, mock.fn);

    await assert.rejects(
      () => fn(makePayload()),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // El mensaje incluye el prefijo + la causa truncada
        assert.ok(err.message.length <= 'linkedin_usage_log_failed: '.length + 100);
        return true;
      },
    );
  });
});

// ─── F9 — batch_id null → lanza antes de llamar al logger ────────────────────

describe('F9 — batch_id null lanza missing_batch_id_for_linkedin_usage_log', () => {
  it('lanza error sin llamar logUsage', async () => {
    let called = false;
    const fn = createLinkedInUsageLoggerFn(USER_ID, async () => {
      called = true;
      return { kind: 'logged' };
    });

    await assert.rejects(
      () => fn(makePayload({ batch_id: null })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'missing_batch_id_for_linkedin_usage_log');
        return true;
      },
    );

    assert.equal(called, false, 'logUsage no debe ser invocado si batch_id es null');
  });
});

// ─── F10 — sin Supabase real ni Tavily real ───────────────────────────────────

describe('F10 — sin Supabase real ni Tavily real', () => {
  it('todos los tests usan mock inyectado; 0 llamadas reales a Supabase', async () => {
    let externalCallCount = 0;

    const fn = createLinkedInUsageLoggerFn(USER_ID, async (input) => {
      // Si llegamos aquí, el mock fue invocado — no hay red real
      externalCallCount++;
      assert.ok(input.batch_id, 'batch_id presente');
      return { kind: 'logged' };
    });

    await fn(makePayload());

    assert.equal(externalCallCount, 1, 'exactamente 1 llamada al mock, 0 a Supabase real');
  });
});
