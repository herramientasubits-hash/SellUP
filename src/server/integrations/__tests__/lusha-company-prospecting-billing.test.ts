/**
 * Tests — Lusha Company Prospecting V3 Billing & Size Guardrail (Q3F-5S)
 *
 * Sin llamadas reales. Sin DB writes. Sin créditos.
 * Usa node:test + assert (patrón del proyecto).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLushaCompanyProspectingBilling,
  evaluateSizeMatch,
  evaluateSizeFilterBatch,
  buildLushaCompanyProspectingUsageLog,
  type LushaCompanyProspectingPricingConfig,
  type SizeRange,
} from '../lusha-company-prospecting-billing';

// Garantía: si cualquier fetch real se llama, el test falla inmediatamente
const originalFetch = global.fetch;
before(() => {
  global.fetch = () => {
    throw new Error(
      '[Q3F-5S Guard] fetch real detectado en billing guardrail. Este módulo NO debe hacer llamadas HTTP.'
    );
  };
});
after(() => {
  global.fetch = originalFetch;
});

const PRICING: LushaCompanyProspectingPricingConfig = {
  provider_key: 'lusha',
  operation_key: 'company_prospecting_v3',
  unit: 'per_credit',
  unit_cost_usd: 0.08823529,
};

// ============================================================
// normalizeLushaCompanyProspectingBilling — billing real
// ============================================================

describe('normalizeLushaCompanyProspectingBilling — creditsCharged real', () => {
  it('creditsCharged=1 → creditsUsed=1', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: 1,
      pricingConfig: PRICING,
    });
    assert.equal(result.creditsUsed, 1);
    assert.equal(result.billingConfirmed, true);
  });

  it('creditsCharged=3 → creditsUsed=3', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: 3,
      pricingConfig: PRICING,
    });
    assert.equal(result.creditsUsed, 3);
    assert.equal(result.billingConfirmed, true);
  });

  it('creditsCharged=0 → creditsUsed=0, billingConfirmed=true', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: 0,
      pricingConfig: PRICING,
    });
    assert.equal(result.creditsUsed, 0);
    assert.equal(result.billingConfirmed, true);
  });

  it('creditsCharged=null → creditsUsed=null, billingConfirmed=false', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: null,
      pricingConfig: PRICING,
    });
    assert.equal(result.creditsUsed, null);
    assert.equal(result.billingConfirmed, false);
  });

  it('creditsCharged=undefined → no inventa crédito, billingConfirmed=false', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: undefined,
      pricingConfig: PRICING,
    });
    assert.equal(result.creditsUsed, null);
    assert.equal(result.billingConfirmed, false);
  });
});

// ============================================================
// normalizeLushaCompanyProspectingBilling — costo
// ============================================================

describe('normalizeLushaCompanyProspectingBilling — costo', () => {
  it('creditsCharged=1 + pricing disponible → calcula costo correctamente', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: 1,
      pricingConfig: PRICING,
    });
    assert.ok(result.estimatedCostUsd !== null);
    assert.ok(Math.abs(result.estimatedCostUsd! - 0.08823529) < 0.0000001);
    assert.equal(result.pricingMissingWarning, null);
  });

  it('creditsCharged=3 + pricing → estimatedCostUsd = 3 × unit_cost_usd', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: 3,
      pricingConfig: PRICING,
    });
    assert.ok(result.estimatedCostUsd !== null);
    assert.ok(Math.abs(result.estimatedCostUsd! - 3 * 0.08823529) < 0.0000001);
  });

  it('creditsCharged=1 + pricing null → estimatedCostUsd=null + warning', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: 1,
      pricingConfig: null,
    });
    assert.equal(result.estimatedCostUsd, null);
    assert.ok(result.pricingMissingWarning !== null);
    assert.ok(result.pricingMissingWarning!.length > 0);
  });

  it('creditsCharged=null + pricing disponible → estimatedCostUsd=null', () => {
    const result = normalizeLushaCompanyProspectingBilling({
      creditsCharged: null,
      pricingConfig: PRICING,
    });
    assert.equal(result.estimatedCostUsd, null);
  });
});

// ============================================================
// evaluateSizeMatch — guardrail de tamaño
// ============================================================

describe('evaluateSizeMatch — guardrail de tamaño', () => {
  const range51_200: SizeRange[] = [{ min: 51, max: 200 }];
  const range201_500: SizeRange[] = [{ min: 201, max: 500 }];

  it('employeeCountExact dentro del rango → size_match_confirmed', () => {
    assert.equal(evaluateSizeMatch(120, range51_200), 'size_match_confirmed');
    assert.equal(evaluateSizeMatch(51, range51_200), 'size_match_confirmed');
    assert.equal(evaluateSizeMatch(200, range51_200), 'size_match_confirmed');
  });

  it('employeeCountExact fuera del rango → size_mismatch_confirmed', () => {
    // Caso real Q3F-5R: request 51-200 retornó empresa con 3134 empleados
    assert.equal(evaluateSizeMatch(3134, range51_200), 'size_mismatch_confirmed');
    // Caso real Q3F-5R: request 51-200 retornó empresa con 1107 empleados
    assert.equal(evaluateSizeMatch(1107, range51_200), 'size_mismatch_confirmed');
    // Caso real Q3F-5R: request 201-500 retornó empresa con 2620 empleados
    assert.equal(evaluateSizeMatch(2620, range201_500), 'size_mismatch_confirmed');
    // Caso real Q3F-5R: request 51-200 México retornó empresa con 5227 empleados
    assert.equal(evaluateSizeMatch(5227, range51_200), 'size_mismatch_confirmed');
  });

  it('múltiples rangos → match si cae en cualquiera', () => {
    const multiRange: SizeRange[] = [{ min: 51, max: 200 }, { min: 201, max: 500 }];
    assert.equal(evaluateSizeMatch(300, multiRange), 'size_match_confirmed');
    assert.equal(evaluateSizeMatch(120, multiRange), 'size_match_confirmed');
    // Fuera de todos los rangos
    assert.equal(evaluateSizeMatch(3000, multiRange), 'size_mismatch_confirmed');
  });

  it('employeeCountExact null → size_unverifiable', () => {
    assert.equal(evaluateSizeMatch(null, range51_200), 'size_unverifiable');
  });

  it('employeeCountExact undefined → size_unverifiable', () => {
    assert.equal(evaluateSizeMatch(undefined, range51_200), 'size_unverifiable');
  });

  it('rangos vacíos → size_unverifiable', () => {
    assert.equal(evaluateSizeMatch(100, []), 'size_unverifiable');
  });

  it('rango sin min → empleados con cualquier valor abajo del max hacen match', () => {
    const rangeNoMin: SizeRange[] = [{ max: 200 }];
    assert.equal(evaluateSizeMatch(50, rangeNoMin), 'size_match_confirmed');
    assert.equal(evaluateSizeMatch(201, rangeNoMin), 'size_mismatch_confirmed');
  });

  it('rango sin max → empleados con cualquier valor arriba del min hacen match', () => {
    const rangeNoMax: SizeRange[] = [{ min: 51 }];
    assert.equal(evaluateSizeMatch(10000, rangeNoMax), 'size_match_confirmed');
    assert.equal(evaluateSizeMatch(50, rangeNoMax), 'size_mismatch_confirmed');
  });
});

// ============================================================
// evaluateSizeFilterBatch — métricas agregadas
// ============================================================

describe('evaluateSizeFilterBatch — métricas agregadas Q3F-5R', () => {
  const range51_200: SizeRange[] = [{ min: 51, max: 200 }];

  it('batch con mix de match/mismatch/unverifiable calcula correctamente', () => {
    const companies = [
      { employeeCountExact: 120 },      // match
      { employeeCountExact: 3134 },     // mismatch (caso Q3F-5R real)
      { employeeCountExact: 1107 },     // mismatch (caso Q3F-5R real)
      { employeeCountExact: null },     // unverifiable
    ];
    const summary = evaluateSizeFilterBatch(companies, range51_200);
    assert.equal(summary.sizeMatchCount, 1);
    assert.equal(summary.sizeMismatchCount, 2);
    assert.equal(summary.sizeUnverifiableCount, 1);
    // mismatch rate = 2 / (1 + 2) = 0.666...
    assert.ok(summary.sizeFilterMismatchRate !== null);
    assert.ok(Math.abs(summary.sizeFilterMismatchRate! - 2/3) < 0.001);
  });

  it('todos en rango → mismatchRate = 0', () => {
    const companies = [
      { employeeCountExact: 100 },
      { employeeCountExact: 150 },
    ];
    const summary = evaluateSizeFilterBatch(companies, range51_200);
    assert.equal(summary.sizeFilterMismatchRate, 0);
    assert.equal(summary.sizeMismatchCount, 0);
  });

  it('todos fuera de rango → mismatchRate = 1', () => {
    const companies = [
      { employeeCountExact: 3000 },
      { employeeCountExact: 5000 },
    ];
    const summary = evaluateSizeFilterBatch(companies, range51_200);
    assert.equal(summary.sizeFilterMismatchRate, 1);
    assert.equal(summary.sizeMatchCount, 0);
  });

  it('todos unverifiable → sizeFilterMismatchRate = null', () => {
    const companies = [
      { employeeCountExact: null },
      { employeeCountExact: null },
    ];
    const summary = evaluateSizeFilterBatch(companies, range51_200);
    assert.equal(summary.sizeFilterMismatchRate, null);
    assert.equal(summary.sizeUnverifiableCount, 2);
  });

  it('results.length == companies.length', () => {
    const companies = [
      { employeeCountExact: 100 },
      { employeeCountExact: 5000 },
      { employeeCountExact: null },
    ];
    const summary = evaluateSizeFilterBatch(companies, range51_200);
    assert.equal(summary.results.length, 3);
  });
});

// ============================================================
// buildLushaCompanyProspectingUsageLog — shape y seguridad
// ============================================================

describe('buildLushaCompanyProspectingUsageLog — shape', () => {
  const billingOutput = normalizeLushaCompanyProspectingBilling({
    creditsCharged: 1,
    pricingConfig: PRICING,
  });

  it('resultsReturned refleja results.length', () => {
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput,
      resultsReturned: 10,
      country: 'Colombia',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 9,
      isBenchmark: true,
    });
    assert.equal(log.results_returned, 10);
  });

  it('provider_key y operation_key correctos', () => {
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput,
      resultsReturned: 10,
      country: 'Colombia',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 9,
      isBenchmark: true,
    });
    assert.equal(log.provider_key, 'lusha');
    assert.equal(log.operation_key, 'company_prospecting_v3');
  });

  it('metadata no contiene billing bruto ni API key', () => {
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput,
      resultsReturned: 10,
      country: 'Colombia',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 9,
      isBenchmark: true,
    });
    const metaStr = JSON.stringify(log.metadata);
    // No debe contener campos sensibles
    assert.ok(!metaStr.includes('api_key'));
    assert.ok(!metaStr.includes('apiKey'));
    assert.ok(!metaStr.includes('creditsCharged'));
    assert.ok(!metaStr.includes('billingRaw'));
  });

  it('size_filter_requires_post_validation siempre true en metadata', () => {
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput,
      resultsReturned: 10,
      country: 'Colombia',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 9,
      isBenchmark: true,
    });
    assert.equal(log.metadata.size_filter_requires_post_validation, true);
  });

  it('benchmark=false cuando isBenchmark=false', () => {
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput,
      resultsReturned: 5,
      country: 'México',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 5,
      isBenchmark: false,
    });
    assert.equal(log.metadata.benchmark, false);
  });

  it('status=success cuando billingConfirmed=true', () => {
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput,
      resultsReturned: 10,
      country: 'Colombia',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 10,
      isBenchmark: true,
    });
    assert.equal(log.status, 'success');
  });

  it('status=failed cuando billingConfirmed=false', () => {
    const noBillingOutput = normalizeLushaCompanyProspectingBilling({
      creditsCharged: null,
      pricingConfig: PRICING,
    });
    const log = buildLushaCompanyProspectingUsageLog({
      billingOutput: noBillingOutput,
      resultsReturned: 0,
      country: 'Colombia',
      requestedPageSize: 10,
      requestedSizeRanges: [{ min: 51, max: 200 }],
      responseEmployeeCountExactPresentCount: 0,
      isBenchmark: true,
    });
    assert.equal(log.status, 'failed');
  });

  it('no hay llamadas externas al construir el log (fetch guard)', () => {
    assert.doesNotThrow(() =>
      buildLushaCompanyProspectingUsageLog({
        billingOutput,
        resultsReturned: 10,
        country: 'Colombia',
        requestedPageSize: 10,
        requestedSizeRanges: [{ min: 51, max: 200 }],
        responseEmployeeCountExactPresentCount: 9,
        isBenchmark: true,
      })
    );
  });
});

// ============================================================
// Garantías de aislamiento general
// ============================================================

describe('isolation guarantees', () => {
  it('no hay fetch real en todo el módulo (fetch guard)', () => {
    // Billing
    assert.doesNotThrow(() =>
      normalizeLushaCompanyProspectingBilling({ creditsCharged: 1, pricingConfig: PRICING })
    );
    // Size match
    assert.doesNotThrow(() =>
      evaluateSizeMatch(100, [{ min: 51, max: 200 }])
    );
    // Size batch
    assert.doesNotThrow(() =>
      evaluateSizeFilterBatch([{ employeeCountExact: 100 }], [{ min: 51, max: 200 }])
    );
  });
});
