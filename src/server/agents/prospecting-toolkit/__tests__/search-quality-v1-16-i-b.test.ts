/**
 * Tests — Agent 1 v1.16I-B — ICP Size Gate UI Helpers
 *
 * Sin Tavily. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — candidate metadata decision=pass → label "ICP >200", tone success
 * F2  — decision=needs_validation → label "Tamaño pendiente", tone warning
 * F3  — decision=block → label "≤200 bloqueado", tone danger
 * F4  — no metadata → label "Sin dato tamaño", tone neutral
 * F5  — fallback desde rich_profile.size.icp_size_gate → decision detectada
 * F6  — estimated_range "10001+" → rangeLabel contiene "10001+"
 * F7  — normalized_min=201, normalized_max=500 → rangeLabel "201-500"
 * F8  — requires_human_review=true → requiresHumanReview true
 * F9  — batch summary pass=1 needs_validation=1 blocked=1 → valores correctos
 * F10 — blocked_reasons con más de 3 → topBlockedReasons.length=3, hiddenReasonCount>0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getIcpSizeGateUiState,
  getIcpSizeGateSummaryUiState,
} from '../../../../components/prospect-batches/icp-size-gate-ui';

// ─── F1 — decision=pass ────────────────────────────────────────────────────

describe('F1 — decision=pass → ICP >200, success', () => {
  const meta = {
    icp_size_gate: { decision: 'pass', reason: 'Más de 200 empleados confirmados' },
  };

  it('label = "ICP >200"', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.label, 'ICP >200');
  });

  it('tone = success', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.tone, 'success');
  });

  it('decision = pass', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.decision, 'pass');
  });
});

// ─── F2 — decision=needs_validation ───────────────────────────────────────

describe('F2 — decision=needs_validation → Tamaño pendiente, warning', () => {
  const meta = {
    icp_size_gate: { decision: 'needs_validation', requires_human_review: true },
  };

  it('label = "Tamaño pendiente"', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.label, 'Tamaño pendiente');
  });

  it('tone = warning', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.tone, 'warning');
  });
});

// ─── F3 — decision=block ───────────────────────────────────────────────────

describe('F3 — decision=block → ≤200 bloqueado, danger', () => {
  const meta = {
    icp_size_gate: { decision: 'block', reason: 'Empleados <= 200' },
  };

  it('label = "≤200 bloqueado"', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.label, '≤200 bloqueado');
  });

  it('tone = danger', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.tone, 'danger');
  });
});

// ─── F4 — sin metadata ────────────────────────────────────────────────────

describe('F4 — sin metadata → Sin dato tamaño, neutral', () => {
  it('label = "Sin dato tamaño" (null)', () => {
    const result = getIcpSizeGateUiState(null);
    assert.equal(result.label, 'Sin dato tamaño');
  });

  it('tone = neutral (null)', () => {
    const result = getIcpSizeGateUiState(null);
    assert.equal(result.tone, 'neutral');
  });

  it('label = "Sin dato tamaño" (empty obj)', () => {
    const result = getIcpSizeGateUiState({});
    assert.equal(result.label, 'Sin dato tamaño');
  });

  it('tone = neutral (empty obj)', () => {
    const result = getIcpSizeGateUiState({});
    assert.equal(result.tone, 'neutral');
  });
});

// ─── F5 — fallback rich_profile.size.icp_size_gate ────────────────────────

describe('F5 — fallback desde rich_profile.size.icp_size_gate', () => {
  const meta = {
    rich_profile: {
      size: {
        icp_size_gate: { decision: 'pass', reason: 'Rango grande detectado' },
      },
    },
  };

  it('decision detectada como pass', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.decision, 'pass');
  });

  it('label = "ICP >200"', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.label, 'ICP >200');
  });
});

// ─── F6 — estimated_range "10001+" ────────────────────────────────────────

describe('F6 — estimated_range "10001+" → rangeLabel contiene "10001+"', () => {
  const meta = {
    icp_size_gate: { decision: 'pass' },
    rich_profile: {
      size: {
        estimated_range: '10001+',
        icp_size_gate: { decision: 'pass' },
      },
    },
  };

  it('rangeLabel includes "10001+"', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.ok(result.rangeLabel?.includes('10001+'), `expected "10001+" in "${result.rangeLabel}"`);
  });
});

// ─── F7 — normalized_min=201, normalized_max=500 ──────────────────────────

describe('F7 — normalized_min=201, normalized_max=500 → rangeLabel "201-500"', () => {
  const meta = {
    icp_size_gate: {
      decision: 'pass',
      normalized_min_employees: 201,
      normalized_max_employees: 500,
    },
  };

  it('rangeLabel = "201-500"', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.rangeLabel, '201-500');
  });
});

// ─── F8 — requires_human_review=true ──────────────────────────────────────

describe('F8 — requires_human_review=true', () => {
  const meta = {
    icp_size_gate: {
      decision: 'needs_validation',
      requires_human_review: true,
    },
  };

  it('requiresHumanReview = true', () => {
    const result = getIcpSizeGateUiState(meta);
    assert.equal(result.requiresHumanReview, true);
  });
});

// ─── F9 — batch summary pass=1 needs_validation=1 blocked=1 ───────────────

describe('F9 — batch summary counts', () => {
  const batchMeta = {
    icp_size_gate_summary: {
      pass: 1,
      needs_validation: 1,
      blocked: 1,
      blocked_reasons: ['Empresa con ≤200 empleados'],
    },
  };

  it('pass = 1', () => {
    const result = getIcpSizeGateSummaryUiState(batchMeta);
    assert.equal(result.pass, 1);
  });

  it('needs_validation = 1', () => {
    const result = getIcpSizeGateSummaryUiState(batchMeta);
    assert.equal(result.needs_validation, 1);
  });

  it('blocked = 1', () => {
    const result = getIcpSizeGateSummaryUiState(batchMeta);
    assert.equal(result.blocked, 1);
  });

  it('hasSummary = true', () => {
    const result = getIcpSizeGateSummaryUiState(batchMeta);
    assert.equal(result.hasSummary, true);
  });
});

// ─── F10 — blocked_reasons truncado a máximo 3 ────────────────────────────

describe('F10 — blocked_reasons truncado a 3 razones', () => {
  const batchMeta = {
    icp_size_gate_summary: {
      pass: 0,
      needs_validation: 0,
      blocked: 5,
      blocked_reasons: [
        'Empresa A: ≤50 empleados',
        'Empresa B: ≤100 empleados',
        'Empresa C: ≤150 empleados',
        'Empresa D: ≤180 empleados',
        'Empresa E: ≤200 empleados',
      ],
    },
  };

  it('topBlockedReasons.length = 3', () => {
    const result = getIcpSizeGateSummaryUiState(batchMeta);
    assert.equal(result.topBlockedReasons.length, 3);
  });

  it('hiddenReasonCount = 2', () => {
    const result = getIcpSizeGateSummaryUiState(batchMeta);
    assert.equal(result.hiddenReasonCount, 2);
  });

  it('sin summary → hasSummary = false', () => {
    const result = getIcpSizeGateSummaryUiState({});
    assert.equal(result.hasSummary, false);
  });
});
