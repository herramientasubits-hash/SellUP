/**
 * legacy-lusha-start-rejection-diagnostic.test.ts
 * (Agente 2A · AGENT2A-LEGACY-LUSHA-START-REJECTION-DIAGNOSTIC-1)
 *
 * QUÉ FIJA ESTA SUITE
 *
 * El incidente: un candidato legacy que la vista previa declara ELEGIBLE con tope 6
 * («Buscar teléfono con Lusha») es rechazado al hacer clic, y el operador lee una sola
 * frase — «Este candidato ya no puede autorizarse por esta vía» — mientras la base de
 * datos queda EXACTAMENTE igual: 0 corridas, 0 reservas, 0 identidades, 0 usage-logs.
 *
 * Esa frase es una afirmación sobre el CANDIDATO, y detrás de ella se colapsaban motivos
 * incompatibles entre sí: el flag apagado, un rol sin permiso, una restricción de
 * privacidad, una autorización ya viva, datos insuficientes para identificar a la
 * persona en Lusha y —el peor caso— una LECTURA QUE FALLÓ, donde el candidato es
 * perfectamente elegible y lo roto es la infraestructura. Con un único desenlace
 * observable para causas distintas, un rechazo en Producción es indiagnosticable.
 *
 * Lo que esta suite fija:
 *
 *   1. PARIDAD — con los MISMOS hechos durables, la vista previa y el ARRANQUE no
 *      pueden discrepar en elegibilidad ni en modalidad. Comparten evaluador puro y
 *      comparten lectura;
 *   2. TAXONOMÍA VERAZ — ningún motivo mecánico conocido se traduce a `not_eligible`.
 *      Cada bloqueo dice lo que de verdad pasó;
 *   3. CERO GASTO en todos los rechazos: 0 corridas, 0 reservas, 0 llamadas a Lusha y
 *      0 llamadas a Apollo — que en esta ruta no existen ni como dep;
 *   4. PRIVACIDAD fail-closed y ANTES de reservar, con supresión confirmada y
 *      verificación no disponible registradas DISTINTO: el efecto es el mismo, la
 *      afirmación no;
 *   5. OBSERVABILIDAD PII-FREE: el evento del arranque no puede contener nombre,
 *      correo, LinkedIn, teléfono ni id nativo de proveedor.
 *
 * OFFLINE por construcción: sin red, sin base de datos, sin Apollo, sin Lusha y sin un
 * solo crédito. Todas las deps son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLegacyPhoneRevealAuthorizationPreview,
  startLegacyPhoneRevealWaterfall,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallLegacyIneligibleReason,
  type PhoneRevealWaterfallRunRecord,
  type PhoneRevealWaterfallSuppressionState,
  type StartLegacyPhoneRevealWaterfallDeps,
} from '../phone-reveal-waterfall-core';
import {
  buildLegacyPhoneRevealStartEvent,
  classifyLegacyPhoneRevealStartFailure,
  LEGACY_START_EXCEPTION_REASON,
  type LegacyPhoneRevealWaterfallActionStatus,
} from '../phone-reveal-waterfall-legacy-start-gate';
import type { LushaIdentitySearchCandidateFacts } from '../lusha-identity-search-core';
import {
  creditHarness,
  type CreditHarness,
} from './phone-reveal-credit-reservation-fixtures';

// ── Fixtures: los hechos durables REALES del candidato del incidente ─────────

const NOW = '2026-08-24T12:00:00.000Z';
const CANDIDATE_ID = 'cand-luis';

/**
 * Hechos observados en Producción, uno a uno:
 *
 *   status = pending_review        (editable)
 *   source = apollo                (nacido en Apollo, NO en Lusha)
 *   source_contact_id presente     (id de APOLLO — nunca reutilizable en Lusha)
 *   phone = null                   (no hay teléfono)
 *   phone_reveal_status = no_phone_found
 *   phone_reveal_provider = apollo
 *   phone_reveal_completed_at presente
 *   LinkedIn presente, email ausente
 *   sin identidad Lusha persistida (migración 124: 0 filas para este candidato)
 *
 * De ahí sale la modalidad: Lusha NO sabe quién es esta persona, pero hay con qué
 * averiguarlo (LinkedIn exacto) ⇒ hay que COMPRAR la identidad ⇒ tope 6.
 */
const LUIS_FACTS: LushaIdentitySearchCandidateFacts = {
  firstName: 'Luis',
  lastName: 'Jacome Gaona',
  linkedinUrl: 'https://www.linkedin.com/in/luis-jacome-gaona',
  email: null,
  companyName: 'Empresa Demo',
  companyDomain: 'empresademo.test',
};

const APOLLO_PERSON_ID = '6633076e37001b0007d086ce';

function luisEvidence(
  overrides: Partial<PhoneRevealWaterfallLegacyEvidence> = {},
): PhoneRevealWaterfallLegacyEvidence {
  return {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-08-20T15:04:00.000Z',
    hasPhone: false,
    source: 'apollo',
    sourceContactId: APOLLO_PERSON_ID,
    providerIdentities: [],
    identitySearchFacts: LUIS_FACTS,
    ...overrides,
  };
}

function liveRun(): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-vivo',
    candidateId: CANDIDATE_ID,
    status: 'lusha_pending',
    runMode: 'legacy_lusha_only',
    authorizedAt: NOW,
    authorizedBy: 'user-admin',
    authorizedByRole: 'admin',
    maxCreditsAuthorized: PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
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
    creditReservationGroupId: 'group-vivo',
  };
}

/**
 * Deps del ARRANQUE legacy con el cableado REAL de la ruta automática: flag encendido,
 * actor con permiso de revelar, vía de pago habilitada y puerta de privacidad ANTES de
 * reservar. No existe ninguna dep de Apollo, y eso es parte del contrato: esta ruta no
 * tiene forma de llamarlo aunque quisiera.
 */
function startDeps(overrides: Partial<StartLegacyPhoneRevealWaterfallDeps> = {}): {
  deps: StartLegacyPhoneRevealWaterfallDeps;
  credit: CreditHarness;
} {
  const credit = creditHarness();
  return {
    credit,
    deps: {
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
    },
  };
}

/** La vista previa que el drawer enseñó: elegible, exige búsqueda, tope 6. */
function preview() {
  return buildLegacyPhoneRevealAuthorizationPreview(luisEvidence(), {
    identitySearchAuthorized: true,
  });
}

/** Cero efectos económicos: ni corrida escrita, ni reserva viva, ni pata reservada. */
function assertZeroSpend(credit: CreditHarness, label: string) {
  assert.equal(credit.createdRuns.length, 0, `${label}: 0 corridas escritas`);
  assert.equal(credit.active.length, 0, `${label}: 0 reservas vivas`);
}

// ═══════════════════════════════════════════════════════════════
// A · § 5 — la regresión de Luis: preview 6 ⇒ start 6 arranca
// ═══════════════════════════════════════════════════════════════

describe('A — regresión Luis: la vista previa dice 6 y el ARRANQUE con 6 arranca', () => {
  it('la vista previa es elegible, exige búsqueda de identidad y su tope es 6', () => {
    const p = preview();
    assert.equal(p.eligible, true);
    assert.equal(p.reason, null);
    assert.equal(p.requiresIdentitySearch, true);
    assert.equal(
      p.maxCredits,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
    );
    assert.equal(p.maxCredits, 6);
  });

  it('el ARRANQUE aceptando 6 crea UNA corrida con tope 6 y modalidad de búsqueda', async () => {
    const { deps, credit } = startDeps();
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
      deps,
    );

    assert.equal(started.started, true);
    if (!started.started) return;
    assert.equal(started.maxCreditsAuthorized, 6);
    assert.equal(started.requiresIdentitySearch, true);
    assert.equal(credit.createdRuns.length, 1, 'UNA corrida, no dos');
    assert.equal(credit.createdDrafts[0].runMode, 'legacy_lusha_only');
    // Los 8 de Apollo NUNCA entran: ese gasto lo pagó la autorización histórica.
    assert.notEqual(started.maxCreditsAuthorized, 13);
    assert.notEqual(started.maxCreditsAuthorized, 14);
  });

  it('el arranque NO consulta el pozo de Apollo: bajo esta autorización no se ejecuta', async () => {
    const { deps, credit } = startDeps();
    await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
      deps,
    );
    for (const query of credit.poolQueries) {
      assert.ok(!query.includes('apollo'), 'Apollo no aparece en ningún pozo consultado');
    }
    const legs = credit.reserveRequests[0]?.legs ?? [];
    assert.deepEqual(
      legs.map((leg) => `${leg.providerKey}:${leg.operationKey}`),
      ['lusha:contact_search', 'lusha:phone_reveal'],
      'búsqueda hasta 1 + teléfono hasta 5, ambas de Lusha',
    );
  });

  it('el diagnóstico del éxito describe lo observado, sin nulls que oculten la decisión', async () => {
    const { deps } = startDeps();
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
      deps,
    );
    assert.deepEqual(started.diagnostics, {
      outerFlagEnabled: true,
      roleAuthorized: true,
      identitySearchAllowed: true,
      requiresIdentitySearch: true,
      privacyState: 'clear',
      activeRunFound: false,
      historyClassification: 'no_previous_run',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// B · § 12 — preview 6 / start 5 ⇒ techo humano, 0 gasto
// ═══════════════════════════════════════════════════════════════

describe('B — aceptar 5 sobre una modalidad de 6 corta sin gastar', () => {
  it('devuelve `authorization_ceiling_mismatch` con los DOS enteros y 0 escrituras', async () => {
    const { deps, credit } = startDeps();
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 5 },
      deps,
    );

    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'authorization_ceiling_mismatch');
    assert.equal(started.requiredMaxCredits, 6);
    assert.equal(started.acceptedMaxCredits, 5);
    assert.equal(credit.poolQueries.length, 0, 'ni siquiera se lee el presupuesto');
    assertZeroSpend(credit, 'techo');
  });

  it('el operador lee «la autorización cambió», nunca «el candidato no aplica»', () => {
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('authorization_ceiling_mismatch'),
      'authorization_changed',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// C/D/E · § 7 — privacidad: fail-closed, ANTES de reservar, y veraz
// ═══════════════════════════════════════════════════════════════

describe('C/D/E — privacidad: 0 corridas, 0 reservas, 0 proveedores', () => {
  const cases: Array<{
    state: Extract<
      PhoneRevealWaterfallSuppressionState,
      'blocked_suppressed' | 'do_not_contact' | 'check_unavailable'
    >;
    reason: PhoneRevealWaterfallLegacyIneligibleReason;
    status: LegacyPhoneRevealWaterfallActionStatus;
  }> = [
    {
      state: 'blocked_suppressed',
      reason: 'blocked_suppressed',
      status: 'blocked_suppressed',
    },
    {
      state: 'do_not_contact',
      reason: 'do_not_contact',
      status: 'do_not_contact',
    },
    {
      state: 'check_unavailable',
      reason: 'suppression_check_unavailable',
      status: 'privacy_check_unavailable',
    },
  ];

  for (const c of cases) {
    it(`\`${c.state}\` bloquea con 0 escrituras y se registra como \`${c.reason}\``, async () => {
      const { deps, credit } = startDeps({
        checkPrivacyGateBeforeReserving: async () => c.state,
      });
      const started = await startLegacyPhoneRevealWaterfall(
        { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
        deps,
      );

      assert.equal(started.started, false);
      if (started.started) return;
      assert.equal(started.reason, c.reason);
      assert.equal(credit.poolQueries.length, 0, 'el presupuesto ni se consulta');
      assert.equal(credit.reserveRequests.length, 0, 'no se emite ninguna reserva');
      assertZeroSpend(credit, c.state);
      // Y el diagnóstico dice CUÁL fue el veredicto, no sólo que hubo uno.
      assert.equal(started.diagnostics.privacyState, c.state);
    });
  }

  it('la verificación NO DISPONIBLE no se confunde con una supresión confirmada', () => {
    // Mismo efecto (bloquea), afirmación distinta: decirle al operador que el contacto
    // está suprimido cuando la lectura falló le inventa un hecho sobre la persona.
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('suppression_check_unavailable'),
      'privacy_check_unavailable',
    );
    assert.notEqual(
      classifyLegacyPhoneRevealStartFailure('suppression_check_unavailable'),
      'blocked_suppressed',
    );
    assert.notEqual(
      classifyLegacyPhoneRevealStartFailure('suppression_check_unavailable'),
      'not_eligible',
    );
  });

  it('privacidad `clear` deja arrancar: la puerta es la privacidad, no el candidato', async () => {
    const { deps, credit } = startDeps({
      checkPrivacyGateBeforeReserving: async () => 'clear',
    });
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(started.started, true);
    assert.equal(credit.createdRuns.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// F · § 12 — una corrida apareció entre el render y el clic
// ═══════════════════════════════════════════════════════════════

describe('F — corrida viva aparecida entre el render y el clic', () => {
  it('no abre una segunda autorización y el operador lee «ya hay una en proceso»', async () => {
    const { deps, credit } = startDeps({
      findActiveRun: async () => liveRun(),
    });
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
      deps,
    );

    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'active_run_exists');
    assert.equal(started.diagnostics.activeRunFound, true);
    assert.equal(started.diagnostics.historyClassification, 'active_run_exists');
    assertZeroSpend(credit, 'corrida viva');
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('active_run_exists'),
      'already_pending',
    );
    // El índice único parcial rechazando el INSERT en paralelo es el MISMO hecho.
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('create_conflict'),
      'already_pending',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// G · § 12 — el estado del candidato cambió
// ═══════════════════════════════════════════════════════════════

describe('G — el candidato cambió entre el render y el clic', () => {
  const changed: Array<{
    label: string;
    evidence: Partial<PhoneRevealWaterfallLegacyEvidence>;
    reason: PhoneRevealWaterfallLegacyIneligibleReason;
  }> = [
    {
      label: 'el reveal ya no está agotado',
      evidence: {
        phoneRevealStatus: 'requested',
        phoneRevealCompletedAt: null,
      },
      reason: 'apollo_not_exhausted',
    },
    {
      label: 'el `no_phone_found` lo produjo Lusha, no Apollo',
      evidence: { phoneRevealProvider: 'lusha' },
      reason: 'apollo_evidence_missing',
    },
    {
      label: 'el intento no cerró fechado',
      evidence: { phoneRevealCompletedAt: null },
      reason: 'apollo_outcome_not_closed',
    },
    {
      label: 'ya hay teléfono',
      evidence: { hasPhone: true },
      reason: 'existing_phone_present',
    },
    {
      label: 'el candidato dejó de ser editable',
      evidence: { candidateStatus: 'approved' },
      reason: 'candidate_not_editable',
    },
  ];

  for (const c of changed) {
    it(`${c.label} ⇒ \`${c.reason}\`, 0 escrituras, y NO «no aplica»`, async () => {
      const { deps, credit } = startDeps({
        loadLegacyEvidence: async () => luisEvidence(c.evidence),
      });
      const started = await startLegacyPhoneRevealWaterfall(
        { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
        deps,
      );

      assert.equal(started.started, false);
      if (started.started) return;
      assert.equal(started.reason, c.reason);
      assertZeroSpend(credit, c.label);
      assert.equal(
        classifyLegacyPhoneRevealStartFailure(c.reason),
        'candidate_state_changed',
      );
    });
  }

  it('sin NINGÚN identificador con que buscar, la pata Lusha no existe: se dice así', async () => {
    // Ni id propio (nació en Apollo), ni identidad persistida, ni hechos con los que
    // construir una búsqueda. Pedir créditos aquí sería pedir permiso para una llamada
    // que estructuralmente no puede ocurrir.
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () =>
        luisEvidence({
          identitySearchFacts: undefined,
          providerIdentities: [],
        }),
    });
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'missing_lusha_contact_id');
    assertZeroSpend(credit, 'sin identificador');
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('missing_lusha_contact_id'),
      'missing_lusha_contact_id',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// I · § 3 y § 12 — ningún motivo conocido cae en `not_eligible`
// ═══════════════════════════════════════════════════════════════

/**
 * Vocabulario CERRADO y COMPLETO de motivos. Está escrito a mano —no derivado del
 * tipo— a propósito: si mañana el core añade uno, el `satisfies` de abajo obliga a
 * declararlo aquí y por tanto a decidir qué lee el operador, en vez de heredar el
 * cajón de sastre en silencio.
 */
const ALL_REASONS = [
  'feature_disabled',
  'role_not_allowed',
  'invalid_candidate',
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
  'blocked_suppressed',
  'do_not_contact',
  'suppression_check_unavailable',
  'authorization_ceiling_mismatch',
] as const satisfies readonly PhoneRevealWaterfallLegacyIneligibleReason[];

describe('I — taxonomía veraz: `not_eligible` deja de ser el cajón de sastre', () => {
  it('ningún motivo MECÁNICO conocido se traduce a `not_eligible`', () => {
    const collapsed = ALL_REASONS.filter(
      (reason) =>
        reason !== 'invalid_candidate' &&
        classifyLegacyPhoneRevealStartFailure(reason) === 'not_eligible',
    );
    assert.deepEqual(
      collapsed,
      [],
      `motivos que aún se colapsan: ${collapsed.join(', ')}`,
    );
  });

  it('sólo la entrada inválida del cliente conserva `not_eligible`', () => {
    // Es el único caso en el que el candidato no llegó a evaluarse, así que no hay
    // ningún hecho suyo que reportar.
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('invalid_candidate'),
      'not_eligible',
    );
  });

  it('una LECTURA que falla es infraestructura, jamás un hecho del candidato', () => {
    // El caso que hacía falsa la frase genérica: el candidato aplica perfectamente.
    const event = buildLegacyPhoneRevealStartEvent({
      started: null,
      outerFlagEnabled: true,
      acceptedMaxCredits: 6,
    });
    assert.equal(event.reason, LEGACY_START_EXCEPTION_REASON);
    assert.equal(event.run_created, false);
  });

  it('los tres hechos que NO son del candidato tienen desenlace propio', () => {
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('feature_disabled'),
      'feature_disabled',
    );
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('role_not_allowed'),
      'role_not_allowed',
    );
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('candidate_not_found'),
      'candidate_not_found',
    );
  });

  it('los cuatro desenlaces económicos conservan su copy: no se reinterpretan', () => {
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('insufficient_credits'),
      'insufficient_credits',
    );
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('budget_not_configured'),
      'budget_not_configured',
    );
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('credit_balance_unavailable'),
      'credit_balance_unavailable',
    );
    assert.equal(
      classifyLegacyPhoneRevealStartFailure('run_creation_unavailable'),
      'infrastructure_unavailable',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// J · § 9 — observabilidad SIN PII
// ═══════════════════════════════════════════════════════════════

describe('J — el evento del arranque es PII-free y describe la decisión', () => {
  /** Todo lo que NUNCA puede aparecer serializado, con sus valores REALES. */
  const FORBIDDEN = [
    LUIS_FACTS.firstName,
    LUIS_FACTS.lastName,
    LUIS_FACTS.linkedinUrl,
    LUIS_FACTS.companyName,
    LUIS_FACTS.companyDomain,
    APOLLO_PERSON_ID,
    CANDIDATE_ID,
    'luis@',
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);

  async function eventFor(
    overrides: Partial<StartLegacyPhoneRevealWaterfallDeps>,
    accepted: number,
  ) {
    const { deps } = startDeps(overrides);
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: accepted },
      deps,
    );
    return buildLegacyPhoneRevealStartEvent({
      started,
      outerFlagEnabled: true,
      acceptedMaxCredits: accepted,
    });
  }

  it('el arranque EXITOSO no serializa ni un dato personal', async () => {
    const serialized = JSON.stringify(await eventFor({}, 6));
    for (const secret of FORBIDDEN) {
      assert.ok(!serialized.includes(secret), `el evento filtró: ${secret}`);
    }
  });

  it('los rechazos tampoco: privacidad, corrida viva y techo', async () => {
    const events = [
      await eventFor(
        { checkPrivacyGateBeforeReserving: async () => 'blocked_suppressed' },
        6,
      ),
      await eventFor({ findActiveRun: async () => liveRun() }, 6),
      await eventFor({}, 5),
    ];
    for (const event of events) {
      const serialized = JSON.stringify(event);
      for (const secret of FORBIDDEN) {
        assert.ok(!serialized.includes(secret), `el evento filtró: ${secret}`);
      }
    }
  });

  it('las claves del evento son exactamente las declaradas, sin extras', async () => {
    const event = await eventFor({}, 6);
    assert.deepEqual(Object.keys(event).sort(), [
      'accepted_max_credits',
      'active_run_found',
      'event',
      'history_classification',
      'identity_search_allowed',
      'outer_flag_enabled',
      'preview_or_start',
      'privacy_state',
      'reason',
      'required_max_credits',
      'requires_identity_search',
      'role_authorized',
      'run_created',
    ]);
  });

  it('el techo ACEPTADO no se deriva del requerido: 6 requerido / 5 aceptado sigue siendo 6 / 5', async () => {
    const event = await eventFor({}, 5);
    assert.equal(event.required_max_credits, 6);
    assert.equal(event.accepted_max_credits, 5);
    assert.equal(event.reason, 'authorization_ceiling_mismatch');
    assert.equal(event.run_created, false);
  });

  it('un rechazo temprano deja en `null` lo que NO llegó a evaluarse', async () => {
    const event = await eventFor({ flagEnabled: false }, 6);
    assert.equal(event.reason, 'feature_disabled');
    assert.equal(event.outer_flag_enabled, false);
    // `null` = «no se evaluó», que es distinto de «salió que no».
    assert.equal(event.privacy_state, null);
    assert.equal(event.active_run_found, null);
    assert.equal(event.history_classification, null);
    assert.equal(event.requires_identity_search, null);
  });

  it('el evento del arranque exitoso registra la modalidad y el permiso humano', async () => {
    const event = await eventFor({}, 6);
    assert.equal(event.event, 'phone_reveal_legacy_start_outcome');
    assert.equal(event.preview_or_start, 'start');
    assert.equal(event.requires_identity_search, true);
    assert.equal(event.required_max_credits, 6);
    assert.equal(event.accepted_max_credits, 6);
    assert.equal(event.privacy_state, 'clear');
    assert.equal(event.run_created, true);
    assert.equal(event.reason, null);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 11 — lo que este hito NO puede haber tocado
// ═══════════════════════════════════════════════════════════════

describe('§ 11 — contratos preservados', () => {
  it('los topes legacy siguen siendo 5 y 6, nunca 8, 13 ni 14', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, 5);
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH, 6);
  });

  it('con identidad Lusha YA persistida el tope vuelve a 5 y no se compra búsqueda', async () => {
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () =>
        luisEvidence({
          providerIdentities: [
            {
              candidateId: CANDIDATE_ID,
              providerKey: 'lusha',
              providerContactId: 'v1.token-lusha-opaco',
              resolutionSource: 'provider_search_linkedin_url',
            },
          ],
        }),
    });
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID, acceptedMaxCredits: 5 },
      deps,
    );
    assert.equal(started.started, true);
    if (!started.started) return;
    assert.equal(started.maxCreditsAuthorized, 5);
    assert.equal(started.requiresIdentitySearch, false);
    assert.deepEqual(
      (credit.reserveRequests[0]?.legs ?? []).map((leg) => leg.operationKey),
      ['phone_reveal'],
      'UNA sola pata: no se compra una identidad que ya teníamos',
    );
  });

  it('sin tope aceptado se asume el SUELO conservador (5), nunca la modalidad requerida', async () => {
    const { deps, credit } = startDeps();
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: CANDIDATE_ID },
      deps,
    );
    assert.equal(started.started, false);
    if (started.started) return;
    assert.equal(started.reason, 'authorization_ceiling_mismatch');
    assert.equal(started.acceptedMaxCredits, 5);
    assertZeroSpend(credit, 'sin techo');
  });
});
