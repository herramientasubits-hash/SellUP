/**
 * legacy-cross-provider-lusha-continuation.test.ts
 * (Agente 2A · AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1)
 *
 * QUÉ FIJA ESTA SUITE
 *
 * La ruta legacy existía sólo para el candidato NACIDO EN LUSHA: exigía id propio, así
 * que un candidato de Apollo cuyo reveal terminó `no_phone_found` se quedaba sin
 * ninguna vía. Este hito lo desbloquea COMPRANDO la identidad que falta, y lo que hay
 * que demostrar es que esa compra está acotada por los dos lados:
 *
 *   * ECONÓMICO — el tope de esta autorización es 5 (identidad ya conocida) o 6
 *     (búsqueda hasta 1 + teléfono hasta 5). Los 8 de Apollo NO entran nunca: ese gasto
 *     lo pagó la autorización histórica, y volver a pedirlos cobraría dos veces el
 *     mismo intento en la confirmación que lee el operador. 14, 13 y «8 + …» no pueden
 *     aparecer en ninguna parte de esta ruta;
 *   * AUTORIZACIÓN — el 5 → 6 nunca es silencioso. El techo que la persona aceptó es
 *     un LÍMITE SUPERIOR DURO y se compara ANTES de tocar el presupuesto, así que una
 *     vista previa obsoleta produce 0 reservas y una pregunta nueva, no un crédito.
 *
 * Y que el resto del contrato sigue intacto: Apollo NO se llama (0 llamadas, y la ruta
 * ni siquiera tiene una dep con la que hacerlo), UNA sola Contact Search por
 * autorización, la identidad se PERSISTE antes de revelar, y una autorización posterior
 * ya no vuelve a comprarla.
 *
 * OFFLINE por construcción: sin red, sin base de datos, sin Apollo, sin Lusha y sin un
 * solo crédito. Todas las deps son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLegacyPhoneRevealAuthorizationPreview,
  continuePhoneRevealWaterfall,
  doesRunAuthorizeIdentitySearch,
  evaluatePhoneRevealWaterfallLegacyEligibility,
  normalizeLegacyPhoneRevealAcceptedMaxCredits,
  resolveLegacyPhoneRevealMaxCredits,
  startLegacyPhoneRevealWaterfall,
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
  type ContinuePhoneRevealWaterfallDeps,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
  type PhoneRevealWaterfallSuppressionState,
  type StartLegacyPhoneRevealWaterfallDeps,
} from '../phone-reveal-waterfall-core';
import {
  resolvePhoneRevealCreditBudgetMode,
  resolvePhoneRevealCreditBudgetProviders,
  resolvePhoneRevealCreditBudgetRequiredCredits,
  resolvePhoneRevealCreditRequirements,
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_WITH_SEARCH_REQUIRED_CREDITS,
} from '../phone-reveal-credit-budget-core';
import {
  resolveLushaIdentityForWaterfall,
  type LushaIdentitySearchClaimResult,
  type LushaIdentitySearchPreflightResult,
  type LushaIdentitySearchProviderResponse,
  type ResolveLushaIdentityDeps,
  type ResolveLushaIdentityResult,
} from '../lusha-identity-resolution-runtime-core';
import type { LushaIdentitySearchCandidateFacts } from '../lusha-identity-search-core';
import type { ProviderContactIdentityRecord } from '../provider-contact-identity-core';
import { getPhoneRevealWaterfallAuthorizationCopy } from '@/components/contact-enrichment/phone-reveal-waterfall-copy';
import { creditHarness, type CreditHarness } from './phone-reveal-credit-reservation-fixtures';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-08-24T12:00:00.000Z';
const LUSHA_ID = 'v1.token-lusha-opaco';

/**
 * Hechos del candidato real que motiva el hito: Luis, nacido en Apollo, con LinkedIn y
 * SIN email. Se usa como base de la regresión § 13 y de la mayoría de los casos.
 */
const LUIS_FACTS: LushaIdentitySearchCandidateFacts = {
  firstName: 'Luis',
  lastName: 'Jacome Gaona',
  linkedinUrl: 'https://www.linkedin.com/in/luis-jacome-gaona',
  email: null,
  companyName: 'Empresa Demo',
  companyDomain: 'empresademo.test',
};

/** Identidad Lusha YA persistida por una autorización anterior. */
function persistedLushaIdentity(): ProviderContactIdentityRecord {
  return {
    candidateId: 'cand-luis',
    providerKey: 'lusha',
    providerContactId: LUSHA_ID,
    resolutionSource: 'provider_search_linkedin_url',
  };
}

/**
 * Evidencia legacy de un candidato NACIDO EN APOLLO: Apollo ya terminó
 * `no_phone_found`, está fechado, y no hay teléfono.
 */
function apolloLegacyEvidence(
  overrides: Partial<PhoneRevealWaterfallLegacyEvidence> = {},
): PhoneRevealWaterfallLegacyEvidence {
  return {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-08-01T09:00:00.000Z',
    hasPhone: false,
    source: 'apollo',
    sourceContactId: 'apollo-person-99',
    providerIdentities: [],
    identitySearchFacts: LUIS_FACTS,
    ...overrides,
  };
}

function apolloCandidate(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'cand-luis',
    source: 'apollo',
    sourceContactId: 'apollo-person-99',
    hasPhone: false,
    phoneRevealStatus: 'no_phone_found',
    providerIdentities: [],
    identitySearchFacts: LUIS_FACTS,
    ...overrides,
  };
}

/** Corrida legacy VIVA, tal y como la deja el arranque de esta modalidad. */
function legacyRun(
  overrides: Partial<PhoneRevealWaterfallRunRecord> = {},
): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-legacy-luis',
    candidateId: 'cand-luis',
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
    creditReservationGroupId: 'group-legacy-luis',
    ...overrides,
  };
}

/**
 * Deps del ARRANQUE legacy. No existe ninguna clave de Apollo, y eso es el contrato:
 * esta ruta no tiene forma de llamarlo aunque quisiera.
 */
function startDeps(
  overrides: Partial<StartLegacyPhoneRevealWaterfallDeps> = {},
  creditOverride?: CreditHarness,
): { deps: StartLegacyPhoneRevealWaterfallDeps; credit: CreditHarness } {
  const credit = creditOverride ?? creditHarness();
  return {
    credit,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: 'user-admin', roleKey: 'admin' },
      nowIso: NOW,
      identitySearchAllowed: true,
      loadLegacyEvidence: async () => apolloLegacyEvidence(),
      findActiveRun: async () => null,
      findLatestRun: async () => null,
      ...credit.deps,
      ...overrides,
    },
  };
}

interface ContinueHarness {
  deps: ContinuePhoneRevealWaterfallDeps;
  updates: Array<{ runId: string; patch: PhoneRevealWaterfallRunPatch }>;
  order: string[];
  identityCalls: number;
  revealClaims: number;
  lushaRevealCalls: number;
  lushaContactIdSeen: string | undefined;
}

/** Deps de la CONTINUACIÓN. Tampoco aquí existe ninguna pata de Apollo. */
function continueHarness(
  opts: {
    run?: PhoneRevealWaterfallRunRecord;
    candidate?: PhoneRevealWaterfallCandidateRecord;
    suppression?: PhoneRevealWaterfallSuppressionState;
    identity?: ResolveLushaIdentityResult;
    withoutIdentityDep?: boolean;
  } = {},
): ContinueHarness {
  const updates: Array<{ runId: string; patch: PhoneRevealWaterfallRunPatch }> = [];
  const order: string[] = [];
  let claimed = false;

  const h: ContinueHarness = {
    updates,
    order,
    identityCalls: 0,
    revealClaims: 0,
    lushaRevealCalls: 0,
    lushaContactIdSeen: undefined,
    deps: {
      flagEnabled: true,
      lushaFallbackFlagEnabled: true,
      nowIso: NOW,
      findActiveRun: async () => opts.run ?? legacyRun(),
      loadCandidate: async () => opts.candidate ?? apolloCandidate(),
      updateRun: async (runId, patch) => {
        order.push('update-run');
        updates.push({ runId, patch });
      },
      checkSuppressionAndDoNotContact: async () => {
        order.push('suppression-check');
        return opts.suppression ?? 'clear';
      },
      claimLushaAttempt: async () => {
        order.push('reveal-claim');
        h.revealClaims += 1;
        if (claimed) return false;
        claimed = true;
        return true;
      },
      callLushaLeg: async (args) => {
        order.push('lusha-reveal');
        h.lushaRevealCalls += 1;
        h.lushaContactIdSeen = args.lushaContactId;
        return { status: 'revealed', creditsCharged: 5, errorCode: null };
      },
      ...(opts.withoutIdentityDep
        ? {}
        : {
            resolveLushaIdentity: async () => {
              order.push('identity-search');
              h.identityCalls += 1;
              return (
                opts.identity ?? {
                  status: 'ready',
                  contactId: LUSHA_ID,
                  searched: true,
                  runOutcome: 'resolved',
                  searchCreditsCharged: 1,
                }
              );
            },
            recordIdentitySearchOutcome: async () => {
              order.push('record-identity-outcome');
            },
          }),
    },
  };
  return h;
}

interface IdentityHarness {
  deps: ResolveLushaIdentityDeps;
  preflightCalls: number;
  claimCalls: number;
  searchCalls: number;
  persistCalls: number;
}

/** Deps del RESOLUTOR de identidad, para los casos J y K. */
function identityHarness(
  opts: {
    preflight?: LushaIdentitySearchPreflightResult;
    claim?: LushaIdentitySearchClaimResult;
    response?: LushaIdentitySearchProviderResponse;
    searchThrows?: boolean;
    persistFails?: boolean;
  } = {},
): IdentityHarness {
  const h: IdentityHarness = {
    preflightCalls: 0,
    claimCalls: 0,
    searchCalls: 0,
    persistCalls: 0,
    deps: {
      preflightSearch: async () => {
        h.preflightCalls += 1;
        return opts.preflight ?? { status: 'ready' };
      },
      claimIdentitySearch: async () => {
        h.claimCalls += 1;
        return opts.claim ?? 'claimed';
      },
      searchIdentity: async () => {
        h.searchCalls += 1;
        if (opts.searchThrows) throw new Error('socket hang up');
        return (
          opts.response ?? {
            outcome: { status: 'success', results: [{ id: LUSHA_ID, companyName: 'Empresa Demo', companyDomain: 'empresademo.test' }] },
            creditsCharged: 1,
          }
        );
      },
      persistIdentity: async () => {
        h.persistCalls += 1;
        return opts.persistFails
          ? { status: 'failed' }
          : { status: 'persisted', providerContactId: LUSHA_ID };
      },
    },
  };
  return h;
}

/** Créditos reservados por operación, tal como llegaron a la transacción atómica. */
function reservedLegs(credit: CreditHarness): Array<[string, string, number]> {
  return credit.reserveRequests[0].legs.map((leg) => [
    leg.providerKey,
    leg.operationKey ?? 'phone_reveal',
    leg.credits,
  ]);
}

// ═══════════════════════════════════════════════════════════════
// § 3 — El costo histórico de Apollo NO forma parte de esta autorización
// ═══════════════════════════════════════════════════════════════

describe('§ 3 — economía de la continuación legacy: 5 o 6, jamás 14 ni 13 ni «8 + …»', () => {
  it('las dos cifras de la ruta legacy son 5 y 6, y 6 = 1 + 5', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, 5);
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH, 6);
    assert.equal(
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS + 1,
    );
  });

  it('los 8 de Apollo NO son un sumando de ninguna de las dos', () => {
    // La comprobación es de VALOR y no de forma: si alguien sumara el histórico, el
    // tope legacy pasaría a 13 o 14, que son exactamente las cifras del flujo COMPLETO.
    for (const legacyCeiling of [
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS_WITH_IDENTITY_SEARCH,
    ]) {
      assert.ok(legacyCeiling < PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS);
      assert.notEqual(legacyCeiling, PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA);
      assert.notEqual(
        legacyCeiling,
        PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
      );
    }
  });

  it('la modalidad económica reserva DOS patas de Lusha y NINGUNA de Apollo', () => {
    const mode = 'legacy_lusha_with_identity_search';
    assert.deepEqual(
      resolvePhoneRevealCreditRequirements(mode).map((leg) => [
        leg.providerKey,
        leg.operationKey,
        leg.credits,
      ]),
      [
        ['lusha', 'contact_search', 1],
        ['lusha', 'phone_reveal', 5],
      ],
    );
    assert.equal(resolvePhoneRevealCreditBudgetRequiredCredits(mode), 6);
    assert.equal(
      PHONE_REVEAL_CREDIT_BUDGET_LEGACY_WITH_SEARCH_REQUIRED_CREDITS,
      6,
    );
    // Sólo se lee el pozo de Lusha: el presupuesto de Apollo no puede bloquear esta
    // operación ni quedar ocupado por ella.
    assert.deepEqual([...resolvePhoneRevealCreditBudgetProviders(mode)], ['lusha']);
  });

  it('el resolutor de modalidad exige un `false` EXPLÍCITO para comprar la búsqueda', () => {
    const legacy = (lushaIdentityResolved?: boolean) =>
      resolvePhoneRevealCreditBudgetMode({
        legacyLushaOnly: true,
        lushaEligible: true,
        ...(lushaIdentityResolved === undefined ? {} : { lushaIdentityResolved }),
      });
    assert.equal(legacy(false), 'legacy_lusha_with_identity_search');
    assert.equal(legacy(true), 'legacy_lusha_only');
    // Omitido ⇒ la modalidad de siempre. Es lo que impide que un caller anterior al
    // hito acabe comprando una búsqueda que su operador nunca vio.
    assert.equal(legacy(undefined), 'legacy_lusha_only');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15 A–D, L — vista previa y elegibilidad
// ═══════════════════════════════════════════════════════════════

describe('§ 15 A–D — qué modalidad ve el operador antes del clic', () => {
  it('A — identidad Lusha YA persistida ⇒ tope 5 y CERO búsqueda', () => {
    const preview = buildLegacyPhoneRevealAuthorizationPreview(
      apolloLegacyEvidence({ providerIdentities: [persistedLushaIdentity()] }),
      { identitySearchAuthorized: true },
    );
    assert.equal(preview.eligible, true);
    assert.equal(preview.requiresIdentitySearch, false);
    assert.equal(preview.maxCredits, 5);
  });

  it('B — sin identidad y con LinkedIn exacto ⇒ tope 6', () => {
    const preview = buildLegacyPhoneRevealAuthorizationPreview(apolloLegacyEvidence(), {
      identitySearchAuthorized: true,
    });
    assert.equal(preview.eligible, true);
    assert.equal(preview.requiresIdentitySearch, true);
    assert.equal(preview.maxCredits, 6);
  });

  it('C — sin identidad y con email exacto ⇒ el MISMO contrato de 6', () => {
    const preview = buildLegacyPhoneRevealAuthorizationPreview(
      apolloLegacyEvidence({
        identitySearchFacts: { ...LUIS_FACTS, linkedinUrl: null, email: 'luis@empresademo.test' },
      }),
      { identitySearchAuthorized: true },
    );
    assert.equal(preview.eligible, true);
    assert.equal(preview.requiresIdentitySearch, true);
    assert.equal(preview.maxCredits, 6);
  });

  it('D — sin identificadores exactos ⇒ NO elegible, y el motivo es mecánico', () => {
    const preview = buildLegacyPhoneRevealAuthorizationPreview(
      apolloLegacyEvidence({
        identitySearchFacts: {
          firstName: 'Luis',
          lastName: null,
          linkedinUrl: null,
          email: null,
          companyName: null,
          companyDomain: null,
        },
      }),
      { identitySearchAuthorized: true },
    );
    assert.equal(preview.eligible, false);
    assert.equal(preview.reason, 'missing_lusha_contact_id');
    assert.equal(preview.requiresIdentitySearch, false);
  });

  it('nombre + apellido + dominio, sin LinkedIn ni email, también resuelve a 6', () => {
    const preview = buildLegacyPhoneRevealAuthorizationPreview(
      apolloLegacyEvidence({
        identitySearchFacts: { ...LUIS_FACTS, linkedinUrl: null, email: null },
      }),
      { identitySearchAuthorized: true },
    );
    assert.equal(preview.eligible, true);
    assert.equal(preview.maxCredits, 6);
  });

  it('sin la vía de pago autorizada, el veredicto vuelve a ser el ANTERIOR al hito', () => {
    // Es el veredicto VERDADERO para esa autorización: bajo ella, este candidato no
    // tiene identificador de Lusha reutilizable. Que otra pudiera comprarlo no es algo
    // que ésta pueda gastar.
    const preview = buildLegacyPhoneRevealAuthorizationPreview(apolloLegacyEvidence());
    assert.equal(preview.eligible, false);
    assert.equal(preview.reason, 'missing_lusha_contact_id');
  });

  it('la elegibilidad legacy sigue exigiendo la TERNA de Apollo, con o sin búsqueda', () => {
    // M — sin evidencia histórica no hay ruta legacy, ni siquiera con identificadores
    // perfectos para buscar.
    for (const [override, reason] of [
      [{ phoneRevealStatus: 'error' }, 'apollo_not_exhausted'],
      [{ phoneRevealProvider: 'lusha' }, 'apollo_evidence_missing'],
      [{ phoneRevealCompletedAt: null }, 'apollo_outcome_not_closed'],
      [{ hasPhone: true }, 'existing_phone_present'],
    ] as const) {
      const result = evaluatePhoneRevealWaterfallLegacyEligibility(
        apolloLegacyEvidence(override),
        { identitySearchAuthorized: true },
      );
      assert.equal(result.eligible, false, JSON.stringify(override));
      assert.equal(result.reason, reason, JSON.stringify(override));
    }
  });

  it('L — con la identidad ya persistida, una autorización POSTERIOR vuelve a costar 5', () => {
    const first = buildLegacyPhoneRevealAuthorizationPreview(apolloLegacyEvidence(), {
      identitySearchAuthorized: true,
    });
    const second = buildLegacyPhoneRevealAuthorizationPreview(
      apolloLegacyEvidence({ providerIdentities: [persistedLushaIdentity()] }),
      { identitySearchAuthorized: true },
    );
    assert.equal(first.maxCredits, 6);
    assert.equal(second.maxCredits, 5);
    assert.equal(second.requiresIdentitySearch, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 7 / § 15 E–F — el techo humano
// ═══════════════════════════════════════════════════════════════

describe('§ 7 — el techo aceptado es un LÍMITE SUPERIOR DURO', () => {
  it('E — exige 6 y el operador aceptó 5 ⇒ 0 reservas, 0 corridas, 0 proveedores', async () => {
    const { deps, credit } = startDeps();
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 5 },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'authorization_ceiling_mismatch');
    assert.equal(result.started === false && result.requiredMaxCredits, 6);
    assert.equal(result.started === false && result.acceptedMaxCredits, 5);
    // El corte va ANTES del presupuesto: ni siquiera se preguntó por el pozo.
    assert.equal(credit.poolQueries.length, 0);
    assert.equal(credit.reserveRequests.length, 0);
    assert.equal(credit.createdRuns.length, 0);
  });

  it('E bis — el techo OMITIDO no puede subir 5 a 6 en silencio', async () => {
    const { deps, credit } = startDeps();
    const result = await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-luis' }, deps);
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'authorization_ceiling_mismatch');
    assert.equal(credit.reserveRequests.length, 0);
  });

  it('el suelo conservador de ESTA ruta es 5, no los 8 del waterfall completo', () => {
    // Con el suelo de 8, un cliente silencioso pasaría el techo de 6 sin haber visto
    // jamás un 6. Ese es exactamente el agujero que este suelo cierra.
    assert.equal(normalizeLegacyPhoneRevealAcceptedMaxCredits(undefined), 5);
    assert.equal(normalizeLegacyPhoneRevealAcceptedMaxCredits(null), 5);
    assert.equal(normalizeLegacyPhoneRevealAcceptedMaxCredits(Number.NaN), 5);
    assert.equal(normalizeLegacyPhoneRevealAcceptedMaxCredits(6), 6);
  });

  it('F — exige 6 y el operador aceptó 6 ⇒ corrida con dos patas de Lusha y cero de Apollo', async () => {
    const { deps, credit } = startDeps();
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(result.started, true);
    assert.equal(result.started === true && result.maxCreditsAuthorized, 6);
    assert.equal(result.started === true && result.requiresIdentitySearch, true);
    assert.deepEqual(reservedLegs(credit), [
      ['lusha', 'contact_search', 1],
      ['lusha', 'phone_reveal', 5],
    ]);
    // Sólo el pozo de Lusha, y la corrida transcribe el histórico sin fabricarlo.
    assert.deepEqual(credit.poolQueries, [['lusha']]);
    const draft = credit.createdDrafts[0];
    assert.equal(draft.runMode, 'legacy_lusha_only');
    assert.equal(draft.maxCreditsAuthorized, 6);
    assert.equal(draft.apolloAttemptedAt, null);
    assert.equal(draft.apolloOutcome, 'no_phone_found');
    assert.equal(draft.apolloCostSource, 'unknown');
  });

  it('con la identidad ya persistida, exige 5 y reserva UNA sola pata', async () => {
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () =>
        apolloLegacyEvidence({ providerIdentities: [persistedLushaIdentity()] }),
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 5 },
      deps,
    );
    assert.equal(result.started, true);
    assert.equal(result.started === true && result.maxCreditsAuthorized, 5);
    assert.equal(result.started === true && result.requiresIdentitySearch, false);
    assert.deepEqual(reservedLegs(credit), [['lusha', 'phone_reveal', 5]]);
  });

  it('aceptar de MÁS es seguro: se reserva lo REQUERIDO, no lo aceptado', async () => {
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () =>
        apolloLegacyEvidence({ providerIdentities: [persistedLushaIdentity()] }),
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(result.started === true && result.maxCreditsAuthorized, 5);
    assert.deepEqual(reservedLegs(credit), [['lusha', 'phone_reveal', 5]]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15 D, M, N, O, P, Q — gates del arranque
// ═══════════════════════════════════════════════════════════════

describe('§ 15 D/M/N/O/P/Q — gates del arranque legacy', () => {
  it('D — sin identificadores exactos: 0 reservas y 0 proveedores', async () => {
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () =>
        apolloLegacyEvidence({
          identitySearchFacts: {
            firstName: 'Luis',
            lastName: null,
            linkedinUrl: null,
            email: null,
            companyName: null,
            companyDomain: null,
          },
        }),
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'missing_lusha_contact_id');
    assert.equal(credit.poolQueries.length, 0);
    assert.equal(credit.reserveRequests.length, 0);
  });

  it('M — sin evidencia histórica de Apollo la ruta se cierra, y Apollo NO se llama', async () => {
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () => apolloLegacyEvidence({ phoneRevealStatus: 'requested', phoneRevealCompletedAt: null }),
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'apollo_not_exhausted');
    assert.equal(credit.reserveRequests.length, 0);
    // Y la superficie de deps no contiene NADA con lo que llamar a Apollo.
    assert.equal(
      Object.keys(deps).join(' ').toLowerCase().includes('apollo'),
      false,
    );
  });

  it('N — con una corrida activa no se abre una segunda: 0 reservas, 0 proveedores', async () => {
    const { deps, credit } = startDeps({ findActiveRun: async () => legacyRun() });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'active_run_exists');
    assert.equal(credit.poolQueries.length, 0);
    assert.equal(credit.reserveRequests.length, 0);
  });

  it('O — supresión / DNC / verificación no disponible ⇒ 0 búsqueda y 0 reveal', async () => {
    for (const [state, reason] of [
      ['blocked_suppressed', 'blocked_suppressed'],
      ['do_not_contact', 'do_not_contact'],
      ['check_unavailable', 'suppression_check_unavailable'],
    ] as const) {
      const { deps, credit } = startDeps({
        checkPrivacyGateBeforeReserving: async () => state,
      });
      const result = await startLegacyPhoneRevealWaterfall(
        { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
        deps,
      );
      assert.equal(result.started, false, state);
      assert.equal(result.started === false && result.reason, reason, state);
      assert.equal(credit.reserveRequests.length, 0, state);
    }
  });

  it('P — commercial_manager tiene la MISMA autorización que admin', async () => {
    const { deps, credit } = startDeps({
      actor: { internalUserId: 'user-cm', roleKey: 'commercial_manager' },
    });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(result.started, true);
    assert.equal(result.started === true && result.maxCreditsAuthorized, 6);
    assert.equal(credit.createdDrafts[0].authorizedByRole, 'commercial_manager');
  });

  it('Q — un rol sin permiso de revelar queda bloqueado ANTES de leer nada', async () => {
    let evidenceReads = 0;
    for (const roleKey of ['seller', 'lead', null]) {
      const { deps, credit } = startDeps({
        actor: { internalUserId: 'user-x', roleKey },
        loadLegacyEvidence: async () => {
          evidenceReads += 1;
          return apolloLegacyEvidence();
        },
      });
      const result = await startLegacyPhoneRevealWaterfall(
        { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
        deps,
      );
      assert.equal(result.started, false, String(roleKey));
      assert.equal(result.started === false && result.reason, 'role_not_allowed', String(roleKey));
      assert.equal(credit.reserveRequests.length, 0, String(roleKey));
    }
    assert.equal(evidenceReads, 0, 'un rol no autorizado no llega a leer el candidato');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 6 — la corrida legacy autoriza la búsqueda por su PROPIO techo
// ═══════════════════════════════════════════════════════════════

describe('§ 6 — qué corrida puede pagar una búsqueda', () => {
  it('el umbral es 6 en la modalidad legacy y 14 en el flujo completo', () => {
    const legacy = (maxCreditsAuthorized: number) =>
      doesRunAuthorizeIdentitySearch({ maxCreditsAuthorized, runMode: 'legacy_lusha_only' });
    assert.equal(legacy(5), false);
    assert.equal(legacy(6), true);
    assert.equal(legacy(14), true);

    // Una corrida `full_waterfall` de 6 NO autoriza nada: ahí 6 no cubre ni la pata de
    // Apollo, así que exigirle 14 sigue siendo lo correcto.
    assert.equal(
      doesRunAuthorizeIdentitySearch({ maxCreditsAuthorized: 6, runMode: 'full_waterfall' }),
      false,
    );
    // Y `search_more` (tope 5) tampoco, que es lo que su modalidad exige.
    assert.equal(
      doesRunAuthorizeIdentitySearch({ maxCreditsAuthorized: 5, runMode: 'search_more' }),
      false,
    );
  });

  it('una corrida legacy de 5 sobre un candidato Apollo se AGOTA sin buscar ni revelar', async () => {
    // Es el disparo manual `legacy_lusha_only`, cuya UI enseña 5 y cuya autorización
    // reserva UNA pata de teléfono. Que el resolutor esté cableado no le da permiso.
    const h = continueHarness({
      run: legacyRun({ maxCreditsAuthorized: 5 }),
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.identityCalls, 0);
    assert.equal(h.revealClaims, 0);
    assert.equal(h.lushaRevealCalls, 0);
    assert.equal(h.updates[0].patch.lushaSkippedReason, 'missing_lusha_contact_id');
  });

  it('resolveLegacyPhoneRevealMaxCredits es la única fuente de 5 / 6', () => {
    assert.equal(resolveLegacyPhoneRevealMaxCredits(false), 5);
    assert.equal(resolveLegacyPhoneRevealMaxCredits(true), 6);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 15 G–K, O — la continuación pagada
// ═══════════════════════════════════════════════════════════════

describe('§ 15 G–K — desenlaces de la búsqueda dentro de la corrida legacy', () => {
  it('camino feliz: privacidad → búsqueda → persistencia → claim → UN reveal, y CERO Apollo', async () => {
    const h = continueHarness();
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_revealed');
    assert.deepEqual(h.order, [
      'suppression-check',
      'identity-search',
      'record-identity-outcome',
      'reveal-claim',
      'lusha-reveal',
      'update-run',
    ]);
    assert.equal(h.lushaRevealCalls, 1);
    assert.equal(h.lushaContactIdSeen, LUSHA_ID);
    // El costo histórico de Apollo NO se re-atribuye a esta corrida: sin
    // `apolloCostCredits` en la entrada, el patch no toca sus columnas.
    assert.equal('apolloCostCredits' in h.updates[0].patch, false);
  });

  it('G — identidad resuelta pero NO persistida ⇒ 0 reveal', async () => {
    const h = continueHarness({
      identity: {
        status: 'blocked',
        skippedReason: 'lusha_identity_not_persisted',
        runOutcome: 'resolved_not_persisted',
        searched: true,
        searchCreditsCharged: 1,
      },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_identity_unresolved');
    assert.equal(h.revealClaims, 0);
    assert.equal(h.lushaRevealCalls, 0);
  });

  it('H — la búsqueda no encontró a nadie ⇒ 0 reveal', async () => {
    const h = continueHarness({
      identity: {
        status: 'blocked',
        skippedReason: 'lusha_identity_not_found',
        runOutcome: 'not_found',
        searched: true,
        searchCreditsCharged: 1,
      },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_identity_unresolved');
    assert.equal(h.lushaRevealCalls, 0);
  });

  it('I — la búsqueda fue ambigua ⇒ 0 reveal', async () => {
    const h = continueHarness({
      identity: {
        status: 'blocked',
        skippedReason: 'lusha_identity_ambiguous',
        runOutcome: 'ambiguous',
        searched: true,
        searchCreditsCharged: 1,
      },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_identity_unresolved');
    assert.equal(h.lushaRevealCalls, 0);
  });

  it('O — supresión confirmada ⇒ 0 búsqueda Y 0 reveal, en ese orden', async () => {
    const h = continueHarness({ suppression: 'blocked_suppressed' });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.identityCalls, 0, 'la búsqueda es una llamada PAGADA sobre una persona');
    assert.equal(h.lushaRevealCalls, 0);
  });

  it('J — sin credencial: 0 claim y 0 petición, y NO se asume cobro', async () => {
    const h = identityHarness({
      preflight: { status: 'unavailable', reason: 'no_credential' },
    });
    const result = await resolveLushaIdentityForWaterfall(
      {
        candidateId: 'cand-luis',
        runId: 'run-legacy-luis',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [],
        facts: LUIS_FACTS,
      },
      h.deps,
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.status === 'blocked' && result.searched, false);
    assert.equal(result.status === 'blocked' && result.searchCreditsCharged, null);
    assert.equal(h.claimCalls, 0);
    assert.equal(h.searchCalls, 0);
  });

  it('K — timeout DESPUÉS de emitir: se conserva la verdad de que salió, y no se reintenta', async () => {
    const h = identityHarness({ searchThrows: true });
    const result = await resolveLushaIdentityForWaterfall(
      {
        candidateId: 'cand-luis',
        runId: 'run-legacy-luis',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [],
        facts: LUIS_FACTS,
      },
      h.deps,
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.status === 'blocked' && result.searched, true);
    // UNA petición y ni una más: el retry sería un segundo cobro.
    assert.equal(h.searchCalls, 1);
    assert.equal(h.persistCalls, 0);
  });

  it('L — con la identidad ya persistida, el resolutor NO emite ninguna petición', async () => {
    const h = identityHarness();
    const result = await resolveLushaIdentityForWaterfall(
      {
        candidateId: 'cand-luis',
        runId: 'run-legacy-luis-2',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [persistedLushaIdentity()],
        facts: LUIS_FACTS,
      },
      h.deps,
    );
    assert.equal(result.status, 'ready');
    assert.equal(result.status === 'ready' && result.searched, false);
    assert.equal(result.status === 'ready' && result.runOutcome, 'reused_persisted');
    assert.equal(h.preflightCalls, 0);
    assert.equal(h.claimCalls, 0);
    assert.equal(h.searchCalls, 0);
  });

  it('la persistencia ocurre ANTES del reveal, y una sola Contact Search por autorización', async () => {
    const h = identityHarness();
    const result = await resolveLushaIdentityForWaterfall(
      {
        candidateId: 'cand-luis',
        runId: 'run-legacy-luis',
        candidateSource: 'apollo',
        candidateSourceContactId: 'apollo-person-99',
        identities: [],
        facts: LUIS_FACTS,
      },
      h.deps,
    );
    assert.equal(result.status, 'ready');
    assert.equal(h.searchCalls, 1);
    assert.equal(h.persistCalls, 1);
    assert.equal(result.status === 'ready' && result.contactId, LUSHA_ID);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 13 — regresión REAL: Luis
// ═══════════════════════════════════════════════════════════════

describe('§ 13 — regresión Luis Jacome Gaona (Apollo agotado, LinkedIn, sin email)', () => {
  it('la vista previa dice 6 y NUNCA nombra los 8 de Apollo', () => {
    const preview = buildLegacyPhoneRevealAuthorizationPreview(apolloLegacyEvidence(), {
      identitySearchAuthorized: true,
    });
    assert.equal(preview.eligible, true);
    assert.equal(preview.requiresIdentitySearch, true);
    assert.equal(preview.maxCredits, 6);

    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
      requiresIdentitySearch: true,
    });
    assert.equal(copy.maxCredits, 6);
    assert.equal(/14|13|hasta 8/.test(copy.helperText), false, copy.helperText);
  });

  it('autorizando 6: UNA corrida legacy, búsqueda ≤ 1, teléfono ≤ 5, Apollo 0', async () => {
    const { deps, credit } = startDeps();
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 6 },
      deps,
    );
    assert.equal(started.started, true);
    assert.equal(credit.createdRuns.length, 1);
    assert.deepEqual(reservedLegs(credit), [
      ['lusha', 'contact_search', 1],
      ['lusha', 'phone_reveal', 5],
    ]);
    assert.deepEqual(credit.poolQueries, [['lusha']]);

    const h = continueHarness();
    const continued = await continuePhoneRevealWaterfall(
      { candidateId: 'cand-luis', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(continued.outcome, 'lusha_revealed');
    assert.equal(h.identityCalls, 1);
    assert.equal(h.lushaRevealCalls, 1);
    // La corrida NUNCA sella un intento de Apollo: no lo hubo.
    assert.equal(credit.createdDrafts[0].apolloAttemptedAt, null);
  });

  it('la segunda autorización, ya con identidad persistida, cuesta 5 y no busca', async () => {
    const { deps, credit } = startDeps({
      loadLegacyEvidence: async () =>
        apolloLegacyEvidence({ providerIdentities: [persistedLushaIdentity()] }),
    });
    const started = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-luis', acceptedMaxCredits: 5 },
      deps,
    );
    assert.equal(started.started === true && started.maxCreditsAuthorized, 5);
    assert.deepEqual(reservedLegs(credit), [['lusha', 'phone_reveal', 5]]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 8 — el copy de la autorización legacy
// ═══════════════════════════════════════════════════════════════

describe('§ 8 — copy: dice que Apollo ya fue consultado y NO ofrece reintentarlo', () => {
  it('con identidad persistida: hasta 5 y sin desglose', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
      requiresIdentitySearch: false,
    });
    assert.equal(copy.maxCredits, 5);
    assert.equal(copy.creditBreakdown, null);
    assert.ok(/hasta 5 créditos/.test(copy.creditsMessage), copy.creditsMessage);
  });

  it('sin identidad: hasta 6, desglosado en búsqueda 1 + teléfono 5', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
      requiresIdentitySearch: true,
    });
    assert.equal(copy.maxCredits, 6);
    assert.ok(/hasta 6 créditos/.test(copy.creditsMessage), copy.creditsMessage);
    assert.ok(/búsqueda hasta 1/.test(copy.creditsMessage), copy.creditsMessage);
    assert.ok(/teléfono hasta 5/.test(copy.creditsMessage), copy.creditsMessage);
    assert.ok(copy.creditBreakdown);
    assert.equal(copy.creditBreakdown?.legs.length, 2);
    assert.ok(/Máximo total autorizado: 6 créditos/.test(copy.creditBreakdown?.total ?? ''));
  });

  it('no oculta que Apollo ya fue consultado, y no promete reintentarlo', () => {
    const copy = getPhoneRevealWaterfallAuthorizationCopy({
      lushaEligible: true,
      legacyLushaOnly: true,
      requiresIdentitySearch: true,
    });
    assert.ok(/Apollo ya fue consultado/i.test(copy.flowDescription), copy.flowDescription);
    assert.ok(/No se volverá a consultar/i.test(copy.flowDescription), copy.flowDescription);
    assert.equal(/Revelar teléfono con Apollo/i.test(copy.helperText), false);
    // Y en ninguna de las dos modalidades legacy aparece la cifra del flujo completo.
    for (const requiresIdentitySearch of [true, false]) {
      const c = getPhoneRevealWaterfallAuthorizationCopy({
        lushaEligible: true,
        legacyLushaOnly: true,
        requiresIdentitySearch,
      });
      assert.equal(/\b13\b|\b14\b/.test(c.helperText), false, c.helperText);
    }
  });
});
