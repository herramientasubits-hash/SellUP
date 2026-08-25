/**
 * lusha-phone-reveal-error-diagnostic.test.ts
 * (Agente 2A · AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1)
 *
 * ══════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO
 * ══════════════════════════════════════════════════════════════
 *
 * La corrida REAL 2a49e0f7 (candidato Luis, 7576d824) hizo esto:
 *
 *   Apollo histórico  no_phone_found, 0 llamadas nuevas
 *   Lusha Search      EJECUTADA, resolved, match por linkedin_url, 1 resultado
 *   identidad         PERSISTIDA (provider_key = lusha)
 *   Lusha reveal      lusha_outcome = error, error_code = lusha_reveal_error
 *                     final_provider = none, phone = null
 *
 * La causa NO era el proveedor. El core del waterfall resolvía la identidad y la
 * pasaba a la pata como `lushaContactId`, pero el EJECUTOR de la pata no declaraba
 * ese parámetro y su lector del candidato tampoco consultaba
 * `contact_provider_identities`. El id recién comprado se perdía entre los dos
 * módulos, `resolveLushaContactId` devolvía null para un candidato nacido en Apollo,
 * y la elegibilidad fallaba `missing_lusha_contact_id` ANTES de emitir un byte. El
 * mapeador de la corrida remataba colapsando ese motivo en el genérico
 * `lusha_reveal_error`, que además AFIRMA algo falso: que hubo un reveal que falló.
 *
 * TypeScript no podía avisar de la divergencia: una función cuyo objeto de parámetros
 * declara MENOS propiedades es asignable a una que declara más.
 *
 * TODO offline. Cero proveedores reales, cero créditos, cero escrituras en Prod.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackActionInput,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import {
  mapLushaLegResultToWaterfallPatch,
  PHONE_REVEAL_WATERFALL_LUSHA_LEG_LOCAL_BLOCK_STATUSES,
} from '../phone-reveal-waterfall-core';
import {
  decidePhoneRevealCreditSettlement,
  PHONE_REVEAL_LOCAL_BLOCK_ERROR_CODES,
} from '../phone-reveal-credit-reservation-core';
import {
  buildPhoneRevealLushaAttemptOutcomeEvent,
  PHONE_REVEAL_LUSHA_ATTEMPT_OUTCOME_EVENT,
  type PhoneRevealLushaAttemptOutcomeEvent,
} from '../phone-reveal-lusha-attempt-diagnostics';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import type { LushaPhoneFallbackErrorCode } from '@/server/integrations/lusha-phone-fallback-response';

const NOW_ISO = '2026-08-24T12:00:00.000Z';

/** Id NATIVO de Lusha resuelto por la búsqueda. Sintético: no es de nadie real. */
const RESOLVED_LUSHA_ID = 'lusha-native-0000-test';
/** Id de APOLLO del candidato. Nunca puede acabar en una petición a Lusha. */
const APOLLO_SOURCE_ID = 'apollo-person-0000-test';

/**
 * El candidato de Luis tal como estaba al empezar el reveal: nacido en APOLLO, con un
 * intento Apollo histórico terminado sin teléfono y sin teléfono propio.
 */
function luisCandidate(
  overrides: Partial<LushaPhoneFallbackCandidateRecord> = {},
): LushaPhoneFallbackCandidateRecord {
  return {
    id: 'candidate-luis',
    status: 'pending_review',
    source: 'apollo',
    sourceContactId: APOLLO_SOURCE_ID,
    existingPhone: null,
    phoneRevealStatus: 'no_phone_found',
    phoneRevealAttemptCount: 1,
    enrichmentMetadata: {},
    ...overrides,
  };
}

function luisInput(
  overrides: Partial<LushaPhoneFallbackActionInput> = {},
): LushaPhoneFallbackActionInput {
  return {
    candidateId: 'candidate-luis',
    confirmCost: true,
    expectedMaxCredits: 5,
    ...overrides,
  };
}

interface Harness {
  deps: LushaPhoneFallbackCoreDeps;
  /** Ids con los que se llamó a Lusha. Vacío ⇒ ninguna petición emitida. */
  revealCalls: string[];
  persisted: Array<{ candidateId: string; patch: LushaPhoneFallbackPersistencePatch }>;
  usageLogs: LushaPhoneFallbackUsageLogEntry[];
  diagnostics: PhoneRevealLushaAttemptOutcomeEvent[];
}

function harness(
  options: {
    candidate?: LushaPhoneFallbackCandidateRecord | null;
    lushaResult?: LushaPhoneFallbackClientResult;
    waterfallMode?: boolean;
  } = {},
): Harness {
  const revealCalls: string[] = [];
  const persisted: Harness['persisted'] = [];
  const usageLogs: LushaPhoneFallbackUsageLogEntry[] = [];
  const diagnostics: PhoneRevealLushaAttemptOutcomeEvent[] = [];

  const lushaResult: LushaPhoneFallbackClientResult = options.lushaResult ?? {
    ok: true,
    httpStatus: 200,
    phones: [{ number: '+57 300 000 0000', phoneType: 'mobile', rawType: 'mobile' }],
    phoneNumber: '+57 300 000 0000',
    phoneType: 'mobile',
    phoneRawType: 'mobile',
    creditsCharged: 5,
    candidateStatus: 'revealed',
    usageStatus: 'success',
    costSource: 'reported',
    errorCode: null,
    availabilitySource: null,
    phonesReturned: 1,
  };

  return {
    revealCalls,
    persisted,
    usageLogs,
    diagnostics,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: 'operator-1', roleKey: 'admin' },
      nowIso: NOW_ISO,
      waterfallMode: options.waterfallMode ?? true,
      phoneRevealWaterfallId: 'run-2a49e0f7',
      loadCandidate: async () =>
        options.candidate === undefined ? luisCandidate() : options.candidate,
      callLusha: async ({ contactId }) => {
        revealCalls.push(contactId);
        return lushaResult;
      },
      persist: async (candidateId, patch) => {
        persisted.push({ candidateId, patch });
      },
      logUsage: async (entry) => {
        usageLogs.push(entry);
      },
      logRevealAttemptOutcome: async (event) => {
        diagnostics.push(event);
      },
    },
  };
}

/** Respuesta de error del proveedor, ya clasificada por el cliente. */
function providerError(
  httpStatus: number,
  errorCode: LushaPhoneFallbackErrorCode,
  usageStatus: 'error' | 'rate_limited' | 'quota_exceeded' = 'error',
): LushaPhoneFallbackClientResult {
  return {
    ok: true,
    httpStatus,
    phones: [],
    phoneNumber: null,
    phoneType: 'unknown',
    phoneRawType: null,
    creditsCharged: null,
    candidateStatus: 'error',
    usageStatus,
    costSource: null,
    errorCode,
    availabilitySource: null,
    phonesReturned: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. LA CAUSA RAÍZ — reproducción del fallo real de Luis
// ═══════════════════════════════════════════════════════════════

describe('AGENT2A-LUSHA-PHONE-REVEAL-ERROR-DIAGNOSTIC-1 · causa raíz', () => {
  test('REGRESIÓN: sin la identidad inyectada, un candidato Apollo no emite NADA', async () => {
    const h = harness();
    // Exactamente lo que pasaba antes del hito: nadie le pasa el id resuelto.
    const result = await runLushaPhoneFallbackReveal(luisInput(), h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, 'missing_lusha_contact_id');
    assert.deepEqual(h.revealCalls, [], 'no puede salir ninguna petición');
    assert.equal(result.requestEmitted, false);
  });

  test('el id de APOLLO jamás se reenvía a Lusha', async () => {
    const h = harness();
    await runLushaPhoneFallbackReveal(luisInput(), h.deps);
    assert.equal(
      h.revealCalls.includes(APOLLO_SOURCE_ID),
      false,
      'un id de Apollo en una petición a Lusha es el 422 del RCA del reveal asíncrono',
    );
  });

  test('LA CORRECCIÓN: con la identidad inyectada, la petición SÍ sale y con el id nativo', async () => {
    const h = harness();
    const result = await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      h.deps,
    );

    assert.deepEqual(h.revealCalls, [RESOLVED_LUSHA_ID]);
    assert.equal(result.status, 'revealed');
    assert.equal(result.requestEmitted, true);
  });

  test('la identidad PERSISTIDA en el candidato también sirve, sin búsqueda nueva', async () => {
    const h = harness({
      candidate: luisCandidate({ lushaProviderContactId: RESOLVED_LUSHA_ID }),
    });
    const result = await runLushaPhoneFallbackReveal(luisInput(), h.deps);

    assert.deepEqual(h.revealCalls, [RESOLVED_LUSHA_ID]);
    assert.equal(result.status, 'revealed');
  });

  test('la identidad de ESTA corrida tiene precedencia sobre la persistida', async () => {
    const h = harness({
      candidate: luisCandidate({ lushaProviderContactId: 'lusha-native-viejo' }),
    });
    await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      h.deps,
    );
    assert.deepEqual(h.revealCalls, [RESOLVED_LUSHA_ID]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. CONTRATO DE ID — Search ↔ reveal
// ═══════════════════════════════════════════════════════════════

describe('compatibilidad del id de Contact Search con el reveal', () => {
  test('el id que viaja al reveal es EXACTAMENTE el que resolvió la búsqueda', async () => {
    const h = harness();
    await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      h.deps,
    );
    // Ni recortado, ni normalizado, ni envuelto: el mismo string, un solo id.
    assert.equal(h.revealCalls.length, 1);
    assert.equal(h.revealCalls[0], RESOLVED_LUSHA_ID);
  });

  test('un id vacío o en blanco NO cuenta como identidad resuelta', async () => {
    for (const blank of ['', '   ']) {
      const h = harness();
      const result = await runLushaPhoneFallbackReveal(
        luisInput({ resolvedLushaContactId: blank }),
        h.deps,
      );
      assert.equal(result.status, 'missing_lusha_contact_id');
      assert.deepEqual(h.revealCalls, []);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. LOS DIEZ CASOS DEL § 10 — desde la identidad ya persistida
// ═══════════════════════════════════════════════════════════════

describe('§10 · desenlaces del adaptador de reveal', () => {
  const input = () => luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID });

  test('A · éxito con teléfono ⇒ revealed', async () => {
    const h = harness();
    const result = await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(result.status, 'revealed');
    assert.equal(result.requestEmitted, true);
    assert.equal(h.diagnostics[0]?.result, 'revealed');
    assert.equal(h.diagnostics[0]?.provider_error_category, 'none');
  });

  test('B · respuesta válida sin teléfono ⇒ no_phone_found, NO un error genérico', async () => {
    const h = harness({
      lushaResult: {
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
      },
    });
    const result = await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(result.status, 'no_phone_found');
    assert.notEqual(result.status, 'error');
    assert.equal(h.diagnostics[0]?.result, 'no_phone');
  });

  test('C · 402 saldo agotado ⇒ categoría propia', async () => {
    const h = harness({
      lushaResult: providerError(402, 'insufficient_credits', 'quota_exceeded'),
    });
    await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(h.diagnostics[0]?.provider_error_category, 'insufficient_credits');
    assert.equal(h.diagnostics[0]?.http_status_class, '4xx');
  });

  test('D · 401 / 403 ⇒ credencial o entitlement, nunca "no hay teléfono"', async () => {
    for (const [status, code] of [
      [401, 'provider_auth_error'],
      [403, 'provider_permission_error'],
    ] as const) {
      const h = harness({ lushaResult: providerError(status, code) });
      const result = await runLushaPhoneFallbackReveal(input(), h.deps);
      assert.equal(result.status, 'error');
      assert.equal(
        h.diagnostics[0]?.provider_error_category,
        'credential_or_entitlement',
      );
      assert.notEqual(result.status, 'no_phone_found');
    }
  });

  test('E · 404 id inválido ⇒ contrato de identidad', async () => {
    const h = harness({ lushaResult: providerError(404, 'invalid_contact_id') });
    await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(h.diagnostics[0]?.provider_error_category, 'identity_contract');
  });

  test('F · 429 ⇒ rate_limited', async () => {
    const h = harness({
      lushaResult: providerError(429, 'rate_limited', 'rate_limited'),
    });
    await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(h.diagnostics[0]?.provider_error_category, 'rate_limited');
  });

  test('G · 5xx ⇒ proveedor no disponible', async () => {
    const h = harness({ lushaResult: providerError(503, 'provider_error') });
    await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(h.diagnostics[0]?.provider_error_category, 'provider_unavailable');
    assert.equal(h.diagnostics[0]?.http_status_class, '5xx');
  });

  test('H · timeout DESPUÉS de emitir ⇒ intentada, sin reintento pagado', async () => {
    const h = harness({
      lushaResult: { ok: false, errorMessage: 'timeout', failureKind: 'timeout' },
    });
    const result = await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(result.requestEmitted, true, 'los bytes ya salieron');
    assert.equal(h.revealCalls.length, 1, 'UNA sola llamada, jamás un retry pagado');
    assert.equal(h.diagnostics[0]?.result, 'timeout');
    assert.equal(h.diagnostics[0]?.provider_error_category, 'provider_unavailable');
  });

  test('I · respuesta malformada ⇒ error de parseo, no "sin teléfono"', async () => {
    const h = harness({
      lushaResult: providerError(200, 'malformed_provider_response'),
    });
    const result = await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(result.status, 'error');
    assert.equal(h.diagnostics[0]?.provider_error_category, 'response_parse_error');
    assert.equal(h.diagnostics[0]?.response_parse_outcome, 'unparseable');
  });

  test('J · fallo ANTES de emitir ⇒ request_emitted false y bloqueo local', async () => {
    const h = harness({
      lushaResult: {
        ok: false,
        errorMessage: 'Lusha API key not configured',
        failureKind: 'preflight',
      },
    });
    const result = await runLushaPhoneFallbackReveal(input(), h.deps);
    assert.equal(result.requestEmitted, false);
    assert.equal(h.diagnostics[0]?.request_emitted, false);
    assert.equal(h.diagnostics[0]?.provider_error_category, 'local_block');
    assert.equal(h.diagnostics[0]?.endpoint_family, 'none');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. MOTIVO TERMINAL VERDADERO
// ═══════════════════════════════════════════════════════════════

describe('el motivo terminal deja de colapsar en `lusha_reveal_error`', () => {
  test('el desenlace REAL de Luis se registra como missing_lusha_contact_id', () => {
    const patch = mapLushaLegResultToWaterfallPatch(
      {
        status: 'missing_lusha_contact_id',
        creditsCharged: null,
        errorCode: null,
        requestEmitted: false,
      },
      NOW_ISO,
    );
    assert.equal(patch.errorCode, 'missing_lusha_contact_id');
    assert.notEqual(patch.errorCode, 'lusha_reveal_error');
    assert.equal(patch.finalProvider, 'none');
  });

  test('los dos vocabularios de bloqueo local no se separan', () => {
    // Uno vive en el core del waterfall y el otro en el módulo de dinero, declarados
    // por separado a propósito para no acoplarlos. Este test es lo que impide que la
    // separación se convierta en divergencia.
    assert.deepEqual(
      [...PHONE_REVEAL_WATERFALL_LUSHA_LEG_LOCAL_BLOCK_STATUSES].sort(),
      [...PHONE_REVEAL_LOCAL_BLOCK_ERROR_CODES].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. VERDAD DE LIQUIDACIÓN — § 9
// ═══════════════════════════════════════════════════════════════

describe('§9 · liquidación según hubo o no petición', () => {
  const revealLeg = {
    id: 'reservation-reveal',
    providerKey: 'lusha' as const,
    operationKey: 'phone_reveal' as const,
    creditsReserved: 5,
  };

  function settle(errorCode: string | null) {
    return decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: false,
        apolloCostCredits: null,
        apolloCostSource: null,
        // El CLAIM se tomó: es lo que pasó en la corrida real.
        lushaAttempted: true,
        lushaCostCredits: null,
        lushaCostSource: null,
        lushaRevealErrorCode: errorCode,
      },
      reservedLegs: [revealLeg],
    });
  }

  test('A · fallo ANTES del HTTP ⇒ RELEASE, 0 créditos confirmados', () => {
    const [action] = settle('missing_lusha_contact_id');
    assert.equal(action?.action, 'release');
    assert.equal(
      action?.action === 'release' ? action.reason : null,
      'leg_request_never_emitted',
    );
  });

  test('B · petición emitida con costo desconocido ⇒ CONFIRM al tope (assumed_cap)', () => {
    const [action] = settle('provider_network_error');
    assert.equal(action?.action, 'confirm');
    if (action?.action === 'confirm') {
      assert.equal(action.credits, 5);
      assert.equal(action.costTruth, 'assumed_cap');
    }
  });

  test('un error_code desconocido NO libera: fail-closed hacia lo conservador', () => {
    const [action] = settle('algo_que_nadie_declaro');
    assert.equal(action?.action, 'confirm');
  });

  test('sin error_code declarado tampoco libera', () => {
    const [action] = settle(null);
    assert.equal(action?.action, 'confirm');
  });

  test('la pata de BÚSQUEDA no se ve afectada por el código del reveal', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: false,
        apolloCostCredits: null,
        apolloCostSource: null,
        lushaAttempted: true,
        lushaCostCredits: null,
        lushaCostSource: null,
        lushaRevealErrorCode: 'missing_lusha_contact_id',
        lushaIdentitySearchAttempted: true,
      },
      reservedLegs: [
        {
          id: 'reservation-search',
          providerKey: 'lusha' as const,
          operationKey: 'contact_search' as const,
          creditsReserved: 1,
        },
      ],
    });
    // La búsqueda SÍ se emitió y SÍ se cobró: se confirma al tope.
    assert.equal(actions[0]?.action, 'confirm');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. PRIVACIDAD DEL DIAGNÓSTICO — § 7
// ═══════════════════════════════════════════════════════════════

describe('§7 · el evento de diagnóstico es PII-free', () => {
  const FORBIDDEN = [
    RESOLVED_LUSHA_ID,
    APOLLO_SOURCE_ID,
    'candidate-luis',
    '+57 300 000 0000',
    'linkedin',
    'operator-1',
  ];

  test('ningún camino filtra id nativo, teléfono, LinkedIn ni id de candidato', async () => {
    const results: LushaPhoneFallbackClientResult[] = [
      providerError(401, 'provider_auth_error'),
      providerError(404, 'invalid_contact_id'),
      providerError(429, 'rate_limited', 'rate_limited'),
      providerError(503, 'provider_error'),
      providerError(200, 'malformed_provider_response'),
      { ok: false, errorMessage: 'timeout', failureKind: 'timeout' },
    ];

    for (const lushaResult of results) {
      const h = harness({ lushaResult });
      await runLushaPhoneFallbackReveal(
        luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
        h.deps,
      );
      const serialized = JSON.stringify(h.diagnostics);
      for (const secret of FORBIDDEN) {
        assert.equal(
          serialized.includes(secret),
          false,
          `el diagnóstico filtró ${secret}`,
        );
      }
    }
  });

  test('el evento del camino REVELADO tampoco lleva el número', async () => {
    const h = harness();
    await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      h.deps,
    );
    assert.equal(JSON.stringify(h.diagnostics).includes('+57'), false);
  });

  test('las claves del evento son exactamente el contrato declarado', () => {
    const event = buildPhoneRevealLushaAttemptOutcomeEvent({
      requestEmitted: false,
      httpStatus: null,
      providerErrorCode: null,
      responseUnparseable: false,
      identitySource: 'none',
      creditsReported: null,
      costTruth: 'unknown',
      result: 'error',
    });
    assert.deepEqual(Object.keys(event).sort(), [
      'async_or_sync',
      'cost_truth',
      'credits_reported',
      'endpoint_family',
      'event',
      'http_status_class',
      'provider_error_category',
      'provider_error_code',
      'provider_identity_source',
      'request_emitted',
      'reservation_operation_key',
      'response_parse_outcome',
      'result',
    ]);
    assert.equal(event.event, PHONE_REVEAL_LUSHA_ATTEMPT_OUTCOME_EVENT);
  });

  test('`credits_reported` sólo trae cifra cuando el proveedor la reportó', async () => {
    const h = harness({ lushaResult: providerError(503, 'provider_error') });
    await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      h.deps,
    );
    assert.equal(h.diagnostics[0]?.credits_reported, null);
    assert.notEqual(h.diagnostics[0]?.credits_reported, 0);
  });

  test('la procedencia de la identidad queda registrada en los tres casos', async () => {
    const injected = harness();
    await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      injected.deps,
    );
    assert.equal(
      injected.diagnostics[0]?.provider_identity_source,
      'run_identity_search',
    );

    const persistedH = harness({
      candidate: luisCandidate({ lushaProviderContactId: RESOLVED_LUSHA_ID }),
    });
    await runLushaPhoneFallbackReveal(luisInput(), persistedH.deps);
    assert.equal(
      persistedH.diagnostics[0]?.provider_identity_source,
      'persisted_identity',
    );

    const missing = harness();
    await runLushaPhoneFallbackReveal(luisInput(), missing.deps);
    assert.equal(missing.diagnostics[0]?.provider_identity_source, 'none');
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. SIN REINTENTO PAGADO — § 11
// ═══════════════════════════════════════════════════════════════

describe('§11 · ningún reintento pagado automático', () => {
  test('cada invocación emite como mucho UNA petición', async () => {
    for (const lushaResult of [
      providerError(503, 'provider_error'),
      providerError(429, 'rate_limited', 'rate_limited'),
      { ok: false, errorMessage: 'timeout', failureKind: 'timeout' } as const,
    ]) {
      const h = harness({ lushaResult });
      await runLushaPhoneFallbackReveal(
        luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
        h.deps,
      );
      assert.equal(h.revealCalls.length, 1);
    }
  });

  test('un fallo del diagnóstico NO cambia el desenlace ni reintenta', async () => {
    const h = harness();
    h.deps.logRevealAttemptOutcome = async () => {
      throw new Error('sink caído');
    };
    const result = await runLushaPhoneFallbackReveal(
      luisInput({ resolvedLushaContactId: RESOLVED_LUSHA_ID }),
      h.deps,
    );
    assert.equal(result.status, 'revealed');
    assert.equal(h.revealCalls.length, 1);
  });
});
