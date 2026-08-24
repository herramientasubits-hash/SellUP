// Tests — el waterfall Apollo → Lusha es el comportamiento NORMAL del botón
// «Revelar teléfono» (Agente 2A · AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1).
//
// QUÉ SE CORRIGE. La autorización de ROL partía el producto en dos: un `admin`
// obtenía Apollo → Lusha y un `commercial_manager` —que SÍ puede revelar teléfono—
// se quedaba en Apollo-only, porque el waterfall tenía una lista de roles PROPIA y
// más estrecha. El rol debe decidir SI el actor puede revelar, nunca QUÉ flujo
// corre. El interruptor del flujo es el flag `ENABLE_PHONE_REVEAL_WATERFALL`.
//
// CONTRATO VERIFICADO AQUÍ:
//   A. admin + flag ON + candidato Apollo sin identidad Lusha persistida pero CON
//      identificadores exactos ⇒ tope 14 y corrida de waterfall.
//   B. commercial_manager, MISMO candidato ⇒ contrato IDÉNTICO al de admin.
//   C/D. flag OFF ⇒ Apollo-only (8) para los dos roles, sin corrida.
//   E. identidad Lusha ya persistida ⇒ 0 búsqueda, tope 13.
//   F. sin identificador exacto de búsqueda ⇒ NO se inventa un 14.
//   G. rol sin permiso de revelar ⇒ bloqueado exactamente como antes.
//   I. ruta legacy ⇒ el rol autorizado la abre sin reintentar Apollo, tope 5.
//   J/K. la pata Lusha nunca corre sin autoridad válida ni con supresión/DNC.
//   L. los topes de la migración 124 (1 / 5 / 8 / 13 / 14) siguen intactos.
//
// OFFLINE por construcción: deps inyectadas, cero red, cero DB, cero Apollo, cero
// Lusha, cero créditos, cero escrituras. Nada aquí puede gastar dinero.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneRevealWaterfallAuthorizationPreview,
  continuePhoneRevealWaterfall,
  decidePhoneRevealWaterfallContinuation,
  doesRunAuthorizeIdentitySearch,
  evaluatePhoneRevealWaterfallLushaLeg,
  isPhoneRevealWaterfallRoleAuthorized,
  startLegacyPhoneRevealWaterfall,
  startPhoneRevealWaterfall,
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
  type ContinuePhoneRevealWaterfallDeps,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallRunDraft,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
} from '../phone-reveal-waterfall-core';
import {
  isPhoneRevealRoleAuthorized,
  PHONE_REVEAL_AUTHORIZED_ROLE_KEYS,
} from '../phone-reveal-authorized-roles';
import { PHONE_REVEAL_AUTHORIZED_ROLE_KEYS as CORE_REEXPORTED_ROLE_KEYS } from '../phone-reveal-core';
import { SEARCH_MORE_PHONES_AUTHORIZED_ROLE_KEYS } from '../search-more-phones-planner';
import {
  ACCEPTED_CEILING_NOT_UNDER_TEST,
  creditHarness,
  type CreditHarness,
} from './phone-reveal-credit-reservation-fixtures';

const NOW_ISO = '2026-08-24T12:00:00.000Z';

/** Los dos roles que el contrato de Product declara equivalentes. */
const REVEAL_ROLES = ['admin', 'commercial_manager'] as const;
/** Roles que NUNCA pudieron revelar teléfono. Este hito no los toca. */
const NON_REVEAL_ROLES = ['seller', 'seller_bd', 'lead', 'viewer', '', null] as const;

// ── Fixtures de candidato ──────────────────────────────────────

/**
 * «Candidato Jaime»: nacido en Apollo, con email y LinkedIn, sin teléfono y SIN
 * identidad de Lusha persistida. Es el caso que el hito desbloquea: Lusha puede
 * alcanzarlo, pero primero hay que pagar por saber con qué id lo conoce.
 */
function apolloCandidateWithSearchableIdentity(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'cand-jaime',
    source: 'apollo',
    sourceContactId: '0123456789abcdef01234567',
    hasPhone: false,
    phoneRevealStatus: null,
    // Ninguna identidad provider-native persistida todavía.
    providerIdentities: [],
    identitySearchFacts: {
      firstName: 'Jaime',
      lastName: 'Pruebas',
      linkedinUrl: 'https://www.linkedin.com/in/jaime-pruebas',
      email: 'jaime@ejemplo.test',
      companyName: 'Empresa De Prueba',
      companyDomain: 'ejemplo.test',
    },
    ...overrides,
  };
}

/** El mismo candidato Apollo, pero con la identidad de Lusha YA persistida. */
function apolloCandidateWithPersistedLushaIdentity(): PhoneRevealWaterfallCandidateRecord {
  return apolloCandidateWithSearchableIdentity({
    providerIdentities: [
      {
        candidateId: 'cand-jaime',
        providerKey: 'lusha',
        providerContactId: 'lusha-native-id-opaco',
        resolutionSource: 'provider_search_linkedin_url',
      },
    ],
  });
}

/** Candidato Apollo SIN nada con lo que construir una búsqueda exacta. */
function apolloCandidateWithoutSearchableIdentity(): PhoneRevealWaterfallCandidateRecord {
  return apolloCandidateWithSearchableIdentity({
    identitySearchFacts: {
      firstName: null,
      lastName: null,
      linkedinUrl: null,
      email: null,
      companyName: null,
      companyDomain: null,
    },
  });
}

// ── Harness del ARRANQUE ───────────────────────────────────────

interface StartHarness {
  created: PhoneRevealWaterfallRunDraft[];
  loadedCandidate: boolean;
  poolQueries: readonly string[][];
  credit: CreditHarness;
  deps: Parameters<typeof startPhoneRevealWaterfall>[1];
}

function startHarness(opts: {
  flagEnabled?: boolean;
  roleKey?: string | null;
  candidate?: PhoneRevealWaterfallCandidateRecord;
} = {}): StartHarness {
  const credit = creditHarness();
  const harness: StartHarness = {
    created: credit.createdDrafts,
    loadedCandidate: false,
    poolQueries: credit.poolQueries,
    credit,
    deps: {
      flagEnabled: opts.flagEnabled ?? true,
      // `roleKey` se pasa TAL CUAL, incluido `null`: este harness no lo sustituye
      // por 'admin', porque el rol es justo lo que estas pruebas miden.
      actor: {
        internalUserId: 'user-1',
        roleKey: opts.roleKey === undefined ? 'admin' : opts.roleKey,
      },
      nowIso: NOW_ISO,
      loadCandidate: async () => {
        harness.loadedCandidate = true;
        return opts.candidate ?? apolloCandidateWithSearchableIdentity();
      },
      findActiveRun: async () => null,
      ...credit.deps,
    },
  };
  return harness;
}

// ═══════════════════════════════════════════════════════════════
// 0. La autoridad: UNA sola, reutilizada
// ═══════════════════════════════════════════════════════════════

describe('§ 1-2 — autoridad canónica única', () => {
  test('PHONE_REVEAL_ALLOWED es admin + commercial_manager, y nada más', () => {
    assert.deepEqual([...PHONE_REVEAL_AUTHORIZED_ROLE_KEYS], [...REVEAL_ROLES]);
    for (const role of REVEAL_ROLES) assert.equal(isPhoneRevealRoleAuthorized(role), true, role);
    for (const role of NON_REVEAL_ROLES) {
      assert.equal(isPhoneRevealRoleAuthorized(role), false, JSON.stringify(role));
    }
    // Un rol con espacios alrededor sigue siendo el mismo rol; uno desconocido, no.
    assert.equal(isPhoneRevealRoleAuthorized('  admin  '), true);
    assert.equal(isPhoneRevealRoleAuthorized('administrador'), false);
    assert.equal(isPhoneRevealRoleAuthorized(undefined), false);
  });

  test('WATERFALL_ALLOWED(actor) === PHONE_REVEAL_ALLOWED(actor), rol por rol', () => {
    for (const role of [...REVEAL_ROLES, ...NON_REVEAL_ROLES]) {
      assert.equal(
        isPhoneRevealWaterfallRoleAuthorized(role),
        isPhoneRevealRoleAuthorized(role),
        JSON.stringify(role),
      );
    }
  });

  test('el core del reveal Apollo consume la MISMA lista (no una copia)', () => {
    assert.equal(CORE_REEXPORTED_ROLE_KEYS, PHONE_REVEAL_AUTHORIZED_ROLE_KEYS);
  });

  test('«Buscar más números» conserva su propia lista admin-only', () => {
    // No es el botón «Revelar teléfono»: es una compra ADICIONAL. Ensanchar el
    // waterfall NO la ensancha, y este test es lo que impide que se acople otra vez.
    assert.deepEqual([...SEARCH_MORE_PHONES_AUTHORIZED_ROLE_KEYS], ['admin']);
    assert.notEqual(
      SEARCH_MORE_PHONES_AUTHORIZED_ROLE_KEYS,
      PHONE_REVEAL_AUTHORIZED_ROLE_KEYS,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// A / B — mismo candidato, mismo contrato para los dos roles
// ═══════════════════════════════════════════════════════════════

describe('§ 11.A/B — admin y commercial_manager obtienen el MISMO contrato', () => {
  test('A. admin + flag ON + Apollo sin id Lusha + identificadores exactos ⇒ 14', async () => {
    const h = startHarness({ roleKey: 'admin' });
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);

    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 14);
    assert.equal(result.started && result.lushaEligible, true);
    assert.equal(result.started && result.requiresIdentitySearch, true);
    // La corrida es del flujo completo y guarda el tope que el operador aceptó.
    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].runMode, 'full_waterfall');
    assert.equal(h.created[0].maxCreditsAuthorized, 14);
    assert.equal(h.created[0].authorizedByRole, 'admin');
  });

  test('B. commercial_manager, MISMO candidato ⇒ desenlace idéntico', async () => {
    const admin = startHarness({ roleKey: 'admin' });
    const manager = startHarness({ roleKey: 'commercial_manager' });

    const adminResult = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, admin.deps);
    const managerResult = await startPhoneRevealWaterfall(
      { candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      manager.deps,
    );

    assert.deepEqual(managerResult, adminResult);
    // Y la corrida es la misma salvo por el rol REGISTRADO, que no se falsifica.
    assert.equal(manager.created.length, 1);
    assert.equal(manager.created[0].authorizedByRole, 'commercial_manager');
    assert.deepEqual(
      { ...manager.created[0], authorizedByRole: null },
      { ...admin.created[0], authorizedByRole: null },
    );
    // Mismos pozos consultados: el rol no cambia qué proveedores se reservan.
    assert.deepEqual([...manager.poolQueries], [...admin.poolQueries]);
  });

  test('B. los dos roles reservan las MISMAS patas (búsqueda incluida)', async () => {
    const legsByRole = new Map<string, unknown>();
    for (const role of REVEAL_ROLES) {
      const h = startHarness({ roleKey: role });
      await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);
      assert.equal(h.credit.reserveRequests.length, 1, role);
      legsByRole.set(role, h.credit.reserveRequests[0].legs);
    }
    assert.deepEqual(legsByRole.get('commercial_manager'), legsByRole.get('admin'));
  });
});

// ═══════════════════════════════════════════════════════════════
// C / D — flag OFF: histórico Apollo-only para los dos roles
// ═══════════════════════════════════════════════════════════════

describe('§ 11.C/D — flag OFF conserva Apollo-only para todo rol autorizado', () => {
  test('ningún rol abre corrida con el flag apagado', async () => {
    for (const role of REVEAL_ROLES) {
      const h = startHarness({ roleKey: role, flagEnabled: false });
      const result = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);
      assert.deepEqual(result, { started: false, reason: 'feature_disabled' }, role);
      // Y no se toca NADA: ni el candidato, ni el presupuesto, ni la reserva.
      assert.equal(h.loadedCandidate, false, role);
      assert.equal(h.created.length, 0, role);
      assert.equal(h.poolQueries.length, 0, role);
      assert.equal(h.credit.reserveRequests.length, 0, role);
    }
  });

  test('el tope Apollo-only sigue siendo 8, sin pata de Lusha ni búsqueda', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS, 8);
    const preview = buildPhoneRevealWaterfallAuthorizationPreview({
      source: 'apollo',
      sourceContactId: 'apollo-id',
      // Sin identidades y sin hechos: es la proyección que produce la lectura
      // cuando el waterfall está apagado (`includeIdentityFacts` ausente).
    });
    assert.deepEqual(preview, {
      lushaEligible: false,
      requiresIdentitySearch: false,
      maxCredits: 8,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// E / F — el tope depende de HECHOS, nunca del rol
// ═══════════════════════════════════════════════════════════════

describe('§ 11.E/F + § 6 — el tope sale de los hechos del candidato', () => {
  test('E. identidad Lusha ya persistida ⇒ 0 búsqueda y tope 13', async () => {
    for (const role of REVEAL_ROLES) {
      const h = startHarness({
        roleKey: role,
        candidate: apolloCandidateWithPersistedLushaIdentity(),
      });
      const result = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);
      assert.equal(result.started && result.maxCreditsAuthorized, 13, role);
      assert.equal(result.started && result.requiresIdentitySearch, false, role);
      assert.equal(result.started && result.lushaEligible, true, role);
      // 13 NO autoriza la búsqueda: la corrida no puede gastar un crédito que
      // nadie reservó ni le enseñó al operador.
      assert.equal(
        doesRunAuthorizeIdentitySearch({
          maxCreditsAuthorized: 13,
          runMode: 'full_waterfall',
        }),
        false,
        role,
      );
    }
  });

  test('F. sin identificador exacto de búsqueda ⇒ 8, nunca un 14 inventado', async () => {
    for (const role of REVEAL_ROLES) {
      const h = startHarness({
        roleKey: role,
        candidate: apolloCandidateWithoutSearchableIdentity(),
      });
      const result = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);
      assert.equal(result.started && result.maxCreditsAuthorized, 8, role);
      assert.equal(result.started && result.lushaEligible, false, role);
      assert.equal(result.started && result.requiresIdentitySearch, false, role);
      assert.equal(h.created[0].lushaSkippedReason, 'missing_lusha_contact_id', role);
    }
  });

  test('la vista previa del botón y el arranque salen de la MISMA función', async () => {
    // § 4 + § 5: si el copy y la reserva se calcularan por separado podrían discrepar,
    // y es exactamente cómo se enseña 8 y se reserva 14. Se comprueba caso por caso.
    const cases: Array<[string, PhoneRevealWaterfallCandidateRecord, number]> = [
      ['búsqueda pagada', apolloCandidateWithSearchableIdentity(), 14],
      ['identidad persistida', apolloCandidateWithPersistedLushaIdentity(), 13],
      ['sin nada que buscar', apolloCandidateWithoutSearchableIdentity(), 8],
    ];
    for (const [label, candidate, expected] of cases) {
      const preview = buildPhoneRevealWaterfallAuthorizationPreview(candidate);
      assert.equal(preview.maxCredits, expected, label);

      const h = startHarness({ candidate });
      const result = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);
      assert.equal(result.started && result.maxCreditsAuthorized, preview.maxCredits, label);
      assert.equal(result.started && result.lushaEligible, preview.lushaEligible, label);
      assert.equal(
        result.started && result.requiresIdentitySearch,
        preview.requiresIdentitySearch,
        label,
      );
    }
  });

  test('la vista previa NO depende del rol (los hechos son los mismos)', () => {
    // No recibe actor a propósito: es una función de HECHOS. Si algún día alguien
    // le pasara un rol, esta prueba deja de compilar y la decisión se ve.
    assert.equal(buildPhoneRevealWaterfallAuthorizationPreview.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// G — el rol sin permiso de revelar sigue bloqueado
// ═══════════════════════════════════════════════════════════════

describe('§ 11.G — no se amplía a ningún rol nuevo', () => {
  test('rol sin permiso de revelar: ni corrida, ni candidato leído, ni presupuesto', async () => {
    for (const role of NON_REVEAL_ROLES) {
      const h = startHarness({ roleKey: role });
      const result = await startPhoneRevealWaterfall({ candidateId: 'cand-jaime', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, h.deps);
      assert.deepEqual(
        result,
        { started: false, reason: 'role_not_allowed' },
        JSON.stringify(role),
      );
      assert.equal(h.loadedCandidate, false, JSON.stringify(role));
      assert.equal(h.created.length, 0, JSON.stringify(role));
      assert.equal(h.poolQueries.length, 0, JSON.stringify(role));
      assert.equal(h.credit.reserveRequests.length, 0, JSON.stringify(role));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// I — ruta legacy: mismo permiso, sin recobrar Apollo
// ═══════════════════════════════════════════════════════════════

interface LegacyHarness {
  drafts: PhoneRevealWaterfallRunDraft[];
  credit: CreditHarness;
  deps: Parameters<typeof startLegacyPhoneRevealWaterfall>[1];
}

function legacyHarness(roleKey: string | null): LegacyHarness {
  const credit = creditHarness();
  const evidence: PhoneRevealWaterfallLegacyEvidence = {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-08-01T10:00:00.000Z',
    hasPhone: false,
    source: 'lusha',
    sourceContactId: 'lusha-own-id',
  };
  return {
    drafts: credit.createdDrafts,
    credit,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: 'user-1', roleKey },
      nowIso: NOW_ISO,
      loadLegacyEvidence: async () => evidence,
      findActiveRun: async () => null,
      findLatestRun: async () => null,
      ...credit.deps,
    },
  };
}

describe('§ 9 + § 11.I — ruta legacy solo-Lusha', () => {
  test('todo rol con permiso de revelar puede reautorizarla, con tope 5', async () => {
    for (const role of REVEAL_ROLES) {
      const h = legacyHarness(role);
      const result = await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-x' }, h.deps);
      assert.equal(result.started, true, role);
      assert.equal(h.drafts.length, 1, role);
      const draft = h.drafts[0];
      assert.equal(draft.runMode, 'legacy_lusha_only', role);
      // NO se vuelve a cobrar Apollo: ni tope, ni timestamp, ni costo.
      assert.equal(draft.maxCreditsAuthorized, PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, role);
      assert.equal(draft.maxCreditsAuthorized, 5, role);
      assert.equal(draft.apolloAttemptedAt, null, role);
      assert.equal(draft.apolloOutcome, 'no_phone_found', role);
      assert.equal(draft.authorizedByRole, role, role);
      // Y su autorización NO cubre la búsqueda de identidad: en modalidad legacy el
      // umbral es 6 (búsqueda 1 + teléfono 5) y esta corrida reservó 5
      // (AGENT2A-LEGACY-CROSS-PROVIDER-LUSHA-CONTINUATION-1).
      assert.equal(
        doesRunAuthorizeIdentitySearch({
          maxCreditsAuthorized: draft.maxCreditsAuthorized,
          runMode: 'legacy_lusha_only',
        }),
        false,
        role,
      );
      // Solo el pozo de Lusha: Apollo no participa en esta autorización.
      assert.deepEqual([...h.credit.poolQueries], [['lusha']], role);
    }
  });

  test('un rol sin permiso de revelar sigue rechazado en la ruta legacy', async () => {
    for (const role of NON_REVEAL_ROLES) {
      const h = legacyHarness(role);
      const result = await startLegacyPhoneRevealWaterfall({ candidateId: 'cand-x' }, h.deps);
      assert.equal(result.started, false, JSON.stringify(role));
      assert.equal(
        result.started === false && result.reason,
        'role_not_allowed',
        JSON.stringify(role),
      );
      assert.equal(h.drafts.length, 0, JSON.stringify(role));
      assert.equal(h.credit.poolQueries.length, 0, JSON.stringify(role));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// J / K — la continuación no gasta sin autoridad ni con supresión
// ═══════════════════════════════════════════════════════════════

function activeRun(
  overrides: Partial<PhoneRevealWaterfallRunRecord> = {},
): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-1',
    candidateId: 'cand-jaime',
    status: 'apollo_in_flight',
    runMode: 'full_waterfall',
    authorizedAt: NOW_ISO,
    authorizedBy: 'user-1',
    authorizedByRole: 'commercial_manager',
    maxCreditsAuthorized: PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
    apolloAttemptedAt: NOW_ISO,
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
    creditReservationGroupId: 'group-1',
    ...overrides,
  };
}

interface ContinueHarness {
  lushaCalls: Array<{ authorizedByRole: string | null }>;
  patches: PhoneRevealWaterfallRunPatch[];
  deps: ContinuePhoneRevealWaterfallDeps;
}

/**
 * Harness de la CONTINUACIÓN. Mismo cableado que la suite del core (una sola
 * llamada, claim atómico), reducido a lo que este hito mide: qué recibe la pata.
 */
function continueHarness(run: PhoneRevealWaterfallRunRecord): ContinueHarness {
  let claimedOnce = false;
  const h: ContinueHarness = {
    lushaCalls: [],
    patches: [],
    deps: {
      flagEnabled: true,
      lushaFallbackFlagEnabled: true,
      nowIso: NOW_ISO,
      findActiveRun: async () => run,
      loadCandidate: async () => apolloCandidateWithPersistedLushaIdentity(),
      updateRun: async (_runId, patch) => {
        h.patches.push(patch);
      },
      checkSuppressionAndDoNotContact: async () => 'clear',
      claimLushaAttempt: async () => {
        if (claimedOnce) return false;
        claimedOnce = true;
        return true;
      },
      callLushaLeg: async (args) => {
        h.lushaCalls.push(args);
        return { status: 'no_phone_found', creditsCharged: 0, errorCode: null };
      },
    },
  };
  return h;
}

describe('§ 8 + § 11.J/K — la 2ª pata sigue fail-closed', () => {
  test('K. supresión o DNC ⇒ 0 llamadas a proveedor, también para commercial_manager', () => {
    for (const state of [
      { suppressed: true, doNotContact: false, evaluated: true },
      { suppressed: false, doNotContact: true, evaluated: true },
      // No evaluable: no se sabe si está suprimido, así que NO se llama.
      { suppressed: false, doNotContact: false, evaluated: false },
    ]) {
      const decision = decidePhoneRevealWaterfallContinuation({
        flagEnabled: true,
        lushaFallbackFlagEnabled: true,
        nowIso: NOW_ISO,
        run: activeRun({ authorizedByRole: 'commercial_manager' }),
        apolloOutcome: 'no_phone_found',
        candidate: apolloCandidateWithPersistedLushaIdentity(),
      });
      // El camino llega a la re-comprobación de privacidad, nunca directo a Lusha.
      assert.equal(decision.action, 'check_suppression', JSON.stringify(state));
    }
  });

  test('J/G. un rol almacenado sin permiso de revelar aborta la continuación', () => {
    for (const role of NON_REVEAL_ROLES) {
      const decision = decidePhoneRevealWaterfallContinuation({
        flagEnabled: true,
        lushaFallbackFlagEnabled: true,
        nowIso: NOW_ISO,
        run: activeRun({ authorizedByRole: role }),
        apolloOutcome: 'no_phone_found',
        candidate: apolloCandidateWithPersistedLushaIdentity(),
      });
      assert.equal(decision.action, 'close', JSON.stringify(role));
      assert.equal(
        decision.action === 'close' && decision.patch.lushaSkippedReason,
        'role_not_allowed',
        JSON.stringify(role),
      );
    }
  });

  test('la pata Lusha recibe el ROL almacenado, para poder revalidarlo', async () => {
    // Es lo que permite que el ejecutor real no dé por hecho que quien autorizó era
    // admin: sin este dato, un token de servicio convertiría cualquier corrida en
    // una llamada pagada.
    const h = continueHarness(activeRun({ authorizedByRole: 'commercial_manager' }));
    await continuePhoneRevealWaterfall(
      { candidateId: 'cand-jaime', apolloOutcome: 'no_phone_found' },
      h.deps,
    );
    assert.equal(h.lushaCalls.length, 1);
    assert.equal(h.lushaCalls[0].authorizedByRole, 'commercial_manager');
  });
});

// ═══════════════════════════════════════════════════════════════
// L — los topes de la migración 124 no se mueven
// ═══════════════════════════════════════════════════════════════

describe('§ 7 + § 11.L — el contrato de crédito queda intacto', () => {
  test('1 / 5 / 8 / 13 / 14, y cada total es la suma de sus patas', () => {
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS, 1);
    assert.equal(PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS, 5);
    assert.equal(PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS, 8);
    assert.equal(PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA, 13);
    assert.equal(PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH, 14);
    assert.equal(
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
      PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS + PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS,
    );
    assert.equal(
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
      PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA +
        PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS,
    );
    assert.equal(PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS, 5);
  });

  test('el umbral que autoriza la búsqueda es 14 en el flujo completo, y es un UMBRAL', () => {
    const full = (maxCreditsAuthorized: number) =>
      doesRunAuthorizeIdentitySearch({ maxCreditsAuthorized, runMode: 'full_waterfall' });
    assert.equal(full(13), false);
    assert.equal(full(14), true);
    assert.equal(full(20), true);
  });

  test('una autorización que no cubre la búsqueda deja la pata Lusha inalcanzable', () => {
    // Corrida legacy (5 créditos): la vía de pago NO existe para ella, así que el
    // veredicto vuelve a ser el de antes del hito. Es la verdad para esa corrida.
    const leg = evaluatePhoneRevealWaterfallLushaLeg(
      apolloCandidateWithSearchableIdentity(),
      { identitySearchAuthorized: false },
    );
    assert.equal(leg.eligible, false);
    assert.equal(leg.requiresIdentitySearch, false);
    assert.equal(leg.skippedReason, 'missing_lusha_contact_id');
  });
});
