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
// Q3F-5G — Metadata de shape de filters
// ============================================================

describe('Q3F-5G — filters shape metadata', () => {
  it('filters_shape_observed = "object" en todo escenario', () => {
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
      assert.equal(result.filters_shape_observed, 'object',
        `filters_shape_observed debe ser "object" en escenario ${scenario}`);
    }
  });

  it('filter_type_key_observed = "filterType" en todo escenario', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.filter_type_key_observed, 'filterType');
  });

  it('empty_filters_rejected_observed = true en todo escenario (Q3F-5H)', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.empty_filters_rejected_observed, true);
  });

  it('minimum_required_filter_observed = true en todo escenario (Q3F-5H)', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.minimum_required_filter_observed, true);
  });

  it('next_filter_candidate = "locations" (candidato observado en Q3F-5F, valores sin confirmar)', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.next_filter_candidate, 'locations');
  });

  it('filter_values_unconfirmed = true (valores de locations no validados en live test)', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.filter_values_unconfirmed, true);
  });

  it('dry_run = true y credits_used = 0 y estimated_cost_usd = 0', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.dry_run, true);
    assert.equal(result.credits_used, 0);
    assert.equal(result.estimated_cost_usd, 0);
  });

  it('source_catalog_unchanged = true confirma que no se modificó source-catalog', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.source_catalog_unchanged, true);
  });

  it('writes_disabled = true confirma que no hay DB writes', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.writes_disabled, true);
  });
});

// ============================================================
// Q3F-5J — metadata de query param support
// ============================================================

describe('Q3F-5J — query param metadata', () => {
  it('locations_requires_query_observed = true en todo escenario', () => {
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
      assert.equal(result.locations_requires_query_observed, true,
        `locations_requires_query_observed debe ser true en escenario ${scenario}`);
    }
  });

  it('names_requires_query_observed = true en todo escenario', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.names_requires_query_observed, true);
  });

  it('filter_values_query_param_supported = true en todo escenario', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.filter_values_query_param_supported, true);
  });

  it('next_location_query_candidate = "Colombia"', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.next_location_query_candidate, 'Colombia');
  });

  it('location_value_id_unconfirmed = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.location_value_id_unconfirmed, true);
  });

  it('credits_used = 0 y estimated_cost_usd = 0 con metadata Q3F-5J', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.credits_used, 0);
    assert.equal(result.estimated_cost_usd, 0);
  });

  it('source_catalog_unchanged = true con metadata Q3F-5J', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.source_catalog_unchanged, true);
  });

  it('writes_disabled = true con metadata Q3F-5J', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.writes_disabled, true);
  });

  it('metadata previa Q3F-5H sigue presente — no hay regresión', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.empty_filters_rejected_observed, true);
    assert.equal(result.minimum_required_filter_observed, true);
    assert.equal(result.next_filter_candidate, 'locations');
    assert.equal(result.filter_values_unconfirmed, true);
    assert.equal(result.filters_shape_observed, 'object');
    assert.equal(result.filter_type_key_observed, 'filterType');
  });

  it('no hay fetch real con Q3F-5J metadata (fetch guard)', () => {
    assert.doesNotThrow(() => run({ scenario: 'useful_results' }));
    assert.doesNotThrow(() => run({ scenario: 'empty_result' }));
  });
});

// ============================================================
// Q3F-5O — Schema anidado oficial (OpenAPI confirmado Q3F-5N)
// ============================================================

describe('Q3F-5O — openapi schema metadata', () => {
  it('official_openapi_schema_confirmed = true en todo escenario', () => {
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
      assert.equal(result.official_openapi_schema_confirmed, true,
        `official_openapi_schema_confirmed debe ser true en escenario ${scenario}`);
    }
  });

  it('filters_nesting_observed = "filters.companies.include"', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.filters_nesting_observed, 'filters.companies.include');
  });

  it('pagination_page_base = "zero_based"', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.pagination_page_base, 'zero_based');
  });

  it('options_include_partial_profiles_default = false', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.options_include_partial_profiles_default, false);
  });

  it('locations_post_value_shape = "country_object"', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.locations_post_value_shape, 'country_object');
  });

  it('sizes_post_value_shape = "numeric_range_object"', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.sizes_post_value_shape, 'numeric_range_object');
  });

  it('dry_run = true en todo escenario Q3F-5O', () => {
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
      assert.equal(result.dry_run, true);
    }
  });

  it('source_catalog_unchanged = true con metadata Q3F-5O', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.source_catalog_unchanged, true);
  });

  it('writes_disabled = true con metadata Q3F-5O', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.writes_disabled, true);
  });

  it('credits_used = 0 y estimated_cost_usd = 0 con metadata Q3F-5O', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.credits_used, 0);
    assert.equal(result.estimated_cost_usd, 0);
  });

  it('metadata Q3F-5J previa sigue presente — no hay regresión', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.locations_requires_query_observed, true);
    assert.equal(result.names_requires_query_observed, true);
    assert.equal(result.filter_values_query_param_supported, true);
    assert.equal(result.next_location_query_candidate, 'Colombia');
    assert.equal(result.location_value_id_unconfirmed, true);
  });

  it('no hay fetch real con Q3F-5O metadata (fetch guard)', () => {
    assert.doesNotThrow(() => run({ scenario: 'useful_results' }));
    assert.doesNotThrow(() => run({ scenario: 'empty_result' }));
    assert.doesNotThrow(() => run({ scenario: 'provider_error' }));
  });
});

// ============================================================
// Q3F-5Q.1 — response real POST observado (metadata)
// ============================================================

describe('Q3F-5Q.1 — real POST observed metadata', () => {
  it('real_successful_post_observed = true en todo escenario', () => {
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
      assert.equal(result.real_successful_post_observed, true,
        `real_successful_post_observed debe ser true en escenario ${scenario}`);
    }
  });

  it('locations_colombia_post_success_observed = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.locations_colombia_post_success_observed, true);
  });

  it('response_top_level_keys_observed incluye requestId, pagination, results, billing', () => {
    const result = run({ scenario: 'useful_results' });
    const keys = result.response_top_level_keys_observed;
    assert.ok(keys.includes('requestId'), 'debe incluir requestId');
    assert.ok(keys.includes('pagination'), 'debe incluir pagination');
    assert.ok(keys.includes('results'), 'debe incluir results');
    assert.ok(keys.includes('billing'), 'debe incluir billing');
  });

  it('employee_count_shape_observed = "object_exact_min_max"', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.employee_count_shape_observed, 'object_exact_min_max');
  });

  it('billing_key_observed = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.billing_key_observed, true);
  });

  it('credits_charged_field_unconfirmed = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.credits_charged_field_unconfirmed, true);
  });

  it('dry_run = true en todo escenario Q3F-5Q.1', () => {
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
      assert.equal(result.dry_run, true);
    }
  });

  it('writes_disabled = true con metadata Q3F-5Q.1', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.writes_disabled, true);
  });

  it('source_catalog_unchanged = true con metadata Q3F-5Q.1', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.source_catalog_unchanged, true);
  });

  it('credits_used = 0 y estimated_cost_usd = 0 con metadata Q3F-5Q.1', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.credits_used, 0);
    assert.equal(result.estimated_cost_usd, 0);
  });

  it('metadata Q3F-5O previa sigue presente — no hay regresión', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.official_openapi_schema_confirmed, true);
    assert.equal(result.filters_nesting_observed, 'filters.companies.include');
    assert.equal(result.pagination_page_base, 'zero_based');
    assert.equal(result.options_include_partial_profiles_default, false);
    assert.equal(result.locations_post_value_shape, 'country_object');
    assert.equal(result.sizes_post_value_shape, 'numeric_range_object');
  });

  it('metadata Q3F-5J previa sigue presente — no hay regresión', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.locations_requires_query_observed, true);
    assert.equal(result.names_requires_query_observed, true);
    assert.equal(result.filter_values_query_param_supported, true);
    assert.equal(result.next_location_query_candidate, 'Colombia');
    assert.equal(result.location_value_id_unconfirmed, true);
  });

  it('no hay fetch real con metadata Q3F-5Q.1 (fetch guard)', () => {
    assert.doesNotThrow(() => run({ scenario: 'useful_results' }));
    assert.doesNotThrow(() => run({ scenario: 'empty_result' }));
    assert.doesNotThrow(() => run({ scenario: 'provider_error' }));
  });
});

// ============================================================
// Q3F-5S — microbenchmark real completado (3 runs reales)
// ============================================================

describe('Q3F-5S — real microbenchmark metadata', () => {
  it('real_microbenchmark_completed = true en todo escenario', () => {
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
      assert.equal(result.real_microbenchmark_completed, true,
        `real_microbenchmark_completed debe ser true en escenario ${scenario}`);
    }
  });

  it('real_microbenchmark_runs = 3', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.real_microbenchmark_runs, 3);
  });

  it('real_microbenchmark_results = 30', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.real_microbenchmark_results, 30);
  });

  it('credits_charged_observed_per_run = [1,1,1] — valor observado, no regla contractual', () => {
    const result = run({ scenario: 'useful_results' });
    const obs = result.credits_charged_observed_per_run;
    assert.equal(obs.length, 3);
    assert.equal(obs[0], 1);
    assert.equal(obs[1], 1);
    assert.equal(obs[2], 1);
  });

  it('billing_credits_charged_confirmed = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.billing_credits_charged_confirmed, true);
  });

  it('company_prospecting_cost_uses_actual_billing = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.company_prospecting_cost_uses_actual_billing, true);
  });

  it('size_filter_strictness_unconfirmed = true en todo escenario', () => {
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
      assert.equal(result.size_filter_strictness_unconfirmed, true,
        `size_filter_strictness_unconfirmed debe ser true en escenario ${scenario}`);
    }
  });

  it('employee_count_exact_requires_post_validation = true', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.employee_count_exact_requires_post_validation, true);
  });

  it('metadata Q3F-5Q.1 previa sigue presente — no hay regresión', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.real_successful_post_observed, true);
    assert.equal(result.locations_colombia_post_success_observed, true);
    assert.equal(result.employee_count_shape_observed, 'object_exact_min_max');
    assert.equal(result.billing_key_observed, true);
    assert.equal(result.credits_charged_field_unconfirmed, true);
  });

  it('dry_run = true y credits_used = 0 y estimated_cost_usd = 0 con metadata Q3F-5S', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.dry_run, true);
    assert.equal(result.credits_used, 0);
    assert.equal(result.estimated_cost_usd, 0);
  });

  it('source_catalog_unchanged = true con metadata Q3F-5S', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.source_catalog_unchanged, true);
  });

  it('writes_disabled = true con metadata Q3F-5S', () => {
    const result = run({ scenario: 'useful_results' });
    assert.equal(result.writes_disabled, true);
  });

  it('no hay fetch real con metadata Q3F-5S (fetch guard)', () => {
    assert.doesNotThrow(() => run({ scenario: 'useful_results' }));
    assert.doesNotThrow(() => run({ scenario: 'empty_result' }));
    assert.doesNotThrow(() => run({ scenario: 'provider_error' }));
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
