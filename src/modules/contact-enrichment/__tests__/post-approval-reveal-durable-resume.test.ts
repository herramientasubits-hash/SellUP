/**
 * Agente 2A — REANUDACIÓN DURABLE del reveal post-aprobación
 * (AGENT2A-POST-APPROVAL-REVEAL-DURABLE-RESUME).
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL DEFECTO QUE ESTE ARCHIVO CIERRA
 * ═══════════════════════════════════════════════════════════════════
 *
 * Un contacto oficial ya aprobado ofrecía «Revelar teléfono». El operador pulsaba, el servidor
 * aceptaba la solicitud y la ficha decía «Solicitud enviada». Cerrar la ficha y volver a abrirla
 * devolvía el botón de COMPRA — como si nunca se hubiera pedido nada.
 *
 * La causa no era el sondeo: era la PROPIEDAD del hecho. «Hay un reveal en curso» vivía en un
 * `useState` del navegador, que el desmontaje borraba. El navegador estaba actuando como dueño
 * durable de una operación que pertenece al servidor.
 *
 * La autoridad ya existía y no se ha creado ninguna nueva:
 * `contact_enrichment_candidates.phone_reveal_status`, la MISMA columna sobre la que el pipeline
 * levanta su gate `already_pending`. Lo que faltaba era LEERLA desde la ficha del contacto.
 *
 * ═══════════════════════════════════════════════════════════════════
 * QUÉ SE MIDE AQUÍ, Y CÓMO
 * ═══════════════════════════════════════════════════════════════════
 *
 * Las promesas de este corte son sobre QUÉ dependencias se invocan. Con las dependencias
 * inyectadas eso se mide CONTANDO LLAMADAS, no leyendo intenciones: «cero segunda compra» es
 * `revealCalls.length === 0`, y como `startCandidateReveal` es la ÚNICA vía a un proveedor de todo
 * el módulo, cero llamadas es a la vez cero proveedor, cero reserva y cero crédito.
 *
 * Determinista y offline: sin red, sin DB, sin proveedores, sin reloj. 0 créditos, 0 escrituras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY,
  POST_APPROVAL_REVEAL_IN_FLIGHT_STATUSES,
  classifyCandidateRevealDurableState,
  classifyOfficialContactPhoneRevealOffer,
  isCandidateRevealDurableStateBlocking,
  type CandidateRevealDurableState,
  type OfficialContactPhoneRevealOfferStatus,
} from '../post-approval-reveal-core';
// LA lista canónica del pipeline: la que decide `already_pending` en el servidor. Se importa
// SÓLO para compararla con la copia pura de este hito.
import { PHONE_REVEAL_IN_FLIGHT_STATUSES } from '../phone-reveal-core';
import {
  runOfficialContactPhoneReconcile,
  runOfficialContactPhoneRevealOffer,
  runOfficialContactPhoneRevealStart,
  type OfficialContactPhoneRevealDeps,
  type OfficialContactRevealContact,
} from '../post-approval-reveal-runtime';
import type { ProjectApprovedCandidatePhonesOutcome } from '../post-approval-reveal-core';
import {
  OFFICIAL_REVEAL_ALREADY_COMPLETED_COPY,
  OFFICIAL_REVEAL_IN_FLIGHT_COPY,
  OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY,
  OFFICIAL_REVEAL_NO_PHONE_COPY,
  OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY,
  officialRevealUnavailableText,
} from '@/components/contacts/post-approval-reveal-copy';

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
  readonly deps: OfficialContactPhoneRevealDeps;
  /** Llamadas al ÚNICO camino que puede alcanzar un proveedor, reservar y gastar. */
  readonly revealCalls: readonly unknown[];
  readonly projectCalls: readonly unknown[];
  readonly previewCalls: readonly string[];
  readonly revealStatusCalls: readonly string[];
}

function harness(
  over: {
    /** Valor CRUDO de `phone_reveal_status`. `undefined` ⇒ columna vacía (nunca se pidió). */
    candidateRevealStatus?: string | null;
    /** La lectura del estado durable FALLA. */
    revealStatusThrows?: boolean;
    candidateLivePhoneCount?: number;
    liveOfficialPhoneCount?: number;
    contact?: OfficialContactRevealContact | null;
  } = {},
): Harness {
  const revealCalls: unknown[] = [];
  const projectCalls: unknown[] = [];
  const previewCalls: string[] = [];
  const revealStatusCalls: string[] = [];

  const deps: OfficialContactPhoneRevealDeps = {
    actor: { internalUserId: ACTOR_ID, roleKey: 'admin' },
    loadContact: async () => (over.contact === undefined ? CONTACT : over.contact),
    countLiveOfficialPhones: async () => over.liveOfficialPhoneCount ?? 0,
    countLiveCandidatePhones: async () => over.candidateLivePhoneCount ?? 0,
    loadCandidateRevealStatus: async (candidateId) => {
      revealStatusCalls.push(candidateId);
      if (over.revealStatusThrows) throw new Error('candidate reveal status read failed');
      return over.candidateRevealStatus === undefined ? null : over.candidateRevealStatus;
    },
    loadAuthorizationPreview: async (candidateId) => {
      previewCalls.push(candidateId);
      return { maxCredits: 14, requiresIdentitySearch: true, lushaEligible: true };
    },
    startCandidateReveal: async (input) => {
      revealCalls.push(input);
      return { ok: true, status: 'requested', errorCode: null };
    },
    project: async (args) => {
      projectCalls.push(args);
      return PROJECTED;
    },
    checkProjectionCapability: async () => true,
    runHubSpotPhoneSyncFollowUp: async () => ({
      status: 'skipped',
    }) as unknown as Awaited<ReturnType<OfficialContactPhoneRevealDeps['runHubSpotPhoneSyncFollowUp']>>,
    onReadUnavailable: () => {},
  };

  return { deps, revealCalls, projectCalls, previewCalls, revealStatusCalls };
}

// ═══════════════════════════════════════════════════════════════════
// 1. La autoridad durable, y que NO es una segunda taxonomía
// ═══════════════════════════════════════════════════════════════════

describe('durable resume — la autoridad es la columna del pipeline, no una nueva', () => {
  it('la lista de «en vuelo» COINCIDE con la del pipeline que decide already_pending', () => {
    // Si dejaran de coincidir, la ficha podría ofrecer una compra que el servidor rechazará —o,
    // peor, esperar eternamente un estado que el pipeline ya considera cerrado—. La copia existe
    // sólo para conservar la pureza del núcleo (el módulo del pipeline importa cliente de
    // proveedor), no para poder divergir. Es el MISMO patrón que `phone-reveal-drawer-sync-core`.
    assert.deepEqual(
      [...POST_APPROVAL_REVEAL_IN_FLIGHT_STATUSES],
      [...PHONE_REVEAL_IN_FLIGHT_STATUSES],
    );
  });

  for (const status of ['requested', 'pending'] as const) {
    it(`"${status}" es un reveal EN VUELO`, () => {
      assert.equal(classifyCandidateRevealDurableState(status), 'in_flight');
    });
  }

  for (const [raw, expected] of [
    ['no_phone_found', 'terminal_no_phone'],
    ['error', 'terminal_failed'],
    ['revealed', 'terminal_revealed'],
    ['not_requested', 'never_requested'],
  ] as const) {
    it(`"${raw}" se clasifica como ${expected}`, () => {
      assert.equal(classifyCandidateRevealDurableState(raw), expected);
    });
  }

  it('la columna VACÍA es la prueba positiva de que nunca se pidió nada', () => {
    for (const empty of [null, undefined, '', '   ']) {
      assert.equal(classifyCandidateRevealDurableState(empty), 'never_requested');
    }
  });

  it('un estado DESCONOCIDO es "unreadable", NUNCA "libre para comprar"', () => {
    // La diferencia entre este archivo y el defecto: un vocabulario abierto habría hecho que un
    // estado nuevo —escrito por un camino que todavía no existe— se leyera como «no hay nada en
    // vuelo» y autorizara un segundo cargo.
    for (const unknownStatus of ['queued', 'in_progress', 'REQUESTED', 'completed_with_errors']) {
      assert.equal(
        classifyCandidateRevealDurableState(unknownStatus),
        'unreadable',
        `${unknownStatus} no puede leerse como libre`,
      );
    }
  });

  it('sólo "never_requested" deja de bloquear: todo lo demás cierra la oferta', () => {
    const all: readonly CandidateRevealDurableState[] = [
      'in_flight',
      'terminal_no_phone',
      'terminal_failed',
      'terminal_revealed',
      'never_requested',
      'unreadable',
    ];
    const blocking = all.filter(isCandidateRevealDurableStateBlocking);
    assert.deepEqual(blocking, [
      'in_flight',
      'terminal_no_phone',
      'terminal_failed',
      'terminal_revealed',
      'unreadable',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. La precedencia de la oferta (núcleo puro)
// ═══════════════════════════════════════════════════════════════════

describe('durable resume — la precedencia, en el núcleo puro', () => {
  const base = {
    contact: {
      id: CONTACT_ID,
      archivedAt: null,
      phone: null,
      mobilePhone: null,
      metadata: { [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: CANDIDATE_ID },
    },
    liveOfficialPhoneCount: 0,
    candidateLivePhoneCount: 0,
  };

  it('TEST 1 — contacto elegible y nada pedido nunca ⇒ compra ACCIONABLE', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      ...base,
      candidateRevealState: 'never_requested',
    });
    assert.equal(offer.status, 'eligible');
    assert.equal(offer.actionable, true);
    assert.equal(offer.free, false);
  });

  for (const [state, status] of [
    ['in_flight', 'reveal_in_flight'],
    ['terminal_no_phone', 'reveal_terminal_no_phone'],
    ['terminal_failed', 'reveal_terminal_failed'],
    ['terminal_revealed', 'reveal_already_completed'],
    ['unreadable', 'reveal_state_unreadable'],
  ] as const) {
    it(`${state} ⇒ ${status} y NO accionable`, () => {
      const offer = classifyOfficialContactPhoneRevealOffer({
        ...base,
        candidateRevealState: state,
      });
      assert.equal(offer.status, status);
      assert.equal(offer.actionable, false, 'no puede ofrecerse una compra');
      assert.equal(offer.free, true, 'y nada de lo que se ofrece puede costar');
    });
  }

  it('TEST 15 — la REUTILIZACIÓN gana al estado en vuelo, y sigue siendo gratis', () => {
    // Deliberado: si el candidato ya tiene una fila viva, copiarla es gratis y es lo que el
    // operador quiere, aunque el proveedor deba todavía una segunda respuesta. Lo que la puerta
    // impide es volver a PAGAR, no traer lo ya pagado.
    const offer = classifyOfficialContactPhoneRevealOffer({
      ...base,
      candidateLivePhoneCount: 1,
      candidateRevealState: 'in_flight',
    });
    assert.equal(offer.status, 'reuse_from_candidate');
    assert.equal(offer.actionable, true);
    assert.equal(offer.free, true);
  });

  it('un contacto que YA tiene teléfono sigue mandando sobre el estado del reveal', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      ...base,
      liveOfficialPhoneCount: 1,
      candidateRevealState: 'in_flight',
    });
    assert.equal(offer.status, 'phone_already_present');
    assert.equal(offer.actionable, false);
  });

  it('y sin vínculo durable el estado del reveal NO puede reabrir nada', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: { ...base.contact, metadata: {} },
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
      candidateRevealState: 'never_requested',
    });
    assert.equal(offer.status, 'missing_source_candidate');
    assert.equal(offer.actionable, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. La OFERTA del servidor declara el estado durable
// ═══════════════════════════════════════════════════════════════════

describe('durable resume — el servidor declara, y la ficha no tiene que recordar', () => {
  it('TEST 3/4 — con un reveal en vuelo, la oferta NO es accionable y lo DICE', async () => {
    // Esto es exactamente «cerrar y reabrir la ficha», y «recargar el navegador»: las dos cosas
    // producen una llamada nueva a esta función y ninguna otra prueba de nada. Si aquí sale
    // `reveal_in_flight`, la reanudación es una propiedad del servidor y no del navegador.
    const h = harness({ candidateRevealStatus: 'requested' });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);

    assert.equal(view.status, 'reveal_in_flight');
    assert.equal(view.actionable, false);
    assert.equal(h.revealCalls.length, 0, 'mirar una ficha no compra nada');
    assert.equal(h.projectCalls.length, 0, 'y la oferta es SÓLO lectura');
  });

  it('la vista previa del TOPE no se pide para un estado que no puede comprar', async () => {
    // Pedir permiso por 14 créditos para una operación que no se puede autorizar sería enseñarle
    // al operador una cifra que nadie va a reservar.
    const h = harness({ candidateRevealStatus: 'pending' });
    await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);
    assert.deepEqual(h.previewCalls, []);
  });

  it('TEST 14 — sin nada pedido, la oferta normal sigue EXACTAMENTE igual', async () => {
    const h = harness();
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);

    assert.equal(view.status, 'eligible');
    assert.equal(view.actionable, true);
    assert.equal(view.free, false);
    assert.equal(view.maxCredits, 14);
    assert.equal(view.requiresIdentitySearch, true);
    assert.equal(view.lushaEligible, true);
    assert.deepEqual(h.previewCalls, [CANDIDATE_ID]);
  });

  it('TEST 15 — `reuse_from_candidate` conserva su forma: gratis y con tope 0', async () => {
    const h = harness({ candidateLivePhoneCount: 2 });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);

    assert.equal(view.status, 'reuse_from_candidate');
    assert.equal(view.actionable, true);
    assert.equal(view.free, true);
    assert.equal(view.maxCredits, 0);
    assert.deepEqual(h.previewCalls, [], 'no se pide tope para copiar lo ya pagado');
  });

  it('TEST 12 — si el estado durable NO se puede LEER, se falla CERRADO', async () => {
    // Una caída de base no es una autorización de gasto. El error seguro es perder un botón.
    const h = harness({ revealStatusThrows: true });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);

    assert.equal(view.status, 'reveal_state_unreadable');
    assert.equal(view.actionable, false);
    assert.equal(view.maxCredits, null);
    assert.equal(h.revealCalls.length, 0);
  });

  it('TEST 12 — y un valor AMBIGUO tampoco se convierte en «listo para comprar»', async () => {
    const h = harness({ candidateRevealStatus: 'in_progress' });
    const view = await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);

    assert.equal(view.status, 'reveal_state_unreadable');
    assert.equal(view.actionable, false);
  });

  it('el estado durable se pide UNA vez por oferta, y sólo con candidato resuelto', async () => {
    const h = harness({ candidateRevealStatus: 'requested' });
    await runOfficialContactPhoneRevealOffer(CONTACT_ID, h.deps);
    assert.deepEqual(h.revealStatusCalls, [CANDIDATE_ID]);

    const noLink = harness({ contact: { ...CONTACT, metadata: {} } });
    await runOfficialContactPhoneRevealOffer(CONTACT_ID, noLink.deps);
    assert.deepEqual(noLink.revealStatusCalls, [], 'sin vínculo no hay candidato que consultar');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. La segunda compra, desde un navegador RANCIO
// ═══════════════════════════════════════════════════════════════════

describe('durable resume — el servidor es la frontera, no el botón deshabilitado', () => {
  it('TEST 7/8/9 — un clic RANCIO con reveal en vuelo: 0 proveedor, 0 reserva, 0 crédito', async () => {
    // El escenario real: una pestaña abierta desde antes del clic, cuyo `offer` cacheado todavía
    // dice «eligible». El navegador manda la compra igual. El servidor RE-RESUELVE la oferta y la
    // corta antes de delegar.
    //
    // Las tres promesas son la MISMA medida: `startCandidateReveal` es la única vía a un
    // proveedor de todo el módulo, y dentro de ella viven la reserva de créditos y el cargo. Cero
    // llamadas es cero de las tres.
    const h = harness({ candidateRevealStatus: 'requested' });
    const result = await runOfficialContactPhoneRevealStart(
      {
        contactId: CONTACT_ID,
        confirmCost: true,
        phoneProcessingBasis: 'legitimate_interest_b2b',
        expectedMaxCredits: 14,
      },
      h.deps,
    );

    assert.equal(result.ok, false);
    assert.equal(result.gate, 'reveal_in_flight');
    assert.equal(result.revealStatus, null);
    assert.equal(result.phoneProjected, false);
    assert.equal(h.revealCalls.length, 0, 'CERO llamadas al pipeline: cero proveedor');
    assert.equal(h.projectCalls.length, 0, 'y cero transacciones abiertas por un rechazo');
  });

  it('DOS clics rancios seguidos siguen sumando CERO', async () => {
    const h = harness({ candidateRevealStatus: 'pending' });
    const input = {
      contactId: CONTACT_ID,
      confirmCost: true,
      phoneProcessingBasis: 'legitimate_interest_b2b' as const,
      expectedMaxCredits: 14,
    };
    await runOfficialContactPhoneRevealStart(input, h.deps);
    await runOfficialContactPhoneRevealStart(input, h.deps);
    assert.equal(h.revealCalls.length, 0);
  });

  for (const [status, gate] of [
    ['no_phone_found', 'reveal_terminal_no_phone'],
    ['error', 'reveal_terminal_failed'],
    ['revealed', 'reveal_already_completed'],
    ['queued', 'reveal_state_unreadable'],
  ] as const) {
    it(`un clic sobre "${status}" tampoco alcanza a un proveedor (gate ${gate})`, async () => {
      const h = harness({ candidateRevealStatus: status });
      const result = await runOfficialContactPhoneRevealStart(
        {
          contactId: CONTACT_ID,
          confirmCost: true,
          phoneProcessingBasis: 'legitimate_interest_b2b',
          expectedMaxCredits: 14,
        },
        h.deps,
      );
      assert.equal(result.gate, gate);
      assert.equal(h.revealCalls.length, 0);
    });
  }

  it('TEST 2 — el primer clic legítimo SÍ delega, y deja el estado en vuelo', async () => {
    const h = harness();
    const result = await runOfficialContactPhoneRevealStart(
      {
        contactId: CONTACT_ID,
        confirmCost: true,
        phoneProcessingBasis: 'legitimate_interest_b2b',
        expectedMaxCredits: 14,
      },
      h.deps,
    );

    assert.equal(result.ok, true);
    assert.equal(result.gate, 'delegated');
    assert.equal(result.revealStatus, 'requested', 'el estado DURABLE del arranque asíncrono');
    assert.equal(h.revealCalls.length, 1, 'exactamente UNA compra');
  });

  it('TEST 15 — la reutilización sigue proyectando sin tocar a ningún proveedor', async () => {
    const h = harness({ candidateLivePhoneCount: 1 });
    const result = await runOfficialContactPhoneRevealStart(
      {
        contactId: CONTACT_ID,
        confirmCost: true,
        phoneProcessingBasis: 'legitimate_interest_b2b',
        expectedMaxCredits: 0,
      },
      h.deps,
    );

    assert.equal(result.gate, 'reuse_from_candidate');
    assert.equal(result.phoneProjected, true);
    assert.equal(h.revealCalls.length, 0);
    assert.equal(h.projectCalls.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. La reconciliación NO cambia: sigue siendo la vía de recogida
// ═══════════════════════════════════════════════════════════════════

describe('durable resume — reconciliar sigue sin comprar, en cualquier estado', () => {
  for (const status of ['requested', 'pending', 'no_phone_found', 'error', 'queued', null]) {
    it(`reconcilia con phone_reveal_status = ${String(status)} sin llamar a un proveedor`, async () => {
      // La reconciliación NO consulta el estado durable a propósito: su trabajo es copiar lo que
      // el candidato ya tenga, y eso es correcto en TODOS los estados. Exigirle un estado sería
      // inventar una segunda puerta para una operación que no puede gastar.
      const h = harness({ candidateRevealStatus: status });
      const result = await runOfficialContactPhoneReconcile(CONTACT_ID, h.deps);

      assert.equal(h.revealCalls.length, 0);
      assert.equal(result.phoneProjected, true);
      assert.equal(h.projectCalls.length, 1, 'UNA proyección, idempotente por la 128');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 6. El copy de cada desenlace terminal
// ═══════════════════════════════════════════════════════════════════

describe('durable resume — lo que el operador LEE en cada desenlace', () => {
  it('TEST 10 — sin número: se dice que los proveedores no devolvieron nada', () => {
    assert.equal(
      officialRevealUnavailableText('reveal_terminal_no_phone'),
      OFFICIAL_REVEAL_NO_PHONE_COPY,
    );
    assert.match(OFFICIAL_REVEAL_NO_PHONE_COPY, /no devolvieron un teléfono/);
  });

  it('TEST 11 — fallo: honesto, sin citar al proveedor (su mensaje puede llevar el número)', () => {
    assert.equal(
      officialRevealUnavailableText('reveal_terminal_failed'),
      OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY,
    );
    assert.match(OFFICIAL_REVEAL_TERMINAL_FAILURE_COPY, /error/i);
  });

  it('en vuelo: se dice que la solicitud está enviada, sin prometer un teléfono', () => {
    assert.equal(officialRevealUnavailableText('reveal_in_flight'), OFFICIAL_REVEAL_IN_FLIGHT_COPY);
  });

  it('ya completado sin número vivo: se explica en vez de ofrecer otra compra', () => {
    assert.equal(
      officialRevealUnavailableText('reveal_already_completed'),
      OFFICIAL_REVEAL_ALREADY_COMPLETED_COPY,
    );
  });

  it('TEST 12 — el caso fail-closed NO invita a comprar: no pinta nada', () => {
    assert.equal(officialRevealUnavailableText('reveal_state_unreadable'), null);
  });

  it('TEST 13 — el copy del presupuesto agotado no promete vigilancia, y sí reanudación', () => {
    assert.notEqual(
      OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY,
      OFFICIAL_REVEAL_IN_FLIGHT_COPY,
      'decir «aparecerá aquí» cuando ya nadie mira es la mentira que este corte evita',
    );
    assert.match(OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY, /en proceso/i);
    assert.match(OFFICIAL_REVEAL_IN_FLIGHT_PAUSED_COPY, /cuando vuelvas/i);
  });

  it('NINGÚN estado del reveal produce un texto que suene a botón de compra', () => {
    const statuses: readonly OfficialContactPhoneRevealOfferStatus[] = [
      'reveal_in_flight',
      'reveal_terminal_no_phone',
      'reveal_terminal_failed',
      'reveal_already_completed',
      'reveal_state_unreadable',
    ];
    for (const status of statuses) {
      const text = officialRevealUnavailableText(status);
      if (text === null) continue;
      assert.equal(/Revelar teléfono/.test(text), false, `${status} no puede invitar a comprar`);
    }
  });
});
