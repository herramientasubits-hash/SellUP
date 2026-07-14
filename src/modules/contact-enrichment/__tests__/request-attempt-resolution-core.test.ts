/**
 * Tests — Request Attempt Resolution Core (Agente 2A · 17B.4X.7C.2)
 *
 * Pure DI tests — no DB, no network. Verifies which attemptId a
 * request-level provider action should execute against, and that
 * attempt_order=2 / automatic fallback are never produced by this core.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAttemptForRequestProvider,
  type ResolveAttemptForRequestDeps,
} from '../request-attempt-resolution-core';
import type { AttemptCreationResult } from '../request-attempt-types';

const TRIGGERED_BY = 'user-1';

function created(attemptId = 'attempt-1', agentRunId = 'ar-1'): AttemptCreationResult {
  return { status: 'created', attemptId, agentRunId };
}

function alreadyExists(attemptId = 'attempt-1', agentRunId = 'ar-1'): AttemptCreationResult {
  return { status: 'already_exists', attemptId, agentRunId };
}

describe('resolveAttemptForRequestProvider', () => {
  it('crea y ejecuta attempt_order=1 Apollo cuando no existe ninguno', async () => {
    let createAttemptCalls = 0;
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async (requestId, provider, triggeredBy) => {
        createAttemptCalls += 1;
        assert.equal(requestId, 'req-1');
        assert.equal(provider, 'apollo');
        assert.equal(triggeredBy, TRIGGERED_BY);
        return created('attempt-apollo-1');
      },
      loadExistingAttempt: async () => {
        throw new Error('no debe consultarse un intento existente en el camino created');
      },
    };

    const result = await resolveAttemptForRequestProvider('req-1', 'apollo', TRIGGERED_BY, deps);

    assert.equal(createAttemptCalls, 1);
    assert.deepEqual(result, { outcome: 'execute', attemptId: 'attempt-apollo-1' });
  });

  it('crea y ejecuta attempt_order=1 Lusha cuando no existe ninguno', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async (_reqId, provider) => {
        assert.equal(provider, 'lusha');
        return created('attempt-lusha-1');
      },
      loadExistingAttempt: async () => {
        throw new Error('no debe consultarse');
      },
    };

    const result = await resolveAttemptForRequestProvider('req-2', 'lusha', TRIGGERED_BY, deps);

    assert.deepEqual(result, { outcome: 'execute', attemptId: 'attempt-lusha-1' });
  });

  it('reutiliza el intento existente cuando el proveedor coincide y el estado es ejecutable (ready_to_enrich)', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => alreadyExists('attempt-existing'),
      loadExistingAttempt: async (attemptId) => {
        assert.equal(attemptId, 'attempt-existing');
        return { intendedProvider: 'apollo', status: 'ready_to_enrich' };
      },
    };

    const result = await resolveAttemptForRequestProvider('req-3', 'apollo', TRIGGERED_BY, deps);

    assert.deepEqual(result, { outcome: 'execute', attemptId: 'attempt-existing' });
  });

  it('reutiliza el intento existente cuando está en enriching (mismo proveedor, no terminal)', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => alreadyExists('attempt-existing'),
      loadExistingAttempt: async () => ({ intendedProvider: 'lusha', status: 'enriching' }),
    };

    const result = await resolveAttemptForRequestProvider('req-4', 'lusha', TRIGGERED_BY, deps);

    assert.deepEqual(result, { outcome: 'execute', attemptId: 'attempt-existing' });
  });

  it('rechaza de forma segura cuando el intento existente pertenece a otro proveedor', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => alreadyExists('attempt-existing'),
      loadExistingAttempt: async () => ({ intendedProvider: 'lusha', status: 'ready_to_enrich' }),
    };

    const result = await resolveAttemptForRequestProvider('req-5', 'apollo', TRIGGERED_BY, deps);

    assert.equal(result.outcome, 'rejected');
    if (result.outcome === 'rejected') {
      assert.equal(result.reason, 'attempt_provider_mismatch');
      assert.match(result.message, /lusha/);
    }
  });

  for (const terminalStatus of ['ready_for_review', 'completed', 'failed', 'superseded'] as const) {
    it(`rechaza de forma segura cuando el intento existente ya es terminal (${terminalStatus}) — NO crea attempt_order=2`, async () => {
      let createAttemptCalls = 0;
      const deps: ResolveAttemptForRequestDeps = {
        createAttempt: async () => {
          createAttemptCalls += 1;
          return alreadyExists('attempt-existing');
        },
        loadExistingAttempt: async () => ({ intendedProvider: 'apollo', status: terminalStatus }),
      };

      const result = await resolveAttemptForRequestProvider('req-6', 'apollo', TRIGGERED_BY, deps);

      assert.equal(createAttemptCalls, 1, 'createAttempt solo se llama una vez — nunca para un segundo intento');
      assert.equal(result.outcome, 'rejected');
      if (result.outcome === 'rejected') {
        assert.equal(result.reason, 'attempt_terminal');
        assert.match(result.message, new RegExp(terminalStatus));
      }
    });
  }

  it('rechaza de forma segura cuando la request no existe (invalid_request)', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => ({ status: 'invalid_request', attemptId: null, agentRunId: null }),
      loadExistingAttempt: async () => {
        throw new Error('no debe consultarse');
      },
    };

    const result = await resolveAttemptForRequestProvider('req-missing', 'apollo', TRIGGERED_BY, deps);

    assert.deepEqual(result, {
      outcome: 'rejected',
      reason: 'invalid_request',
      message: 'La request de enriquecimiento no existe',
    });
  });

  it('rechaza de forma segura ante invalid_provider desde la RPC', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => ({ status: 'invalid_provider', attemptId: null, agentRunId: null }),
      loadExistingAttempt: async () => null,
    };

    const result = await resolveAttemptForRequestProvider('req-7', 'apollo', TRIGGERED_BY, deps);

    assert.equal(result.outcome, 'rejected');
    if (result.outcome === 'rejected') assert.equal(result.reason, 'invalid_provider');
  });

  it('rechaza de forma segura ante rpc_error, propagando el motivo', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => ({ status: 'rpc_error', attemptId: null, agentRunId: null, reason: 'connection reset' }),
      loadExistingAttempt: async () => null,
    };

    const result = await resolveAttemptForRequestProvider('req-8', 'lusha', TRIGGERED_BY, deps);

    assert.equal(result.outcome, 'rejected');
    if (result.outcome === 'rejected') {
      assert.equal(result.reason, 'creation_failed');
      assert.equal(result.message, 'connection reset');
    }
  });

  it('rechaza de forma segura cuando already_exists pero el intento existente no puede leerse', async () => {
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => alreadyExists('attempt-existing'),
      loadExistingAttempt: async () => null,
    };

    const result = await resolveAttemptForRequestProvider('req-9', 'apollo', TRIGGERED_BY, deps);

    assert.equal(result.outcome, 'rejected');
    if (result.outcome === 'rejected') assert.equal(result.reason, 'lookup_failed');
  });

  it('nunca invoca createAttempt más de una vez por resolución — sin fallback automático', async () => {
    let calls = 0;
    const deps: ResolveAttemptForRequestDeps = {
      createAttempt: async () => {
        calls += 1;
        return alreadyExists('attempt-existing');
      },
      loadExistingAttempt: async () => ({ intendedProvider: 'lusha', status: 'ready_to_enrich' }),
    };

    await resolveAttemptForRequestProvider('req-10', 'apollo', TRIGGERED_BY, deps);

    assert.equal(calls, 1);
  });
});
