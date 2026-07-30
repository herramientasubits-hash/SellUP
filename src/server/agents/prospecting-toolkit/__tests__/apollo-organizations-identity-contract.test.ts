/**
 * A1-APOLLO-WIZARD-1 — Identidad canónica y orden de deduplicación.
 *
 * Puro, offline, determinista.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APOLLO_PIPELINE_STAGE_ORDER,
  APOLLO_NON_AUTHORITATIVE_IDENTITY_FIELDS,
  apolloPipelineStageIndex,
  assertApolloDeduplicationOrder,
  assertLegalIdentifierNotFromApollo,
  assertApolloIdNotUsedAsCanonicalIdentity,
  buildApolloProviderReference,
  evaluateCanonicalIdentityStrength,
  canRunDefinitiveDeduplication,
  type CanonicalIdentitySignals,
} from '../apollo-organizations-identity-contract';

const noSignals: CanonicalIdentitySignals = {
  primaryDomain: null,
  alternateDomains: [],
  linkedinUrl: null,
  normalizedName: null,
  legalIdentifier: null,
  legalIdentifierSource: null,
};

describe('A1-APOLLO-WIZARD-1 · orden del pipeline', () => {
  it('declara el orden obligatorio de extremo a extremo', () => {
    assert.deepEqual(APOLLO_PIPELINE_STAGE_ORDER, [
      'provider_discovery',
      'initial_normalization',
      'initial_gates',
      'country_legal_enrichment',
      'canonical_company_identity',
      'definitive_deduplication',
      'candidate_persistence',
      'human_review',
    ]);
  });

  // ── Caso 19: enriquecimiento legal antes de la deduplicación final ─────────
  it('el enriquecimiento legal precede a la deduplicación definitiva', () => {
    assert.ok(
      apolloPipelineStageIndex('country_legal_enrichment') <
        apolloPipelineStageIndex('definitive_deduplication'),
    );
    assert.doesNotThrow(() =>
      assertApolloDeduplicationOrder({
        legalEnrichmentStage: 'country_legal_enrichment',
        definitiveDeduplicationStage: 'definitive_deduplication',
      }),
    );
  });

  it('rechaza una ruta que deduplique definitivamente antes del enriquecimiento legal', () => {
    assert.throws(
      () =>
        assertApolloDeduplicationOrder({
          legalEnrichmentStage: 'candidate_persistence',
          definitiveDeduplicationStage: 'initial_normalization',
        }),
      /definitive deduplication runs before country legal enrichment/,
    );
  });

  it('la identidad canónica se construye antes de deduplicar definitivamente', () => {
    assert.ok(
      apolloPipelineStageIndex('canonical_company_identity') <
        apolloPipelineStageIndex('definitive_deduplication'),
    );
  });

  it('la persistencia y la revisión humana van al final', () => {
    assert.ok(
      apolloPipelineStageIndex('definitive_deduplication') <
        apolloPipelineStageIndex('candidate_persistence'),
    );
    assert.ok(
      apolloPipelineStageIndex('candidate_persistence') <
        apolloPipelineStageIndex('human_review'),
    );
  });
});

describe('A1-APOLLO-WIZARD-1 · identidad de proveedor vs identidad de empresa', () => {
  it('construye la referencia de proveedor con org id y account id separados', () => {
    const ref = buildApolloProviderReference({
      providerOrganizationId: 'org_1',
      providerAccountId: 'acct_1',
    });
    assert.deepEqual(ref, {
      provider: 'apollo',
      providerOrganizationId: 'org_1',
      providerAccountId: 'acct_1',
    });
  });

  it('exige un organization id no vacío', () => {
    assert.throws(
      () => buildApolloProviderReference({ providerOrganizationId: '   ' }),
      /requires_organization_id/,
    );
  });

  // ── Caso 18: el Apollo ID no es identidad definitiva ───────────────────────
  it('rechaza usar el Apollo Organization ID como identidad canónica', () => {
    const providerReference = buildApolloProviderReference({
      providerOrganizationId: 'org_1',
      providerAccountId: 'acct_1',
    });
    for (const key of ['org_1', 'apollo:org_1']) {
      assert.throws(
        () => assertApolloIdNotUsedAsCanonicalIdentity({ canonicalIdentityKey: key, providerReference }),
        /Apollo organization id used as canonical identity/,
      );
    }
  });

  it('rechaza usar el Apollo Account ID como identidad canónica', () => {
    const providerReference = buildApolloProviderReference({
      providerOrganizationId: 'org_1',
      providerAccountId: 'acct_1',
    });
    assert.throws(
      () => assertApolloIdNotUsedAsCanonicalIdentity({ canonicalIdentityKey: 'acct_1', providerReference }),
      /Apollo account id used as canonical identity/,
    );
  });

  it('acepta una identidad canónica basada en dominio o identificador legal', () => {
    const providerReference = buildApolloProviderReference({ providerOrganizationId: 'org_1' });
    for (const key of ['acme.com', 'co:900123456', null]) {
      assert.doesNotThrow(() =>
        assertApolloIdNotUsedAsCanonicalIdentity({ canonicalIdentityKey: key, providerReference }),
      );
    }
  });
});

describe('A1-APOLLO-WIZARD-1 · identificador legal', () => {
  it('enumera los campos que Apollo no puede fundamentar', () => {
    for (const field of ['tax_identifier', 'nit', 'rfc', 'rut', 'ruc', 'cnpj', 'vat']) {
      assert.ok(
        (APOLLO_NON_AUTHORITATIVE_IDENTITY_FIELDS as readonly string[]).includes(field),
        `${field} debe declararse como no autoritativo para Apollo`,
      );
    }
  });

  it('rechaza un identificador legal atribuido a Apollo', () => {
    assert.throws(
      () =>
        assertLegalIdentifierNotFromApollo({
          legalIdentifier: '900123456',
          legalIdentifierSource: 'apollo_organizations',
        }),
      /attributed to Apollo discovery/,
    );
  });

  it('rechaza un identificador legal sin fuente oficial', () => {
    assert.throws(
      () => assertLegalIdentifierNotFromApollo({ legalIdentifier: '900123456', legalIdentifierSource: null }),
      /without an official source/,
    );
  });

  it('acepta un identificador legal proveniente del enriquecimiento oficial del país', () => {
    assert.doesNotThrow(() =>
      assertLegalIdentifierNotFromApollo({
        legalIdentifier: '900123456',
        legalIdentifierSource: 'co_siis',
      }),
    );
  });

  it('sin identificador legal no hay nada que validar', () => {
    assert.doesNotThrow(() =>
      assertLegalIdentifierNotFromApollo({ legalIdentifier: null, legalIdentifierSource: null }),
    );
  });
});

describe('A1-APOLLO-WIZARD-1 · fuerza de identidad', () => {
  it('clasifica la fuerza según la mejor señal disponible', () => {
    assert.equal(
      evaluateCanonicalIdentityStrength({ ...noSignals, legalIdentifier: '900', legalIdentifierSource: 'co_siis' }),
      'legal_identifier',
    );
    assert.equal(
      evaluateCanonicalIdentityStrength({ ...noSignals, primaryDomain: 'acme.com' }),
      'domain_backed',
    );
    assert.equal(
      evaluateCanonicalIdentityStrength({ ...noSignals, linkedinUrl: 'https://linkedin.com/company/acme' }),
      'linkedin_backed',
    );
    assert.equal(
      evaluateCanonicalIdentityStrength({ ...noSignals, normalizedName: 'acme sas' }),
      'name_only',
    );
    assert.equal(evaluateCanonicalIdentityStrength(noSignals), 'provider_reference_only');
  });

  it('sólo el identificador legal habilita la deduplicación definitiva', () => {
    assert.equal(canRunDefinitiveDeduplication('legal_identifier'), true);
    for (const weak of ['domain_backed', 'linkedin_backed', 'name_only', 'provider_reference_only'] as const) {
      assert.equal(canRunDefinitiveDeduplication(weak), false, `${weak} no debe habilitarla`);
    }
  });

  it('un candidato recién descubierto en Apollo no puede deduplicarse definitivamente', () => {
    // Estado justo tras el discovery: dominio y nombre, sin identificador legal.
    const strength = evaluateCanonicalIdentityStrength({
      ...noSignals,
      primaryDomain: 'acme.com',
      normalizedName: 'acme sas',
    });
    assert.equal(canRunDefinitiveDeduplication(strength), false);
  });
});
