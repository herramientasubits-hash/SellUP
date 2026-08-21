/**
 * Agente 2A — el núcleo PURO del merge humano hacia un contacto EXISTENTE
 * (AGENT2A-PHONE-REVEAL-4O-H3-B).
 *
 * Dos decisiones se fijan aquí, y las dos son de las que no rompen nada hoy y sí rompen algo
 * mañana:
 *
 *   1. QUÉ IDENTIDAD AUTORIZA ESCRIBIR EN LA FILA DE OTRO. Avisar de un duplicado de más es una
 *      molestia; escribir teléfonos en el contacto equivocado mezcla los datos de dos personas
 *      y no hay forma de deshacerlo desde la UI.
 *   2. SI EL ESCALAR HEREDADO DEL CONTACTO PUEDE REPRESENTARSE FIELMENTE. Inventar `manual`
 *      haría que un borrado de proveedor NO alcanzara un número que debía alcanzar; inventar un
 *      proveedor haría que un borrado destruyera un número que una persona tecleó.
 *
 * Y una tercera, en el módulo de privacidad: que un contacto FUSIONADO sea alcanzable por el
 * borrado, y que uno meramente DUPLICADO siga sin serlo.
 *
 * Sin red, sin DB, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN,
  buildIncumbentContactBootstrap,
  buildMergeCandidateIntoExistingContactParams,
  parseMergeCandidateEnvelope,
} from '../existing-contact-merge-core';
import {
  resolveExistingContactMergeOffer,
  resolveTrustedExistingContactMatch,
  type ExistingContactForDedup,
} from '../candidate-review-core';
import { resolveContactErasureProvenance } from '../phone-cache-suppression-core';
import { normalizeCandidatePhone } from '../phone-collection-core';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CANDIDATE_ID = '44444444-4444-4444-8444-444444444444';
const PHONE = '+15550000001';

const contact = (
  over: Partial<ExistingContactForDedup> & { id: string },
): ExistingContactForDedup => ({
  email: null,
  linkedin_url: null,
  full_name: 'Contacto Sintetico',
  ...over,
});

// ═══════════════════════════════════════════════════════════════
// 1. Identidad confiable
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — identidad CONFIABLE del contacto existente', () => {
  it('confía en un email exacto tras normalizar mayúsculas y espacios', () => {
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: '  Ana.Perez@ACME.com ', linkedin_url: null },
      existingContacts: [
        contact({ id: C1, email: 'ana.perez@acme.com' }),
        contact({ id: C2, email: 'otro@acme.com' }),
      ],
    });
    assert.deepEqual(verdict, { kind: 'trusted', contactId: C1, signal: 'email' });
  });

  it('confía en un LinkedIn exacto tras normalizar barra final y mayúsculas', () => {
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: null, linkedin_url: 'https://LinkedIn.com/in/ana-perez/' },
      existingContacts: [contact({ id: C1, linkedin_url: 'https://linkedin.com/in/ana-perez' })],
    });
    assert.deepEqual(verdict, { kind: 'trusted', contactId: C1, signal: 'linkedin' });
  });

  it('prefiere el email cuando las DOS señales exactas apuntan al MISMO contacto', () => {
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: 'ana@acme.com', linkedin_url: 'https://linkedin.com/in/ana' },
      existingContacts: [
        contact({ id: C1, email: 'ana@acme.com', linkedin_url: 'https://linkedin.com/in/ana' }),
      ],
    });
    assert.deepEqual(verdict, { kind: 'trusted', contactId: C1, signal: 'email' });
  });

  it('BLOQUEA cuando dos contactos comparten el mismo email — no elige el primero', () => {
    // `findDuplicateContact()` usa `.find()` y se quedaría con C1. Para AVISAR basta; para
    // ESCRIBIR, elegir uno de dos es elegir al azar cuál de las dos filas recibe los teléfonos.
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: 'ana@acme.com', linkedin_url: null },
      existingContacts: [
        contact({ id: C1, email: 'ana@acme.com' }),
        contact({ id: C2, email: 'ANA@acme.com' }),
      ],
    });
    assert.deepEqual(verdict, { kind: 'ambiguous', reason: 'multiple_contacts' });
  });

  it('BLOQUEA cuando el email señala a un contacto y el LinkedIn a otro', () => {
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: 'ana@acme.com', linkedin_url: 'https://linkedin.com/in/ana' },
      existingContacts: [
        contact({ id: C1, email: 'ana@acme.com' }),
        contact({ id: C2, linkedin_url: 'https://linkedin.com/in/ana' }),
      ],
    });
    assert.deepEqual(verdict, { kind: 'ambiguous', reason: 'conflicting_signals' });
  });

  it('RECHAZA el duplicado por NOMBRE, aunque el nombre sea idéntico', () => {
    // Es el caso que `findDuplicateContact()` sí acepta como `possible_duplicate`. Aquí no:
    // dos personas pueden llamarse igual y ninguna de las dos aceptaría los teléfonos de la otra.
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: null, linkedin_url: null },
      existingContacts: [contact({ id: C1, full_name: 'Ana Perez' })],
    });
    assert.deepEqual(verdict, { kind: 'untrusted', reason: 'name_only' });
  });

  it('RECHAZA cuando el candidato tiene señales pero ninguna empareja', () => {
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: 'ana@acme.com', linkedin_url: null },
      existingContacts: [contact({ id: C1, email: 'otro@acme.com' })],
    });
    assert.deepEqual(verdict, { kind: 'untrusted', reason: 'no_exact_signal' });
  });

  it('no confía en el TELÉFONO: no participa en la resolución en ninguna forma', () => {
    // Ni siquiera se recibe. El tipo de entrada sólo admite email y linkedin, y esta prueba fija
    // que añadir un teléfono al candidato no cambia el veredicto.
    const verdict = resolveTrustedExistingContactMatch({
      candidate: { email: null, linkedin_url: null },
      existingContacts: [contact({ id: C1, full_name: 'Ana Perez' })],
    });
    assert.equal(verdict.kind, 'untrusted');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. La OFERTA: identidad + destino registrado por el servidor
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — la oferta exige identidad Y destino registrado', () => {
  const trustedContacts = [contact({ id: C1, email: 'ana@acme.com' })];
  const candidate = { email: 'ana@acme.com', linkedin_url: null };

  it('ofrece cuando la identidad es exacta y coincide con `matched_contacts_id`', () => {
    assert.deepEqual(
      resolveExistingContactMergeOffer({
        candidate,
        existingContacts: trustedContacts,
        recordedMatchContactId: C1,
      }),
      { offered: true, contactId: C1, signal: 'email' },
    );
  });

  it('RETIRA la oferta cuando el servidor registró OTRO contacto', () => {
    // Ofrecer algo distinto de lo que la transacción va a aceptar es peor que no ofrecer nada.
    assert.deepEqual(
      resolveExistingContactMergeOffer({
        candidate,
        existingContacts: trustedContacts,
        recordedMatchContactId: C2,
      }),
      { offered: false, reason: 'recorded_match_mismatch' },
    );
  });

  it('RETIRA la oferta cuando no hay destino registrado', () => {
    for (const recorded of [null, undefined, '   ']) {
      assert.deepEqual(
        resolveExistingContactMergeOffer({
          candidate,
          existingContacts: trustedContacts,
          recordedMatchContactId: recorded,
        }),
        { offered: false, reason: 'no_recorded_match' },
      );
    }
  });

  it('propaga el motivo del bloqueo por ambigüedad en lugar de callarlo', () => {
    assert.deepEqual(
      resolveExistingContactMergeOffer({
        candidate,
        existingContacts: [
          contact({ id: C1, email: 'ana@acme.com' }),
          contact({ id: C2, email: 'ana@acme.com' }),
        ],
        recordedMatchContactId: C1,
      }),
      { offered: false, reason: 'multiple_contacts' },
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Bootstrap del escalar heredado del CONTACTO
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — bootstrap del escalar heredado del contacto existente', () => {
  it('invierte los CINCO miembros que la 112 mapea sin ambigüedad', () => {
    const cases: [string, string, string][] = [
      ['apollo_search', 'apollo', 'search'],
      ['apollo_reveal', 'apollo', 'reveal'],
      ['apollo_cache', 'apollo_cache', 'cache'],
      ['lusha_reveal', 'lusha', 'reveal'],
      ['manual', 'manual', 'manual'],
    ];
    for (const [legacy, provider, mode] of cases) {
      const out = buildIncumbentContactBootstrap({
        phone: PHONE,
        phoneType: 'work',
        phoneSource: legacy,
        phoneRawType: 'work',
      });
      assert.ok(out, `${legacy} debe invertir`);
      assert.equal(out.provider, provider);
      assert.equal(out.acquisition_mode, mode);
    }
  });

  it('un escalar MANUAL se representa como (manual, manual) y no como un proveedor', () => {
    const out = buildIncumbentContactBootstrap({
      phone: PHONE,
      phoneType: 'work',
      phoneSource: 'manual',
      phoneRawType: null,
    });
    assert.ok(out);
    assert.equal(out.provider, 'manual');
    assert.equal(out.acquisition_mode, 'manual');
  });

  it('NO bootstrappea procedencia desconocida: `unknown`, `provider_payload` y null', () => {
    // HISTORICAL_MANUAL_NULL_PROVENANCE_PENDING. Las dos invenciones posibles fallan en
    // direcciones opuestas y ninguna es aceptable, así que no se escribe ninguna.
    for (const legacy of ['unknown', 'provider_payload', null, undefined, '   ']) {
      assert.equal(
        buildIncumbentContactBootstrap({
          phone: PHONE,
          phoneType: 'work',
          phoneSource: legacy,
          phoneRawType: null,
        }),
        null,
        `${String(legacy)} no debe bootstrappear`,
      );
    }
  });

  it('sin número no hay nada que representar', () => {
    for (const phone of [null, undefined, '   ']) {
      assert.equal(
        buildIncumbentContactBootstrap({
          phone,
          phoneType: 'work',
          phoneSource: 'manual',
          phoneRawType: null,
        }),
        null,
      );
    }
  });

  it('usa EL normalizador: la misma `dedupe_key` que produce la colección del candidato', () => {
    // Si esto divergiera, el mismo número en el contacto y en el candidato serían DOS filas
    // canónicas y el tombstone de una no protegería a la otra.
    const out = buildIncumbentContactBootstrap({
      phone: PHONE,
      phoneType: 'work',
      phoneSource: 'manual',
      phoneRawType: null,
    });
    const expected = normalizeCandidatePhone({
      displayPhone: PHONE,
      sanitizedPhone: PHONE,
      countryCode: null,
    });
    assert.ok(out);
    assert.equal(out.dedupe_key, expected.dedupeKey);
    assert.equal(out.normalized_phone, expected.normalizedPhone);
  });

  it('lleva `observed_phone` para que la 117 pueda detectar un escalar cambiado', () => {
    const out = buildIncumbentContactBootstrap({
      phone: `  ${PHONE}  `,
      phoneType: 'work',
      phoneSource: 'manual',
      phoneRawType: null,
    });
    assert.ok(out);
    assert.equal(out.observed_phone, PHONE);
  });

  it('descarta un `phone_type` fuera del vocabulario de la 114 en vez de propagarlo', () => {
    const out = buildIncumbentContactBootstrap({
      phone: PHONE,
      phoneType: 'oficina',
      phoneSource: 'manual',
      phoneRawType: 'oficina',
    });
    assert.ok(out);
    assert.equal(out.phone_type, null);
    // El valor crudo del proveedor SÍ se conserva: es la palabra original y nunca se normaliza.
    assert.equal(out.raw_provider_type, 'oficina');
  });

  it('la clave de evento del incumbente NO colisiona con la del escalar del candidato', () => {
    // La 117 les antepone prefijos distintos (`v1:incumbent:` vs `v1:promoted:`), pero la fase
    // ya las separa en origen. Sin esta separación, un contacto y un candidato con el mismo
    // número y la misma procedencia colapsarían en una sola procedencia.
    const out = buildIncumbentContactBootstrap({
      phone: PHONE,
      phoneType: 'work',
      phoneSource: 'apollo_reveal',
      phoneRawType: null,
    });
    assert.ok(out);
    assert.match(out.source_event_key, /existing_contact_scalar/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Parámetros y sobre de la RPC
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — parámetros y sobre de la migración 117', () => {
  it('nombra la función una sola vez y con el nombre exacto de la migración', () => {
    assert.equal(
      MERGE_CANDIDATE_INTO_EXISTING_CONTACT_FN,
      'merge_contact_candidate_into_existing_contact',
    );
  });

  it('construye los OCHO parámetros con los nombres exactos de la firma', () => {
    const params = buildMergeCandidateIntoExistingContactParams({
      candidateId: CANDIDATE_ID,
      contactId: C1,
      accountId: C2,
      reviewPatch: { status: 'duplicate' },
      scalarFallback: null,
      incumbentBootstrap: null,
      actorId: CANDIDATE_ID,
      nowIso: '2026-08-12T12:00:00.000Z',
    });
    assert.deepEqual(Object.keys(params).sort(), [
      'p_account_id',
      'p_actor_id',
      'p_candidate_id',
      'p_contact_id',
      'p_incumbent_bootstrap',
      'p_now',
      'p_review_patch',
      'p_scalar_fallback',
    ]);
  });

  it('LANZA ante un estado desconocido en vez de propagarlo como éxito', () => {
    assert.throws(() => parseMergeCandidateEnvelope({ status: 'ok' }), /unknown envelope status/);
    assert.throws(() => parseMergeCandidateEnvelope(null), /not an object/);
    assert.throws(() => parseMergeCandidateEnvelope([]), /not an object/);
  });

  it('normaliza conteos y banderas sin confiar en la forma del sobre', () => {
    const out = parseMergeCandidateEnvelope({
      status: 'merged',
      candidate_id: CANDIDATE_ID,
      contact_id: C1,
      contact_created: false,
      phones_inserted: '3',
      phones_reused: -1,
      primary_preserved: true,
      scalar_projection: 'algo_raro',
      incumbent_bootstrap: 'promoted',
      candidate_terminal: true,
    });
    assert.equal(out.status, 'merged');
    assert.equal(out.contactCreated, false);
    assert.equal(out.phonesInserted, 3);
    assert.equal(out.phonesReused, 0);
    assert.equal(out.primaryPreserved, true);
    // Un valor fuera del vocabulario cae al lado SEGURO: «no se tocó el escalar».
    assert.equal(out.scalarProjection, 'incumbent_preserved');
    assert.equal(out.incumbentBootstrap, 'promoted');
  });

  it('`already_merged` es un estado legítimo, no un fallo', () => {
    const out = parseMergeCandidateEnvelope({
      status: 'already_merged',
      contact_id: C1,
      candidate_terminal: true,
    });
    assert.equal(out.status, 'already_merged');
    assert.equal(out.contactId, C1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. El merge NO abre una ruta alrededor de la privacidad
// ═══════════════════════════════════════════════════════════════

describe('4O-H3-B — un contacto FUSIONADO es alcanzable por el borrado', () => {
  const suppressed = new Set([CANDIDATE_ID]);

  it('un duplicado meramente EMPAREJADO sigue siendo `weak` — FIX 1 intacto', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: { id: C1, accountId: C2, sourceCandidateId: null, phoneSource: 'apollo_reveal' },
        suppressedCandidateIds: suppressed,
      }),
      'weak',
    );
  });

  it('un contacto en el que ESE candidato fue FUSIONADO es `provenance_proven`', () => {
    // Sin esto, la 117 dejaría números de proveedor en una fila que el borrado puede encontrar
    // (por `matched_contacts_id`) pero no borrar: el agujero que H3-B no puede abrir.
    assert.equal(
      resolveContactErasureProvenance({
        contact: {
          id: C1,
          accountId: C2,
          sourceCandidateId: null,
          mergedCandidateIds: [CANDIDATE_ID],
          phoneSource: 'apollo_reveal',
        },
        suppressedCandidateIds: suppressed,
      }),
      'provenance_proven',
    );
  });

  it('una fusión de OTRO candidato no autoriza nada', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: {
          id: C1,
          accountId: C2,
          sourceCandidateId: null,
          mergedCandidateIds: [OTHER_CANDIDATE_ID],
          phoneSource: 'apollo_reveal',
        },
        suppressedCandidateIds: suppressed,
      }),
      'weak',
    );
  });

  it('un array con forma inesperada se ignora en vez de asumirse', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: {
          id: C1,
          accountId: C2,
          sourceCandidateId: null,
          mergedCandidateIds: ['', '   '],
          phoneSource: 'apollo_reveal',
        },
        suppressedCandidateIds: suppressed,
      }),
      'weak',
    );
  });

  it('la procedencia por CREACIÓN sigue funcionando exactamente igual', () => {
    assert.equal(
      resolveContactErasureProvenance({
        contact: {
          id: C1,
          accountId: C2,
          sourceCandidateId: CANDIDATE_ID,
          phoneSource: 'apollo_reveal',
        },
        suppressedCandidateIds: suppressed,
      }),
      'provenance_proven',
    );
  });
});
