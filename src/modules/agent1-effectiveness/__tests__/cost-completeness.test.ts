// Q3F-5AX.2 — cost-completeness pure tests (non-live).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCostCompleteness,
  isMissingCostRow,
  isSuspiciousZeroCostRow,
  hasLlmCostEvidence,
  type UsageCostSignal,
} from '../cost-completeness';

describe('cost-completeness row predicates', () => {
  it('isMissingCostRow true only when estimatedCostUsd is null', () => {
    assert.equal(isMissingCostRow({ providerKey: 'apollo', estimatedCostUsd: null, creditsUsed: 1 }), true);
    assert.equal(isMissingCostRow({ providerKey: 'apollo', estimatedCostUsd: 0, creditsUsed: 1 }), false);
    assert.equal(isMissingCostRow({ providerKey: 'apollo', estimatedCostUsd: 0.5, creditsUsed: 1 }), false);
  });

  it('isSuspiciousZeroCostRow true only when cost 0 and credits > 0', () => {
    assert.equal(isSuspiciousZeroCostRow({ providerKey: 'tavily', estimatedCostUsd: 0, creditsUsed: 5 }), true);
    assert.equal(isSuspiciousZeroCostRow({ providerKey: 'tavily', estimatedCostUsd: 0, creditsUsed: 0 }), false);
    assert.equal(isSuspiciousZeroCostRow({ providerKey: 'tavily', estimatedCostUsd: null, creditsUsed: 5 }), false);
  });

  it('hasLlmCostEvidence detects known LLM providers case-insensitively', () => {
    assert.equal(hasLlmCostEvidence([{ providerKey: 'Anthropic', estimatedCostUsd: 1, creditsUsed: 0 }]), true);
    assert.equal(hasLlmCostEvidence([{ providerKey: 'tavily', estimatedCostUsd: 1, creditsUsed: 0 }]), false);
    assert.equal(hasLlmCostEvidence([]), false);
  });
});

describe('computeCostCompleteness — flag priority', () => {
  it('no batches → unknown', () => {
    const out = computeCostCompleteness({ usageRows: [], batchesCount: 0, generatedCountsMissing: false });
    assert.equal(out.flag, 'unknown');
    assert.ok(out.warnings.length >= 1);
  });

  it('batches but no usage logs → unknown (cost not attributable)', () => {
    const out = computeCostCompleteness({ usageRows: [], batchesCount: 3, generatedCountsMissing: false });
    assert.equal(out.flag, 'unknown');
    assert.ok(out.warnings.some((w) => w.includes('uso de proveedores')));
  });

  it('valid costs + LLM present + outcomes present → complete', () => {
    const rows: UsageCostSignal[] = [
      { providerKey: 'anthropic', estimatedCostUsd: 0.02, creditsUsed: 0 },
      { providerKey: 'apollo', estimatedCostUsd: 0.01, creditsUsed: 1 },
    ];
    const out = computeCostCompleteness({ usageRows: rows, batchesCount: 1, generatedCountsMissing: false });
    assert.equal(out.flag, 'complete');
    assert.equal(out.missingCostRows, 0);
  });

  it('a null cost row → partial_missing_provider_pricing (most severe)', () => {
    const rows: UsageCostSignal[] = [
      { providerKey: 'anthropic', estimatedCostUsd: 0.02, creditsUsed: 0 },
      { providerKey: 'apollo', estimatedCostUsd: null, creditsUsed: 1 },
    ];
    const out = computeCostCompleteness({ usageRows: rows, batchesCount: 1, generatedCountsMissing: true });
    assert.equal(out.flag, 'partial_missing_provider_pricing');
    assert.equal(out.missingCostRows, 1);
  });

  it('credits > 0 with cost 0 → complete flag but suspicious warning surfaced', () => {
    const rows: UsageCostSignal[] = [
      { providerKey: 'anthropic', estimatedCostUsd: 0.02, creditsUsed: 0 },
      { providerKey: 'tavily', estimatedCostUsd: 0, creditsUsed: 5 },
    ];
    const out = computeCostCompleteness({ usageRows: rows, batchesCount: 1, generatedCountsMissing: false });
    assert.equal(out.flag, 'complete');
    assert.equal(out.suspiciousZeroCostRows, 1);
    assert.ok(out.warnings.some((w) => w.includes('pricing de proveedor posiblemente ausente')));
  });

  it('valid costs but no LLM provider → partial_missing_llm_cost', () => {
    const rows: UsageCostSignal[] = [
      { providerKey: 'tavily', estimatedCostUsd: 0.008, creditsUsed: 1 },
      { providerKey: 'apollo', estimatedCostUsd: 0.01, creditsUsed: 1 },
    ];
    const out = computeCostCompleteness({ usageRows: rows, batchesCount: 1, generatedCountsMissing: false });
    assert.equal(out.flag, 'partial_missing_llm_cost');
  });

  it('LLM + valid costs but outcomes missing → partial_missing_candidate_outcomes', () => {
    const rows: UsageCostSignal[] = [{ providerKey: 'anthropic', estimatedCostUsd: 0.02, creditsUsed: 0 }];
    const out = computeCostCompleteness({ usageRows: rows, batchesCount: 2, generatedCountsMissing: true });
    assert.equal(out.flag, 'partial_missing_candidate_outcomes');
  });
});
