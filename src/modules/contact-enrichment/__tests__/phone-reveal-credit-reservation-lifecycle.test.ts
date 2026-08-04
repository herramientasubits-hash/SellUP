// Tests — ciclo de vida de la reserva ATRAVESANDO el arranque del waterfall
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4E)
//
// El compañero `phone-reveal-credit-reservation-core.test.ts` fija la aritmética y la
// liquidación en aislamiento. Este archivo fija el ORDEN y la COMPENSACIÓN sobre el
// arranque real (`startPhoneRevealWaterfall` / `startLegacyPhoneRevealWaterfall`), que es
// donde el dinero se compromete:
//
//   1. se reserva ANTES de crear la corrida y ANTES de que cualquier proveedor pueda
//      correr — y si el gate de crédito bloquea, NO hay corrida;
//   2. la corrida nace ASOCIADA a la reserva (`creditReservationGroupId` en el INSERT);
//   3. si el INSERT falla o el índice único lo rechaza (23505), la reserva se LIBERA;
//   4. dos autorizaciones concurrentes no consumen la misma disponibilidad;
//   5. lo que 4E NO cambia: flag OFF y `commercial_manager` siguen exactamente igual —
//      sin resolver presupuesto, sin reservar y sin corrida.
//
// OFFLINE por construcción: la reserva se simula con la semántica de REFERENCIA del core
// puro. Sin red, sin DB, sin Apollo, sin Lusha, 0 créditos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  startLegacyPhoneRevealWaterfall,
  startPhoneRevealWaterfall,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallRunDraft,
  type StartLegacyPhoneRevealWaterfallDeps,
  type StartPhoneRevealWaterfallDeps,
} from '../phone-reveal-waterfall-core';
import {
  configuredPool,
  creditHarness,
  poolsWith,
  type CreditHarness,
} from './phone-reveal-credit-reservation-fixtures';

const NOW = '2026-08-04T12:00:00.000Z';
const ADMIN = { internalUserId: 'user-admin', roleKey: 'admin' };

function lushaCandidate(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'cand-1',
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
    hasPhone: false,
    phoneRevealStatus: null,
    ...overrides,
  };
}

function legacyEvidence(): PhoneRevealWaterfallLegacyEvidence {
  return {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-07-20T09:00:00.000Z',
    hasPhone: false,
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
  };
}

interface Harness {
  deps: StartPhoneRevealWaterfallDeps;
  drafts: PhoneRevealWaterfallRunDraft[];
  credit: CreditHarness;
  createCalls: number;
}

function fullHarness(opts: {
  credit?: CreditHarness;
  candidateId?: string;
  createReturns?: string | null;
  createThrows?: Error;
} = {}): Harness {
  const drafts: PhoneRevealWaterfallRunDraft[] = [];
  const credit = opts.credit ?? creditHarness();
  const harness: Harness = { drafts, credit, createCalls: 0, deps: undefined as never };
  harness.deps = {
    flagEnabled: true,
    actor: ADMIN,
    nowIso: NOW,
    loadCandidate: async () => lushaCandidate({ id: opts.candidateId ?? 'cand-1' }),
    findActiveRun: async () => null,
    ...credit.deps,
    createRun: async (draft) => {
      harness.createCalls += 1;
      if (opts.createThrows) throw opts.createThrows;
      drafts.push(draft);
      return opts.createReturns === undefined ? 'run-new' : opts.createReturns;
    },
  };
  return harness;
}

function legacyHarness(opts: {
  credit?: CreditHarness;
  candidateId?: string;
  createReturns?: string | null;
  createThrows?: Error;
} = {}): {
  deps: StartLegacyPhoneRevealWaterfallDeps;
  drafts: PhoneRevealWaterfallRunDraft[];
  credit: CreditHarness;
} {
  const drafts: PhoneRevealWaterfallRunDraft[] = [];
  const credit = opts.credit ?? creditHarness();
  return {
    drafts,
    credit,
    deps: {
      flagEnabled: true,
      actor: ADMIN,
      nowIso: NOW,
      loadLegacyEvidence: async () => legacyEvidence(),
      findActiveRun: async () => null,
      findLatestRun: async () => null,
      ...credit.deps,
      createRun: async (draft) => {
        if (opts.createThrows) throw opts.createThrows;
        drafts.push(draft);
        return opts.createReturns === undefined ? 'run-legacy' : opts.createReturns;
      },
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Orden: reservar ANTES de crear la corrida
// ═══════════════════════════════════════════════════════════════

describe('4E — la reserva precede a la corrida y a cualquier proveedor', () => {
  it('camino feliz: 1 reserva de Apollo 8 + Lusha 5, y LUEGO la corrida', async () => {
    const h = fullHarness({ credit: creditHarness({ groupIds: ['group-abc'] }) });
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);

    assert.equal(result.started, true);
    assert.equal(h.credit.reserveRequests.length, 1);
    assert.deepEqual(
      h.credit.reserveRequests[0].legs.map((l) => [l.providerKey, l.credits]),
      [
        ['apollo', 8],
        ['lusha', 5],
      ],
    );
    // La corrida se creó UNA vez y con la asociación dentro del INSERT.
    assert.equal(h.drafts.length, 1);
    assert.equal(h.drafts[0].creditReservationGroupId, 'group-abc');
    // Y nada se liberó: la exposición sigue ocupada mientras la corrida esté viva.
    assert.deepEqual(h.credit.releases, []);
  });

  it('la corrida NO se intenta crear si el crédito bloquea', async () => {
    for (const credit of [
      creditHarness({ poolsFor: poolsWith(5) }), // insuficiente
      creditHarness({
        poolsFor: (keys) =>
          keys.map((providerKey) => ({ providerKey, state: { kind: 'not_configured' } })),
      }),
      creditHarness({ outcome: { status: 'unavailable', detail: 'reserve_rpc_error' } }),
    ]) {
      const h = fullHarness({ credit });
      const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
      assert.equal(result.started, false);
      assert.equal(h.createCalls, 0, 'ningún INSERT emitido');
      assert.equal(h.drafts.length, 0);
    }
  });

  it('la RPC caída ⇒ credit_balance_unavailable (fail-closed), nunca "faltan créditos"', async () => {
    // Es el estado real de un entorno donde la migración 104 no está aplicada.
    const h = fullHarness({
      credit: creditHarness({ outcome: { status: 'unavailable', detail: 'reserve_rpc_error' } }),
    });
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'credit_balance_unavailable' });
  });

  it('la RPC responde already_reserved ⇒ active_run_exists (hay autorización viva)', async () => {
    const h = fullHarness({ credit: creditHarness({ outcome: { status: 'already_reserved' } }) });
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'active_run_exists' });
    assert.equal(h.createCalls, 0);
  });

  it('el legacy reserva SOLO Lusha 5 y asocia el grupo en su INSERT', async () => {
    const { deps, drafts, credit } = legacyHarness({
      credit: creditHarness({ groupIds: ['group-legacy'] }),
    });
    const result = await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-1' }, deps);
    assert.equal(result.started, true);
    assert.deepEqual(
      credit.reserveRequests[0].legs.map((l) => [l.providerKey, l.credits]),
      [['lusha', 5]],
    );
    assert.equal(drafts[0].creditReservationGroupId, 'group-legacy');
    assert.equal(drafts[0].maxCreditsAuthorized, 5);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Compensación: la reserva no puede quedar bloqueada
// ═══════════════════════════════════════════════════════════════

describe('4E — la exposición se libera cuando la corrida no llega a existir', () => {
  it('el INSERT lanza ⇒ release con `run_creation_failed` y el error se propaga', async () => {
    const boom = new Error('relation "public.phone_reveal_waterfall_runs" does not exist');
    const h = fullHarness({ createThrows: boom });

    await assert.rejects(
      () => startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps),
      /does not exist/,
    );
    assert.deepEqual(
      h.credit.releases.map((r) => r.reason),
      ['run_creation_failed'],
    );
    // Y la disponibilidad volvió al pozo: no queda exposición huérfana.
    assert.deepEqual(h.credit.active, []);
  });

  it('23505 (índice único) ⇒ create_conflict y release con `create_conflict`', async () => {
    const h = fullHarness({ createReturns: null });
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);

    assert.deepEqual(result, { started: false, reason: 'create_conflict' });
    assert.deepEqual(
      h.credit.releases.map((r) => r.reason),
      ['create_conflict'],
    );
    assert.deepEqual(h.credit.active, []);
  });

  it('se liberan TODAS las patas del grupo, no solo la primera', async () => {
    const h = fullHarness({ createReturns: null });
    await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
    assert.deepEqual(
      h.credit.releases[0].reservations.map((r) => r.providerKey),
      ['apollo', 'lusha'],
    );
  });

  it('legacy: los dos fallos de creación también liberan', async () => {
    const thrown = legacyHarness({ createThrows: new Error('timeout') });
    await assert.rejects(() =>
      startLegacyPhoneRevealWaterfall({ candidateId: 'cand-1' }, thrown.deps),
    );
    assert.deepEqual(
      thrown.credit.releases.map((r) => r.reason),
      ['run_creation_failed'],
    );

    const conflict = legacyHarness({ createReturns: null });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-1' },
      conflict.deps,
    );
    assert.equal(result.started === false && result.reason, 'create_conflict');
    assert.deepEqual(
      conflict.credit.releases.map((r) => r.reason),
      ['create_conflict'],
    );
  });

  it('tras liberar por conflicto, la disponibilidad queda utilizable otra vez', async () => {
    // Pozo justo para UNA autorización: si el conflicto no liberase, la siguiente
    // autorización legítima quedaría bloqueada para siempre.
    const credit = creditHarness({
      poolsFor: (keys) =>
        keys.map((providerKey) => ({
          providerKey,
          state: configuredPool(providerKey === 'apollo' ? 8 : 5),
        })),
      groupIds: ['group-1', 'group-2'],
    });

    const conflicted = fullHarness({ credit, createReturns: null });
    await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, conflicted.deps);

    const retried = fullHarness({ credit, candidateId: 'cand-2' });
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-2' }, retried.deps);
    assert.equal(result.started, true, 'la exposición liberada volvió a estar disponible');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Concurrencia sobre el arranque real
// ═══════════════════════════════════════════════════════════════

describe('4E — dos autorizaciones no consumen la misma disponibilidad', () => {
  it('dos waterfalls completos con 13 por pozo: solo el primero arranca', async () => {
    const credit = creditHarness({
      poolsFor: poolsWith(13),
      groupIds: ['group-a', 'group-b'],
    });
    const first = fullHarness({ credit, candidateId: 'cand-a' });
    const second = fullHarness({ credit, candidateId: 'cand-b' });

    const a = await startPhoneRevealWaterfall({ candidateId: 'cand-a' }, first.deps);
    const b = await startPhoneRevealWaterfall({ candidateId: 'cand-b' }, second.deps);

    assert.equal(a.started, true);
    assert.deepEqual(b, { started: false, reason: 'insufficient_credits' });
    assert.equal(second.createCalls, 0, 'el segundo no llegó a crear corrida');
  });

  it('dos legacy con 5 en el pozo de Lusha: solo el primero arranca', async () => {
    const credit = creditHarness({
      poolsFor: poolsWith(5),
      groupIds: ['group-a', 'group-b'],
    });
    const first = legacyHarness({ credit, candidateId: 'cand-a' });
    const second = legacyHarness({ credit, candidateId: 'cand-b' });

    const a = await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-a' }, first.deps);
    const b = await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-b' }, second.deps);

    assert.equal(a.started, true);
    assert.equal(b.started === false && b.reason, 'insufficient_credits');
    assert.equal(second.drafts.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Lo que 4E NO cambia
// ═══════════════════════════════════════════════════════════════

describe('4E — flag OFF y commercial_manager quedan exactamente igual', () => {
  it('flag OFF: 0 resoluciones de presupuesto, 0 reservas, 0 corridas', async () => {
    const h = fullHarness();
    h.deps = { ...h.deps, flagEnabled: false };
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'feature_disabled' });
    assert.equal(h.credit.poolQueries.length, 0);
    assert.equal(h.credit.reserveRequests.length, 0);
    assert.equal(h.createCalls, 0);
  });

  it('commercial_manager: rechazado por rol antes de tocar el presupuesto', async () => {
    const h = fullHarness();
    h.deps = {
      ...h.deps,
      actor: { internalUserId: 'user-cm', roleKey: 'commercial_manager' },
    };
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'role_not_allowed' });
    assert.equal(h.credit.poolQueries.length, 0, 'ni se resolvió presupuesto');
    assert.equal(h.credit.reserveRequests.length, 0, 'ni se reservó nada');
    assert.deepEqual(h.credit.releases, []);
  });

  it('una autorización viva preexistente no reserva nada nuevo', async () => {
    const h = fullHarness();
    h.deps = {
      ...h.deps,
      findActiveRun: async () => ({
        id: 'run-live',
        candidateId: 'cand-1',
        status: 'apollo_in_flight',
        runMode: 'full_waterfall',
        authorizedAt: NOW,
        authorizedBy: 'user-admin',
        authorizedByRole: 'admin',
        maxCreditsAuthorized: 13,
        apolloAttemptedAt: NOW,
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
        creditReservationGroupId: 'group-live',
      }),
    };
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1' }, h.deps);
    assert.deepEqual(result, { started: false, reason: 'active_run_exists' });
    assert.equal(h.credit.reserveRequests.length, 0);
  });
});
