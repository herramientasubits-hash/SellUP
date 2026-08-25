/**
 * Agente 2A — el NÚCLEO PURO del reveal desde un contacto oficial
 * (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1).
 *
 * Qué fija este archivo, y por qué importa que sea aquí:
 *
 *   * el vínculo durable se resuelve SÓLO desde `contacts.metadata.source_candidate_id` y
 *     fail-closed. Cada caso en el que hoy devuelve «no hay candidato» es un caso en el que el
 *     producto NO puede autorizar un gasto, así que probarlo es probar el §9 del contrato;
 *   * la precedencia de la oferta. Las cuatro respuestas posibles («no se puede», «ya tiene»,
 *     «reutiliza gratis», «autoriza una compra») se deciden con un orden explícito, y ese orden
 *     es lo que impide que un contacto con teléfono vea un botón de compra;
 *   * los parámetros de la RPC de la 128 salen de UN builder, en el orden de sus argumentos;
 *   * el sobre se parsea SIN confiar en él: un estado desconocido LANZA en vez de propagarse
 *     como éxito.
 *
 * Determinista y offline: no hay red, no hay DB, no hay flags, no hay reloj. 0 proveedores,
 * 0 créditos, 0 escrituras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY,
  PROJECT_APPROVED_CANDIDATE_PHONES_FN,
  buildProjectApprovedCandidatePhonesParams,
  classifyOfficialContactPhoneRevealOffer,
  parseProjectApprovedCandidatePhonesEnvelope,
  resolveOfficialContactSourceCandidateId,
} from '../post-approval-reveal-core';

const CANDIDATE_ID = '6e28099a-ad4e-492f-9ec4-65d766877696';
const CONTACT_ID = '45959dfa-9607-406e-bcd0-bcb9e78b9d4c';
const ACTOR_ID = '30000000-0000-4000-8000-000000000001';

const contactOf = (over: Record<string, unknown> = {}) => ({
  id: CONTACT_ID,
  archivedAt: null,
  phone: null,
  mobilePhone: null,
  metadata: { [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: CANDIDATE_ID },
  ...over,
});

describe('resolveOfficialContactSourceCandidateId — el vínculo durable, fail-closed', () => {
  it('resuelve el candidato cuando la metadata lo declara con un uuid', () => {
    const result = resolveOfficialContactSourceCandidateId({
      [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: CANDIDATE_ID,
      source: 'contact_enrichment_candidate',
    });
    assert.deepEqual(result, { kind: 'resolved', candidateId: CANDIDATE_ID });
  });

  it('recorta espacios en blanco antes de validar', () => {
    const result = resolveOfficialContactSourceCandidateId({
      [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: `  ${CANDIDATE_ID}  `,
    });
    assert.deepEqual(result, { kind: 'resolved', candidateId: CANDIDATE_ID });
  });

  for (const [label, metadata] of [
    ['metadata ausente', undefined],
    ['metadata nula', null],
    ['metadata que no es objeto', 'source_candidate_id=x'],
    ['metadata que es un array', [CANDIDATE_ID]],
    ['clave ausente', { source: 'contact_enrichment_candidate' }],
    ['clave nula', { [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: null }],
    ['clave vacía', { [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: '   ' }],
    ['clave numérica', { [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: 42 }],
  ] as const) {
    it(`devuelve "missing" con ${label}`, () => {
      assert.deepEqual(resolveOfficialContactSourceCandidateId(metadata), { kind: 'missing' });
    });
  }

  it('un valor que no es uuid es "malformed" y NUNCA se usa como candidato', () => {
    // No es un detalle de forma: el candidato fuente determina la autorización económica. Un id
    // «casi bueno» apuntaría a otra persona con otro historial de reveal y otro tope.
    const result = resolveOfficialContactSourceCandidateId({
      [OFFICIAL_CONTACT_SOURCE_CANDIDATE_METADATA_KEY]: 'candidate-6e28099a',
    });
    assert.deepEqual(result, { kind: 'malformed' });
  });
});

describe('classifyOfficialContactPhoneRevealOffer — la precedencia de la oferta', () => {
  it('sin contacto legible no se ofrece nada', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: null,
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'contact_unavailable');
    assert.equal(offer.actionable, false);
    assert.equal(offer.candidateId, null);
  });

  it('un contacto archivado no compra nada', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf({ archivedAt: '2026-08-01T00:00:00.000Z' }),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'contact_archived');
    assert.equal(offer.actionable, false);
  });

  it('sin candidato fuente: fail-closed, y NO se emite un candidato', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf({ metadata: { source: 'manual' } }),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'missing_source_candidate');
    assert.equal(offer.actionable, false);
    assert.equal(offer.candidateId, null);
  });

  it('el fail-closed del vínculo se decide ANTES de mirar teléfonos', () => {
    // Con teléfonos por reutilizar Y sin vínculo, la respuesta sigue siendo «no hay vínculo»: la
    // reutilización tampoco se ofrece sin prueba durable de a quién pertenece la evidencia.
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf({ metadata: {} }),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 3,
    });
    assert.equal(offer.status, 'missing_source_candidate');
  });

  it('un contacto con teléfono escalar NO ve el botón de compra (§11)', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf({ phone: '+15550000001' }),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'phone_already_present');
    assert.equal(offer.actionable, false);
  });

  it('un celular guardado cuenta como teléfono reutilizable', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf({ mobilePhone: '+15550000002' }),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'phone_already_present');
  });

  it('una colección oficial VIVA cuenta, aunque el escalar esté en NULL', () => {
    // Es el estado que deja una erasura de la 115 sobre el principal: el escalar por sí solo no
    // responde «este contacto tiene teléfono».
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf(),
      liveOfficialPhoneCount: 2,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'phone_already_present');
  });

  it('el candidato ya tenía teléfonos ⇒ reutilización GRATIS (§10)', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf(),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 2,
    });
    assert.equal(offer.status, 'reuse_from_candidate');
    assert.equal(offer.actionable, true);
    assert.equal(offer.free, true);
    assert.equal(offer.candidateId, CANDIDATE_ID);
  });

  it('el caso Priscilla: sin teléfono en ninguna parte ⇒ se puede AUTORIZAR una compra', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf(),
      liveOfficialPhoneCount: 0,
      candidateLivePhoneCount: 0,
    });
    assert.equal(offer.status, 'eligible');
    assert.equal(offer.actionable, true);
    assert.equal(offer.free, false);
    assert.equal(offer.candidateId, CANDIDATE_ID);
  });

  it('conteos inválidos se tratan como 0 y no como «tiene teléfono»', () => {
    const offer = classifyOfficialContactPhoneRevealOffer({
      contact: contactOf(),
      liveOfficialPhoneCount: Number.NaN,
      candidateLivePhoneCount: -3,
    });
    assert.equal(offer.status, 'eligible');
  });
});

describe('buildProjectApprovedCandidatePhonesParams — la firma de la 128', () => {
  it('nombra los cinco argumentos de la función y ninguno más', () => {
    const params = buildProjectApprovedCandidatePhonesParams({
      candidateId: CANDIDATE_ID,
      contactId: CONTACT_ID,
      scalarFallback: null,
      actorId: ACTOR_ID,
      nowIso: '2026-08-25T12:00:00.000Z',
    });
    assert.deepEqual(Object.keys(params).sort(), [
      'p_actor_id',
      'p_candidate_id',
      'p_contact_id',
      'p_now',
      'p_scalar_fallback',
    ]);
    assert.equal(params.p_candidate_id, CANDIDATE_ID);
    assert.equal(params.p_contact_id, CONTACT_ID);
    assert.equal(params.p_scalar_fallback, null);
  });

  it('el nombre de la función vive en UNA sola constante', () => {
    assert.equal(
      PROJECT_APPROVED_CANDIDATE_PHONES_FN,
      'project_approved_candidate_phones_onto_contact',
    );
  });
});

describe('parseProjectApprovedCandidatePhonesEnvelope — no confiar en el sobre', () => {
  it('parsea el sobre feliz completo', () => {
    const outcome = parseProjectApprovedCandidatePhonesEnvelope({
      status: 'projected',
      candidate_id: CANDIDATE_ID,
      contact_id: CONTACT_ID,
      phones_seen: 1,
      phones_inserted: 1,
      phones_reused: 0,
      phones_skipped_suppressed: 0,
      sources_inserted: 1,
      sources_reused: 0,
      primary_dedupe_key: 'a'.repeat(64),
      primary_elected_now: true,
      scalar_synced: true,
      scalar_fallback: 'absent',
    });
    assert.equal(outcome.status, 'projected');
    assert.equal(outcome.phonesInserted, 1);
    assert.equal(outcome.primaryElectedNow, true);
    assert.equal(outcome.scalarSynced, true);
  });

  it('un estado desconocido LANZA en vez de propagarse como éxito', () => {
    assert.throws(
      () => parseProjectApprovedCandidatePhonesEnvelope({ status: 'ok' }),
      /unknown envelope status/,
    );
  });

  for (const bad of [null, undefined, 'projected', 42, ['projected']] as const) {
    it(`un sobre que no es objeto (${JSON.stringify(bad)}) LANZA`, () => {
      assert.throws(
        () => parseProjectApprovedCandidatePhonesEnvelope(bad),
        /envelope is not an object/,
      );
    });
  }

  it('los conteos ausentes o basura se leen como 0, no como NaN', () => {
    const outcome = parseProjectApprovedCandidatePhonesEnvelope({
      status: 'scalar_incumbent_unprojectable',
      phones_inserted: 'muchos',
      sources_inserted: -4,
    });
    assert.equal(outcome.phonesInserted, 0);
    assert.equal(outcome.sourcesInserted, 0);
    assert.equal(outcome.scalarSynced, false);
    assert.equal(outcome.scalarFallback, 'absent');
  });

  it('los once estados del sobre son reconocidos', () => {
    for (const status of [
      'projected',
      'invalid_input',
      'candidate_not_found',
      'candidate_not_projectable',
      'contact_link_missing',
      'contact_link_mismatch',
      'contact_not_found',
      'contact_mismatch',
      'contact_not_projectable',
      'person_suppressed',
      'scalar_incumbent_unprojectable',
    ]) {
      assert.equal(parseProjectApprovedCandidatePhonesEnvelope({ status }).status, status);
    }
  });
});
