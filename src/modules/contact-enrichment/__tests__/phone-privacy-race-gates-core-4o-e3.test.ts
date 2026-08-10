/**
 * Agente 2A — PUERTAS DE PRIVACIDAD y ESCRITURAS CONDICIONALES
 * (AGENT2A-PHONE-REVEAL-4O-E3) — lógica pura, con deps inyectadas.
 *
 * Tres propiedades, ninguna de ellas sobre strings:
 *
 *   1. el disparo MANUAL de Lusha no puede llamar al proveedor cuando hay supresión
 *      o `do_not_contact` — 0 llamadas y 0 créditos, medidos como conteos;
 *   2. si la supresión aparece MIENTRAS Lusha responde, el número no se escribe y el
 *      COSTO REAL sí se conserva — el cargo existió y borrarlo sería mentir;
 *   3. el cierre por tombstone del webhook y de la recuperación es CONDICIONAL: un
 *      `revealed` concurrente sobrevive intacto en vez de ser pisado.
 *
 * La carrera de verdad —dos transacciones compitiendo por un lock— vive en
 * `phone-privacy-inflight-race-postgres-4o-e3.test.ts`, contra PostgreSQL real. Aquí
 * se fija el CONTRATO que esa carrera protege.
 *
 * No hay red, ni base de datos, ni proveedor, ni flags.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackActionInput,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackCoreDeps,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from '../lusha-phone-fallback-core';
import type { LushaPhoneFallbackClientResult } from '@/server/integrations/lusha-phone-fallback-client';
import type { PhoneRevealWaterfallSuppressionState } from '../phone-reveal-waterfall-core';
import {
  applyTerminalPhoneSuppression,
  buildTerminalPhoneSuppressionPatch,
  IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES,
  SUPPRESSION_BLOCKED_ERROR_CODE,
  type TerminalPhoneSuppressionPatch,
} from '../phone-reveal-suppression-guard';

const NOW_ISO = '2026-08-10T00:00:00.000Z';

// ═══════════════════════════════════════════════════════════════
// Arnés del disparo manual
// ═══════════════════════════════════════════════════════════════

function baseCandidate(
  overrides: Partial<LushaPhoneFallbackCandidateRecord> = {},
): LushaPhoneFallbackCandidateRecord {
  return {
    id: 'candidate-1',
    status: 'pending_review',
    source: 'lusha',
    sourceContactId: 'v1.abcdef1234567890',
    existingPhone: null,
    phoneRevealStatus: 'no_phone_found',
    phoneRevealAttemptCount: 0,
    enrichmentMetadata: {},
    ...overrides,
  };
}

function baseInput(): LushaPhoneFallbackActionInput {
  return { candidateId: 'candidate-1', confirmCost: true };
}

const REVEALED: LushaPhoneFallbackClientResult = {
  ok: true,
  httpStatus: 200,
  phoneNumber: '+15550000001',
  phoneType: 'mobile',
  phoneRawType: 'mobile',
  creditsCharged: 5,
  candidateStatus: 'revealed',
  usageStatus: 'success',
  costSource: 'reported',
  errorCode: null,
  availabilitySource: null,
  phonesReturned: 1,
} as LushaPhoneFallbackClientResult;

interface ManualHarness {
  deps: LushaPhoneFallbackCoreDeps;
  persisted: Array<{ candidateId: string; patch: LushaPhoneFallbackPersistencePatch }>;
  logged: LushaPhoneFallbackUsageLogEntry[];
  terminal: Array<{ candidateId: string; patch: TerminalPhoneSuppressionPatch }>;
  readonly lushaCalls: number;
  readonly gateCalls: number;
}

function buildManual(
  options: {
    candidate?: LushaPhoneFallbackCandidateRecord;
    lushaResult?: LushaPhoneFallbackClientResult;
    /** Veredictos consecutivos: [antes de la llamada, después de la llamada]. */
    gate?: readonly PhoneRevealWaterfallSuppressionState[];
    wireGate?: boolean;
    terminalApplied?: boolean;
  } = {},
): ManualHarness {
  const persisted: ManualHarness['persisted'] = [];
  const logged: LushaPhoneFallbackUsageLogEntry[] = [];
  const terminal: ManualHarness['terminal'] = [];
  const state = { lushaCalls: 0, gateCalls: 0 };
  const verdicts = options.gate ?? ['clear', 'clear'];

  const deps: LushaPhoneFallbackCoreDeps = {
    flagEnabled: true,
    actor: { internalUserId: 'user-1', roleKey: 'admin' },
    nowIso: NOW_ISO,
    loadCandidate: async () => options.candidate ?? baseCandidate(),
    callLusha: async () => {
      state.lushaCalls += 1;
      return options.lushaResult ?? REVEALED;
    },
    persist: async (candidateId, patch) => {
      persisted.push({ candidateId, patch });
    },
    logUsage: async (entry) => {
      logged.push(entry);
    },
    persistTerminalSuppression: async (candidateId, patch) => {
      terminal.push({ candidateId, patch });
      return { applied: options.terminalApplied ?? true };
    },
    ...(options.wireGate === false
      ? {}
      : {
          checkPrivacyGate: async () => {
            const verdict = verdicts[Math.min(state.gateCalls, verdicts.length - 1)];
            state.gateCalls += 1;
            return verdict;
          },
        }),
  };

  return {
    deps,
    persisted,
    logged,
    terminal,
    get lushaCalls() {
      return state.lushaCalls;
    },
    get gateCalls() {
      return state.gateCalls;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Bloqueo ANTES de la llamada: 0 llamadas, 0 créditos
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — disparo manual de Lusha: puerta previa a la llamada', () => {
  test('supresión ⇒ 0 llamadas al proveedor y 0 créditos', async () => {
    const h = buildManual({ gate: ['blocked_suppressed'] });
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(h.lushaCalls, 0, 'no se puede llamar a Lusha con una DSAR registrada');
    assert.equal(result.creditsCharged, 0);
    assert.equal(h.persisted.length, 0, 'el candidato no se muta');
    assert.equal(h.logged.length, 1, 'el bloqueo sí queda registrado');
    assert.equal(h.logged[0].creditsUsed, 0);
    assert.equal(h.logged[0].errorCode, SUPPRESSION_BLOCKED_ERROR_CODE);
  });

  test('do_not_contact ⇒ 0 llamadas al proveedor y 0 créditos', async () => {
    const h = buildManual({ gate: ['do_not_contact'] });
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(result.status, 'do_not_contact');
    assert.equal(h.lushaCalls, 0);
    assert.equal(result.creditsCharged, 0);
    assert.equal(h.persisted.length, 0);
  });

  test('la lectura que falla es fail-closed: tampoco se llama al proveedor', async () => {
    const h = buildManual({ gate: ['check_unavailable'] });
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(result.status, 'suppression_check_unavailable');
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.logged[0].status, 'error', '«no pude comprobarlo» no es un éxito');
  });

  test('precedencia determinista: con DNC y supresión a la vez gana el DNC', async () => {
    // La puerta compartida evalúa DNC primero. Lo que importa no es cuál gane —las dos
    // bloquean con 0 créditos— sino que dos actores obtengan SIEMPRE la misma razón.
    const h = buildManual({ gate: ['do_not_contact'] });
    const first = await runLushaPhoneFallbackReveal(baseInput(), h.deps);
    const second = await runLushaPhoneFallbackReveal(baseInput(), buildManual({
      gate: ['do_not_contact'],
    }).deps);

    assert.equal(first.status, 'do_not_contact');
    assert.equal(second.status, 'do_not_contact');
  });

  test('sin bloqueo, el camino manual queda exactamente como antes del hito', async () => {
    const h = buildManual();
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');
    assert.equal(h.lushaCalls, 1);
    assert.equal(h.persisted.length, 1);
    assert.equal(h.persisted[0].patch.phone, '+15550000001');
    assert.equal(h.persisted[0].patch.phone_reveal_provider, 'lusha');
    assert.equal(h.persisted[0].patch.phone_reveal_cost_credits, 5);
  });

  test('sin la puerta cableada, el comportamiento previo al hito se conserva íntegro', async () => {
    const h = buildManual({ wireGate: false });
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(result.status, 'revealed');
    assert.equal(h.gateCalls, 0);
    assert.equal(h.lushaCalls, 1);
    assert.equal(h.persisted.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Supresión DESPUÉS de una llamada ya pagada
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — disparo manual de Lusha: supresión posterior a la respuesta', () => {
  test('el número no se escribe y el costo real se conserva', async () => {
    const h = buildManual({ gate: ['clear', 'blocked_suppressed'] });
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(h.lushaCalls, 1, 'la llamada ocurrió: el crédito se gastó');
    assert.equal(result.status, SUPPRESSION_BLOCKED_ERROR_CODE);
    assert.equal(
      h.persisted.length,
      0,
      'ni el teléfono ni la metadata del teléfono se escriben',
    );
    assert.equal(
      result.creditsCharged,
      5,
      'el cargo REAL se conserva: convertirlo en 0 sería declarar gratis una llamada pagada',
    );
    assert.equal(result.costSource, 'reported');
    const log = h.logged.at(-1)!;
    assert.equal(log.creditsUsed, 5);
    assert.equal(log.errorCode, SUPPRESSION_BLOCKED_ERROR_CODE);
  });

  test('el cierre terminal es CONDICIONAL sobre el estado que autorizó el intento', async () => {
    const h = buildManual({ gate: ['clear', 'blocked_suppressed'] });
    await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(h.terminal.length, 1);
    assert.deepEqual(h.terminal[0].patch.expectedStatuses, ['no_phone_found']);
    assert.equal(h.terminal[0].patch.phone_reveal_status, 'error');
    assert.equal(
      h.terminal[0].patch.phone_reveal_error_code,
      SUPPRESSION_BLOCKED_ERROR_CODE,
    );
    assert.equal(
      h.terminal[0].patch.phone_reveal_cost_credits,
      undefined,
      'las columnas de costo del candidato describen el reveal de la pata anterior',
    );
  });

  test('un segundo intento tras el cierre ya no llega al proveedor', async () => {
    // Primer intento: pagado y suprimido después de la respuesta.
    const first = buildManual({ gate: ['clear', 'blocked_suppressed'] });
    const firstResult = await runLushaPhoneFallbackReveal(baseInput(), first.deps);
    assert.equal(first.lushaCalls, 1);
    assert.equal(firstResult.creditsCharged, 5);

    // Segundo intento: el tombstone sigue ahí, así que la puerta PREVIA lo para.
    const second = buildManual({ gate: ['blocked_suppressed'] });
    const secondResult = await runLushaPhoneFallbackReveal(baseInput(), second.deps);

    assert.equal(second.lushaCalls, 0, 'no se vuelve a pagar por una persona suprimida');
    assert.equal(secondResult.creditsCharged, 0);
    assert.equal(secondResult.status, SUPPRESSION_BLOCKED_ERROR_CODE);
  });

  test('un do_not_contact posterior retiene el número sin cerrar el candidato', async () => {
    const h = buildManual({ gate: ['clear', 'do_not_contact'] });
    const result = await runLushaPhoneFallbackReveal(baseInput(), h.deps);

    assert.equal(result.status, 'do_not_contact');
    assert.equal(h.persisted.length, 0);
    assert.equal(
      h.terminal.length,
      0,
      'solo la supresión confirmada deja rastro terminal de privacidad',
    );
    assert.equal(result.creditsCharged, 5, 'el gasto ocurrido no se borra');
  });

  test('los caminos que NO revelan quedan idénticos', async () => {
    const noPhone = buildManual({
      gate: ['clear', 'blocked_suppressed'],
      lushaResult: {
        ...REVEALED,
        candidateStatus: 'no_phone_found',
        phoneNumber: null,
        creditsCharged: 0,
      } as LushaPhoneFallbackClientResult,
    });
    const noPhoneResult = await runLushaPhoneFallbackReveal(baseInput(), noPhone.deps);
    assert.equal(noPhoneResult.status, 'no_phone_found');
    assert.equal(noPhone.persisted.length, 1, 'la puerta posterior no toca este camino');

    const failed = buildManual({
      gate: ['clear', 'blocked_suppressed'],
      lushaResult: { ok: false, errorMessage: 'boom' } as LushaPhoneFallbackClientResult,
    });
    const failedResult = await runLushaPhoneFallbackReveal(baseInput(), failed.deps);
    assert.equal(failedResult.status, 'error');
    assert.equal(failedResult.errorCode, 'provider_network_error');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Escritura condicional del cierre por tombstone
// ═══════════════════════════════════════════════════════════════

describe('4O-E3 — el cierre por supresión no puede pisar a otro actor', () => {
  test('el patch en vuelo exige que la fila siga en `requested` o `pending`', () => {
    const patch = buildTerminalPhoneSuppressionPatch({
      expectedStatuses: IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES,
      nowIso: NOW_ISO,
      cost: { credits: 1, source: 'reported' },
      provider: 'apollo',
      webhookReceivedAt: NOW_ISO,
    });

    assert.deepEqual([...patch.expectedStatuses], ['requested', 'pending']);
    assert.ok(
      !patch.expectedStatuses.includes('revealed'),
      'un `revealed` concurrente no puede estar entre los estados que autorizan pisar',
    );
    assert.equal(patch.phone_reveal_cost_credits, 1, 'el cargo real viaja en el patch');
  });

  test('0 filas afectadas se reporta como carrera, no como éxito', async () => {
    const outcome = await applyTerminalPhoneSuppression({
      candidateId: 'candidate-1',
      persist: async () => ({ applied: false }),
      patch: buildTerminalPhoneSuppressionPatch({
        expectedStatuses: IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES,
        nowIso: NOW_ISO,
      }),
    });

    assert.equal(outcome.applied, false);
    assert.equal(outcome.reason, 'concurrent_state_change');
  });

  test('sin dep cableada se reporta `not_wired`, que es lo que preserva el camino previo', async () => {
    const outcome = await applyTerminalPhoneSuppression({
      candidateId: 'candidate-1',
      patch: buildTerminalPhoneSuppressionPatch({
        expectedStatuses: IN_FLIGHT_TERMINAL_SUPPRESSION_EXPECTED_STATUSES,
        nowIso: NOW_ISO,
      }),
    });

    assert.equal(outcome.applied, false);
    assert.equal(
      outcome.reason,
      'not_wired',
      'el webhook y la recuperación distinguen este caso para caer al UPDATE de siempre',
    );
  });

  test('una lista de estados vacía nunca escribe: no hay condición que exigir', async () => {
    let called = false;
    const outcome = await applyTerminalPhoneSuppression({
      candidateId: 'candidate-1',
      persist: async () => {
        called = true;
        return { applied: true };
      },
      patch: buildTerminalPhoneSuppressionPatch({ expectedStatuses: [], nowIso: NOW_ISO }),
    });

    assert.equal(called, false);
    assert.equal(outcome.applied, false);
  });
});
