// Tests for phone-reveal-waterfall-core.ts (Agente 2A · AGENT2A-PHONE-WATERFALL-1).
//
// Pure logic with injected deps: NO network, NO DB, NO real Apollo/Lusha calls,
// NO credits. Node.js built-in test runner.
//
// The invariants under test are the ones that cost money or leak privacy if they
// break: the Lusha leg runs AT MOST ONCE per authorization, never after the 24h
// TTL, never without a re-checked suppression/DNC, never for a candidate without
// its own Lusha contact id, and its cost is never merged with Apollo's.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneRevealWaterfallAuditView,
  continuePhoneRevealWaterfall,
  decidePhoneRevealWaterfallContinuation,
  evaluatePhoneRevealWaterfallLushaLeg,
  isPhoneRevealWaterfallAuthorizationExpired,
  isPhoneRevealWaterfallRoleAuthorized,
  mapApolloStartStatusToWaterfallPatch,
  mapLushaLegResultToWaterfallPatch,
  resolvePhoneRevealWaterfallCostSource,
  resolvePhoneRevealWaterfallMaxCredits,
  resolvePhoneRevealWaterfallSuppressionBlock,
  startPhoneRevealWaterfall,
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS,
  PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS,
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
  type ContinuePhoneRevealWaterfallDeps,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLushaLegResult,
  type PhoneRevealWaterfallRunDraft,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
  type PhoneRevealWaterfallSuppressionState,
} from '../phone-reveal-waterfall-core';
import { APOLLO_PHONE_REVEAL_CREDITS } from '../phone-reveal-core';
import { LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS } from '../lusha-phone-fallback-core';

const NOW_ISO = '2026-08-03T12:00:00.000Z';

function isoMinusHours(hours: number): string {
  return new Date(new Date(NOW_ISO).getTime() - hours * 3_600_000).toISOString();
}

function lushaCandidate(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'candidate-1',
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
    hasPhone: false,
    phoneRevealStatus: 'no_phone_found',
    ...overrides,
  };
}

function apolloCandidate(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return lushaCandidate({
    source: 'apollo',
    sourceContactId: '0123456789abcdef01234567',
    ...overrides,
  });
}

function activeRun(
  overrides: Partial<PhoneRevealWaterfallRunRecord> = {},
): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-1',
    candidateId: 'candidate-1',
    status: 'apollo_in_flight',
    authorizedAt: isoMinusHours(1),
    authorizedBy: 'user-admin',
    authorizedByRole: 'admin',
    maxCreditsAuthorized: PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
    apolloAttemptedAt: isoMinusHours(1),
    apolloOutcome: null,
    apolloCostCredits: null,
    apolloCostSource: null,
    lushaEligible: true,
    lushaSkippedReason: null,
    lushaAttemptedAt: null,
    lushaOutcome: null,
    lushaCostCredits: null,
    lushaCostSource: null,
    finalProvider: null,
    completedAt: null,
    errorCode: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Constantes: los topes que el operador ve deben ser los reales
// ═══════════════════════════════════════════════════════════════

describe('waterfall — constantes de costo y rol', () => {
  test('el tope Apollo del waterfall es el mismo que el del reveal Apollo', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS, APOLLO_PHONE_REVEAL_CREDITS);
    assert.equal(PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS, 8);
  });

  test('el tope Lusha del waterfall es el mismo que el del fallback manual', () => {
    assert.equal(
      PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
      LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS, 5);
  });

  test('el tope combinado es 13 = 8 + 5 (no un número inventado)', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA, 13);
    assert.equal(
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS + PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
    );
  });

  test('el waterfall completo es admin-only', () => {
    assert.deepEqual([...PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS], ['admin']);
    assert.equal(isPhoneRevealWaterfallRoleAuthorized('admin'), true);
    assert.equal(isPhoneRevealWaterfallRoleAuthorized('commercial_manager'), false);
    assert.equal(isPhoneRevealWaterfallRoleAuthorized(null), false);
  });

  test('el tope mostrado depende de si Lusha es una 2ª pata posible', () => {
    assert.equal(resolvePhoneRevealWaterfallMaxCredits(true), 13);
    assert.equal(resolvePhoneRevealWaterfallMaxCredits(false), 8);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Elegibilidad de la pata Lusha (id propio, nunca ajeno)
// ═══════════════════════════════════════════════════════════════

describe('waterfall — elegibilidad de la pata Lusha', () => {
  test('un candidato Lusha con id propio es elegible', () => {
    const result = evaluatePhoneRevealWaterfallLushaLeg(lushaCandidate());
    assert.equal(result.eligible, true);
    assert.equal(result.skippedReason, null);
  });

  test('un candidato Apollo NO reenvía su id a Lusha (espacios de id distintos)', () => {
    const result = evaluatePhoneRevealWaterfallLushaLeg(apolloCandidate());
    assert.equal(result.eligible, false);
    assert.equal(result.skippedReason, 'missing_lusha_contact_id');
  });

  test('un candidato Lusha sin id (o con id en blanco) no es elegible', () => {
    for (const sourceContactId of [null, '', '   ']) {
      const result = evaluatePhoneRevealWaterfallLushaLeg(
        lushaCandidate({ sourceContactId }),
      );
      assert.equal(result.eligible, false, `sourceContactId=${JSON.stringify(sourceContactId)}`);
      assert.equal(result.skippedReason, 'missing_lusha_contact_id');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Arranque de la corrida
// ═══════════════════════════════════════════════════════════════

interface StartHarness {
  created: PhoneRevealWaterfallRunDraft[];
  loadedCandidate: boolean;
  deps: Parameters<typeof startPhoneRevealWaterfall>[1];
}

function startHarness(opts: {
  flagEnabled?: boolean;
  roleKey?: string | null;
  candidate?: PhoneRevealWaterfallCandidateRecord | null;
  activeRun?: PhoneRevealWaterfallRunRecord | null;
  createReturns?: string | null;
} = {}): StartHarness {
  const created: PhoneRevealWaterfallRunDraft[] = [];
  const harness: StartHarness = {
    created,
    loadedCandidate: false,
    deps: {
      flagEnabled: opts.flagEnabled ?? true,
      actor: { internalUserId: 'user-admin', roleKey: opts.roleKey ?? 'admin' },
      nowIso: NOW_ISO,
      loadCandidate: async () => {
        harness.loadedCandidate = true;
        return opts.candidate === undefined ? lushaCandidate() : opts.candidate;
      },
      findActiveRun: async () => opts.activeRun ?? null,
      createRun: async (draft) => {
        created.push(draft);
        return opts.createReturns === undefined ? 'run-new' : opts.createReturns;
      },
    },
  };
  return harness;
}

describe('waterfall — arranque de la corrida', () => {
  test('flag OFF: no lee candidato y no crea corrida', async () => {
    const h = startHarness({ flagEnabled: false });
    const result = await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'feature_disabled' });
    assert.equal(h.loadedCandidate, false);
    assert.equal(h.created.length, 0);
  });

  test('commercial_manager: NO crea corrida (queda Apollo-only)', async () => {
    const h = startHarness({ roleKey: 'commercial_manager' });
    const result = await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'role_not_allowed' });
    assert.equal(h.loadedCandidate, false);
    assert.equal(h.created.length, 0);
  });

  test('admin con id Lusha: corrida con tope 13 y pata Lusha viva', async () => {
    const h = startHarness();
    const result = await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, h.deps);
    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 13);
    assert.equal(result.started && result.lushaEligible, true);
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].status, 'apollo_in_flight');
    assert.equal(h.created[0].maxCreditsAuthorized, 13);
    assert.equal(h.created[0].lushaEligible, true);
    assert.equal(h.created[0].lushaSkippedReason, null);
    assert.equal(h.created[0].authorizedByRole, 'admin');
  });

  test('admin sin id Lusha: corrida con tope 8 y motivo de omisión ya registrado', async () => {
    const h = startHarness({ candidate: apolloCandidate() });
    const result = await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, h.deps);
    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 8);
    assert.equal(result.started && result.lushaEligible, false);
    assert.equal(h.created[0].maxCreditsAuthorized, 8);
    assert.equal(h.created[0].lushaEligible, false);
    assert.equal(h.created[0].lushaSkippedReason, 'missing_lusha_contact_id');
  });

  test('ya hay una autorización viva: no se abre una segunda', async () => {
    const h = startHarness({ activeRun: activeRun() });
    const result = await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'active_run_exists' });
    assert.equal(h.created.length, 0);
  });

  test('el índice único parcial gana la carrera: create_conflict, sin corrida', async () => {
    const h = startHarness({ createReturns: null });
    const result = await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'create_conflict' });
  });

  test('candidato inexistente o id vacío: no crea corrida', async () => {
    const missing = startHarness({ candidate: null });
    assert.deepEqual(
      await startPhoneRevealWaterfall({ candidateId: 'candidate-1' }, missing.deps),
      { started: false, reason: 'candidate_not_found' },
    );
    const blank = startHarness();
    assert.deepEqual(await startPhoneRevealWaterfall({ candidateId: '  ' }, blank.deps), {
      started: false,
      reason: 'invalid_candidate',
    });
    assert.equal(blank.created.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Reconciliación del START de Apollo
// ═══════════════════════════════════════════════════════════════

describe('waterfall — reconciliación del START de Apollo', () => {
  test('`requested` deja la corrida en vuelo (no la toca)', () => {
    assert.equal(mapApolloStartStatusToWaterfallPatch('requested', NOW_ISO), null);
  });

  test('cache hit: cierra apollo, final apollo, Lusha omitida por apollo_revealed', () => {
    const patch = mapApolloStartStatusToWaterfallPatch('revealed_from_cache', NOW_ISO);
    assert.equal(patch?.status, 'completed_apollo');
    assert.equal(patch?.apolloOutcome, 'revealed_from_cache');
    assert.equal(patch?.finalProvider, 'apollo');
    assert.equal(patch?.lushaSkippedReason, 'apollo_revealed');
    // Un hit no cobra créditos nuevos y ESO sí está reportado.
    assert.equal(patch?.apolloCostCredits, 0);
    assert.equal(patch?.apolloCostSource, 'reported');
  });

  test('bloqueos de privacidad abortan sin gastar la 2ª pata', () => {
    const suppressed = mapApolloStartStatusToWaterfallPatch('blocked_suppressed', NOW_ISO);
    assert.equal(suppressed?.status, 'aborted');
    assert.equal(suppressed?.lushaSkippedReason, 'suppressed');
    assert.equal(suppressed?.finalProvider, 'none');

    const dnc = mapApolloStartStatusToWaterfallPatch('do_not_contact', NOW_ISO);
    assert.equal(dnc?.status, 'aborted');
    assert.equal(dnc?.lushaSkippedReason, 'dnc');
  });

  test('supresión no verificable: fail-closed, se lee como suprimida', () => {
    const patch = mapApolloStartStatusToWaterfallPatch(
      'suppression_check_unavailable',
      NOW_ISO,
    );
    assert.equal(patch?.status, 'error');
    assert.equal(patch?.lushaSkippedReason, 'suppressed');
    assert.equal(patch?.errorCode, 'suppression_check_unavailable');
  });

  test('cualquier gate desconocido aborta registrando el código (nunca queda activa)', () => {
    for (const status of ['already_pending', 'unauthorized_role', 'error', 'lo-que-sea']) {
      const patch = mapApolloStartStatusToWaterfallPatch(status, NOW_ISO);
      assert.equal(patch?.status, 'aborted', status);
      assert.equal(patch?.errorCode, status, status);
      assert.equal(patch?.finalProvider, 'none', status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Decisión de continuación (pura)
// ═══════════════════════════════════════════════════════════════

function decide(overrides: {
  flagEnabled?: boolean;
  lushaFallbackFlagEnabled?: boolean;
  run?: PhoneRevealWaterfallRunRecord | null;
  apolloOutcome?: Parameters<typeof decidePhoneRevealWaterfallContinuation>[0]['apolloOutcome'];
  candidate?: PhoneRevealWaterfallCandidateRecord | null;
} = {}) {
  return decidePhoneRevealWaterfallContinuation({
    flagEnabled: overrides.flagEnabled ?? true,
    lushaFallbackFlagEnabled: overrides.lushaFallbackFlagEnabled ?? true,
    nowIso: NOW_ISO,
    run: overrides.run === undefined ? activeRun() : overrides.run,
    apolloOutcome: overrides.apolloOutcome ?? 'no_phone_found',
    candidate: overrides.candidate === undefined ? lushaCandidate() : overrides.candidate,
  });
}

describe('waterfall — decisión de continuación', () => {
  test('el camino feliz llega a la re-comprobación de supresión', () => {
    assert.deepEqual(decide(), { action: 'check_suppression' });
  });

  test('flag OFF / sin corrida / corrida terminal: noop sin escribir', () => {
    assert.equal(decide({ flagEnabled: false }).action, 'noop');
    assert.equal(decide({ run: null }).action, 'noop');
    const terminal = decide({ run: activeRun({ status: 'completed_apollo' }) });
    assert.equal(terminal.action, 'noop');
    assert.equal(terminal.action === 'noop' && terminal.reason, 'run_already_terminal');
  });

  test('IDEMPOTENCIA: si la pata Lusha ya está reclamada, noop', () => {
    const decision = decide({ run: activeRun({ lushaAttemptedAt: isoMinusHours(0.1) }) });
    assert.equal(decision.action, 'noop');
    assert.equal(decision.action === 'noop' && decision.reason, 'lusha_already_attempted');
  });

  test('rol almacenado no autorizado: cierra sin llamar a Lusha', () => {
    const decision = decide({ run: activeRun({ authorizedByRole: 'commercial_manager' }) });
    assert.equal(decision.action, 'close');
    assert.equal(
      decision.action === 'close' && decision.patch.lushaSkippedReason,
      'role_not_allowed',
    );
  });

  test('Apollo reveló (fresco o de caché): final apollo, Lusha nunca', () => {
    for (const outcome of ['revealed', 'revealed_from_cache'] as const) {
      const decision = decide({ apolloOutcome: outcome });
      assert.equal(decision.action, 'close', outcome);
      assert.equal(decision.action === 'close' && decision.patch.status, 'completed_apollo');
      assert.equal(decision.action === 'close' && decision.patch.finalProvider, 'apollo');
      assert.equal(
        decision.action === 'close' && decision.patch.lushaSkippedReason,
        'apollo_revealed',
      );
    }
  });

  test('bloqueos de privacidad de Apollo cierran la corrida', () => {
    const suppressed = decide({ apolloOutcome: 'blocked_suppressed' });
    assert.equal(suppressed.action === 'close' && suppressed.patch.status, 'aborted');
    const dnc = decide({ apolloOutcome: 'do_not_contact' });
    assert.equal(dnc.action === 'close' && dnc.patch.lushaSkippedReason, 'dnc');
    const unverifiable = decide({ apolloOutcome: 'suppression_check_unavailable' });
    assert.equal(unverifiable.action === 'close' && unverifiable.patch.status, 'error');
    assert.equal(
      unverifiable.action === 'close' && unverifiable.patch.lushaSkippedReason,
      'suppressed',
    );
  });

  test('errores de Apollo cierran como error, nunca como "sin teléfono"', () => {
    const err = decide({ apolloOutcome: 'error' });
    assert.equal(err.action === 'close' && err.patch.status, 'error');
    assert.equal(err.action === 'close' && err.patch.errorCode, 'apollo_reveal_error');
    const cache = decide({ apolloOutcome: 'cache_unavailable' });
    assert.equal(cache.action === 'close' && cache.patch.errorCode, 'cache_unavailable');
  });

  test('TTL vencido (> 24 h): aborta, sin llamar a Lusha', () => {
    const decision = decide({
      run: activeRun({
        authorizedAt: isoMinusHours(PHONE_REVEAL_WATERFALL_AUTHORIZATION_TTL_HOURS + 1),
      }),
    });
    assert.equal(decision.action, 'close');
    assert.equal(decision.action === 'close' && decision.patch.status, 'aborted');
    assert.equal(
      decision.action === 'close' && decision.patch.lushaSkippedReason,
      'authorization_expired',
    );
    assert.equal(
      decision.action === 'close' && decision.patch.errorCode,
      'authorization_expired',
    );
  });

  test('sin id Lusha propio: exhausted, final none, 0 llamadas', () => {
    const decision = decide({ candidate: apolloCandidate() });
    assert.equal(decision.action, 'close');
    assert.equal(decision.action === 'close' && decision.patch.status, 'exhausted');
    assert.equal(decision.action === 'close' && decision.patch.finalProvider, 'none');
    assert.equal(
      decision.action === 'close' && decision.patch.lushaSkippedReason,
      'missing_lusha_contact_id',
    );
  });

  test('el flag del fallback Lusha sigue siendo el kill switch real', () => {
    const decision = decide({ lushaFallbackFlagEnabled: false });
    assert.equal(decision.action, 'close');
    assert.equal(decision.action === 'close' && decision.patch.status, 'exhausted');
    assert.equal(
      decision.action === 'close' && decision.patch.lushaSkippedReason,
      'feature_disabled',
    );
  });

  test('si ya apareció un teléfono, no se gasta la 2ª pata', () => {
    const decision = decide({ candidate: lushaCandidate({ hasPhone: true }) });
    assert.equal(decision.action, 'close');
    assert.equal(decision.action === 'close' && decision.patch.lushaSkippedReason, 'not_needed');
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Supresión / DNC antes de la pata Lusha
// ═══════════════════════════════════════════════════════════════

describe('waterfall — re-comprobación de supresión/DNC', () => {
  test('clear deja pasar', () => {
    assert.equal(resolvePhoneRevealWaterfallSuppressionBlock('clear', NOW_ISO), null);
  });

  test('tombstone y DNC abortan con su motivo propio', () => {
    const suppressed = resolvePhoneRevealWaterfallSuppressionBlock(
      'blocked_suppressed',
      NOW_ISO,
    );
    assert.equal(suppressed?.status, 'aborted');
    assert.equal(suppressed?.lushaSkippedReason, 'suppressed');
    const dnc = resolvePhoneRevealWaterfallSuppressionBlock('do_not_contact', NOW_ISO);
    assert.equal(dnc?.status, 'aborted');
    assert.equal(dnc?.lushaSkippedReason, 'dnc');
  });

  test('FAIL-CLOSED: no verificable bloquea igual que un tombstone', () => {
    const patch = resolvePhoneRevealWaterfallSuppressionBlock('check_unavailable', NOW_ISO);
    assert.notEqual(patch, null);
    assert.equal(patch?.status, 'error');
    assert.equal(patch?.errorCode, 'suppression_check_unavailable');
    assert.equal(patch?.finalProvider, 'none');
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Costos: nunca 0 por omisión, nunca sumados
// ═══════════════════════════════════════════════════════════════

describe('waterfall — costos', () => {
  test('un costo ausente es `unknown`, NUNCA 0', () => {
    assert.equal(resolvePhoneRevealWaterfallCostSource(null), 'unknown');
    assert.equal(resolvePhoneRevealWaterfallCostSource(undefined), 'unknown');
    assert.equal(resolvePhoneRevealWaterfallCostSource(Number.NaN), 'unknown');
    // 0 EXPLÍCITO sí es un dato reportado (p.ej. un cache hit).
    assert.equal(resolvePhoneRevealWaterfallCostSource(0), 'reported');
    assert.equal(resolvePhoneRevealWaterfallCostSource(5), 'reported');
  });

  test('el resultado Lusha solo escribe columnas de Lusha (jamás las de Apollo)', () => {
    const patch = mapLushaLegResultToWaterfallPatch(
      { status: 'revealed', creditsCharged: 5, errorCode: null },
      NOW_ISO,
    );
    assert.equal(patch.status, 'completed_lusha');
    assert.equal(patch.lushaOutcome, 'revealed');
    assert.equal(patch.lushaCostCredits, 5);
    assert.equal(patch.lushaCostSource, 'reported');
    assert.equal(patch.finalProvider, 'lusha');
    assert.equal('apolloCostCredits' in patch, false);
    assert.equal('apolloCostSource' in patch, false);
  });

  test('Lusha sin teléfono: exhausted y final NONE (intentó, no reveló)', () => {
    const patch = mapLushaLegResultToWaterfallPatch(
      { status: 'no_phone_found', creditsCharged: 0, errorCode: null },
      NOW_ISO,
    );
    assert.equal(patch.status, 'exhausted');
    assert.equal(patch.lushaOutcome, 'no_phone_found');
    assert.equal(patch.finalProvider, 'none');
  });

  test('Lusha en error: costo desconocido (null + unknown), nunca 0, final none', () => {
    for (const errorCode of [
      'provider_quota_exceeded',
      'provider_permission_error',
      'provider_rate_limited',
      'provider_server_error',
      'provider_network_error',
    ]) {
      const patch = mapLushaLegResultToWaterfallPatch(
        { status: 'error', creditsCharged: 99, errorCode },
        NOW_ISO,
      );
      assert.equal(patch.status, 'error', errorCode);
      assert.equal(patch.lushaOutcome, 'error', errorCode);
      assert.equal(patch.lushaCostCredits, null, errorCode);
      assert.equal(patch.lushaCostSource, 'unknown', errorCode);
      assert.equal(patch.finalProvider, 'none', errorCode);
      assert.equal(patch.errorCode, errorCode, errorCode);
    }
  });

  test('un status Lusha desconocido se trata como error', () => {
    const patch = mapLushaLegResultToWaterfallPatch(
      { status: 'feature_disabled', creditsCharged: null, errorCode: null },
      NOW_ISO,
    );
    assert.equal(patch.status, 'error');
    assert.equal(patch.errorCode, 'lusha_reveal_error');
    assert.equal(patch.finalProvider, 'none');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. TTL
// ═══════════════════════════════════════════════════════════════

describe('waterfall — TTL de la autorización', () => {
  test('dentro de 24 h no está vencida; pasadas 24 h sí', () => {
    assert.equal(isPhoneRevealWaterfallAuthorizationExpired(isoMinusHours(1), NOW_ISO), false);
    assert.equal(isPhoneRevealWaterfallAuthorizationExpired(isoMinusHours(23.9), NOW_ISO), false);
    assert.equal(isPhoneRevealWaterfallAuthorizationExpired(isoMinusHours(24.1), NOW_ISO), true);
    assert.equal(isPhoneRevealWaterfallAuthorizationExpired(isoMinusHours(72), NOW_ISO), true);
  });

  test('una fecha ilegible se trata como vencida (fail-closed)', () => {
    assert.equal(isPhoneRevealWaterfallAuthorizationExpired('no-es-fecha', NOW_ISO), true);
    assert.equal(isPhoneRevealWaterfallAuthorizationExpired(isoMinusHours(1), 'nope'), true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Continuación completa (claim atómico + una sola llamada)
// ═══════════════════════════════════════════════════════════════

interface ContinueHarness {
  deps: ContinuePhoneRevealWaterfallDeps;
  updates: Array<{ runId: string; patch: PhoneRevealWaterfallRunPatch }>;
  lushaCalls: number;
  claimAttempts: number;
  suppressionChecks: number;
}

function continueHarness(opts: {
  flagEnabled?: boolean;
  lushaFallbackFlagEnabled?: boolean;
  run?: PhoneRevealWaterfallRunRecord | null;
  candidate?: PhoneRevealWaterfallCandidateRecord | null;
  suppression?: PhoneRevealWaterfallSuppressionState;
  /** La comprobación LANZA (tabla ausente, timeout): debe leerse fail-closed. */
  suppressionThrows?: boolean;
  claimSucceeds?: boolean;
  legResult?: PhoneRevealWaterfallLushaLegResult;
  legThrows?: boolean;
} = {}): ContinueHarness {
  const updates: Array<{ runId: string; patch: PhoneRevealWaterfallRunPatch }> = [];
  // `claimedOnce` simula el UPDATE condicional real: el primer claim gana y
  // cualquier claim posterior sobre la misma corrida actualiza 0 filas.
  let claimedOnce = false;
  const harness: ContinueHarness = {
    updates,
    lushaCalls: 0,
    claimAttempts: 0,
    suppressionChecks: 0,
    deps: {
      flagEnabled: opts.flagEnabled ?? true,
      lushaFallbackFlagEnabled: opts.lushaFallbackFlagEnabled ?? true,
      nowIso: NOW_ISO,
      findActiveRun: async () => (opts.run === undefined ? activeRun() : opts.run),
      loadCandidate: async () =>
        opts.candidate === undefined ? lushaCandidate() : opts.candidate,
      updateRun: async (runId, patch) => {
        updates.push({ runId, patch });
      },
      checkSuppressionAndDoNotContact: async () => {
        harness.suppressionChecks += 1;
        if (opts.suppressionThrows) {
          throw new Error('tabla ausente con detalle del driver');
        }
        return opts.suppression ?? 'clear';
      },
      claimLushaAttempt: async () => {
        harness.claimAttempts += 1;
        if (opts.claimSucceeds === false) return false;
        if (claimedOnce) return false;
        claimedOnce = true;
        return true;
      },
      callLushaLeg: async () => {
        harness.lushaCalls += 1;
        if (opts.legThrows) throw new Error('boom con detalle sensible');
        return (
          opts.legResult ?? { status: 'revealed', creditsCharged: 5, errorCode: null }
        );
      },
    },
  };
  return harness;
}

describe('waterfall — continuación con claim atómico', () => {
  test('Apollo sin teléfono + id Lusha: UNA llamada a Lusha, corrida completed_lusha', async () => {
    const h = continueHarness();
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_revealed');
    assert.equal(result.lushaCalled, true);
    assert.equal(h.lushaCalls, 1);
    assert.equal(h.suppressionChecks, 1);
    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0].patch.status, 'completed_lusha');
    assert.equal(h.updates[0].patch.finalProvider, 'lusha');
    assert.equal(h.updates[0].patch.lushaCostCredits, 5);
  });

  test('Apollo reveló: 0 llamadas a Lusha y 0 comprobaciones de supresión', async () => {
    const h = continueHarness();
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'revealed', apolloCostCredits: 8 },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.claimAttempts, 0);
    assert.equal(h.suppressionChecks, 0);
    assert.equal(h.updates[0].patch.finalProvider, 'apollo');
    // El costo de Apollo se sella en SU columna.
    assert.equal(h.updates[0].patch.apolloCostCredits, 8);
    assert.equal(h.updates[0].patch.apolloCostSource, 'reported');
  });

  test('sin id Lusha: exhausted con 0 llamadas y sin tocar supresión', async () => {
    const h = continueHarness({ candidate: apolloCandidate() });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.suppressionChecks, 0);
    assert.equal(h.updates[0].patch.status, 'exhausted');
    assert.equal(h.updates[0].patch.lushaSkippedReason, 'missing_lusha_contact_id');
  });

  test('DOS disparadores sobre la MISMA corrida ⇒ UNA sola llamada a Lusha', async () => {
    // Un único harness = una única corrida: el segundo claim actualiza 0 filas,
    // exactamente como el UPDATE condicional real (webhook vs cron vs L3 manual).
    const h = continueHarness();
    const input = {
      candidateId: 'candidate-1',
      apolloOutcome: 'no_phone_found' as const,
      apolloCostCredits: null,
    };
    const first = await continuePhoneRevealWaterfall(input, h.deps);
    const second = await continuePhoneRevealWaterfall(input, h.deps);
    assert.equal(first.lushaCalled, true);
    assert.equal(second.lushaCalled, false);
    assert.equal(second.outcome, 'lusha_claim_lost');
    assert.equal(h.lushaCalls, 1, 'Lusha debe llamarse EXACTAMENTE una vez');
  });

  test('claim perdido: no llama a Lusha y no escribe la corrida', async () => {
    const h = continueHarness({ claimSucceeds: false });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_claim_lost');
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.updates.length, 0);
  });

  test('supresión que LANZA se trata como no verificable: 0 llamadas', async () => {
    const h = continueHarness({ suppressionThrows: true });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.claimAttempts, 0);
    assert.equal(h.updates[0].patch.errorCode, 'suppression_check_unavailable');
  });

  test('tombstone registrado entre el START y el webhook: 0 llamadas a Lusha', async () => {
    const h = continueHarness({ suppression: 'blocked_suppressed' });
    await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.claimAttempts, 0);
    assert.equal(h.updates[0].patch.status, 'aborted');
    assert.equal(h.updates[0].patch.lushaSkippedReason, 'suppressed');
  });

  test('TTL vencido: 0 llamadas, corrida abortada', async () => {
    const h = continueHarness({
      run: activeRun({ authorizedAt: isoMinusHours(30) }),
    });
    await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.claimAttempts, 0);
    assert.equal(h.updates[0].patch.lushaSkippedReason, 'authorization_expired');
  });

  test('la pata Lusha que LANZA no se reintenta: se cierra como error sin costo', async () => {
    const h = continueHarness({ legThrows: true });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_error');
    assert.equal(h.lushaCalls, 1, 'sin retry automático');
    assert.equal(h.updates[0].patch.status, 'error');
    assert.equal(h.updates[0].patch.lushaCostCredits, null);
    assert.equal(h.updates[0].patch.lushaCostSource, 'unknown');
    // El mensaje crudo de la excepción NUNCA viaja al patch.
    assert.equal(h.updates[0].patch.errorCode, 'lusha_leg_threw');
  });

  test('Lusha sin teléfono: exhausted, y el candidato NO queda con provider lusha', async () => {
    const h = continueHarness({
      legResult: { status: 'no_phone_found', creditsCharged: 0, errorCode: null },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_no_phone_found');
    assert.equal(h.updates[0].patch.status, 'exhausted');
    assert.equal(h.updates[0].patch.finalProvider, 'none');
  });

  test('flag OFF: no lee corrida, no escribe, no llama', async () => {
    const h = continueHarness({ flagEnabled: false });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'noop');
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.updates.length, 0);
  });

  test('sin corrida activa: noop sin escribir (idempotente)', async () => {
    const h = continueHarness({ run: null });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'noop');
    assert.equal(result.reason, 'no_active_run');
    assert.equal(h.updates.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Vista de auditoría (PII-free)
// ═══════════════════════════════════════════════════════════════

describe('waterfall — vista de auditoría', () => {
  test('expone por proveedor y no filtra ids ni datos personales', () => {
    const view = buildPhoneRevealWaterfallAuditView(
      activeRun({
        status: 'completed_lusha',
        apolloOutcome: 'no_phone_found',
        apolloCostCredits: 0,
        apolloCostSource: 'reported',
        lushaAttemptedAt: isoMinusHours(0.1),
        lushaOutcome: 'revealed',
        lushaCostCredits: 5,
        lushaCostSource: 'reported',
        finalProvider: 'lusha',
      }),
    );
    assert.equal(view.isTerminal, true);
    assert.equal(view.apolloAttempted, true);
    assert.equal(view.lushaAttempted, true);
    assert.equal(view.finalProvider, 'lusha');
    assert.equal(view.maxCreditsAuthorized, 13);
    // Los costos viajan SEPARADOS: no hay campo de total mezclado.
    assert.equal(view.apolloCostCredits, 0);
    assert.equal(view.lushaCostCredits, 5);
    const keys = Object.keys(view);
    for (const forbidden of [
      'runId',
      'id',
      'candidateId',
      'authorizedBy',
      'phone',
      'email',
      'totalCostCredits',
    ]) {
      assert.equal(keys.includes(forbidden), false, `no debe exponer ${forbidden}`);
    }
  });

  test('una corrida en vuelo se marca como NO terminal (bloquea aprobar)', () => {
    for (const status of ['authorized', 'apollo_in_flight', 'lusha_pending', 'lusha_running'] as const) {
      const view = buildPhoneRevealWaterfallAuditView(activeRun({ status }));
      assert.equal(view.isTerminal, false, status);
    }
    for (const status of ['completed_apollo', 'completed_lusha', 'exhausted', 'error', 'aborted'] as const) {
      const view = buildPhoneRevealWaterfallAuditView(activeRun({ status }));
      assert.equal(view.isTerminal, true, status);
    }
  });
});
