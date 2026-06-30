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
