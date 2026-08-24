// Tests — el tope que el operador VIO es un LÍMITE SUPERIOR DURO
// (Agente 2A · AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1-R2)
//
// QUÉ SE CORRIGE. El copy del botón resuelve su tope ANTES del clic, con una lectura
// que puede fallar o quedarse vieja. Cuando fallaba, la UI caía —bien— a su suelo
// conservador de 8. Pero el arranque volvía a resolver la modalidad REAL en el clic y
// reservaba lo que esa modalidad exigía, sin mirar lo que la persona había aceptado.
// Secuencia completa del defecto:
//
//   vista previa falla → el botón dice «hasta 8 créditos» → la persona autoriza 8
//   → el clic envía expectedMaxCredits = 8 → el servidor resuelve 14 → reserva 14
//   → el core de Apollo acepta, porque 8 >= el tope de Apollo (8).
//
// Es decir: se reservaba un máximo que nadie aprobó, y la única validación que existía
// —«¿aceptaste al menos los 8 de Apollo?»— no podía verlo, porque compara contra la
// pata de Apollo, no contra la modalidad.
//
// CONTRATO VERIFICADO AQUÍ:
//   1. El techo aceptado se compara contra el REQUERIDO, y hacerlo ANTES de tocar el
//      presupuesto o la transacción de reserva: aceptado < requerido ⇒ 0 consultas de
//      pozo, 0 reservas, 0 corridas, 0 proveedores, 0 créditos.
//   2. Aceptar de MÁS es seguro y se permite, pero lo que se RESERVA sigue siendo lo
//      requerido: un operador generoso no encarece su propia corrida.
//   3. Aceptar de MENOS nunca se reinterpreta: no se sube el techo en silencio y no se
//      cae al flujo Apollo-only, que sería gastar 8 que tampoco pidió bajo esa lectura.
//   4. Omitir el techo equivale al suelo conservador de 8, jamás a la modalidad
//      requerida: un cliente que no lo manda no puede acabar autorizando el más caro.
//   5. La ruta legacy solo-Lusha conserva su tope 5 y su propio arranque: este cambio
//      no la convierte en una autorización de 13/14.
//
// OFFLINE por construcción: deps inyectadas, cero red, cero DB, cero Apollo, cero
// Lusha, cero créditos, cero escrituras. Nada aquí puede gastar dinero.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPhoneRevealWaterfallAuthorizationCeilingHonored,
  normalizePhoneRevealWaterfallAcceptedMaxCredits,
  startLegacyPhoneRevealWaterfall,
  startPhoneRevealWaterfall,
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH,
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLegacyEvidence,
  type PhoneRevealWaterfallRunDraft,
} from '../phone-reveal-waterfall-core';
import { creditHarness, type CreditHarness } from './phone-reveal-credit-reservation-fixtures';

const NOW_ISO = '2026-08-24T12:00:00.000Z';

// ── Fixtures: un candidato por MODALIDAD ───────────────────────

/**
 * Requiere 14: Apollo, sin identidad de Lusha persistida, pero con identificadores
 * exactos con los que pagar una búsqueda. Es el candidato del defecto original.
 */
function requires14(): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'cand-14',
    source: 'apollo',
    sourceContactId: '0123456789abcdef01234567',
    hasPhone: false,
    phoneRevealStatus: null,
    providerIdentities: [],
    identitySearchFacts: {
      firstName: 'Jaime',
      lastName: 'Pruebas',
      linkedinUrl: 'https://www.linkedin.com/in/jaime-pruebas',
      email: 'jaime@ejemplo.test',
      companyName: 'Empresa De Prueba',
      companyDomain: 'ejemplo.test',
    },
  };
}

/** Requiere 13: la identidad de Lusha YA está persistida, así que no hay que buscarla. */
function requires13(): PhoneRevealWaterfallCandidateRecord {
  return {
    ...requires14(),
    id: 'cand-13',
    providerIdentities: [
      {
        candidateId: 'cand-13',
        providerKey: 'lusha',
        providerContactId: 'lusha-native-id-opaco',
        resolutionSource: 'provider_search_linkedin_url',
      },
    ],
  };
}

/** Requiere 8: ni identidad persistida ni nada con lo que buscarla ⇒ Apollo-only. */
function requires8(): PhoneRevealWaterfallCandidateRecord {
  return {
    ...requires14(),
    id: 'cand-8',
    identitySearchFacts: {
      firstName: null,
      lastName: null,
      linkedinUrl: null,
      email: null,
      companyName: null,
      companyDomain: null,
    },
  };
}

// ── Harness del ARRANQUE ───────────────────────────────────────

interface CeilingHarness {
  /** Corridas realmente ESCRITAS. Debe quedar vacío en todo bloqueo. */
  created: PhoneRevealWaterfallRunDraft[];
  /** Proveedores por los que se PREGUNTÓ presupuesto. El delator del orden. */
  poolQueries: readonly string[][];
  credit: CreditHarness;
  deps: Parameters<typeof startPhoneRevealWaterfall>[1];
}

function harness(candidate: PhoneRevealWaterfallCandidateRecord): CeilingHarness {
  const credit = creditHarness();
  return {
    created: credit.createdDrafts,
    poolQueries: credit.poolQueries,
    credit,
    deps: {
      flagEnabled: true,
      actor: { internalUserId: 'user-1', roleKey: 'admin' },
      nowIso: NOW_ISO,
      loadCandidate: async () => candidate,
      findActiveRun: async () => null,
      ...credit.deps,
    },
  };
}

/**
 * Afirma la garantía COMPLETA de un bloqueo por techo: ni un pozo consultado, ni una
 * reserva emitida, ni una corrida escrita, ni un borrador enviado.
 *
 * Los pozos son lo que hace de esto una prueba de ORDEN y no sólo de resultado: si
 * alguien moviera la comparación después de la reserva, `poolQueries` dejaría de estar
 * vacío aunque el desenlace final siguiera siendo un bloqueo.
 */
function assertNothingHappened(h: CeilingHarness, label: string): void {
  assert.equal(h.poolQueries.length, 0, `${label}: presupuesto consultado`);
  assert.equal(h.credit.reserveRequests.length, 0, `${label}: reserva emitida`);
  assert.equal(h.credit.runDrafts.length, 0, `${label}: borrador de corrida enviado`);
  assert.equal(h.created.length, 0, `${label}: corrida escrita`);
  assert.equal(h.credit.createdRuns.length, 0, `${label}: corrida en el pozo simulado`);
  assert.equal(h.credit.active.length, 0, `${label}: exposición viva`);
}

// ═══════════════════════════════════════════════════════════════
// 0. La comparación, como función pura
// ═══════════════════════════════════════════════════════════════

describe('R2 § 0 — la comparación es un umbral, no una igualdad', () => {
  test('aceptado >= requerido pasa; aceptado < requerido no', () => {
    const honored = (requiredMaxCredits: number, acceptedMaxCredits: number) =>
      isPhoneRevealWaterfallAuthorizationCeilingHonored({
        requiredMaxCredits,
        acceptedMaxCredits,
      });
    assert.equal(honored(14, 14), true);
    assert.equal(honored(14, 15), true, 'aceptar de más es seguro');
    assert.equal(honored(14, 13), false);
    assert.equal(honored(14, 8), false);
    assert.equal(honored(13, 13), true);
    assert.equal(honored(13, 8), false);
    assert.equal(honored(8, 8), true);
    assert.equal(honored(8, 0), false);
  });

  test('un techo ausente o no finito equivale al suelo de 8, nunca a la modalidad', () => {
    const floor = PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS;
    assert.equal(normalizePhoneRevealWaterfallAcceptedMaxCredits(undefined), floor);
    assert.equal(normalizePhoneRevealWaterfallAcceptedMaxCredits(null), floor);
    assert.equal(normalizePhoneRevealWaterfallAcceptedMaxCredits(Number.NaN), floor);
    assert.equal(normalizePhoneRevealWaterfallAcceptedMaxCredits(Infinity), floor);
    // Un número real SÍ se respeta tal cual, incluso por encima del máximo.
    assert.equal(normalizePhoneRevealWaterfallAcceptedMaxCredits(13), 13);
    assert.equal(normalizePhoneRevealWaterfallAcceptedMaxCredits(99), 99);
  });
});

// ═══════════════════════════════════════════════════════════════
// 1. El caso del defecto: vista previa caída ⇒ 8 aceptado, 14 requerido
// ═══════════════════════════════════════════════════════════════

describe('R2 § 1 — vista previa caída: la UI ofrece 8 y el servidor exige 14', () => {
  test('el clic NO reserva 14: bloquea, y no queda nada que deshacer', async () => {
    const h = harness(requires14());

    const result = await startPhoneRevealWaterfall(
      // Exactamente lo que manda el drawer cuando su vista previa devolvió `null`.
      { candidateId: 'cand-14', acceptedMaxCredits: PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS },
      h.deps,
    );

    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'authorization_ceiling_mismatch');
    // El motivo lleva los dos enteros para que el wrapper pueda registrarlo sin volver
    // a resolver la modalidad.
    assert.equal(result.started === false && result.requiredMaxCredits, 14);
    assert.equal(result.started === false && result.acceptedMaxCredits, 8);
    assertNothingHappened(h, 'requerido 14 / aceptado 8');
  });

  test('omitir el techo se trata igual que enviar 8: bloquea', async () => {
    const h = harness(requires14());
    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-14' }, h.deps);
    assert.equal(result.started === false && result.reason, 'authorization_ceiling_mismatch');
    assert.equal(result.started === false && result.acceptedMaxCredits, 8);
    assertNothingHappened(h, 'requerido 14 / techo omitido');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. La matriz completa requerido × aceptado
// ═══════════════════════════════════════════════════════════════

describe('R2 § 2 — matriz requerido × aceptado', () => {
  const BLOCKED: Array<[string, () => PhoneRevealWaterfallCandidateRecord, number, number]> = [
    ['REQ14_ACCEPT8', requires14, 14, 8],
    ['REQ14_ACCEPT13', requires14, 14, 13],
    ['REQ13_ACCEPT8', requires13, 13, 8],
  ];

  for (const [label, candidate, required, accepted] of BLOCKED) {
    test(`${label} ⇒ bloqueado ANTES de la reserva`, async () => {
      const h = harness(candidate());
      const result = await startPhoneRevealWaterfall(
        { candidateId: candidate().id, acceptedMaxCredits: accepted },
        h.deps,
      );
      assert.equal(result.started, false, label);
      assert.equal(
        result.started === false && result.reason,
        'authorization_ceiling_mismatch',
        label,
      );
      assert.equal(result.started === false && result.requiredMaxCredits, required, label);
      assert.equal(result.started === false && result.acceptedMaxCredits, accepted, label);
      assertNothingHappened(h, label);
    });
  }

  const ALLOWED: Array<[string, () => PhoneRevealWaterfallCandidateRecord, number]> = [
    ['REQ14_ACCEPT14', requires14, PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH],
    ['REQ13_ACCEPT13', requires13, PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA],
    ['REQ8_ACCEPT8', requires8, PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS],
  ];

  for (const [label, candidate, exact] of ALLOWED) {
    test(`${label} ⇒ permitido, y la corrida guarda ESE tope`, async () => {
      const c = candidate();
      const h = harness(c);
      const result = await startPhoneRevealWaterfall(
        { candidateId: c.id, acceptedMaxCredits: exact },
        h.deps,
      );
      assert.equal(result.started, true, label);
      assert.equal(result.started && result.maxCreditsAuthorized, exact, label);
      assert.equal(h.created.length, 1, label);
      assert.equal(h.created[0].maxCreditsAuthorized, exact, label);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 3. Aceptar de más NO encarece la corrida
// ═══════════════════════════════════════════════════════════════

describe('R2 § 3 — aceptado > requerido: se reserva lo REQUERIDO', () => {
  test('aceptar 14 sobre una modalidad de 13 reserva 13, no 14', async () => {
    const h = harness(requires13());
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-13', acceptedMaxCredits: 14 },
      h.deps,
    );

    assert.equal(result.started, true);
    // Lo REQUERIDO, no lo aceptado. Reservar el techo generoso le quitaría al operador
    // disponibilidad por una búsqueda que esta corrida no puede llegar a ejecutar.
    assert.equal(result.started && result.maxCreditsAuthorized, 13);
    assert.equal(h.created[0].maxCreditsAuthorized, 13);
    // Y la exposición reservada suma 13, no 14.
    const reserved = h.credit.reserveRequests[0].legs.reduce(
      (total, leg) => total + leg.credits,
      0,
    );
    assert.equal(reserved, 13);
  });

  test('aceptar 14 sobre una modalidad Apollo-only reserva 8 y NO abre la pata Lusha', async () => {
    const h = harness(requires8());
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-8', acceptedMaxCredits: 14 },
      h.deps,
    );

    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 8);
    assert.equal(result.started && result.lushaEligible, false);
    // Sólo se pidió presupuesto de Apollo: aceptar de más no invita a un proveedor.
    assert.deepEqual([...h.poolQueries[0]], ['apollo']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. ORDEN: la comparación precede a TODO gasto
// ═══════════════════════════════════════════════════════════════

describe('R2 § 4 — la comparación va antes del presupuesto y de la reserva', () => {
  test('un bloqueo por techo no consulta ni un solo pozo', async () => {
    // Éste es el test de MUTACIÓN: mover la comparación detrás de
    // `reserveCreditsAndCreateRun` —o incluso sólo detrás del preflight de
    // presupuesto— hace que `poolQueries` deje de estar vacío y este test falle,
    // aunque el desenlace visible siguiera siendo un bloqueo. Reservar y liberar
    // después NO es equivalente: sigue siendo exposición que nadie autorizó.
    const h = harness(requires14());
    await startPhoneRevealWaterfall({ candidateId: 'cand-14', acceptedMaxCredits: 8 }, h.deps);
    assert.deepEqual([...h.poolQueries], []);
    assert.equal(h.credit.reserveRequests.length, 0);
  });

  test('el bloqueo NO cae al flujo Apollo-only por su cuenta', async () => {
    // Degradar a 8 sería gastar exactamente los créditos que la persona no autorizó
    // bajo la lectura correcta. El motivo tiene que ser propio para que la UI pueda
    // volver a preguntar en vez de cobrar.
    const h = harness(requires14());
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-14', acceptedMaxCredits: 8 },
      h.deps,
    );
    assert.notEqual(result.started === false && result.reason, 'insufficient_credits');
    assert.notEqual(result.started === false && result.reason, 'budget_not_configured');
    assert.equal(result.started === false && result.reason, 'authorization_ceiling_mismatch');
  });

  test('el mismo candidato con el techo correcto SÍ arranca: el gate es el techo, no el candidato', async () => {
    const blocked = harness(requires14());
    const allowed = harness(requires14());

    const no = await startPhoneRevealWaterfall(
      { candidateId: 'cand-14', acceptedMaxCredits: 13 },
      blocked.deps,
    );
    const yes = await startPhoneRevealWaterfall(
      { candidateId: 'cand-14', acceptedMaxCredits: 14 },
      allowed.deps,
    );

    assert.equal(no.started, false);
    assert.equal(yes.started, true);
    assert.equal(blocked.created.length, 0);
    assert.equal(allowed.created.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. La ruta legacy conserva su tope 5
// ═══════════════════════════════════════════════════════════════

describe('R2 § 5 — legacy solo-Lusha: sigue siendo 5 y sigue siendo suya', () => {
  test('el arranque legacy no consume el techo del waterfall completo', async () => {
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

    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-legacy' },
      {
        flagEnabled: true,
        actor: { internalUserId: 'user-1', roleKey: 'admin' },
        nowIso: NOW_ISO,
        loadLegacyEvidence: async () => evidence,
        findActiveRun: async () => null,
        findLatestRun: async () => null,
        ...credit.deps,
      },
    );

    assert.equal(result.started, true);
    assert.equal(credit.createdDrafts.length, 1);
    // 5, no 13 ni 14: este cambio no puede reinterpretar una autorización legacy.
    assert.equal(
      credit.createdDrafts[0].maxCreditsAuthorized,
      PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS,
    );
    assert.equal(credit.createdDrafts[0].maxCreditsAuthorized, 5);
    // Y sólo se pidió el pozo de Lusha: la ruta legacy no reintenta Apollo.
    assert.deepEqual([...credit.poolQueries[0]], ['lusha']);
  });
});
