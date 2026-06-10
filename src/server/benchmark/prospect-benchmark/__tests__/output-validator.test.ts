/**
 * Output Validator Tests (Hotfix 16AB.24.5)
 *
 * 15 casos dirigidos — sin llamadas a APIs externas.
 * Usa node:test + node:assert.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateVerificationOutput } from '../context/output-validator';
import {
  transformWithValidation,
  assertTwelveColumns,
} from '../context/output-transformer';
import type { CompactVerificationRecord } from '../context/types';

// ─── Fixture base válido ───────────────────────────────────────────────────────

function makeBase(): CompactVerificationRecord {
  return {
    candidate_name: 'Acme Corp',
    identity: {
      status: 'verified',
      commercial_name: 'Acme Corp',
      legal_name: { value: 'Acme Corp S.A.S.', status: 'verified', evidence_urls: [] },
      official_website: 'https://acme.com',
      linkedin_company_url: 'https://www.linkedin.com/company/acme',
      evidence_urls: ['https://acme.com'],
    },
    colombia_operation: {
      status: 'verified',
      primary_city: 'Bogotá',
      other_cities: ['Medellín'],
      evidence_urls: ['https://acme.com/colombia'],
    },
    technology_b2b_fit: {
      status: 'verified',
      subsegment: 'SaaS',
      reason: 'Plataforma B2B de software',
      evidence_urls: ['https://acme.com'],
    },
    size: {
      value: '501-1.000',
      status: 'estimated',
      scope: 'colombia',
      evidence_urls: [],
    },
    company_facts: {
      incorporation_date: '2013-05-24',
      incorporation_year: 2013,
      evidence_urls: [],
    },
    ubits_fit: { signals: ['LMS integration'], status: 'present' },
    conflicts: [],
    missing_information: [],
    audit_status: 'eligible_auditable',
    confidence: 'Alta',
    eligibility: 'eligible_auditable',
    primary_evidence_url: 'https://acme.com',
    notes: '',
  };
}

// ─── Test 1: Ciudad válida llega al transformador ─────────────────────────────

describe('Test 1 — ciudad válida llega al transformador', () => {
  it('row.ciudad debe ser la ciudad del fixture', () => {
    const result = transformWithValidation(makeBase());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.ciudad, 'Bogotá');
  });
});

// ─── Test 2: Ciudad ausente queda vacía ───────────────────────────────────────

describe('Test 2 — ciudad ausente queda vacía', () => {
  it('row.ciudad debe ser string vacío cuando primary_city es null', () => {
    const input = makeBase();
    input.colombia_operation.primary_city = null;
    const result = transformWithValidation(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.ciudad, '');
    // Warning pero no blocking
    const blocking = result.issues.filter((i) => i.severity === 'blocking');
    assert.equal(blocking.length, 0);
  });
});

// ─── Test 3: Razón social se preserva en notas ───────────────────────────────

describe('Test 3 — razón social se preserva en notas', () => {
  it('la razón social distinta del nombre comercial debe aparecer en notas', () => {
    const input = makeBase();
    input.identity.commercial_name = 'Acme Corp';
    input.identity.legal_name.value = 'Acme Corp S.A.S.';
    const result = transformWithValidation(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.row.notas, /Razón social: Acme Corp S\.A\.S\./);
  });
});

// ─── Test 4: Nombre comercial sigue en Empresa ───────────────────────────────

describe('Test 4 — nombre comercial sigue en columna Empresa', () => {
  it('row.empresa debe ser el commercial_name, no la razón social', () => {
    const input = makeBase();
    input.identity.commercial_name = 'Acme Corp';
    input.identity.legal_name.value = 'Acme Corporación S.A.S.';
    const result = transformWithValidation(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.empresa, 'Acme Corp');
  });
});

// ─── Test 5: Fecha ISO válida ─────────────────────────────────────────────────

describe('Test 5 — fecha ISO válida', () => {
  it('fecha 2013-05-24 debe preservarse en el output saneado', () => {
    const result = validateVerificationOutput(makeBase(), { currentYear: 2026 });
    assert.equal(result.valid, true);
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_date, '2013-05-24');
  });
});

// ─── Test 6: Fecha de calendario imposible ───────────────────────────────────

describe('Test 6 — fecha de calendario imposible', () => {
  it('2023-02-29 debe sanearse a null con warning (no blocking)', () => {
    const input = makeBase();
    input.company_facts.incorporation_date = '2023-02-29' as never;
    input.company_facts.incorporation_year = null;
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    // No debe ser blocking — solo warning
    assert.equal(result.blockingIssues.length, 0);
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_date, null);
    const dateIssue = result.issues.find((i) => i.path === 'company_facts.incorporation_date');
    assert.notEqual(dateIssue, undefined);
    assert.equal(dateIssue!.severity, 'warning');
  });
});

// ─── Test 7: Texto de fecha malformado ────────────────────────────────────────

describe('Test 7 — texto de fecha malformado', () => {
  it('"24 de mayo de 2013" debe sanearse a null con warning', () => {
    const input = makeBase();
    input.company_facts.incorporation_date = '24 de mayo de 2013' as never;
    input.company_facts.incorporation_year = null;
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    assert.equal(result.blockingIssues.length, 0);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_date, null);
    const issue = result.issues.find(
      (i) => i.path === 'company_facts.incorporation_date' && i.severity === 'warning',
    );
    assert.notEqual(issue, undefined);
  });
});

// ─── Test 8: Año válido aislado ───────────────────────────────────────────────

describe('Test 8 — año válido aislado sin fecha', () => {
  it('incorporation_year 2013 sin fecha debe preservar año y dejar fecha null', () => {
    const input = makeBase();
    input.company_facts.incorporation_date = null;
    input.company_facts.incorporation_year = 2013;
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    assert.equal(result.blockingIssues.length, 0);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_year, 2013);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_date, null);
  });
});

// ─── Test 9: Año futuro ───────────────────────────────────────────────────────

describe('Test 9 — año futuro', () => {
  it('incorporation_year mayor que currentYear debe sanearse a null con warning', () => {
    const input = makeBase();
    input.company_facts.incorporation_date = null;
    input.company_facts.incorporation_year = 2030;
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    assert.equal(result.blockingIssues.length, 0);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_year, null);
    const issue = result.issues.find(
      (i) => i.path === 'company_facts.incorporation_year' && i.code === 'year_in_future',
    );
    assert.notEqual(issue, undefined);
  });
});

// ─── Test 10: Fecha y año inconsistentes ──────────────────────────────────────

describe('Test 10 — fecha y año inconsistentes', () => {
  it('fecha 2013-05-24 con year 2014 debe emitir warning pero preservar ambos', () => {
    const input = makeBase();
    input.company_facts.incorporation_date = '2013-05-24';
    input.company_facts.incorporation_year = 2014;
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    assert.equal(result.blockingIssues.length, 0);
    const issue = result.issues.find((i) => i.code === 'date_year_inconsistent');
    assert.notEqual(issue, undefined);
    assert.equal(issue!.severity, 'warning');
    // Ambos se preservan (no se auto-corrigen)
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_date, '2013-05-24');
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_year, 2014);
  });
});

// ─── Test 11: Error secundario no bloquea la empresa ─────────────────────────

describe('Test 11 — error secundario no bloquea la empresa', () => {
  it('ciudad inválida (warning) no debe impedir la transformación', () => {
    const input = makeBase();
    // Forzar ciudad con espacios extra — se sanea pero no bloquea
    input.colombia_operation.primary_city = '  Bogotá  ';
    const result = transformWithValidation(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.row.ciudad, 'Bogotá');
  });
});

// ─── Test 12: size.scope preservado ──────────────────────────────────────────

describe('Test 12 — size.scope preservado', () => {
  it('scope global_group debe llegar intacto al sanitizedOutput', () => {
    const input = makeBase();
    input.size.scope = 'global_group';
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    assert.equal(result.valid, true);
    assert.equal(result.sanitizedOutput!.size.scope, 'global_group');
  });

  it('scope unknown debe ser válido', () => {
    const input = makeBase();
    input.size.scope = 'unknown';
    const result = validateVerificationOutput(input, { currentYear: 2026 });
    const scopeBlocking = result.blockingIssues.filter((i) => i.path === 'size.scope');
    assert.equal(scopeBlocking.length, 0);
    assert.equal(result.sanitizedOutput!.size.scope, 'unknown');
  });
});

// ─── Test 13: Migración del schema anterior ───────────────────────────────────

describe('Test 13 — migración de schema 16AB.24.2-v1', () => {
  it('input sin company_facts debe migrarse con warning legacy_schema_migrated', () => {
    const legacy = {
      candidate_name: 'LegacyCo',
      identity: {
        status: 'verified',
        commercial_name: 'LegacyCo',
        legal_name: 'LegacyCo S.A.',  // string en lugar de objeto
        official_website: 'https://legacy.co',
        linkedin_company_url: null,
        evidence_urls: ['https://legacy.co'],
      },
      colombia_operation: {
        status: 'verified',
        primary_city: 'Bogotá',
        other_cities: [],
        evidence_urls: [],
      },
      // company_facts ausente — marca como legacy
      technology_b2b_fit: {
        status: 'verified',
        subsegment: null,
        reason: 'SaaS B2B',
        evidence_urls: [],
      },
      size: { value: '51-200', status: 'estimated', scope: 'colombia', evidence_urls: [] },
      ubits_fit: { signals: [], status: 'not_found' },
      conflicts: [],
      missing_information: [],
      audit_status: 'eligible_auditable',
      confidence: 'Media',
      eligibility: 'eligible_auditable',
      primary_evidence_url: 'https://legacy.co',
      notes: '',
    };

    const result = validateVerificationOutput(legacy, { currentYear: 2026 });

    const migrationWarning = result.issues.find((i) => i.code === 'legacy_schema_migrated');
    assert.notEqual(migrationWarning, undefined, 'Debe existir warning de migración');
    assert.equal(migrationWarning!.severity, 'warning');

    // legal_name debe haberse estructurado
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(typeof result.sanitizedOutput!.identity.legal_name, 'object');
    assert.equal(result.sanitizedOutput!.identity.legal_name.value, 'LegacyCo S.A.');
    // company_facts debe haberse creado vacío
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_date, null);
    assert.equal(result.sanitizedOutput!.company_facts.incorporation_year, null);
  });
});

// ─── Test 14: Elegibilidad incompatible con confianza baja ───────────────────

describe('Test 14 — elegibilidad incompatible con confianza Baja', () => {
  it('confidence Baja + eligible_auditable debe producir blocking y degradar eligibility', () => {
    const input = makeBase();
    input.confidence = 'Baja';
    input.eligibility = 'eligible_auditable';

    const result = validateVerificationOutput(input, { currentYear: 2026 });

    assert.equal(result.valid, false);
    const blocking = result.blockingIssues.find(
      (i) => i.code === 'eligible_with_low_confidence',
    );
    assert.notEqual(blocking, undefined, 'Debe existir blocking issue eligible_with_low_confidence');
    assert.equal(result.sanitizedOutput!.eligibility, 'requires_review');
  });
});

// ─── Test 15: Exactamente 12 columnas ────────────────────────────────────────

describe('Test 15 — exactamente 12 columnas', () => {
  it('assertTwelveColumns no debe lanzar para un output válido', () => {
    const result = transformWithValidation(makeBase());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.doesNotThrow(() => assertTwelveColumns(result.row));
    assert.equal(Object.keys(result.row).length, 12);
  });
});
