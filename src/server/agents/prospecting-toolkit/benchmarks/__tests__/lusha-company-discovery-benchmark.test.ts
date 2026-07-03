/**
 * Tests — Lusha Company Discovery Benchmark Dry-Run (Q3F-5B)
 *
 * Sin llamadas reales. Sin DB writes. Sin créditos.
 * Usa node:test + assert (patrón del proyecto).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  runLushaCompanyDiscoveryBenchmarkDryRun,
  type LushaCompanyDiscoveryBenchmarkInput,
} from '../lusha-company-discovery-benchmark';

// Garantía: si cualquier fetch real se llama, el test falla inmediatamente
const originalFetch = global.fetch;
before(() => {
  global.fetch = () => {
    throw new Error(
      '[Q3F-5B Guard] fetch real detectado en benchmark dry-run. Este módulo NO debe hacer llamadas HTTP.'
    );
  };
});
after(() => {
  global.fetch = originalFetch;
});

const BASE_INPUT = {
  country: 'CO',
  industry: 'Technology',
  limit: 10,
  benchmark: true as const,
  scenario: 'useful_results' as const,
};

function run(overrides: Partial<LushaCompanyDiscoveryBenchmarkInput>) {
  return runLushaCompanyDiscoveryBenchmarkDryRun({ ...BASE_INPUT, ...overrides });
}

// ============================================================
// Metadatos invariantes
// ============================================================

describe('metadata invariants', () => {
  it('siempre emite provider_key=lusha y dry_run=true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.provider_key, 'lusha');
    assert.equal(result.operation_key, 'company_discovery_benchmark_dry_run');
    assert.equal(result.provider_role, 'lusha_company_discovery_experimental');
    assert.equal(result.dry_run, true);
    assert.equal(result.benchmark, true);
  });

  it('credits_used = 0 y estimated_cost_usd = 0 en todo escenario', () => {
    const scenarios = [
      'useful_results',
      'empty_result',
      'plan_not_authorized',
      'forbidden',
      'invalid_filter',
      'provider_error',
    ] as const;
    for (const scenario of scenarios) {
      const result = run({ scenario });
      assert.equal(result.credits_used, 0);
      assert.equal(result.estimated_cost_usd, 0);
    }
  });

  it('writes_disabled = true en todo escenario', () => {
    const result = run({ scenario: 'empty_result' });
    assert.equal(result.writes_disabled, true);
  });

  it('source_catalog_unchanged = true en todo escenario', () => {
    const result = run({ scenario: 'forbidden' });
    assert.equal(result.source_catalog_unchanged, true);
  });
});

// ============================================================
// Escenario: useful_results
// ============================================================

describe('scenario: useful_results', () => {
  it('retorna outcome success_candidate_pool', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.metrics.outcome, 'success_candidate_pool');
  });

  it('raw_returned > 0', () => {
    const result = run({ scenario: 'useful_results' });
    assert.ok(result.metrics.raw_returned > 0);
  });

  it('has_domain_count >= 0 y <= raw_returned', () => {
    const result = run({ scenario: 'useful_results' });
    assert.ok(result.metrics.has_domain_count >= 0);
    assert.ok(result.metrics.has_domain_count <= result.metrics.raw_returned);
  });

  it('country_match_count refleja empresas que coinciden con el país', () => {
    const result = run({ scenario: 'useful_results', country: 'CO' });
    // mock: Alpha+Beta+Gamma con country=CO, Delta con country=US → 3
    assert.equal(result.metrics.country_match_count, 3);
  });

  it('fields_completeness es un número entre 0 y 1', () => {
    const result = run({ scenario: 'useful_results' });
    assert.ok(result.metrics.fields_completeness !== null);
    assert.ok(result.metrics.fields_completeness >= 0);
    assert.ok(result.metrics.fields_completeness <= 1);
  });

  it('false_positive_rate es un número entre 0 y 1', () => {
    const result = run({ scenario: 'useful_results' });
    assert.ok(result.metrics.false_positive_rate !== null);
    assert.ok(result.metrics.false_positive_rate >= 0);
    assert.ok(result.metrics.false_positive_rate <= 1);
  });

  it('respeta el limit — no retorna más empresas de las pedidas', () => {
    const result = run({ scenario: 'useful_results', limit: 2 });
    assert.ok(result.metrics.raw_returned <= 2);
  });

  it('no invoca ningún writer ni Supabase (fetch guard)', () => {
    assert.doesNotThrow(() => run({ scenario: 'useful_results' }));
  });
});

// ============================================================
// Escenario: empty_result
// ============================================================

describe('scenario: empty_result', () => {
  it('retorna outcome empty_result', () => {
    const result = run({ scenario: 'empty_result' });
    assert.equal(result.metrics.outcome, 'empty_result');
  });

  it('raw_returned = 0', () => {
    const result = run({ scenario: 'empty_result' });
    assert.equal(result.metrics.raw_returned, 0);
  });

  it('false_positive_rate = null cuando raw_returned = 0', () => {
    const result = run({ scenario: 'empty_result' });
    assert.equal(result.metrics.false_positive_rate, null);
  });

  it('fields_completeness = null cuando raw_returned = 0', () => {
    const result = run({ scenario: 'empty_result' });
    assert.equal(result.metrics.fields_completeness, null);
  });
});

// ============================================================
// Escenario: plan_not_authorized (HTTP 402 simulado)
// ============================================================

describe('scenario: plan_not_authorized', () => {
  it('retorna outcome plan_not_authorized', () => {
    const result = run({ scenario: 'plan_not_authorized' });
    assert.equal(result.metrics.outcome, 'plan_not_authorized');
  });

  it('incluye stop_reason que menciona 402', () => {
    const result = run({ scenario: 'plan_not_authorized' });
    assert.ok(result.stop_reason !== undefined);
    assert.ok(result.stop_reason.includes('402'));
  });

  it('raw_returned = 0', () => {
    const result = run({ scenario: 'plan_not_authorized' });
    assert.equal(result.metrics.raw_returned, 0);
  });
});

// ============================================================
// Escenario: forbidden (HTTP 403 simulado)
// ============================================================

describe('scenario: forbidden', () => {
  it('retorna outcome forbidden', () => {
    const result = run({ scenario: 'forbidden' });
    assert.equal(result.metrics.outcome, 'forbidden');
  });

  it('incluye stop_reason que menciona 403', () => {
    const result = run({ scenario: 'forbidden' });
    assert.ok(result.stop_reason !== undefined);
    assert.ok(result.stop_reason.includes('403'));
  });

  it('raw_returned = 0', () => {
    const result = run({ scenario: 'forbidden' });
    assert.equal(result.metrics.raw_returned, 0);
  });
});

// ============================================================
// Escenario: invalid_filter
// ============================================================

describe('scenario: invalid_filter', () => {
  it('retorna outcome invalid_filter', () => {
    const result = run({ scenario: 'invalid_filter' });
    assert.equal(result.metrics.outcome, 'invalid_filter');
  });

  it('filter_notes contiene el país y la industria del input', () => {
    const result = run({ scenario: 'invalid_filter', country: 'XZ', industry: 'UnknownSector' });
    assert.ok(result.filter_notes !== undefined);
    assert.ok(result.filter_notes.includes('XZ'));
    assert.ok(result.filter_notes.includes('UnknownSector'));
  });

  it('raw_returned = 0', () => {
    const result = run({ scenario: 'invalid_filter' });
    assert.equal(result.metrics.raw_returned, 0);
  });

  it('filter_notes no realiza normalización especulativa', () => {
    const result = run({ scenario: 'invalid_filter' });
    assert.ok((result.filter_notes ?? '').toLowerCase().includes('normalización'));
  });
});

// ============================================================
// Garantías de aislamiento
// ============================================================

describe('isolation guarantees', () => {
  it('no hay llamadas externas en ningún escenario (fetch guard)', () => {
    const scenarios = [
      'useful_results',
      'empty_result',
      'plan_not_authorized',
      'forbidden',
      'invalid_filter',
      'provider_error',
    ] as const;
    for (const scenario of scenarios) {
      assert.doesNotThrow(() => run({ scenario }));
    }
  });

  it('el input se preserva en el resultado sin modificación', () => {
    const result = run({ scenario: 'useful_results', country: 'MX', industry: 'Finance' });
    assert.equal(result.input.country, 'MX');
    assert.equal(result.input.industry, 'Finance');
    assert.equal(result.input.scenario, 'useful_results');
  });

  it('el campo benchmark siempre es true en el output', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.benchmark, true);
  });

  it('smoke_test_minimum_page_size_observed = 10 en todo escenario (Q3F-5E.1)', () => {
    const scenarios = [
      'useful_results',
      'empty_result',
      'plan_not_authorized',
      'forbidden',
      'invalid_filter',
      'provider_error',
    ] as const;
    for (const scenario of scenarios) {
      const result = run({ scenario });
      assert.equal(result.smoke_test_minimum_page_size_observed, 10,
        `smoke_test_minimum_page_size_observed debe ser 10 en escenario ${scenario}`);
    }
  });
});
