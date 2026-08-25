/**
 * legacy-lusha-false-active-run-conflict.test.ts
 * (Agente 2A · AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1)
 *
 * ═══════════════════════════════════════════════════════════════
 * EL INCIDENTE
 * ═══════════════════════════════════════════════════════════════
 *
 * Un candidato legacy con la vista previa en 6 («Buscar teléfono con Lusha», máximo 6)
 * es rechazado al hacer clic con «Ya hay una revelación en proceso», y Producción, en
 * modo lectura, dice lo contrario: 0 corridas y 0 reservas para ese candidato. El
 * diagnóstico del propio arranque se contradecía en una sola línea:
 *
 *     active_run_found = false          ← la comprobación PREVIA no encontró ninguna
 *     reason           = active_run_exists
 *     run_created      = false
 *
 * Las dos cosas no pueden ser ciertas a la vez, y por eso el incidente no se podía
 * diagnosticar desde fuera del proceso.
 *
 * ═══════════════════════════════════════════════════════════════
 * LA CAUSA RAÍZ — DOS DEFECTOS ENCADENADOS
 * ═══════════════════════════════════════════════════════════════
 *
 * (1) LA OPERACIÓN NO VIAJABA. El serializador de `p_legs`
 *     (`reservePhoneRevealCreditsAndCreateRun`) construía cada pata con
 *     `provider_key`, `credits` y la identidad del pozo — pero SIN `operation_key`.
 *
 *     Desde la migración 124 la unicidad de una pata activa es
 *     `(candidate_id, provider_key, operation_key)` y el SQL resuelve la operación con
 *     `COALESCE(leg->>'operation_key','phone_reveal')`. Sin el campo, las DOS patas
 *     Lusha de una autorización con búsqueda de identidad —`contact_search` (1) y
 *     `phone_reveal` (5)— aterrizaban como la MISMA operación. La segunda chocaba con
 *     la primera DENTRO DE SU PROPIA TRANSACCIÓN, el bloque interno deshacía las dos
 *     escrituras y la función devolvía `already_reserved`.
 *
 *     Por eso la base quedaba intacta: 0 corridas y 0 reservas no era un misterio, era
 *     el rollback. Y por eso sólo fallaban los candidatos SIN identidad Lusha
 *     persistida: son los únicos cuya modalidad tiene dos patas del mismo proveedor.
 *
 * (2) EL CONFLICTO SE LEÍA COMO UNA CONCLUSIÓN. `already_reserved` se traducía a
 *     `active_run_exists`, y `create_conflict` compartía rama con él hasta
 *     `already_pending`, bajo la premisa de que «la corrida existente ES la
 *     autorización». Esa premisa exige que la corrida EXISTA, y un conflicto de
 *     unicidad no lo demuestra: la transacción se deshace entera.
 *
 * ═══════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTA SUITE
 * ═══════════════════════════════════════════════════════════════
 *
 *   A. la pata Lusha de búsqueda y la de teléfono llegan a la base como operaciones
 *      DISTINTAS — el defecto (1) no puede volver;
 *   B. la taxonomía completa de conflictos: sólo una corrida COMPROBADA produce
 *      `already_pending`; todo lo demás es infraestructura;
 *   C. la re-lectura que falla, o que no está cableada, es fail-closed y NUNCA afirma
 *      que exista una corrida;
 *   D. cero proveedores y cero créditos en TODOS los caminos de conflicto;
 *   E. la taxonomía de PR #342 sigue intacta: ningún motivo mecánico cae en
 *      `not_eligible`.
 *
 * OFFLINE por construcción: sin red, sin base de datos, sin Apollo, sin Lusha y sin un
 * solo crédito. La contraparte contra PostgreSQL de verdad —que ejecuta la 124 REAL y
 * demuestra la colisión— vive en `legacy-lusha-false-active-run-conflict-postgres`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  startLegacyPhoneRevealWaterfall,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallLegacyIneligibleReason,
  type PhoneRevealWaterfallRunRecord,
  type StartLegacyPhoneRevealWaterfallDeps,
} from '../phone-reveal-waterfall-core';
import { classifyLegacyPhoneRevealStartFailure } from '../phone-reveal-waterfall-legacy-start-gate';
import type { LushaIdentitySearchCandidateFacts } from '../lusha-identity-search-core';
import {
  creditHarness,
  type CreditHarness,
} from './phone-reveal-credit-reservation-fixtures';

// ── Fixture: el candidato del incidente ─────────────────────────

const NOW = '2026-08-24T12:00:00.000Z';
const CANDIDATE_ID = 'cand-luis';

/** Sin email y sin identidad Lusha persistida: la modalidad de DOS patas, tope 6. */
const LUIS_FACTS: LushaIdentitySearchCandidateFacts = {
  firstName: 'Luis',
  lastName: 'Jacome Gaona',
  linkedinUrl: 'https://www.linkedin.com/in/luis-jacome-gaona',
  email: null,
  companyName: 'Empresa Demo',
  companyDomain: 'empresademo.test',
};

function luisEvidence(): PhoneRevealWaterfallLegacyEvidence {
  return {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-08-20T15:04:00.000Z',
    hasPhone: false,
    source: 'apollo',
    sourceContactId: '6633076e37001b0007d086ce',
    providerIdentities: [],
    identitySearchFacts: LUIS_FACTS,
  };
}

/** Una corrida VIVA cualquiera. El core sólo mira si la hay. */
function liveRun(): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-ganadora',
    candidateId: CANDIDATE_ID,
    status: 'lusha_pending',
    runMode: 'legacy_lusha_only',
    authorizedAt: NOW,
    authorizedBy: 'user-admin',
    authorizedByRole: 'admin',
    maxCreditsAuthorized: 6,
    apolloAttemptedAt: null,
    apolloOutcome: 'no_phone_found',
    apolloCostCredits: null,
    apolloCostSource: 'unknown',
    lushaEligible: true,
    lushaSkippedReason: null,
    lushaAttemptedAt: null,
    lushaOutcome: null,
    lushaCostCredits: null,
    lushaCostSource: null,
    finalProvider: null,
    completedAt: null,
    errorCode: null,
    creditReservationGroupId: 'group-ganadora',
  };
}

function startDeps(
  credit: CreditHarness,
  overrides: Partial<StartLegacyPhoneRevealWaterfallDeps> = {},
): StartLegacyPhoneRevealWaterfallDeps {
  return {
    flagEnabled: true,
    actor: { internalUserId: 'user-admin', roleKey: 'admin' },
    nowIso: NOW,
    identitySearchAllowed: true,
    loadLegacyEvidence: async () => luisEvidence(),
    findActiveRun: async () => null,
    findLatestRun: async () => null,
    checkPrivacyGateBeforeReserving: async () => 'clear',
    ...credit.deps,
    ...overrides,
  };
}

/**
 * CERO efectos económicos. Se comprueba lo que de verdad importa: ninguna corrida
 * escrita y ninguna exposición viva. Un conflicto deshace la transacción entera, así
 * que el estado durable tiene que ser indistinguible de no haber hecho clic.
 */
function assertZeroSpend(credit: CreditHarness, label: string) {
  assert.equal(credit.createdRuns.length, 0, `${label}: 0 corridas escritas`);
  assert.equal(credit.active.length, 0, `${label}: 0 reservas vivas`);
}

async function startWith(
  credit: CreditHarness,
  overrides: Partial<StartLegacyPhoneRevealWaterfallDeps> = {},
) {
  return startLegacyPhoneRevealWaterfall(
    { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
    startDeps(credit, overrides),
  );
}

// ═══════════════════════════════════════════════════════════════
// A · § 10 — LA REGRESIÓN DE LUIS: el camino limpio ARRANCA
// ═══════════════════════════════════════════════════════════════

describe('A — regresión Luis: el arranque limpio crea la corrida', () => {
  it('crea UNA corrida legacy con tope 6 y reserva 1 + 5, sin tocar Apollo', async () => {
    const credit = creditHarness();
    const started = await startWith(credit);

    assert.equal(started.started, true);
    if (!started.started) return;
    assert.equal(started.maxCreditsAuthorized, 6);
    assert.equal(
      started.maxCreditsAuthorized,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
    );
    assert.equal(started.requiresIdentitySearch, true);
    assert.equal(credit.createdRuns.length, 1, 'exactamente UNA corrida');
    assert.equal(credit.createdDrafts[0]?.runMode, 'legacy_lusha_only');

    // La comprobación previa NO encontró corrida, no hubo conflicto, y por tanto no
    // hubo re-lectura. Es la línea que en Producción se contradecía a sí misma.
    assert.equal(started.diagnostics.activeRunFound, false);
    assert.equal(started.diagnostics.atomicCreateConflict, false);
    assert.equal(started.diagnostics.conflictClass, null);
    assert.equal(started.diagnostics.postConflictActiveRunFound, null);

    // Apollo NO aparece en NINGÚN pozo consultado: no se ejecuta bajo esta autorización.
    for (const query of credit.poolQueries) {
      assert.equal(query.includes('apollo'), false, 'Apollo no se consulta');
    }
  });

  it('las DOS patas de Lusha son operaciones DISTINTAS: 1 de búsqueda + 5 de teléfono', async () => {
    const credit = creditHarness();
    await startWith(credit);

    const legs = credit.reserveRequests[0]?.legs ?? [];
    assert.deepEqual(
      legs.map((leg) => [leg.providerKey, leg.operationKey, leg.credits]),
      [
        ['lusha', 'contact_search', 1],
        ['lusha', 'phone_reveal', 5],
      ],
      'búsqueda hasta 1 + teléfono hasta 5, cada una con SU operación',
    );

    // EL DEFECTO (1), fijado como invariante: dos patas del MISMO proveedor no pueden
    // compartir operación. Si vuelven a compartirla, en la base son la misma fila y la
    // segunda choca contra la primera dentro de su propia transacción.
    const identities = legs.map((leg) => `${leg.providerKey}:${leg.operationKey}`);
    assert.equal(
      new Set(identities).size,
      identities.length,
      'ninguna pata comparte (proveedor, operación) con otra de la misma autorización',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// B · § 6/§ 11 — LA TAXONOMÍA DEL CONFLICTO
// ═══════════════════════════════════════════════════════════════

describe('B — un conflicto SIN corrida viva NO es «ya hay una en proceso»', () => {
  // § 11.B — conflicto de RESERVA sin corrida. Es EXACTAMENTE la forma del incidente.
  it('already_reserved sin corrida ⇒ reservation_conflict, 0 proveedores', async () => {
    const credit = creditHarness({ outcome: { status: 'already_reserved' } });
    const started = await startWith(credit);

    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'reservation_conflict');
    assert.notEqual(
      started.reason,
      'active_run_exists',
      'la afirmación falsa del incidente no puede volver',
    );

    // El diagnóstico ya NO se contradice: se ve que chocó, qué chocó, y que la
    // re-lectura respondió que no hay corrida.
    assert.equal(started.diagnostics.activeRunFound, false);
    assert.equal(started.diagnostics.atomicCreateConflict, true);
    assert.equal(started.diagnostics.conflictClass, 'reservation');
    assert.equal(started.diagnostics.postConflictActiveRunFound, false);

    assert.equal(
      classifyLegacyPhoneRevealStartFailure(started.reason),
      'infrastructure_unavailable',
    );
    assertZeroSpend(credit, 'reservation_conflict');
  });

  // § 11.C — conflicto de la CORRIDA sin corrida ganadora.
  it('create_conflict sin corrida ⇒ create_conflict, jamás already_pending', async () => {
    const credit = creditHarness({ outcome: { status: 'create_conflict' } });
    const started = await startWith(credit);

    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'create_conflict');
    assert.equal(started.diagnostics.conflictClass, 'run_create');
    assert.equal(started.diagnostics.postConflictActiveRunFound, false);
    assert.equal(
      classifyLegacyPhoneRevealStartFailure(started.reason),
      'infrastructure_unavailable',
    );
    assertZeroSpend(credit, 'create_conflict');
  });

  // § 11.A/B — la carrera REAL: el perdedor encuentra la corrida del ganador.
  it('conflicto CON corrida ganadora ⇒ active_run_exists, ya comprobado', async () => {
    for (const outcome of ['already_reserved', 'create_conflict'] as const) {
      const credit = creditHarness({
        outcome: { status: outcome },
        existingRuns: [
          {
            runId: 'run-ganadora',
            candidateId: CANDIDATE_ID,
            authorizationKey: 'authkey-ganadora',
            reservationGroupId: 'group-ganadora',
            isActive: true,
          },
        ],
      });
      const started = await startWith(credit);

      assert.equal(started.started, false, outcome);
      if (started.started) return;
      assert.equal(started.reason, 'active_run_exists', outcome);
      assert.equal(started.diagnostics.postConflictActiveRunFound, true, outcome);
      assert.equal(
        classifyLegacyPhoneRevealStartFailure(started.reason),
        'already_pending',
        outcome,
      );
      // Ninguna SEGUNDA corrida: la del ganador es la única.
      assert.equal(credit.createdRuns.length, 0, `${outcome}: no se creó una segunda`);
    }
  });

  // § 11.E — la corrida viva se detecta ANTES de intentar escribir.
  it('una corrida viva detectada en el PRE-CHECK no llega siquiera a reservar', async () => {
    const credit = creditHarness();
    const started = await startWith(credit, { findActiveRun: async () => liveRun() });

    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'active_run_exists');
    assert.equal(started.diagnostics.activeRunFound, true);
    // No se intentó escribir, así que no hay conflicto que clasificar.
    assert.equal(started.diagnostics.atomicCreateConflict, null);
    assert.equal(started.diagnostics.conflictClass, null);
    assert.equal(credit.reserveRequests.length, 0, 'ni siquiera se intentó reservar');
    assertZeroSpend(credit, 'corrida viva en el pre-check');
  });
});

// ═══════════════════════════════════════════════════════════════
// C · § 7/§ 11.F — LA RE-LECTURA QUE NO SE PUEDE HACER
// ═══════════════════════════════════════════════════════════════

describe('C — sin poder comprobarlo, NO se afirma que haya corrida', () => {
  it('la re-lectura posterior al conflicto LANZA ⇒ infraestructura, fail-closed', async () => {
    for (const outcome of ['already_reserved', 'create_conflict'] as const) {
      const credit = creditHarness({
        outcome: { status: outcome },
        postConflictLookupThrows: new Error('driver caído'),
        // La corrida ganadora EXISTE, pero la lectura falla: aun así NO se afirma. Un
        // fallo de lectura no es permiso para dar por cierto lo que se quería leer.
        existingRuns: [
          {
            runId: 'run-ganadora',
            candidateId: CANDIDATE_ID,
            authorizationKey: 'authkey-ganadora',
            reservationGroupId: 'group-ganadora',
            isActive: true,
          },
        ],
      });
      const started = await startWith(credit);

      assert.equal(started.started, false, outcome);
      if (started.started) return;
      assert.equal(started.reason, 'run_creation_unavailable', outcome);
      assert.notEqual(started.reason, 'active_run_exists', outcome);
      assert.equal(started.diagnostics.conflictClass, outcome === 'already_reserved' ? 'reservation' : 'run_create');
      assert.equal(
        started.diagnostics.postConflictActiveRunFound,
        null,
        `${outcome}: no se consultó con éxito, así que no se afirma nada`,
      );
      assert.equal(
        classifyLegacyPhoneRevealStartFailure(started.reason),
        'infrastructure_unavailable',
        outcome,
      );
    }
  });

  it('sin la dep de re-lectura cableada, un conflicto tampoco afirma corrida viva', async () => {
    const credit = creditHarness({
      outcome: { status: 'already_reserved' },
      omitPostConflictLookup: true,
    });
    const started = await startWith(credit);

    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'run_creation_unavailable');
    assert.equal(started.diagnostics.postConflictActiveRunFound, null);
    assertZeroSpend(credit, 'sin dep de re-lectura');
  });
});

// ═══════════════════════════════════════════════════════════════
// D · § 12 — SEGURIDAD ECONÓMICA EN TODOS LOS CONFLICTOS
// ═══════════════════════════════════════════════════════════════

describe('D — ningún camino de conflicto gasta nada', () => {
  it('los tres desenlaces de conflicto dejan la base como estaba', async () => {
    const CASES = [
      { outcome: 'already_reserved' as const, expected: 'reservation_conflict' },
      { outcome: 'create_conflict' as const, expected: 'create_conflict' },
    ];
    for (const { outcome, expected } of CASES) {
      const credit = creditHarness({ outcome: { status: outcome } });
      const started = await startWith(credit);

      assert.equal(started.started === false && started.reason, expected);
      assertZeroSpend(credit, outcome);
      // La ruta legacy no tiene dep de Apollo: su pozo nunca se consulta.
      for (const query of credit.poolQueries) {
        assert.equal(query.includes('apollo'), false, `${outcome}: 0 Apollo`);
      }
    }
  });

  it('el arranque legacy NO expone ninguna dep con la que llamar a un proveedor', () => {
    const credit = creditHarness();
    const keys = Object.keys(startDeps(credit)).join(' ').toLowerCase();
    assert.equal(keys.includes('apollo'), false);
    assert.equal(keys.includes('lusha'), false);
    assert.equal(keys.includes('reveal'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// E · § 14.10 — LA TAXONOMÍA DE PR #342 SIGUE INTACTA
// ═══════════════════════════════════════════════════════════════

describe('E — la taxonomía veraz de PR #342 se conserva', () => {
  /** Todos los motivos mecánicos del vocabulario, incluidos los dos nuevos. */
  const MECHANICAL: PhoneRevealWaterfallLegacyIneligibleReason[] = [
    'feature_disabled',
    'role_not_allowed',
    'candidate_not_found',
    'apollo_not_exhausted',
    'apollo_evidence_missing',
    'apollo_outcome_not_closed',
    'existing_phone_present',
    'candidate_not_editable',
    'missing_lusha_contact_id',
    'active_run_exists',
    'insufficient_credits',
    'budget_not_configured',
    'credit_balance_unavailable',
    'run_creation_unavailable',
    'incompatible_historical_run',
    'previous_run_revealed_phone',
    'create_conflict',
    'reservation_conflict',
    'blocked_suppressed',
    'do_not_contact',
    'suppression_check_unavailable',
    'authorization_ceiling_mismatch',
  ];

  it('ningún motivo mecánico —tampoco los dos nuevos— cae en `not_eligible`', () => {
    for (const reason of MECHANICAL) {
      assert.notEqual(
        classifyLegacyPhoneRevealStartFailure(reason),
        'not_eligible',
        `${reason} no puede colapsarse en el cajón de sastre`,
      );
    }
  });

  it('sólo la entrada inválida del cliente conserva `not_eligible`', () => {
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('invalid_candidate'),
      'not_eligible',
    );
  });

  it('sólo UN motivo produce «ya hay una revelación en proceso»', () => {
    const alreadyPending = MECHANICAL.filter(
      (reason) => classifyLegacyPhoneRevealStartFailure(reason) === 'already_pending',
    );
    assert.deepEqual(
      alreadyPending,
      ['active_run_exists'],
      'los conflictos sin corrida ya no pueden afirmar un proceso en curso',
    );
  });
});
