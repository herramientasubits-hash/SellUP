/**
 * Tests — Waterfall legacy (solo pata Lusha)
 * (Agente 2A · AGENT2A-PHONE-WATERFALL-2)
 *
 * Contrato verificado:
 *   * elegibilidad legacy: la evidencia canónica es la TERNA
 *     `phone_reveal_status='no_phone_found'` + `phone_reveal_provider='apollo'` +
 *     `phone_reveal_completed_at IS NOT NULL`. Nada más la sustituye;
 *   * CERO Apollo: la ruta legacy no tiene ninguna dependencia de Apollo que pueda
 *     invocarse, y la prueba FALLA si alguna se toca;
 *   * costos: tope 5 (nunca 13, nunca 8), Apollo `null` + `unknown`, sin totales
 *     mezclados y sin representar un costo desconocido como 0;
 *   * concurrencia: con tres disparadores simultáneos hay exactamente UN claim y
 *     UNA llamada a Lusha;
 *   * supresión/DNC fail-closed, distinguiendo `suppressed` de
 *     `suppression_check_unavailable`;
 *   * TTL de 24 h;
 *   * `run_mode` explícito, nunca inferido de `apollo_attempted_at`.
 *
 * PURO: sin red, sin DB, sin proveedores, sin créditos. Todas las deps son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneRevealWaterfallAuditView,
  continuePhoneRevealWaterfall,
  decidePhoneRevealWaterfallContinuation,
  evaluatePhoneRevealWaterfallLegacyEligibility,
  parsePhoneRevealWaterfallRunMode,
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_TERMINAL_CANDIDATE_STATUSES,
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
  PHONE_REVEAL_WATERFALL_RUN_MODES,
  startLegacyPhoneRevealWaterfall,
  type ContinuePhoneRevealWaterfallDeps,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallLushaLegResult,
  type PhoneRevealWaterfallRunDraft,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
  type PhoneRevealWaterfallSuppressionState,
  type StartLegacyPhoneRevealWaterfallDeps,
} from '../phone-reveal-waterfall-core';
import {
  creditHarness,
  poolsWith,
  type CreditHarness,
} from './phone-reveal-credit-reservation-fixtures';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-08-03T12:00:00.000Z';

function isoMinusHours(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
}

/** Candidato Lusha con id propio, sin teléfono y con Apollo ya agotado. */
function legacyEvidence(
  overrides: Partial<PhoneRevealWaterfallLegacyEvidence> = {},
): PhoneRevealWaterfallLegacyEvidence {
  return {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-07-20T09:00:00.000Z',
    hasPhone: false,
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
    ...overrides,
  };
}

function candidateRecord(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'cand-legacy',
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
    hasPhone: false,
    phoneRevealStatus: 'no_phone_found',
    ...overrides,
  };
}

/** Corrida legacy activa, tal y como la deja el INSERT del arranque legacy. */
function legacyRun(
  overrides: Partial<PhoneRevealWaterfallRunRecord> = {},
): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-legacy-1',
    candidateId: 'cand-legacy',
    status: 'lusha_pending',
    runMode: 'legacy_lusha_only',
    authorizedAt: isoMinusHours(1),
    authorizedBy: 'user-admin',
    authorizedByRole: 'admin',
    maxCreditsAuthorized: PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
    // Apollo NO corrió bajo esta autorización.
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
    // AGENT2A-PHONE-WATERFALL-4E: la corrida nace asociada a su grupo de reserva.
    creditReservationGroupId: 'group-legacy-1',
    ...overrides,
  };
}

/**
 * Deps del arranque legacy. Cualquier clave que empiece por `apollo` es
 * DELIBERADAMENTE inexistente: la ruta legacy no tiene forma de llamar a Apollo.
 */
function startDeps(
  overrides: Partial<StartLegacyPhoneRevealWaterfallDeps> = {},
  creditOverride?: CreditHarness,
): {
  deps: StartLegacyPhoneRevealWaterfallDeps;
  drafts: PhoneRevealWaterfallRunDraft[];
  credit: CreditHarness;
} {
  // Presupuesto por defecto: pozo CONFIGURADO con saldo amplio
  // (AGENT2A-PHONE-WATERFALL-4E). Ya no puede ser "sin regla": desde 4E eso bloquea, y
  // el resto de la suite mide otras cosas. El preflight tiene sus propias pruebas.
  const credit = creditOverride ?? creditHarness();
  // 4F: la corrida la escribe la MISMA operación que reserva, así que los borradores
  // realmente escritos los lleva el harness de crédito.
  const drafts = credit.createdDrafts;
  const deps: StartLegacyPhoneRevealWaterfallDeps = {
    flagEnabled: true,
    actor: { internalUserId: 'user-admin', roleKey: 'admin' },
    nowIso: NOW,
    loadLegacyEvidence: async () => legacyEvidence(),
    findActiveRun: async () => null,
    findLatestRun: async () => null,
    ...credit.deps,
    ...overrides,
  };
  return { deps, drafts, credit };
}

// ── 1. Elegibilidad legacy ───────────────────────────────────────────────────

describe('WATERFALL-2 — elegibilidad legacy: evidencia canónica', () => {
  it('Apollo histórico no_phone_found cerrado + sin teléfono ⇒ ELEGIBLE', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(legacyEvidence());
    assert.equal(result.eligible, true);
    assert.equal(result.reason, null);
  });

  it('sin evidencia ninguna (phone_reveal_status null) ⇒ NO elegible', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ phoneRevealStatus: null, phoneRevealProvider: null }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'apollo_not_exhausted');
  });

  it('Apollo histórico en ERROR ⇒ NO elegible (un fallo técnico no es "no hay teléfono")', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ phoneRevealStatus: 'error' }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'apollo_not_exhausted');
  });

  it('Apollo nunca intentado ⇒ NO elegible', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({
        phoneRevealStatus: null,
        phoneRevealProvider: null,
        phoneRevealCompletedAt: null,
      }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'apollo_not_exhausted');
  });

  it('reveal en vuelo (requested / pending) ⇒ NO elegible', () => {
    for (const status of ['requested', 'pending']) {
      const result = evaluatePhoneRevealWaterfallLegacyEligibility(
        legacyEvidence({ phoneRevealStatus: status, phoneRevealCompletedAt: null }),
      );
      assert.equal(result.eligible, false, status);
      assert.equal(result.reason, 'apollo_not_exhausted', status);
    }
  });

  it('no_phone_found producido por LUSHA ⇒ NO elegible (no re-llama a Lusha sobre su propia respuesta)', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ phoneRevealProvider: 'lusha' }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'apollo_evidence_missing');
  });

  it('no_phone_found SIN proveedor registrado ⇒ NO elegible (no se asume Apollo)', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ phoneRevealProvider: null }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'apollo_evidence_missing');
  });

  it('no_phone_found SIN completed_at ⇒ NO elegible (el intento no cerró de forma fechada)', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ phoneRevealCompletedAt: null }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'apollo_outcome_not_closed');
  });

  it('ya tiene teléfono ⇒ NO elegible', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ hasPhone: true }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'existing_phone_present');
  });

  it('candidato en estado terminal (aprobado / descartado / …) ⇒ NO elegible', () => {
    for (const status of PHONE_REVEAL_WATERFALL_LEGACY_TERMINAL_CANDIDATE_STATUSES) {
      const result = evaluatePhoneRevealWaterfallLegacyEligibility(
        legacyEvidence({ candidateStatus: status }),
      );
      assert.equal(result.eligible, false, status);
      assert.equal(result.reason, 'candidate_not_editable', status);
    }
  });

  it('sin id Lusha propio ⇒ NO elegible (autorizar 5 créditos para una pata imposible sería mentir)', () => {
    const apolloSourced = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ source: 'apollo', sourceContactId: '0123456789abcdef01234567' }),
    );
    assert.equal(apolloSourced.eligible, false);
    assert.equal(apolloSourced.reason, 'missing_lusha_contact_id');

    const noId = evaluatePhoneRevealWaterfallLegacyEligibility(
      legacyEvidence({ sourceContactId: '   ' }),
    );
    assert.equal(noId.eligible, false);
    assert.equal(noId.reason, 'missing_lusha_contact_id');
  });

  it('un texto de UI no es evidencia: solo cuentan las columnas persistidas', () => {
    // Ninguna combinación que NO incluya la terna canónica es elegible, por muy
    // parecida que "suene" a "no se encontró teléfono".
    const nearMisses: Partial<PhoneRevealWaterfallLegacyEvidence>[] = [
      { phoneRevealStatus: 'No se encontró teléfono' },
      { phoneRevealStatus: 'NO_PHONE_FOUND' },
      { phoneRevealStatus: 'exhausted' },
      { phoneRevealProvider: 'Apollo.io' },
      { phoneRevealProvider: 'APOLLO' },
    ];
    for (const overrides of nearMisses) {
      const result = evaluatePhoneRevealWaterfallLegacyEligibility(
        legacyEvidence(overrides),
      );
      assert.equal(result.eligible, false, JSON.stringify(overrides));
    }
  });
});

describe('WATERFALL-2 — gates del arranque legacy (flag, rol, corridas)', () => {
  it('flag OFF ⇒ no arranca y NO lee el candidato', async () => {
    let loaded = 0;
    const { deps, drafts } = startDeps({
      flagEnabled: false,
      loadLegacyEvidence: async () => {
        loaded += 1;
        return legacyEvidence();
      },
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'feature_disabled');
    assert.equal(loaded, 0);
    assert.equal(drafts.length, 0);
  });

  it('commercial_manager (y cualquier rol no admin) ⇒ RECHAZADO, sin leer nada', async () => {
    for (const roleKey of ['commercial_manager', 'viewer', '', null]) {
      let loaded = 0;
      const { deps, drafts } = startDeps({
        actor: { internalUserId: 'user-x', roleKey },
        loadLegacyEvidence: async () => {
          loaded += 1;
          return legacyEvidence();
        },
      });
      const result = await startLegacyPhoneRevealWaterfall(
        { candidateId: 'cand-legacy' },
        deps,
      );
      assert.equal(result.started, false, String(roleKey));
      assert.equal(
        result.started === false && result.reason,
        'role_not_allowed',
        String(roleKey),
      );
      assert.equal(loaded, 0, String(roleKey));
      assert.equal(drafts.length, 0, String(roleKey));
    }
  });

  it('admin ⇒ PERMITIDO', async () => {
    const { deps, drafts } = startDeps();
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started, true);
    assert.equal(drafts.length, 1);
  });

  it('candidato inexistente ⇒ candidate_not_found, sin INSERT', async () => {
    const { deps, drafts } = startDeps({ loadLegacyEvidence: async () => null });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started === false && result.reason, 'candidate_not_found');
    assert.equal(drafts.length, 0);
  });

  it('candidateId vacío ⇒ invalid_candidate, sin INSERT', async () => {
    const { deps, drafts } = startDeps();
    const result = await startLegacyPhoneRevealWaterfall({ candidateId: '   ' }, deps);
    assert.equal(result.started === false && result.reason, 'invalid_candidate');
    assert.equal(drafts.length, 0);
  });

  it('corrida ACTIVA existente ⇒ no se abre una segunda autorización', async () => {
    const { deps, drafts } = startDeps({
      findActiveRun: async () => legacyRun(),
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started === false && result.reason, 'active_run_exists');
    assert.equal(drafts.length, 0);
  });

  it('corrida FULL_WATERFALL anterior (ya terminal) ⇒ la ruta legacy NO aplica', async () => {
    // El candidato pertenece al flujo completo: su corrida NO lo convierte en legacy y
    // esta ruta no puede usarse para saltarse Apollo. La reautorización legacy
    // (AGENT2A-PHONE-WATERFALL-2C) solo alcanza a corridas `legacy_lusha_only`.
    const { deps, drafts } = startDeps({
      findLatestRun: async () =>
        legacyRun({
          status: 'exhausted',
          runMode: 'full_waterfall',
          completedAt: isoMinusHours(2),
        }),
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(
      result.started === false && result.reason,
      'incompatible_historical_run',
    );
    assert.equal(drafts.length, 0);
  });

  it('el índice único parcial rechazando el INSERT ⇒ create_conflict', async () => {
    const { deps } = startDeps(
      {},
      creditHarness({ outcome: { status: 'create_conflict' } }),
    );
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started === false && result.reason, 'create_conflict');
  });
});

// ── 2. Cero Apollo ───────────────────────────────────────────────────────────

// ── Preflight de saldo de la ruta legacy (AGENT2A-PHONE-WATERFALL-4D) ────────

describe('WATERFALL-4D/4E — presupuesto y reserva antes de crear la corrida legacy', () => {
  it('pozo de Lusha con 5 SÍ autoriza la corrida legacy: su tope es 5, no 13 ni 8', async () => {
    const { deps, drafts, credit } = startDeps(
      {},
      creditHarness({ poolsFor: poolsWith(5) }),
    );
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started, true);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].maxCreditsAuthorized, 5);
    // La reserva ocupa 5 contra Lusha, y SOLO contra Lusha.
    assert.deepEqual(
      credit.reserveRequests[0].legs.map((leg) => [leg.providerKey, leg.credits]),
      [['lusha', 5]],
    );
  });

  it('pozo con 4 ⇒ insufficient_credits y NINGUNA corrida creada', async () => {
    const { deps, drafts } = startDeps({}, creditHarness({ poolsFor: poolsWith(4) }));
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'insufficient_credits');
    assert.equal(drafts.length, 0, 'sin corrida no hay forma de llamar a Lusha');
  });

  it('sin regla de crédito para Lusha ⇒ budget_not_configured y sin corrida', async () => {
    const { deps, drafts } = startDeps(
      {},
      creditHarness({
        poolsFor: (keys) =>
          keys.map((providerKey) => ({ providerKey, state: { kind: 'not_configured' } })),
      }),
    );
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'budget_not_configured');
    assert.equal(drafts.length, 0);
  });

  it('presupuesto NO verificable ⇒ fail-closed con motivo propio y sin corrida', async () => {
    const { deps, drafts } = startDeps(
      {},
      creditHarness({
        poolsFor: (keys) =>
          keys.map((providerKey) => ({ providerKey, state: { kind: 'unavailable' } })),
      }),
    );
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(
      result.started === false && result.reason,
      'credit_balance_unavailable',
    );
    assert.equal(drafts.length, 0);
  });

  it('solo se consulta el pozo de LUSHA: Apollo no corre en esta autorización', async () => {
    const { deps, credit } = startDeps();
    await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-legacy' }, deps);
    assert.deepEqual(credit.poolQueries, [['lusha']]);
  });

  it('flag OFF / rol no admin no consultan el presupuesto (gates baratos primero)', async () => {
    for (const overrides of [
      { flagEnabled: false },
      { actor: { internalUserId: 'user-x', roleKey: 'commercial_manager' } },
    ]) {
      const { deps, credit } = startDeps(overrides);
      await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-legacy' }, deps);
      assert.equal(credit.poolQueries.length, 0, JSON.stringify(overrides));
      assert.equal(credit.reserveRequests.length, 0, JSON.stringify(overrides));
    }
  });
});

describe('WATERFALL-2 — CERO Apollo', () => {
  it('el arranque legacy no expone NINGUNA dep de Apollo que se pueda invocar', async () => {
    const { deps } = startDeps();
    // Si alguien añadiera una dependencia de Apollo al arranque legacy, este test
    // falla: la superficie de deps es la lista cerrada de abajo.
    assert.deepEqual(Object.keys(deps).sort(), [
      'actor',
      'findActiveRun',
      'findLatestRun',
      'flagEnabled',
      'loadLegacyEvidence',
      // Generan un uuid. No tocan red ni proveedores.
      'newAuthorizationKey',
      'newReservationGroupId',
      'nowIso',
      // AGENT2A-PHONE-WATERFALL-4D/4E. Resuelve PRESUPUESTO, no proveedores: en esta
      // modalidad solo se pregunta por Lusha.
      'readCreditPools',
      // AGENT2A-PHONE-WATERFALL-4F. Ocupa presupuesto Y escribe la corrida, en UNA
      // transacción. No puede llamar a Apollo ni a Lusha.
      'reserveCreditsAndCreateRun',
    ]);
  });

  it('el draft de la corrida legacy NO fabrica apollo_attempted_at, request id ni costo', async () => {
    const { deps, drafts } = startDeps();
    await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-legacy' }, deps);

    assert.equal(drafts.length, 1);
    const draft = drafts[0];
    // apollo_attempted_at NULL: Apollo no se ejecutó bajo esta autorización.
    assert.equal(draft.apolloAttemptedAt, null);
    // El desenlace es la TRANSCRIPCIÓN del histórico, no una ejecución nueva.
    assert.equal(draft.apolloOutcome, 'no_phone_found');
    // Costo desconocido: `unknown`, y la columna de créditos ni se escribe.
    assert.equal(draft.apolloCostSource, 'unknown');
    assert.equal(
      Object.prototype.hasOwnProperty.call(draft, 'apolloCostCredits'),
      false,
      'apolloCostCredits no debe escribirse: null es su valor correcto, nunca 0',
    );
    // Ningún campo del draft puede contener un provider request id inventado.
    assert.equal(
      JSON.stringify(draft).includes('request_id'),
      false,
    );
  });

  it('la corrida legacy nace en lusha_pending, un estado RECLAMABLE (no espera a Apollo)', async () => {
    const { deps, drafts } = startDeps();
    await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-legacy' }, deps);
    assert.equal(drafts[0].status, 'lusha_pending');
    assert.ok(PHONE_REVEAL_WATERFALL_CLAIMABLE_STATUSES.includes(drafts[0].status));
  });

  it('un evento terminal de Apollo que NO es no_phone_found no toca una corrida legacy', () => {
    for (const apolloOutcome of [
      'revealed',
      'revealed_from_cache',
      'error',
      'blocked_suppressed',
      'do_not_contact',
      'cache_unavailable',
    ] as const) {
      const decision = decidePhoneRevealWaterfallContinuation({
        flagEnabled: true,
        lushaFallbackFlagEnabled: true,
        nowIso: NOW,
        run: legacyRun(),
        apolloOutcome,
        candidate: candidateRecord(),
      });
      assert.equal(decision.action, 'noop', apolloOutcome);
      assert.equal(
        decision.action === 'noop' && decision.reason,
        'legacy_run_ignores_apollo_event',
        apolloOutcome,
      );
    }
  });

  it('si aparece un teléfono en el intervalo, la corrida legacy NO se atribuye a Apollo', () => {
    const decision = decidePhoneRevealWaterfallContinuation({
      flagEnabled: true,
      lushaFallbackFlagEnabled: true,
      nowIso: NOW,
      run: legacyRun(),
      apolloOutcome: 'no_phone_found',
      candidate: candidateRecord({ hasPhone: true }),
    });
    assert.equal(decision.action, 'close');
    if (decision.action !== 'close') return;
    // NUNCA `completed_apollo` + `apollo`: Apollo no corrió bajo esta autorización.
    assert.equal(decision.patch.status, 'aborted');
    assert.equal(decision.patch.finalProvider, 'none');
    assert.equal(decision.patch.lushaSkippedReason, 'not_needed');
  });

  it('el mismo caso en full_waterfall SÍ conserva el cierre validado (sin regresión)', () => {
    const decision = decidePhoneRevealWaterfallContinuation({
      flagEnabled: true,
      lushaFallbackFlagEnabled: true,
      nowIso: NOW,
      run: legacyRun({ runMode: 'full_waterfall', status: 'apollo_in_flight' }),
      apolloOutcome: 'no_phone_found',
      candidate: candidateRecord({ hasPhone: true }),
    });
    assert.equal(decision.action, 'close');
    if (decision.action !== 'close') return;
    assert.equal(decision.patch.status, 'completed_apollo');
    assert.equal(decision.patch.finalProvider, 'apollo');
  });
});

// ── 3. Continuación legacy: Lusha, claim y concurrencia ──────────────────────

interface ContinueHarness {
  deps: ContinuePhoneRevealWaterfallDeps;
  patches: { runId: string; patch: PhoneRevealWaterfallRunPatch }[];
  lushaCalls: { candidateId: string; maxCreditsAuthorized: number }[];
  claims: number;
}

/**
 * Arma la continuación sobre UNA corrida legacy compartida. El claim atómico se
 * simula con el mismo invariante que el UPDATE condicional real: solo el primero
 * que lo pide, y solo si la autorización no venció, lo obtiene.
 */
function continueHarness(options: {
  run?: PhoneRevealWaterfallRunRecord;
  candidate?: PhoneRevealWaterfallCandidateRecord | null;
  suppression?: PhoneRevealWaterfallSuppressionState;
  lushaResult?: PhoneRevealWaterfallLushaLegResult;
  lushaFallbackFlagEnabled?: boolean;
  ttlHours?: number;
}): ContinueHarness {
  const run = options.run ?? legacyRun();
  const state = { claimed: false };
  const harness: ContinueHarness = {
    patches: [],
    lushaCalls: [],
    claims: 0,
    deps: {
      flagEnabled: true,
      lushaFallbackFlagEnabled: options.lushaFallbackFlagEnabled ?? true,
      nowIso: NOW,
      findActiveRun: async () => (state.claimed ? { ...run, lushaAttemptedAt: NOW } : run),
      loadCandidate: async () =>
        options.candidate === undefined ? candidateRecord() : options.candidate,
      updateRun: async (runId, patch) => {
        harness.patches.push({ runId, patch });
      },
      checkSuppressionAndDoNotContact: async () => options.suppression ?? 'clear',
      claimLushaAttempt: async () => {
        harness.claims += 1;
        // Espejo del WHERE real: lusha_attempted_at IS NULL AND authorized_at > TTL.
        const expired =
          Date.parse(NOW) - Date.parse(run.authorizedAt) > 24 * 3_600_000;
        if (state.claimed || expired) return false;
        state.claimed = true;
        return true;
      },
      callLushaLeg: async (args) => {
        harness.lushaCalls.push({
          candidateId: args.candidateId,
          maxCreditsAuthorized: args.maxCreditsAuthorized,
        });
        return (
          options.lushaResult ?? {
            status: 'revealed',
            creditsCharged: 5,
            errorCode: null,
          }
        );
      },
    },
  };
  return harness;
}

describe('WATERFALL-2 — continuación legacy: una sola llamada a Lusha', () => {
  it('camino feliz: 1 claim, 1 llamada, tope 5, proveedor final lusha', async () => {
    const h = continueHarness({});
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );

    assert.equal(result.outcome, 'lusha_revealed');
    assert.equal(result.lushaCalled, true);
    assert.equal(h.lushaCalls.length, 1);
    assert.equal(
      h.lushaCalls[0].maxCreditsAuthorized,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
    );

    const patch = h.patches.at(-1)?.patch;
    assert.equal(patch?.status, 'completed_lusha');
    assert.equal(patch?.finalProvider, 'lusha');
    assert.equal(patch?.lushaCostCredits, 5);
    assert.equal(patch?.lushaCostSource, 'reported');
    // El costo de Apollo NO se toca en la continuación legacy.
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch ?? {}, 'apolloCostCredits'),
      false,
    );
  });

  it('TRES disparadores concurrentes ⇒ exactamente 1 claim ganador y 1 llamada a Lusha', async () => {
    const h = continueHarness({});
    const input = {
      candidateId: 'cand-legacy',
      apolloOutcome: 'no_phone_found' as const,
    };

    // Continuación directa (el propio arranque legacy) + recovery L2 + revisión L3.
    const results = await Promise.all([
      continuePhoneRevealWaterfall(input, h.deps),
      continuePhoneRevealWaterfall(input, h.deps),
      continuePhoneRevealWaterfall(input, h.deps),
    ]);

    assert.equal(h.lushaCalls.length, 1, 'lusha_calls debe ser exactamente 1');
    assert.equal(
      results.filter((r) => r.lushaCalled).length,
      1,
      'successful_claims debe ser exactamente 1',
    );
    assert.equal(
      results.filter((r) => r.outcome === 'lusha_claim_lost' || r.outcome === 'noop')
        .length,
      2,
    );
  });

  it('la corrida ya terminal ⇒ noop, sin escribir y sin llamar', async () => {
    const h = continueHarness({
      run: legacyRun({ status: 'exhausted', completedAt: isoMinusHours(1) }),
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'noop');
    assert.equal(result.reason, 'run_already_terminal');
    assert.equal(h.lushaCalls.length, 0);
    assert.equal(h.patches.length, 0);
  });

  it('la pata ya reclamada por otro disparador ⇒ noop, 0 llamadas', async () => {
    const h = continueHarness({ run: legacyRun({ lushaAttemptedAt: isoMinusHours(0.1) }) });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'noop');
    assert.equal(result.reason, 'lusha_already_attempted');
    assert.equal(h.lushaCalls.length, 0);
  });

  it('autorización vencida (>24 h) ⇒ se cierra sin llamar a Lusha', async () => {
    const h = continueHarness({ run: legacyRun({ authorizedAt: isoMinusHours(25) }) });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls.length, 0);
    const patch = h.patches.at(-1)?.patch;
    assert.equal(patch?.status, 'aborted');
    assert.equal(patch?.lushaSkippedReason, 'authorization_expired');
  });

  it('el rol almacenado dejó de estar autorizado ⇒ cierre sin Lusha', async () => {
    const h = continueHarness({
      run: legacyRun({ authorizedByRole: 'commercial_manager' }),
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls.length, 0);
    assert.equal(h.patches.at(-1)?.patch.lushaSkippedReason, 'role_not_allowed');
  });

  it('el kill switch del fallback Lusha apagado ⇒ 0 llamadas (este flag no lo sustituye)', async () => {
    const h = continueHarness({ lushaFallbackFlagEnabled: false });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls.length, 0);
    assert.equal(h.patches.at(-1)?.patch.lushaSkippedReason, 'feature_disabled');
  });
});

describe('WATERFALL-2 — supresión y DNC fail-closed en la ruta legacy', () => {
  it('supresión CONFIRMADA ⇒ terminal, 0 llamadas, motivo `suppressed`', async () => {
    const h = continueHarness({ suppression: 'blocked_suppressed' });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls.length, 0);
    const patch = h.patches.at(-1)?.patch;
    assert.equal(patch?.lushaSkippedReason, 'suppressed');
    assert.equal(patch?.status, 'aborted');
  });

  it('do_not_contact ⇒ terminal, 0 llamadas, motivo `dnc`', async () => {
    const h = continueHarness({ suppression: 'do_not_contact' });
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(h.lushaCalls.length, 0);
    assert.equal(h.patches.at(-1)?.patch.lushaSkippedReason, 'dnc');
  });

  it('comprobación NO DISPONIBLE ⇒ terminal, 0 llamadas, y NO se afirma que esté suprimido', async () => {
    const h = continueHarness({ suppression: 'check_unavailable' });
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(h.lushaCalls.length, 0);
    const patch = h.patches.at(-1)?.patch;
    // Los dos estados NO se colapsan: el efecto es el mismo, la afirmación no.
    assert.equal(patch?.lushaSkippedReason, 'suppression_check_unavailable');
    assert.notEqual(patch?.lushaSkippedReason, 'suppressed');
    assert.equal(patch?.errorCode, 'suppression_check_unavailable');
    // Costo de Lusha: null + unknown, nunca 0 (no se ejecutó).
    assert.equal(patch?.lushaCostCredits, null);
    assert.equal(patch?.lushaCostSource, 'unknown');
  });

  it('la comprobación se hace ANTES del claim (nunca se reclama para luego no llamar)', async () => {
    const order: string[] = [];
    const h = continueHarness({});
    const deps: ContinuePhoneRevealWaterfallDeps = {
      ...h.deps,
      checkSuppressionAndDoNotContact: async () => {
        order.push('suppression');
        return 'clear';
      },
      claimLushaAttempt: async () => {
        order.push('claim');
        return true;
      },
      callLushaLeg: async () => {
        order.push('lusha');
        return { status: 'revealed', creditsCharged: 5, errorCode: null };
      },
    };
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      deps,
    );
    assert.deepEqual(order, ['suppression', 'claim', 'lusha']);
  });
});

// ── 4. Costos ────────────────────────────────────────────────────────────────

describe('WATERFALL-2 — costos de la ruta legacy', () => {
  it('el tope legacy es 5: el de Lusha, NUNCA 13 ni 8', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, 5);
    assert.notEqual(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    );
    assert.notEqual(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
    );
  });

  it('la corrida legacy autoriza exactamente 5 y eso es lo que viaja a la pata Lusha', async () => {
    const { deps, drafts } = startDeps();
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      deps,
    );
    assert.equal(started.started === true && started.maxCreditsAuthorized, 5);
    assert.equal(drafts[0].maxCreditsAuthorized, 5);

    const h = continueHarness({});
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(h.lushaCalls[0].maxCreditsAuthorized, 5);
  });

  it('un costo NO reportado por Lusha se registra null + unknown, jamás 0', async () => {
    const h = continueHarness({
      lushaResult: { status: 'revealed', creditsCharged: null, errorCode: null },
    });
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    const patch = h.patches.at(-1)?.patch;
    assert.equal(patch?.lushaCostCredits, null);
    assert.equal(patch?.lushaCostSource, 'unknown');
    assert.notEqual(patch?.lushaCostCredits, 0);
  });

  it('un error de Lusha nunca declara un costo real (null + unknown)', async () => {
    const h = continueHarness({
      lushaResult: { status: 'error', creditsCharged: null, errorCode: 'provider_network_error' },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_error');
    const patch = h.patches.at(-1)?.patch;
    assert.equal(patch?.status, 'error');
    assert.equal(patch?.finalProvider, 'none');
    assert.equal(patch?.lushaCostCredits, null);
    assert.equal(patch?.lushaCostSource, 'unknown');
    // Sin reintento automático: la pata quedó reclamada y la corrida es terminal.
    assert.equal(h.lushaCalls.length, 1);
  });

  it('`no_phone_found` de Lusha: intentó pero NO reveló ⇒ final_provider none', async () => {
    const h = continueHarness({
      lushaResult: { status: 'no_phone_found', creditsCharged: 0, errorCode: null },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_no_phone_found');
    const patch = h.patches.at(-1)?.patch;
    assert.equal(patch?.status, 'exhausted');
    assert.equal(patch?.finalProvider, 'none');
    // 0 explícito SÍ es `reported`: el proveedor lo declaró.
    assert.equal(patch?.lushaCostCredits, 0);
    assert.equal(patch?.lushaCostSource, 'reported');
  });

  it('los costos de las dos patas viven en columnas SEPARADAS y no se suman', async () => {
    const h = continueHarness({
      lushaResult: { status: 'revealed', creditsCharged: 5, errorCode: null },
    });
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-legacy', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    const patch = h.patches.at(-1)?.patch ?? {};
    // Ninguna clave de "total": los créditos de Apollo y Lusha nunca se agregan.
    for (const key of Object.keys(patch)) {
      assert.equal(/total/i.test(key), false, key);
    }
    const run = legacyRun();
    // La fila legacy mantiene Apollo en null + unknown mientras Lusha reporta 5.
    assert.equal(run.apolloCostCredits, null);
    assert.equal(run.apolloCostSource, 'unknown');
    assert.equal(patch.lushaCostCredits, 5);
  });
});

// ── 5. run_mode: modalidad explícita ────────────────────────────────────────

describe('WATERFALL-2 — run_mode explícito, no inferido', () => {
  it('el vocabulario es exactamente las tres modalidades', () => {
    // `search_more` (AGENT2A-SEARCH-MORE-PHONES-1) NO es un reetiquetado de
    // `legacy_lusha_only`: la condición de entrada es la opuesta —esa exige que el
    // candidato NO tenga teléfono y `search_more` exige que SÍ lo tenga—, así que reusar el
    // valor haría que una auditoría de «¿se agotó Apollo?» respondiera al revés.
    assert.deepEqual([...PHONE_REVEAL_WATERFALL_RUN_MODES], [
      'full_waterfall',
      'legacy_lusha_only',
      'search_more',
    ]);
  });

  it('un valor desconocido o ausente cae a full_waterfall (nunca excusa a Apollo)', () => {
    for (const value of [undefined, null, '', '  ', 'legacy', 'LEGACY_LUSHA_ONLY', 42, {}]) {
      assert.equal(parsePhoneRevealWaterfallRunMode(value), 'full_waterfall', String(value));
    }
    assert.equal(parsePhoneRevealWaterfallRunMode(' legacy_lusha_only '), 'legacy_lusha_only');
  });

  it('la modalidad NO se deduce de apollo_attempted_at: son señales independientes', () => {
    // Una corrida legacy tiene apollo_attempted_at null Y run_mode legacy…
    const legacy = legacyRun();
    assert.equal(legacy.apolloAttemptedAt, null);
    assert.equal(legacy.runMode, 'legacy_lusha_only');

    // …pero una corrida FULL con el timestamp ausente sigue siendo full_waterfall, y
    // la vista de auditoría no la confunde con una legacy.
    const fullWithoutTimestamp = legacyRun({
      runMode: 'full_waterfall',
      apolloAttemptedAt: null,
    });
    const view = buildPhoneRevealWaterfallAuditView(fullWithoutTimestamp);
    assert.equal(view.runMode, 'full_waterfall');
    assert.equal(view.apolloAttempted, false);
  });

  it('la vista de auditoría expone la modalidad y los costos por pata sin mezclarlos', () => {
    const view = buildPhoneRevealWaterfallAuditView(
      legacyRun({
        status: 'completed_lusha',
        lushaAttemptedAt: NOW,
        lushaOutcome: 'revealed',
        lushaCostCredits: 5,
        lushaCostSource: 'reported',
        finalProvider: 'lusha',
        completedAt: NOW,
      }),
    );
    assert.equal(view.runMode, 'legacy_lusha_only');
    assert.equal(view.maxCreditsAuthorized, 5);
    assert.equal(view.apolloAttempted, false);
    assert.equal(view.apolloCostCredits, null);
    assert.equal(view.apolloCostSource, 'unknown');
    assert.equal(view.lushaCostCredits, 5);
    assert.equal(view.finalProvider, 'lusha');
  });

  it('la vista de auditoría sigue siendo PII-free (solo códigos, booleanos y conteos)', () => {
    const view = buildPhoneRevealWaterfallAuditView(legacyRun());
    const serialized = JSON.stringify(view);
    for (const forbidden of ['v1.token-opaco', 'cand-legacy', 'run-legacy-1', 'user-admin']) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
});
