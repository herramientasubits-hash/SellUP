/**
 * Agente 2A — el núcleo PURO de la aprobación atómica (AGENT2A-PHONE-REVEAL-4O-H3).
 *
 * Aquí se fija la única decisión que la H3 toma en TypeScript y no en SQL: si la procedencia
 * heredada de un candidato escalar-only puede representarse FIELMENTE en el modelo oficial. Es
 * la decisión con más consecuencias del hito, porque una inversión inventada no rompe nada hoy
 * y sí rompe el borrado de mañana: un número marcado `manual` sobrevive a una erasure de
 * proveedor que debería haberlo alcanzado.
 *
 * Sin red, sin DB, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN,
  buildApproveCandidateWithPhonesParams,
  buildCandidateScalarFallback,
  parseApproveCandidateWithPhonesEnvelope,
} from '../official-contact-approval-core';
import { normalizeCandidatePhone } from '../phone-collection-core';

const PHONE = '+15550000001';

describe('4O-H3 — inversión de la procedencia heredada', () => {
  it('invierte los CINCO miembros que la 112 mapea sin ambigüedad', () => {
    const cases: [string, string, string][] = [
      ['apollo_search', 'apollo', 'search'],
      ['apollo_reveal', 'apollo', 'reveal'],
      ['apollo_cache', 'apollo_cache', 'cache'],
      ['lusha_reveal', 'lusha', 'reveal'],
      ['manual', 'manual', 'manual'],
    ];
    for (const [legacy, provider, mode] of cases) {
      const out = buildCandidateScalarFallback({
        phone: PHONE,
        phoneMetadata: { type: 'mobile', source: legacy, raw_type: 'mobile' },
      });
      assert.ok(out, `${legacy} debe invertir`);
      assert.equal(out.provider, provider);
      assert.equal(out.acquisition_mode, mode);
    }
  });

  it('NO inventa una procedencia para `provider_payload` ni para `unknown`', () => {
    // `provider_payload` no nombra a ningún proveedor y `unknown` es la ausencia declarada de
    // evidencia. Los dos son exactamente los casos en los que escribir una fila sería afirmar
    // algo que nadie observó.
    for (const legacy of ['provider_payload', 'unknown']) {
      assert.equal(
        buildCandidateScalarFallback({
          phone: PHONE,
          phoneMetadata: { type: 'mobile', source: legacy },
        }),
        null,
        `${legacy} no debe producir una promoción`,
      );
    }
  });

  it('NO promueve sin metadata, sin `source`, ni con un `source` desconocido', () => {
    assert.equal(buildCandidateScalarFallback({ phone: PHONE, phoneMetadata: null }), null);
    assert.equal(buildCandidateScalarFallback({ phone: PHONE, phoneMetadata: {} }), null);
    assert.equal(
      buildCandidateScalarFallback({ phone: PHONE, phoneMetadata: { source: 'apollo_v2' } }),
      null,
    );
    assert.equal(
      buildCandidateScalarFallback({ phone: PHONE, phoneMetadata: { source: '  ' } }),
      null,
    );
  });

  it('NO promueve sin teléfono ni cuando no queda forma canónica utilizable', () => {
    assert.equal(
      buildCandidateScalarFallback({ phone: null, phoneMetadata: { source: 'manual' } }),
      null,
    );
    assert.equal(
      buildCandidateScalarFallback({ phone: '   ', phoneMetadata: { source: 'manual' } }),
      null,
    );
    // Sin dígitos suficientes, `normalizeCandidatePhone()` devuelve `normalizedPhone: null` y una
    // clave opaca. Una fila canónica sin número no dice nada de nadie y nunca podría ser
    // principal (CHECK de la 114), así que no se escribe.
    assert.equal(
      buildCandidateScalarFallback({ phone: '12', phoneMetadata: { source: 'manual' } }),
      null,
    );
  });

  it('usa EL normalizador del repo: la clave coincide byte a byte con `normalizeCandidatePhone`', () => {
    const out = buildCandidateScalarFallback({
      phone: PHONE,
      phoneMetadata: { type: 'mobile', source: 'apollo_search' },
    });
    assert.ok(out);
    const expected = normalizeCandidatePhone({
      displayPhone: PHONE,
      sanitizedPhone: PHONE,
      countryCode: null,
    });
    assert.equal(out.dedupe_key, expected.dedupeKey);
    assert.equal(out.normalized_phone, expected.normalizedPhone);
    // La clave NUNCA contiene el número.
    assert.match(out.dedupe_key, /^(e164|digits|opaque):[0-9a-f]{64}$/);
    assert.equal(out.dedupe_key.includes('5550000001'), false);
  });

  it('la clave de evento es determinista, PII-free y sin ids de contabilidad inventados', () => {
    const a = buildCandidateScalarFallback({
      phone: PHONE,
      phoneMetadata: { source: 'apollo_search' },
    });
    const b = buildCandidateScalarFallback({
      phone: PHONE,
      phoneMetadata: { source: 'apollo_search' },
    });
    assert.ok(a && b);
    assert.equal(a.source_event_key, b.source_event_key, 'determinista');
    assert.equal(a.source_event_key.includes('5550000001'), false);
    assert.match(a.source_event_key, /^v1:apollo:search:candidate_scalar:-:-:-$/);
  });

  it('normaliza el `phone_type` al vocabulario de la 114 y descarta lo demás', () => {
    const ok = buildCandidateScalarFallback({
      phone: PHONE,
      phoneMetadata: { type: 'direct_dial', source: 'apollo_search' },
    });
    assert.equal(ok?.phone_type, 'direct_dial');

    const bad = buildCandidateScalarFallback({
      phone: PHONE,
      phoneMetadata: { type: 'oficina', source: 'apollo_search' },
    });
    assert.equal(bad?.phone_type, null, 'un tipo fuera del enum no viaja al INSERT');
  });

  it('el `countryCode` NO fabrica un prefijo internacional', () => {
    const national = buildCandidateScalarFallback({
      phone: '5550000001',
      phoneMetadata: { source: 'apollo_search' },
      countryCode: 'CO',
    });
    assert.ok(national);
    assert.equal(
      national.normalized_phone.startsWith('+'),
      false,
      'un número nacional no se convierte en E.164 adivinando el país',
    );
  });
});

describe('4O-H3 — parámetros y sobre', () => {
  it('los parámetros salen con los nombres exactos de la migración 116', () => {
    const params = buildApproveCandidateWithPhonesParams({
      candidateId: 'cand-1',
      accountId: 'acc-1',
      contactPayload: { account_id: 'acc-1' },
      reviewPatch: { status: 'approved' },
      scalarFallback: null,
      actorId: 'user-1',
      nowIso: '2026-08-12T12:00:00.000Z',
    });
    assert.deepEqual(Object.keys(params), [
      'p_candidate_id',
      'p_account_id',
      'p_contact_payload',
      'p_review_patch',
      'p_scalar_fallback',
      'p_actor_id',
      'p_now',
    ]);
    assert.equal(APPROVE_CONTACT_CANDIDATE_WITH_PHONES_FN, 'approve_contact_candidate_with_phones');
  });

  it('parsea el sobre de éxito', () => {
    const out = parseApproveCandidateWithPhonesEnvelope({
      status: 'approved',
      candidate_id: 'cand-1',
      contact_id: 'contact-1',
      contact_mode: 'created',
      contact_created: true,
      phones_seen: 3,
      phones_inserted: 3,
      phones_reused: 0,
      phones_skipped_suppressed: 1,
      sources_inserted: 4,
      sources_reused: 0,
      primary_dedupe_key: 'e164:' + 'a'.repeat(64),
      scalar_synced: true,
      scalar_fallback: 'absent',
      candidate_terminal: true,
    });
    assert.equal(out.status, 'approved');
    assert.equal(out.phonesInserted, 3);
    assert.equal(out.phonesSkippedSuppressed, 1);
    assert.equal(out.sourcesInserted, 4);
    assert.equal(out.candidateTerminal, true);
  });

  it('LANZA ante un sobre desconocido en vez de propagarlo como éxito', () => {
    // Un sobre con forma inesperada DESPUÉS de un COMMIT es exactamente el caso en el que
    // adivinar produce un "aprobado" que nadie escribió.
    assert.throws(() => parseApproveCandidateWithPhonesEnvelope(null));
    assert.throws(() => parseApproveCandidateWithPhonesEnvelope('approved'));
    assert.throws(() => parseApproveCandidateWithPhonesEnvelope([{ status: 'approved' }]));
    assert.throws(() => parseApproveCandidateWithPhonesEnvelope({ status: 'ok' }));
    assert.throws(() => parseApproveCandidateWithPhonesEnvelope({}));
  });

  it('no asume booleanos ni conteos: lo ausente es falso y cero', () => {
    const out = parseApproveCandidateWithPhonesEnvelope({ status: 'candidate_not_found' });
    assert.equal(out.contactCreated, false);
    assert.equal(out.candidateTerminal, false);
    assert.equal(out.phonesInserted, 0);
    assert.equal(out.contactId, null);
    assert.equal(out.scalarFallback, 'absent');
  });
});
