/**
 * Agente 2A — la pata LUSHA sobre un candidato APROBADO
 * (AGENT2A-APPROVED-CANDIDATE-LUSHA-LEG).
 *
 * ═══════════════════════════════════════════════════════════════════
 * EL DEFECTO, MEDIDO EN PRODUCCIÓN
 * ═══════════════════════════════════════════════════════════════════
 *
 * Todo contacto oficial ES, por definición, un candidato `approved`. Y `approved` estaba en la
 * lista de estados «no editable», así que la pata Lusha era ESTRUCTURALMENTE imposible para el
 * 100 % de los contactos aprobados.
 *
 * No es una hipótesis. En `phone_reveal_waterfall_runs` de Producción, el mismo contacto tenía
 * CINCO corridas consecutivas idénticas:
 *
 *   apollo_outcome      = no_phone_found
 *   lusha_eligible      = true          ← el waterfall SÍ quería llamar a Lusha
 *   lusha_skipped_reason= null          ← no se saltó: se intentó
 *   lusha_outcome       = error
 *   error_code          = candidate_not_editable
 *   final_provider      = none
 *
 * ── LA ASIMETRÍA QUE LO CONVIERTE EN DEFECTO Y NO EN PROTECCIÓN ──
 *
 * La pata de APOLLO no comprueba editabilidad en ningún punto, y por tanto YA escribía sobre
 * candidatos aprobados: esas mismas cinco corridas dejaron `no_phone_found` escrito en un
 * candidato `approved`. «Aprobado = congelado» no era una regla del sistema: era una regla de UN
 * proveedor — justo el que quedaba como único capaz de contestar.
 *
 * Determinista y offline: sin red, sin DB, sin proveedores. 0 créditos, 0 escrituras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateLushaPhoneFallbackEligibility,
  isCandidateEditableForPhoneCollection,
  type LushaPhoneFallbackEligibilityInput,
} from '../lusha-phone-fallback-eligibility';
import { evaluatePhoneRevealWaterfallLegacyEligibility } from '../phone-reveal-waterfall-core';

const CONTACT_ID = 'd6f35a76-bce1-46d4-a7e8-8af1591aef87';

// ═══════════════════════════════════════════════════════════════════
// 1. El predicado compartido
// ═══════════════════════════════════════════════════════════════════

describe('editabilidad PARA TELÉFONO — aprobado ya no es congelado', () => {
  it('un candidato APROBADO con contacto oficial SÍ es editable para teléfono', () => {
    // Éste es el caso de Leidy, y el que estaba roto.
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: 'approved',
        candidateReviewStatus: null,
        candidateArchivedAt: null,
        officialContactId: CONTACT_ID,
      }),
      true,
    );
  });

  it('un candidato APROBADO SIN contacto registrado sigue bloqueado (fail-closed)', () => {
    // Sin destino registrado no hay dónde proyectar el teléfono que se compraría: pagar por él
    // sería comprar un dato que no puede llegar a ninguna ficha.
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: 'approved',
        candidateReviewStatus: null,
        candidateArchivedAt: null,
        officialContactId: null,
      }),
      false,
    );
  });

  for (const status of ['rejected', 'discarded', 'archived'] as const) {
    it(`"${status}" sigue bloqueado SIN excepción, aunque hubiera contacto`, () => {
      // La excepción es EXCLUSIVA de `approved`. Un rechazado con contacto vinculado no existe en
      // el producto, y si existiera no autorizaría un gasto.
      assert.equal(
        isCandidateEditableForPhoneCollection({
          candidateStatus: status,
          candidateReviewStatus: null,
          candidateArchivedAt: null,
          officialContactId: CONTACT_ID,
        }),
        false,
      );
    });
  }

  it('un candidato ARCHIVADO por fecha sigue bloqueado', () => {
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: 'approved',
        candidateReviewStatus: null,
        candidateArchivedAt: '2026-08-01T00:00:00.000Z',
        officialContactId: CONTACT_ID,
      }),
      false,
    );
  });

  it('un candidato en REVISIÓN sigue editable, exactamente como antes', () => {
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: 'pending_review',
        candidateReviewStatus: null,
        candidateArchivedAt: null,
        officialContactId: null,
      }),
      true,
    );
  });

  it('la excepción se evalúa también sobre `candidateReviewStatus`, no sólo sobre `status`', () => {
    // Si un día ese campo existe, no puede abrir una puerta más laxa que ésta.
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: null,
        candidateReviewStatus: 'approved',
        candidateArchivedAt: null,
        officialContactId: null,
      }),
      false,
    );
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: null,
        candidateReviewStatus: 'approved',
        candidateArchivedAt: null,
        officialContactId: CONTACT_ID,
      }),
      true,
    );
  });

  it('un estado con «approved» dentro pero distinto NO cuela por parecido', () => {
    // Comparación exacta, no `includes`: `auto_approved_pending` no es `approved`.
    assert.equal(
      isCandidateEditableForPhoneCollection({
        candidateStatus: 'auto_approved_pending',
        candidateReviewStatus: null,
        candidateArchivedAt: null,
        officialContactId: null,
      }),
      true,
      'un estado desconocido se comporta como no-terminal, igual que antes del cambio',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. El gate canónico — el que disparaba en Producción
// ═══════════════════════════════════════════════════════════════════

const eligible = (
  over: Partial<LushaPhoneFallbackEligibilityInput> = {},
): LushaPhoneFallbackEligibilityInput => ({
  candidateStatus: 'approved',
  candidateReviewStatus: null,
  candidateArchivedAt: null,
  officialContactId: CONTACT_ID,
  phoneRevealStatus: 'no_phone_found',
  hasExistingPhone: false,
  hasLushaContactId: true,
  lushaContactIdReuseConfirmed: true,
  lushaPhoneEntitlementConfirmed: true,
  featureFlagEnabled: true,
  actorRole: 'admin',
  hasConfirmedCost: true,
  isBulkAction: false,
  ...over,
});

describe('gate canónico — el caso exacto de Producción ya NO se bloquea', () => {
  it('aprobado + contacto + Apollo agotado ⇒ ELEGIBLE (antes: candidate_not_editable)', () => {
    const result = evaluateLushaPhoneFallbackEligibility(eligible());
    assert.equal(result.reasonCode, 'eligible');
    assert.equal(result.eligible, true);
  });

  it('aprobado SIN contacto ⇒ sigue devolviendo candidate_not_editable', () => {
    const result = evaluateLushaPhoneFallbackEligibility(
      eligible({ officialContactId: null }),
    );
    assert.equal(result.reasonCode, 'candidate_not_editable');
  });

  it('rechazado ⇒ sigue devolviendo candidate_not_editable', () => {
    const result = evaluateLushaPhoneFallbackEligibility(
      eligible({ candidateStatus: 'rejected' }),
    );
    assert.equal(result.reasonCode, 'candidate_not_editable');
  });

  it('la precedencia NO cambió: el flag y el rol siguen ganando a la editabilidad', () => {
    assert.equal(
      evaluateLushaPhoneFallbackEligibility(
        eligible({ featureFlagEnabled: false, officialContactId: null }),
      ).reasonCode,
      'feature_disabled',
    );
    assert.equal(
      evaluateLushaPhoneFallbackEligibility(
        eligible({ actorRole: 'viewer', officialContactId: null }),
      ).reasonCode,
      'unauthorized_role',
    );
  });

  it('y las puertas de AGUAS ABAJO siguen intactas para un aprobado con contacto', () => {
    // Abrir la editabilidad no relaja nada más: Apollo tiene que estar agotado, no puede haber
    // teléfono y hace falta identidad de Lusha. Si alguna cayera con la editabilidad, este
    // cambio habría comprado teléfonos que nadie autorizó.
    assert.equal(
      evaluateLushaPhoneFallbackEligibility(eligible({ phoneRevealStatus: 'requested' }))
        .reasonCode,
      'apollo_not_exhausted',
    );
    assert.equal(
      evaluateLushaPhoneFallbackEligibility(eligible({ hasExistingPhone: true })).reasonCode,
      'existing_phone_present',
    );
    assert.equal(
      evaluateLushaPhoneFallbackEligibility(eligible({ hasLushaContactId: false })).reasonCode,
      'missing_lusha_contact_id',
    );
    assert.equal(
      evaluateLushaPhoneFallbackEligibility(eligible({ hasConfirmedCost: false })).reasonCode,
      'missing_cost_confirmation',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. El pre-filtro del waterfall legacy dice LO MISMO
// ═══════════════════════════════════════════════════════════════════

describe('pre-filtro legacy — no puede condenar lo que el gate deja pasar', () => {
  const evidence = (over: Record<string, unknown> = {}) =>
    ({
      candidateStatus: 'approved',
      matchedContactsId: CONTACT_ID,
      phoneRevealStatus: 'no_phone_found',
      phoneRevealProvider: 'apollo',
      phoneRevealCompletedAt: '2026-08-27T19:14:25.952Z',
      hasPhone: false,
      source: 'apollo',
      sourceContactId: 'lusha-contact-1',
      ...over,
    }) as Parameters<typeof evaluatePhoneRevealWaterfallLegacyEligibility>[0];

  it('aprobado con contacto ya NO se rechaza por candidate_not_editable', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(evidence());
    assert.notEqual(
      result.reason,
      'candidate_not_editable',
      'el pre-filtro seguía condenando la corrida que el gate sí acepta',
    );
  });

  it('aprobado SIN contacto se sigue rechazando', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      evidence({ matchedContactsId: null }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'candidate_not_editable');
  });

  it('rechazado se sigue rechazando', () => {
    const result = evaluatePhoneRevealWaterfallLegacyEligibility(
      evidence({ candidateStatus: 'rejected' }),
    );
    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'candidate_not_editable');
  });
});
