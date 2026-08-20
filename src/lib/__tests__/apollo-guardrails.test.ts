/**
 * Tests — apollo-guardrails.ts (Hito 17A.6B)
 *
 * Verifica que el config compartido expone los valores correctos de guardrail
 * y que no contiene secretos. Es seguro para frontend.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { APOLLO_CONTACT_ENRICHMENT_GUARDRAILS } from '../apollo-guardrails';

describe('APOLLO_CONTACT_ENRICHMENT_GUARDRAILS', () => {
  // ── Guardrails de búsqueda (17A.6D) ──────────────────────────
  it('maxSearchAttempts = 3 (limita capas de búsqueda por run)', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxSearchAttempts, 3);
  });

  it('maxResultsPerSearchAttempt = 5 (per_page enviado a Apollo por intento)', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxResultsPerSearchAttempt, 5);
  });

  it('maxSearchResultsPerRun = 15 (tope duro acumulado de resultados por run)', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxSearchResultsPerRun, 15);
  });

  // AGENT2A-APOLLO-PEOPLE-SEARCH-BILLING-TRUTH-1 — el aserto anterior era
  // `maxEstimatedSearchCreditsPerRun === maxSearchResultsPerRun` ("Apollo cobra 1
  // crédito por resultado"). El soporte de Apollo confirmó que People Search no cobra,
  // así que ese aserto fijaba en un test la premisa falsa que producía los créditos
  // fantasma: ligaba el COSTO al VOLUMEN.
  it('maxEstimatedSearchCreditsPerRun = 0 (People Search no cobra créditos)', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxEstimatedSearchCreditsPerRun, 0);
  });

  it('el costo cero de la búsqueda NO relaja el tope de volumen', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    assert.equal(g.maxEstimatedSearchCreditsPerRun, 0);
    assert.equal(g.maxSearchResultsPerRun, 15);
    assert.equal(g.maxSearchAttempts, 3);
  });

  it('el costo cero NO se generaliza al enriquecimiento pagado', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    assert.ok(g.maxCompletionCreditsPerRun > 0, 'completion (people/match) sigue siendo pagada');
    assert.ok(g.emailRevealCredits > 0, 'el reveal de email sigue costando');
    assert.ok(g.phoneRevealCredits > 0, 'el reveal de teléfono sigue costando');
  });

  it('targetReviewableContacts = 2 (stop-early cuando se acumulan suficientes candidatos revisables)', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.targetReviewableContacts, 2);
  });

  it('maxSearchResultsPerRun = maxSearchAttempts × maxResultsPerSearchAttempt (presupuesto consistente)', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    assert.equal(g.maxSearchResultsPerRun, g.maxSearchAttempts * g.maxResultsPerSearchAttempt);
  });

  // ── Guardrails de completion ──────────────────────────────────
  it('maxCompletionCandidates = 3', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxCompletionCandidates, 3);
  });

  it('maxCompletionCreditsPerRun = 10', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.maxCompletionCreditsPerRun, 10);
  });

  it('automaticPhoneRevealEnabled = false (reveal automático desactivado, no el dato de teléfono)', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.automaticPhoneRevealEnabled, false);
  });

  it('automaticPhoneRevealEnabled=false no implica que phone sea canal inválido — solo que no se revela automáticamente', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    // El guardrail controla el reveal/match adicional, no los datos de búsqueda.
    assert.equal(g.automaticPhoneRevealEnabled, false);
    // El costo de reveal sigue configurado para cuando se active en el futuro.
    assert.ok(g.phoneRevealCredits > 0, 'phoneRevealCredits debe estar configurado aunque el reveal esté desactivado');
  });

  it('emailRevealCredits = 1', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.emailRevealCredits, 1);
  });

  it('phoneRevealCredits = 8', () => {
    assert.equal(APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.phoneRevealCredits, 8);
  });

  it('maxCompletionCreditsPerRun >= maxCompletionCandidates (presupuesto cubre todos sin phone)', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    assert.ok(
      g.maxCompletionCreditsPerRun >= g.maxCompletionCandidates,
      'El presupuesto debe cubrir al menos un email por candidato',
    );
  });

  it('no expone secretos — solo números y booleanos', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    for (const [key, value] of Object.entries(g)) {
      const type = typeof value;
      assert.ok(
        type === 'number' || type === 'boolean',
        `Campo "${key}" debe ser number o boolean, encontrado: ${type}`,
      );
    }
  });

  it('phoneRevealCredits > emailRevealCredits (phone es más caro)', () => {
    const g = APOLLO_CONTACT_ENRICHMENT_GUARDRAILS;
    assert.ok(g.phoneRevealCredits > g.emailRevealCredits);
  });
});
