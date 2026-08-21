// Tests — semántica de MODO WATERFALL en el core del fallback Lusha
// (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
//
// El fallback manual de Lusha (LUSHA-PHONE-FALLBACK-1) ya está validado y NO
// cambia: cuando el operador lo dispara a mano, un `no_phone_found` o un error SON
// el resultado de la acción que pidió, y quedan en el candidato.
//
// En modo waterfall esos mismos desenlaces serían una MENTIRA sobre el candidato:
// Apollo ya lo cerró como `no_phone_found` y Lusha solo intentó, no resolvió. Ese
// resultado pertenece a `phone_reveal_waterfall_runs`.
//
// Lo que se verifica aquí:
//   * modo manual = comportamiento anterior, byte por byte (persiste siempre);
//   * modo waterfall = solo `revealed` persiste en el candidato;
//   * el usage-log se escribe SIEMPRE, en los dos modos y en todos los caminos —
//     un gasto (o un intento) nunca deja de registrarse;
//   * `phone_reveal_waterfall_id` correlaciona sin sumar créditos.
//
// Puro y con deps inyectadas: NO red, NO DB, NO Lusha real, 0 créditos.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runLushaPhoneFallbackReveal,
  LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
  LUSHA_PHONE_FALLBACK_OPERATION_KEY,
  LUSHA_PHONE_FALLBACK_PROVIDER_KEY,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import { PHONE_REVEAL_OPERATION_KEY } from '../phone-reveal-core';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';

const NOW_ISO = '2026-08-03T12:00:00.000Z';
const RUN_ID = 'run-waterfall-1';

function candidate(
  overrides: Partial<LushaPhoneFallbackCandidateRecord> = {},
): LushaPhoneFallbackCandidateRecord {
  return {
    id: 'candidate-1',
    status: 'pending_review',
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
    existingPhone: null,
    phoneRevealStatus: 'no_phone_found',
    phoneRevealAttemptCount: 0,
    enrichmentMetadata: {},
    ...overrides,
  };
}

interface Harness {
  deps: LushaPhoneFallbackCoreDeps;
  persisted: Array<{ candidateId: string; patch: LushaPhoneFallbackPersistencePatch }>;
  logged: LushaPhoneFallbackUsageLogEntry[];
}

function harness(opts: {
  waterfallMode?: boolean;
  withRunId?: boolean;
  lushaResult?: LushaPhoneFallbackClientResult;
}): Harness {
  const persisted: Array<{
    candidateId: string;
    patch: LushaPhoneFallbackPersistencePatch;
  }> = [];
  const logged: LushaPhoneFallbackUsageLogEntry[] = [];
  return {
    persisted,
    logged,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: 'user-admin', roleKey: 'admin' },
      nowIso: NOW_ISO,
      ...(opts.waterfallMode ? { waterfallMode: true } : {}),
      ...(opts.withRunId === false ? {} : { phoneRevealWaterfallId: RUN_ID }),
      loadCandidate: async () => candidate(),
      callLusha: async () => opts.lushaResult ?? REVEALED_RESULT,
      persist: async (candidateId, patch) => {
        persisted.push({ candidateId, patch });
      },
      logUsage: async (entry) => {
        logged.push(entry);
      },
    } as LushaPhoneFallbackCoreDeps,
  };
}

const INPUT = {
  candidateId: 'candidate-1',
  confirmCost: true,
  expectedMaxCredits: LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
};

const REVEALED_RESULT: LushaPhoneFallbackClientResult = {
  ok: true,
  httpStatus: 200,
  // 4O-D: el cliente publica AHORA la lista completa además del escalar. El
  // escalar sigue siendo el que el ranking elige; con un solo teléfono, ese.
  phones: [{ number: '+570000000000', rawType: null, phoneType: 'unknown' }],
  phoneNumber: '+570000000000',
  phoneType: 'unknown',
  phoneRawType: null,
  creditsCharged: 5,
  candidateStatus: 'revealed',
  usageStatus: 'success',
  costSource: 'reported',
  errorCode: null,
  availabilitySource: null,
  phonesReturned: 1,
};

const NO_PHONE_RESULT: LushaPhoneFallbackClientResult = {
  ok: true,
  httpStatus: 200,
  phones: [],
  phoneNumber: null,
  phoneType: 'unknown',
  phoneRawType: null,
  creditsCharged: 0,
  candidateStatus: 'no_phone_found',
  usageStatus: 'success',
  costSource: 'reported',
  errorCode: null,
  availabilitySource: null,
  phonesReturned: 0,
};

const HTTP_ERROR_RESULT: LushaPhoneFallbackClientResult = {
  ok: true,
  httpStatus: 402,
  phones: [],
  phoneNumber: null,
  phoneType: 'unknown',
  phoneRawType: null,
  creditsCharged: null,
  candidateStatus: 'error',
  usageStatus: 'quota_exceeded',
  costSource: null,
  // 402 de Lusha: el clasificador lo mapea a `insufficient_credits`.
  errorCode: 'insufficient_credits',
  availabilitySource: null,
  phonesReturned: 0,
};

/** `revealed` sin número: el cliente no debería producirlo, pero el core lo trata
 *  como malformado en vez de persistir un teléfono vacío. */
const MALFORMED_RESULT: LushaPhoneFallbackClientResult = {
  ok: true,
  httpStatus: 200,
  phones: [],
  phoneNumber: null,
  phoneType: 'unknown',
  phoneRawType: null,
  creditsCharged: 5,
  candidateStatus: 'revealed',
  usageStatus: 'success',
  costSource: 'reported',
  errorCode: null,
  availabilitySource: null,
  phonesReturned: 1,
};

// ═══════════════════════════════════════════════════════════════
// 1. Modo manual (regresión): nada cambia
// ═══════════════════════════════════════════════════════════════

describe('modo manual — comportamiento previo intacto', () => {
  test('no_phone_found SÍ persiste en el candidato (provider lusha)', async () => {
    const h = harness({ lushaResult: NO_PHONE_RESULT });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.status, 'no_phone_found');
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].patch.phone_reveal_status, 'no_phone_found');
    assert.equal(h.persisted[0].patch.phone_reveal_provider, 'lusha');
  });

  test('un error de Lusha SÍ persiste en el candidato', async () => {
    const h = harness({ lushaResult: HTTP_ERROR_RESULT });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.status, 'error');
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].patch.phone_reveal_status, 'error');
    // El costo de un error nunca se asume: null + unknown, jamás 0.
    assert.equal(h.persisted[0].patch.phone_reveal_cost_credits, null);
    assert.equal(h.persisted[0].patch.phone_reveal_cost_source, 'unknown');
  });

  test('un fallo de red SÍ persiste en el candidato', async () => {
    const h = harness({ lushaResult: { ok: false, errorMessage: 'timeout' } });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.errorCode, 'provider_network_error');
    assert.equal(h.persisted.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Modo waterfall: solo `revealed` toca el candidato
// ═══════════════════════════════════════════════════════════════

describe('modo waterfall — solo un reveal real toca el candidato', () => {
  test('revealed: persiste igual que en manual (provider lusha + lusha_reveal)', async () => {
    const h = harness({ waterfallMode: true });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.status, 'revealed');
    assert.equal(h.persisted.length, 1);
    const patch = h.persisted[0].patch;
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.phone_reveal_provider, 'lusha');
    assert.equal(patch.enrichment_metadata?.phone?.source, 'lusha_reveal');
    assert.equal(patch.phone_reveal_cost_credits, 5);
    assert.equal(patch.phone_reveal_cost_source, 'reported');
  });

  test('no_phone_found: NO sobrescribe provider ni costo del candidato', async () => {
    const h = harness({ waterfallMode: true, lushaResult: NO_PHONE_RESULT });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.status, 'no_phone_found');
    assert.equal(h.persisted.length, 0, 'el candidato NO debe tocarse');
    // El costo sí vuelve al caller para que la corrida lo registre.
    assert.equal(result.creditsCharged, 0);
    assert.equal(result.costSource, 'reported');
  });

  test('error HTTP de Lusha: NO sobrescribe el estado del candidato', async () => {
    const h = harness({ waterfallMode: true, lushaResult: HTTP_ERROR_RESULT });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'insufficient_credits');
    assert.equal(h.persisted.length, 0);
    assert.equal(result.creditsCharged, null);
    assert.equal(result.costSource, 'unknown');
  });

  test('fallo de red: NO sobrescribe el estado del candidato', async () => {
    const h = harness({
      waterfallMode: true,
      lushaResult: { ok: false, errorMessage: 'timeout' },
    });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.errorCode, 'provider_network_error');
    assert.equal(h.persisted.length, 0);
  });

  test('respuesta malformada: NO sobrescribe el estado del candidato', async () => {
    const h = harness({ waterfallMode: true, lushaResult: MALFORMED_RESULT });
    const result = await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(result.errorCode, 'malformed_provider_response');
    assert.equal(h.persisted.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Usage-log: siempre, con correlación y sin PII
// ═══════════════════════════════════════════════════════════════

describe('modo waterfall — usage-log', () => {
  test('se escribe en TODOS los caminos, también cuando el candidato no se toca', async () => {
    for (const lushaResult of [
      undefined,
      NO_PHONE_RESULT,
      HTTP_ERROR_RESULT,
      { ok: false, errorMessage: 'timeout' } as LushaPhoneFallbackClientResult,
    ]) {
      const h = harness({ waterfallMode: true, lushaResult });
      await runLushaPhoneFallbackReveal(INPUT, h.deps);
      assert.equal(h.logged.length, 1, 'un intento siempre se registra');
    }
  });

  test('lleva phone_reveal_waterfall_id y NO se mezcla con el operation_key de Apollo', async () => {
    const h = harness({ waterfallMode: true });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    const entry = h.logged[0];
    assert.equal(entry.metadata.phone_reveal_waterfall_id, RUN_ID);
    assert.equal(entry.operationKey, LUSHA_PHONE_FALLBACK_OPERATION_KEY);
    assert.equal(entry.provider, LUSHA_PHONE_FALLBACK_PROVIDER_KEY);
    // Los créditos de Lusha viven en SU fila: nunca en la de Apollo.
    assert.notEqual(entry.operationKey, PHONE_REVEAL_OPERATION_KEY);
    assert.equal(entry.creditsUsed, 5);
  });

  test('la metadata es PII-free (ni teléfono, ni email, ni id de proveedor)', async () => {
    const h = harness({ waterfallMode: true });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    const serialized = JSON.stringify(h.logged[0].metadata);
    for (const forbidden of ['+57', 'v1.token-opaco', '@', 'linkedin']) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `la metadata no debe contener ${forbidden}`,
      );
    }
    const keys = Object.keys(h.logged[0].metadata);
    for (const forbidden of [
      'phone',
      'phone_number',
      'email',
      'linkedin_url',
      'full_name',
      'lusha_contact_id',
      'raw_payload',
    ]) {
      assert.equal(keys.includes(forbidden), false, `no debe exponer ${forbidden}`);
    }
  });

  test('sin corrida (fallback manual) la clave de correlación se OMITE, no va null', async () => {
    const h = harness({ withRunId: false });
    await runLushaPhoneFallbackReveal(INPUT, h.deps);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        h.logged[0].metadata,
        'phone_reveal_waterfall_id',
      ),
      false,
    );
  });
});
