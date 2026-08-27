/**
 * Agente 2A — PARIDAD DE RESCATE del contacto OFICIAL
 * (AGENT2A-POST-APPROVAL-RESCUE-PARITY).
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL DEFECTO QUE ESTE ARCHIVO CIERRA
 * ═══════════════════════════════════════════════════════════════════
 *
 * «El botón de revelar teléfono en contactos de empresas ya aprobados se queda cargando y no
 * encuentra teléfono.» No era un spinner mal pintado: era una pantalla SIN SALIDAS.
 *
 * La ficha del CANDIDATO tiene cuatro superficies y el operador las usa en cascada —reveal,
 * revisión manual, continuación a Lusha, buscar más números—. La del CONTACTO OFICIAL sólo tenía
 * la primera, y la primera es ASÍNCRONA: Apollo acepta y contesta por webhook. Si ese webhook
 * tardaba, se perdía o volvía vacío, no había NADA en esa pantalla capaz de mover el caso.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ SE MIDE, Y CÓMO
 * ═══════════════════════════════════════════════════════════════════
 *
 * Que NO hay un segundo waterfall, un segundo Search More ni un segundo recovery se mide contando
 * llamadas a dependencias inyectadas. Y la propiedad económica más importante de este hito se mide
 * igual: `startCandidateReveal` —la vía a APOLLO— tiene que quedar en CERO en las tres salidas.
 * Una continuación a Lusha que llamara a Apollo estaría cobrando 8 créditos que nadie autorizó.
 *
 * Determinista y offline: sin red, sin DB, sin proveedores, sin reloj. 0 créditos, 0 escrituras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY } from '../post-approval-reveal-core';
import type { ProjectApprovedCandidatePhonesOutcome } from '../post-approval-reveal-core';
import {
  classifyOfficialContactRescue,
  hasAnyOfficialContactRescue,
  type OfficialContactRescueInput,
} from '../post-approval-rescue-core';
import {
  runOfficialContactLushaContinuation,
  runOfficialContactRecoverReveal,
  runOfficialContactRescueOptions,
  runOfficialContactSearchMore,
  type OfficialContactRescueDeps,
} from '../post-approval-rescue-runtime';
import type { OfficialContactRevealContact } from '../post-approval-reveal-runtime';

const CANDIDATE_ID = '6e28099a-ad4e-492f-9ec4-65d766877696';
const CONTACT_ID = '45959dfa-9607-406e-bcd0-bcb9e78b9d4c';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';

const CONTACT: OfficialContactRevealContact = {
  id: CONTACT_ID,
  archivedAt: null,
  phone: null,
  mobilePhone: null,
  metadata: { [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: CANDIDATE_ID },
};

const PROJECTED: ProjectApprovedCandidatePhonesOutcome = {
  status: 'projected',
  detail: null,
  candidateId: CANDIDATE_ID,
  contactId: CONTACT_ID,
  phonesSeen: 1,
  phonesInserted: 1,
  phonesReused: 0,
  phonesSkippedSuppressed: 0,
  sourcesInserted: 1,
  sourcesReused: 0,
  primaryDedupeKey: 'a'.repeat(64),
  primaryElectedNow: true,
  scalarSynced: true,
  scalarFallback: 'promoted',
  hubspotSyncTransition: 'no_outbound_change',
};

interface Harness {
  readonly deps: OfficialContactRescueDeps;
  /** LA vía a APOLLO. Tiene que quedar en CERO en las tres salidas de rescate. */
  readonly apolloCalls: readonly unknown[];
  readonly recoveryCalls: readonly string[];
  readonly lushaCalls: readonly unknown[];
  readonly searchMoreCalls: readonly string[];
  readonly projectCalls: readonly unknown[];
}

function harness(
  over: {
    contact?: OfficialContactRevealContact | null;
    revealStatus?: string | null;
    hasRecoveryHandle?: boolean;
    liveOfficialPhoneCount?: number;
    legacyEligible?: boolean;
    legacyMaxCredits?: number;
    searchMoreAvailable?: boolean;
    rescueFactsThrow?: boolean;
    legacyPreviewThrows?: boolean;
    searchMorePreflightThrows?: boolean;
    recoveryRevealsPhone?: boolean;
    roleKey?: string | null;
  } = {},
): Harness {
  const apolloCalls: unknown[] = [];
  const recoveryCalls: string[] = [];
  const lushaCalls: unknown[] = [];
  const searchMoreCalls: string[] = [];
  const projectCalls: unknown[] = [];

  const deps: OfficialContactRescueDeps = {
    actor: {
      internalUserId: ACTOR_ID,
      roleKey: over.roleKey === undefined ? 'admin' : over.roleKey,
    },
    loadContact: async () => (over.contact === undefined ? CONTACT : over.contact),
    countLiveOfficialPhones: async () => over.liveOfficialPhoneCount ?? 0,
    countLiveCandidatePhones: async () => 0,
    loadCandidateRevealStatus: async () => over.revealStatus ?? null,
    loadAuthorizationPreview: async () => ({
      maxCredits: 14,
      requiresIdentitySearch: true,
      lushaEligible: true,
    }),
    startCandidateReveal: async (input) => {
      apolloCalls.push(input);
      return { ok: true, status: 'requested', errorCode: null };
    },
    project: async (args) => {
      projectCalls.push(args);
      return PROJECTED;
    },
    checkProjectionCapability: async () => true,
    runHubSpotPhoneSyncFollowUp: async () =>
      ({ status: 'skipped' }) as unknown as Awaited<
        ReturnType<OfficialContactRescueDeps['runHubSpotPhoneSyncFollowUp']>
      >,
    onReadUnavailable: () => {},

    loadRescueFacts: async () => {
      if (over.rescueFactsThrow) throw new Error('candidate rescue facts read failed');
      return {
        phoneRevealStatus: over.revealStatus ?? null,
        hasRecoveryHandle: over.hasRecoveryHandle ?? true,
      };
    },
    loadLegacyPreview: async () => {
      if (over.legacyPreviewThrows) throw new Error('legacy preview failed');
      return {
        eligible: over.legacyEligible ?? true,
        maxCredits: over.legacyMaxCredits ?? 5,
        requiresIdentitySearch: false,
      };
    },
    loadSearchMorePreflight: async () => {
      if (over.searchMorePreflightThrows) throw new Error('search more preflight failed');
      return { available: over.searchMoreAvailable ?? true, maxCredits: 5 };
    },
    recoverRevealNow: async (candidateId) => {
      recoveryCalls.push(candidateId);
      const revealed = over.recoveryRevealsPhone === true;
      return {
        ok: true,
        status: revealed ? 'revealed' : 'still_pending',
        phoneRevealed: revealed,
        noPhoneFound: false,
        stillPending: !revealed,
      };
    },
    startLushaContinuation: async (input) => {
      lushaCalls.push(input);
      return {
        status: 'completed',
        reason: null,
        maxCreditsAuthorized: 5,
        requiredMaxCredits: null,
      };
    },
    startSearchMore: async (candidateId) => {
      searchMoreCalls.push(candidateId);
      return { outcome: 'completed', reason: null, newDistinctPhoneCount: 2 };
    },
  };

  return { deps, apolloCalls, recoveryCalls, lushaCalls, searchMoreCalls, projectCalls };
}

// ═══════════════════════════════════════════════════════════════════
// 1. Qué se ofrece en cada estado (núcleo puro)
// ═══════════════════════════════════════════════════════════════════

const rescueInput = (over: Partial<OfficialContactRescueInput> = {}): OfficialContactRescueInput => ({
  revealState: 'in_flight',
  contactHasPhone: false,
  hasRecoveryHandle: true,
  legacy: { eligible: true, maxCredits: 5, requiresIdentitySearch: false },
  searchMore: { available: true, maxCredits: 5 },
  ...over,
});

describe('rescate — cada salida responde a una pregunta distinta', () => {
  it('EN VUELO: se ofrece revisar AHORA — es la salida del «se queda cargando»', () => {
    const view = classifyOfficialContactRescue(rescueInput({ revealState: 'in_flight' }));
    assert.equal(view.recovery.available, true);
  });

  it('EN VUELO sin identificador recuperable NO se ofrece revisar: no habría a qué preguntar', () => {
    const view = classifyOfficialContactRescue(
      rescueInput({ revealState: 'in_flight', hasRecoveryHandle: false }),
    );
    assert.equal(view.recovery.available, false);
  });

  it('EN VUELO NO se ofrece Lusha: Apollo todavía puede contestar y ya está pagado', () => {
    const view = classifyOfficialContactRescue(rescueInput({ revealState: 'in_flight' }));
    assert.equal(view.lushaContinuation.available, false);
  });

  it('EN VUELO NO se ofrece «buscar más»: pisaría una corrida viva', () => {
    const view = classifyOfficialContactRescue(rescueInput({ revealState: 'in_flight' }));
    assert.equal(view.searchMore.available, false);
  });

  for (const state of ['terminal_no_phone', 'terminal_failed'] as const) {
    it(`${state}: SÍ se ofrece la continuación a Lusha, con su tope leído`, () => {
      const view = classifyOfficialContactRescue(rescueInput({ revealState: state }));
      assert.equal(view.lushaContinuation.available, true);
      assert.equal(view.lushaContinuation.maxCredits, 5);
      assert.equal(view.recovery.available, false, 'no hay nada que recuperar de un caso cerrado');
    });
  }

  it('cerrado sin número pero con teléfono YA en el contacto: Lusha no, «buscar más» sí', () => {
    const view = classifyOfficialContactRescue(
      rescueInput({ revealState: 'terminal_no_phone', contactHasPhone: true }),
    );
    assert.equal(view.lushaContinuation.available, false);
    assert.equal(view.searchMore.available, true, 'los números ADICIONALES son su propósito');
  });

  it('si el subsistema legacy dice que NO es elegible, no se ofrece aunque haya cerrado vacío', () => {
    const view = classifyOfficialContactRescue(
      rescueInput({
        revealState: 'terminal_no_phone',
        legacy: { eligible: false, maxCredits: null, requiresIdentitySearch: false },
      }),
    );
    assert.equal(view.lushaContinuation.available, false);
  });

  it('ESTADO ILEGIBLE: no se ofrece NADA, ni siquiera lo gratis', () => {
    // Fail-closed en bloque. Sobre un candidato cuyo estado nadie entiende no se autoriza ni una
    // llamada gratis, porque «gratis» es una propiedad del camino que creemos estar tomando.
    const view = classifyOfficialContactRescue(rescueInput({ revealState: 'unreadable' }));
    assert.equal(hasAnyOfficialContactRescue(view), false);
  });

  it('nunca se pidió nada: sólo «buscar más» puede aplicar, y lo decide su preflight', () => {
    const view = classifyOfficialContactRescue(rescueInput({ revealState: 'never_requested' }));
    assert.equal(view.recovery.available, false);
    assert.equal(view.lushaContinuation.available, false);
    assert.equal(view.searchMore.available, true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. La oferta de rescate es SOLO LECTURA
// ═══════════════════════════════════════════════════════════════════

describe('rescate — preguntar qué salidas hay no cuesta nada', () => {
  it('no invoca NINGUNA de las tres tuberías, ni Apollo', async () => {
    const h = harness({ revealStatus: 'requested' });
    const view = await runOfficialContactRescueOptions(CONTACT_ID, h.deps);

    assert.equal(view.recovery.available, true);
    assert.equal(h.apolloCalls.length, 0);
    assert.equal(h.recoveryCalls.length, 0);
    assert.equal(h.lushaCalls.length, 0);
    assert.equal(h.searchMoreCalls.length, 0);
    assert.equal(h.projectCalls.length, 0);
  });

  it('sin candidato fuente durable no se ofrece nada (§9 de #352, intacto)', async () => {
    const h = harness({ contact: { ...CONTACT, metadata: {} } });
    const view = await runOfficialContactRescueOptions(CONTACT_ID, h.deps);
    assert.equal(hasAnyOfficialContactRescue(view), false);
  });

  it('sobre un contacto ARCHIVADO no se ofrece nada', async () => {
    const h = harness({ contact: { ...CONTACT, archivedAt: '2026-08-01T00:00:00.000Z' } });
    const view = await runOfficialContactRescueOptions(CONTACT_ID, h.deps);
    assert.equal(hasAnyOfficialContactRescue(view), false);
  });

  it('un rol no autorizado no ve ninguna salida', async () => {
    const h = harness({ roleKey: 'viewer', revealStatus: 'requested' });
    const view = await runOfficialContactRescueOptions(CONTACT_ID, h.deps);
    assert.equal(hasAnyOfficialContactRescue(view), false);
    assert.equal(h.recoveryCalls.length, 0);
  });

  it('si los hechos del candidato no se pueden leer, se falla CERRADO', async () => {
    const h = harness({ rescueFactsThrow: true });
    const view = await runOfficialContactRescueOptions(CONTACT_ID, h.deps);
    assert.equal(hasAnyOfficialContactRescue(view), false);
  });

  it('un fallo de UNA vista previa apaga SU oferta, no las otras', async () => {
    // No poder calcular el tope de Lusha no es razón para esconder el botón GRATIS de revisar el
    // resultado: son preguntas independientes y colapsarlas deja al operador sin la salida barata.
    const h = harness({ revealStatus: 'requested', legacyPreviewThrows: true });
    const view = await runOfficialContactRescueOptions(CONTACT_ID, h.deps);
    assert.equal(view.recovery.available, true);
    assert.equal(view.lushaContinuation.available, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Revisar AHORA — la salida del «se queda cargando»
// ═══════════════════════════════════════════════════════════════════

describe('rescate — revisar el resultado no compra nada', () => {
  it('delega UNA vez en el recovery y NUNCA llama a Apollo', async () => {
    const h = harness({ revealStatus: 'requested' });
    const out = await runOfficialContactRecoverReveal(CONTACT_ID, h.deps);

    assert.deepEqual(h.recoveryCalls, [CANDIDATE_ID]);
    assert.equal(h.apolloCalls.length, 0, 'revisar NO es revelar');
    assert.equal(h.lushaCalls.length, 0);
    assert.equal(out.phoneProjected, false);
    assert.equal(out.status, 'still_pending');
  });

  it('si sigue pendiente NO se abre una transacción de proyección', async () => {
    // Una transacción por cada consulta sería una transacción por cada vez que alguien mira.
    const h = harness({ revealStatus: 'requested' });
    await runOfficialContactRecoverReveal(CONTACT_ID, h.deps);
    assert.equal(h.projectCalls.length, 0);
  });

  it('cuando la revisión SÍ trae el número, se PROYECTA al contacto en la misma llamada', async () => {
    const h = harness({ revealStatus: 'requested', recoveryRevealsPhone: true });
    const out = await runOfficialContactRecoverReveal(CONTACT_ID, h.deps);

    assert.equal(h.projectCalls.length, 1);
    assert.equal(out.phoneProjected, true);
    assert.equal(h.apolloCalls.length, 0);
  });

  it('sin candidato fuente no se revisa nada', async () => {
    const h = harness({ contact: { ...CONTACT, metadata: {} } });
    const out = await runOfficialContactRecoverReveal(CONTACT_ID, h.deps);
    assert.equal(out.ok, false);
    assert.equal(h.recoveryCalls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Continuación a Lusha — Apollo NUNCA
// ═══════════════════════════════════════════════════════════════════

describe('rescate — continuar a Lusha no puede tocar Apollo', () => {
  it('delega UNA vez en la ruta legacy, con el tope LEÍDO, y proyecta', async () => {
    const h = harness({ revealStatus: 'no_phone_found' });
    const out = await runOfficialContactLushaContinuation(
      { contactId: CONTACT_ID, acceptedMaxCredits: 5 },
      h.deps,
    );

    assert.deepEqual(h.lushaCalls, [{ candidateId: CANDIDATE_ID, acceptedMaxCredits: 5 }]);
    assert.equal(h.apolloCalls.length, 0, 'los 8 créditos de Apollo NUNCA entran por aquí');
    assert.equal(out.ok, true);
    assert.equal(out.phoneProjected, true);
  });

  it('el tope que viaja es el que el operador ACEPTÓ, no el que el servidor prefiera', async () => {
    const h = harness({ revealStatus: 'no_phone_found' });
    await runOfficialContactLushaContinuation(
      { contactId: CONTACT_ID, acceptedMaxCredits: 6 },
      h.deps,
    );
    assert.deepEqual(h.lushaCalls, [{ candidateId: CANDIDATE_ID, acceptedMaxCredits: 6 }]);
  });

  it('un contacto que YA tiene teléfono no continúa a Lusha', async () => {
    const h = harness({ revealStatus: 'no_phone_found', liveOfficialPhoneCount: 1 });
    const out = await runOfficialContactLushaContinuation(
      { contactId: CONTACT_ID, acceptedMaxCredits: 5 },
      h.deps,
    );
    assert.equal(out.status, 'phone_already_present');
    assert.equal(h.lushaCalls.length, 0);
  });

  it('sin candidato fuente no se compra Lusha', async () => {
    const h = harness({ contact: { ...CONTACT, metadata: {} } });
    await runOfficialContactLushaContinuation(
      { contactId: CONTACT_ID, acceptedMaxCredits: 5 },
      h.deps,
    );
    assert.equal(h.lushaCalls.length, 0);
  });

  it('un rol no autorizado no puede gastar', async () => {
    const h = harness({ roleKey: null, revealStatus: 'no_phone_found' });
    await runOfficialContactLushaContinuation(
      { contactId: CONTACT_ID, acceptedMaxCredits: 5 },
      h.deps,
    );
    assert.equal(h.lushaCalls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Buscar más números
// ═══════════════════════════════════════════════════════════════════

describe('rescate — buscar más números, con proyección', () => {
  it('delega UNA vez, proyecta, y no toca Apollo', async () => {
    const h = harness({ revealStatus: 'revealed', liveOfficialPhoneCount: 1 });
    const out = await runOfficialContactSearchMore(CONTACT_ID, h.deps);

    assert.deepEqual(h.searchMoreCalls, [CANDIDATE_ID]);
    assert.equal(h.apolloCalls.length, 0);
    assert.equal(h.projectCalls.length, 1);
    assert.equal(out.newDistinctPhoneCount, 2);
    assert.equal(out.ok, true);
  });

  it('funciona con teléfono ya presente: ése es su caso de uso', async () => {
    const h = harness({ revealStatus: 'revealed', liveOfficialPhoneCount: 3 });
    const out = await runOfficialContactSearchMore(CONTACT_ID, h.deps);
    assert.equal(h.searchMoreCalls.length, 1);
    assert.equal(out.ok, true);
  });

  it('sin candidato fuente no busca nada', async () => {
    const h = harness({ contact: { ...CONTACT, metadata: {} } });
    await runOfficialContactSearchMore(CONTACT_ID, h.deps);
    assert.equal(h.searchMoreCalls.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. La propiedad transversal: ninguna salida alcanza Apollo
// ═══════════════════════════════════════════════════════════════════

describe('rescate — CERO Apollo en las tres salidas', () => {
  it('las tres, seguidas, suman 0 llamadas a la vía de Apollo', async () => {
    // `startCandidateReveal` es la ÚNICA vía a Apollo de todo el módulo, y dentro de ella viven la
    // reserva y el cargo de sus 8 créditos. Cero llamadas es cero de las tres cosas.
    const h = harness({ revealStatus: 'no_phone_found' });
    await runOfficialContactRecoverReveal(CONTACT_ID, h.deps);
    await runOfficialContactLushaContinuation(
      { contactId: CONTACT_ID, acceptedMaxCredits: 5 },
      h.deps,
    );
    await runOfficialContactSearchMore(CONTACT_ID, h.deps);
    assert.equal(h.apolloCalls.length, 0);
  });
});
