// Agente 2A — Company Consistency Checker Tests
// Hito 17A.9G — Evaluación de consistencia empresa/candidato.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCompanyConsistency,
  normalizeDomain,
  extractEmailDomain,
  type CompanyConsistencyInput,
} from '../company-consistency-checker';

// ── normalizeDomain ────────────────────────────────────────────

describe('normalizeDomain', () => {
  it('extrae dominio de URL con protocolo', () => {
    assert.equal(normalizeDomain('https://coca-colafemsa.com'), 'coca-colafemsa.com');
  });

  it('extrae dominio de URL con path', () => {
    assert.equal(normalizeDomain('https://coca-colafemsa.com/careers/jobs'), 'coca-colafemsa.com');
  });

  it('strips www.', () => {
    assert.equal(normalizeDomain('https://www.coca-colafemsa.com'), 'coca-colafemsa.com');
  });

  it('maneja dominio sin protocolo', () => {
    assert.equal(normalizeDomain('coca-colafemsa.com'), 'coca-colafemsa.com');
  });

  it('maneja dominio con www. sin protocolo', () => {
    assert.equal(normalizeDomain('www.coca-colafemsa.com'), 'coca-colafemsa.com');
  });

  it('retorna null para valor vacío', () => {
    assert.equal(normalizeDomain(''), null);
    assert.equal(normalizeDomain(null), null);
    assert.equal(normalizeDomain(undefined), null);
  });
});

// ── extractEmailDomain ─────────────────────────────────────────

describe('extractEmailDomain', () => {
  it('extrae dominio del email', () => {
    assert.equal(extractEmailDomain('persona@coca-colafemsa.com'), 'coca-colafemsa.com');
  });

  it('normaliza a minúsculas', () => {
    assert.equal(extractEmailDomain('Persona@ACRIP.org'), 'acrip.org');
  });

  it('retorna null sin @', () => {
    assert.equal(extractEmailDomain('sinArroba'), null);
  });

  it('retorna null para null/undefined', () => {
    assert.equal(extractEmailDomain(null), null);
    assert.equal(extractEmailDomain(undefined), null);
  });
});

// ── checkCompanyConsistency ────────────────────────────────────

function input(overrides: Partial<CompanyConsistencyInput> = {}): CompanyConsistencyInput {
  return {
    email: null,
    apolloOrganizationName: null,
    apolloOrganizationWebsiteUrl: null,
    companyDomain: null,
    companyName: null,
    ...overrides,
  };
}

describe('checkCompanyConsistency — email domain match', () => {
  it('email domain coincide con company_domain → match', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'persona@coca-colafemsa.com',
        companyDomain: 'coca-colafemsa.com',
      }),
    );
    assert.equal(result.status, 'match');
    assert.equal(result.review_required, false);
    assert.ok(result.signals.includes('email_domain_matches_company_domain'));
  });

  it('email domain difiere de company_domain → possible_mismatch', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'cmolina@rica.com.mx',
        companyDomain: 'coca-colafemsa.com',
      }),
    );
    assert.equal(result.status, 'possible_mismatch');
    assert.equal(result.review_required, true);
    assert.ok(result.signals.includes('email_domain_differs_from_company_domain'));
  });

  it('email genérico (gmail) → unknown, sin mismatch fuerte', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'persona@gmail.com',
        companyDomain: 'acrip.org',
      }),
    );
    assert.equal(result.status, 'unknown');
    assert.equal(result.review_required, false);
    assert.ok(result.signals.includes('email_domain_is_generic'));
    assert.ok(!result.signals.includes('email_domain_differs_from_company_domain'));
  });

  it('email outlook genérico → unknown', () => {
    const result = checkCompanyConsistency(
      input({ email: 'persona@outlook.com', companyDomain: 'administrategia.com' }),
    );
    assert.equal(result.status, 'unknown');
  });

  it('sin email → unknown', () => {
    const result = checkCompanyConsistency(
      input({ email: null, companyDomain: 'acrip.org' }),
    );
    assert.equal(result.status, 'unknown');
    assert.equal(result.review_required, false);
  });
});

describe('checkCompanyConsistency — Apollo organization domain', () => {
  it('apollo organization domain coincide con company_domain → match', () => {
    const result = checkCompanyConsistency(
      input({
        apolloOrganizationWebsiteUrl: 'https://administrategia.com',
        companyDomain: 'administrategia.com',
      }),
    );
    assert.equal(result.status, 'match');
    assert.ok(result.signals.includes('apollo_organization_domain_matches'));
  });

  it('apollo organization domain difiere de company_domain → possible_mismatch', () => {
    const result = checkCompanyConsistency(
      input({
        apolloOrganizationWebsiteUrl: 'https://otraempresa.com',
        companyDomain: 'administrategia.com',
      }),
    );
    assert.equal(result.status, 'possible_mismatch');
    assert.ok(result.signals.includes('apollo_organization_domain_differs'));
  });

  it('sin apollo org domain → sin señal B', () => {
    const result = checkCompanyConsistency(
      input({ apolloOrganizationWebsiteUrl: null, companyDomain: 'administrategia.com' }),
    );
    assert.ok(!result.signals.some((s) => s.startsWith('apollo_organization_domain')));
  });
});

describe('checkCompanyConsistency — sin email, con LinkedIn', () => {
  it('sin email y sin organización Apollo → unknown', () => {
    const result = checkCompanyConsistency(
      input({
        email: null,
        apolloOrganizationName: null,
        apolloOrganizationWebsiteUrl: null,
        companyDomain: 'empresa.com',
      }),
    );
    assert.equal(result.status, 'unknown');
    assert.equal(result.review_required, false);
    assert.deepEqual(result.signals, []);
  });
});

describe('checkCompanyConsistency — metadata en candidato', () => {
  it('status se escribe en el resultado con los campos esperados', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'persona@coca-colafemsa.com',
        companyDomain: 'coca-colafemsa.com',
        companyName: 'Coca-Cola FEMSA',
        apolloOrganizationName: 'Coca-Cola FEMSA',
        apolloOrganizationWebsiteUrl: 'https://coca-colafemsa.com',
      }),
    );
    assert.equal(typeof result.status, 'string');
    assert.equal(typeof result.explanation, 'string');
    assert.ok(Array.isArray(result.signals));
    assert.equal(typeof result.review_required, 'boolean');
    assert.equal(result.email_domain, 'coca-colafemsa.com');
    assert.equal(result.expected_domain, 'coca-colafemsa.com');
  });

  it('resultado de mismatch contiene explicación no vacía', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'cmolina@rica.com.mx',
        companyDomain: 'coca-colafemsa.com',
      }),
    );
    assert.ok(result.explanation.length > 0);
    assert.ok(result.explanation.includes('rica.com.mx') || result.explanation.length > 10);
  });
});

describe('checkCompanyConsistency — possible_related_domain', () => {
  it('dominio difiere pero nombre es similar → possible_related_domain', () => {
    // Rica es una marca de Coca-Cola FEMSA, nombre similar puede producir related.
    const result = checkCompanyConsistency(
      input({
        email: 'cmolina@rica.com.mx',
        companyDomain: 'coca-colafemsa.com',
        companyName: 'Rica',
        apolloOrganizationName: 'Rica',
        apolloOrganizationWebsiteUrl: 'https://rica.com.mx',
      }),
    );
    // Nombre idéntico entre apolloOrg y companyName → possible_related_domain
    assert.equal(result.status, 'possible_related_domain');
    assert.equal(result.review_required, true);
  });
});

describe('checkCompanyConsistency — múltiples señales', () => {
  it('email match + org domain match → match robusto', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'persona@administrategia.com',
        apolloOrganizationWebsiteUrl: 'https://www.administrategia.com',
        companyDomain: 'administrategia.com',
        companyName: 'Administrategia',
        apolloOrganizationName: 'Administrategia',
      }),
    );
    assert.equal(result.status, 'match');
    assert.ok(result.signals.includes('email_domain_matches_company_domain'));
    assert.ok(result.signals.includes('apollo_organization_domain_matches'));
  });

  it('email mismatch + org domain mismatch → possible_mismatch con señales múltiples', () => {
    const result = checkCompanyConsistency(
      input({
        email: 'persona@otra.com',
        apolloOrganizationWebsiteUrl: 'https://otra.com',
        companyDomain: 'empresa.com',
      }),
    );
    assert.equal(result.status, 'possible_mismatch');
    assert.ok(result.signals.includes('email_domain_differs_from_company_domain'));
    assert.ok(result.signals.includes('apollo_organization_domain_differs'));
  });
});
