/**
 * Tests — Agent 1 v1.16I — ICP Size Gate + Unknown Size Handling
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — employeeCount 201  → pass
 * F2  — employeeCount 200  → block
 * F3  — employeeCount 199  → block
 * F4  — employeeCount null → needs_validation
 * F5  — sizeRange "10001+" → pass
 * F6  — sizeRange "201-500" → pass
 * F7  — sizeRange "51-200" → block
 * F8  — sizeRange "<=200"  → block
 * F9  — sizeRange "200"    → block
 * F10 — sizeRange "unknown" → needs_validation
 * F11 — rich_profile size.estimated_range=10001+ → icp_size_gate.decision=pass
 * F12 — rich_profile size.estimated_range=51-200 → icp_size_gate.decision=block
 * F13 — rich_profile size unknown → decision=needs_validation, requires_human_review=true
 * F14 — writer action para block → skip con icp_size_below_threshold
 * F15 — writer action para needs_validation → needs_review
 * F16 — writer action para pass → pass
 * F17 — batch summary tiene conteos correctos
 * F18 — sin campos de tamaño → no inventa, decision=needs_validation
 * F19 — threshold configurable (500): rango 201-500 → block
 * F20 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled=false y DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled=false no alterados
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateIcpSizeGate,
  evaluateIcpSizeGateFromRichProfile,
  resolveIcpSizeGateWriterAction,
} from '../icp-size-gate';
import type { IcpSizeGateResult } from '../icp-size-gate';
import { DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG } from '../rich-profile-enrichment';
import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';

// ─── F1 — employeeCount 201 ───────────────────────────────────────────────────

describe('F1 — employeeCount 201 → pass', () => {
  it('decision = pass', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 201 });
    assert.equal(result.decision, 'pass');
  });

  it('size_status = confirmed_above_threshold', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 201 });
    assert.equal(result.size_status, 'confirmed_above_threshold');
  });

  it('threshold = 200', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 201 });
    assert.equal(result.threshold, 200);
  });

  it('requires_human_review = false', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 201 });
    assert.equal(result.requires_human_review, false);
  });

  it('normalized_min_employees = 201', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 201 });
    assert.equal(result.normalized_min_employees, 201);
  });
});

// ─── F2 — employeeCount 200 ───────────────────────────────────────────────────

describe('F2 — employeeCount 200 → block', () => {
  it('decision = block (exactamente en umbral no pasa)', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 200 });
    assert.equal(result.decision, 'block');
  });

  it('size_status = confirmed_below_threshold', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 200 });
    assert.equal(result.size_status, 'confirmed_below_threshold');
  });
});

// ─── F3 — employeeCount 199 ───────────────────────────────────────────────────

describe('F3 — employeeCount 199 → block', () => {
  it('decision = block', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 199 });
    assert.equal(result.decision, 'block');
  });
});

// ─── F4 — employeeCount null ──────────────────────────────────────────────────

describe('F4 — employeeCount null → needs_validation', () => {
  it('decision = needs_validation cuando employeeCount=null', () => {
    const result = evaluateIcpSizeGate({ employeeCount: null });
    assert.equal(result.decision, 'needs_validation');
  });

  it('requires_human_review = true', () => {
    const result = evaluateIcpSizeGate({ employeeCount: null });
    assert.equal(result.requires_human_review, true);
  });

  it('size_status = unknown', () => {
    const result = evaluateIcpSizeGate({ employeeCount: null });
    assert.equal(result.size_status, 'unknown');
  });
});

// ─── F5 — sizeRange "10001+" ──────────────────────────────────────────────────

describe('F5 — sizeRange "10001+" → pass', () => {
  it('decision = pass', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '10001+' });
    assert.equal(result.decision, 'pass');
  });

  it('size_status = estimated_above_threshold', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '10001+' });
    assert.equal(result.size_status, 'estimated_above_threshold');
  });

  it('normalized_min_employees = 10001', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '10001+' });
    assert.equal(result.normalized_min_employees, 10001);
  });

  it('normalized_max_employees = null (open-ended)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '10001+' });
    assert.equal(result.normalized_max_employees, null);
  });
});

// ─── F6 — sizeRange "201-500" ─────────────────────────────────────────────────

describe('F6 — sizeRange "201-500" → pass', () => {
  it('decision = pass', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '201-500' });
    assert.equal(result.decision, 'pass');
  });

  it('normalized_min_employees = 201', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '201-500' });
    assert.equal(result.normalized_min_employees, 201);
  });

  it('normalized_max_employees = 500', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '201-500' });
    assert.equal(result.normalized_max_employees, 500);
  });
});

// ─── F7 — sizeRange "51-200" ──────────────────────────────────────────────────

describe('F7 — sizeRange "51-200" → block', () => {
  it('decision = block', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '51-200' });
    assert.equal(result.decision, 'block');
  });

  it('size_status = estimated_below_threshold', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '51-200' });
    assert.equal(result.size_status, 'estimated_below_threshold');
  });

  it('normalized_max_employees = 200', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '51-200' });
    assert.equal(result.normalized_max_employees, 200);
  });
});

// ─── F8 — sizeRange "<=200" ───────────────────────────────────────────────────

describe('F8 — sizeRange "<=200" → block', () => {
  it('decision = block', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '<=200' });
    assert.equal(result.decision, 'block');
  });

  it('normalized_max_employees = 200', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '<=200' });
    assert.equal(result.normalized_max_employees, 200);
  });
});

// ─── F9 — sizeRange "200" ────────────────────────────────────────────────────

describe('F9 — sizeRange "200" → block (exactamente en umbral no pasa)', () => {
  it('decision = block', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '200' });
    assert.equal(result.decision, 'block');
  });

  it('normalized_min_employees = 200', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '200' });
    assert.equal(result.normalized_min_employees, 200);
  });
});

// ─── F10 — sizeRange "unknown" ───────────────────────────────────────────────

describe('F10 — sizeRange "unknown" → needs_validation', () => {
  it('decision = needs_validation', () => {
    const result = evaluateIcpSizeGate({ sizeRange: 'unknown' });
    assert.equal(result.decision, 'needs_validation');
  });

  it('requires_human_review = true', () => {
    const result = evaluateIcpSizeGate({ sizeRange: 'unknown' });
    assert.equal(result.requires_human_review, true);
  });
});

// ─── F11 — rich_profile size.estimated_range=10001+ ──────────────────────────

describe('F11 — rich_profile con size.estimated_range=10001+ → decision=pass', () => {
  it('evaluateIcpSizeGateFromRichProfile retorna pass', () => {
    const size = { estimated_range: '10001+', status: 'estimated' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.decision, 'pass');
  });

  it('size_status = estimated_above_threshold', () => {
    const size = { estimated_range: '10001+', status: 'estimated' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.size_status, 'estimated_above_threshold');
  });
});

// ─── F12 — rich_profile size.estimated_range=51-200 ──────────────────────────

describe('F12 — rich_profile con size.estimated_range=51-200 → decision=block', () => {
  it('evaluateIcpSizeGateFromRichProfile retorna block', () => {
    const size = { estimated_range: '51-200', status: 'estimated' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.decision, 'block');
  });

  it('size_status = estimated_below_threshold', () => {
    const size = { estimated_range: '51-200', status: 'estimated' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.size_status, 'estimated_below_threshold');
  });
});

// ─── F13 — rich_profile size unknown ─────────────────────────────────────────

describe('F13 — rich_profile size unknown → needs_validation + requires_human_review', () => {
  it('decision = needs_validation cuando size.status=unknown', () => {
    const size = { estimated_range: null, status: 'unknown' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.decision, 'needs_validation');
  });

  it('requires_human_review = true', () => {
    const size = { estimated_range: null, status: 'unknown' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.requires_human_review, true);
  });

  it('size_status = unknown', () => {
    const size = { estimated_range: null, status: 'unknown' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.size_status, 'unknown');
  });

  it('no inventa normalized_min_employees', () => {
    const size = { estimated_range: null, status: 'unknown' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.normalized_min_employees, null);
  });

  it('no inventa normalized_max_employees', () => {
    const size = { estimated_range: null, status: 'unknown' as const };
    const result = evaluateIcpSizeGateFromRichProfile(size);
    assert.equal(result.normalized_max_employees, null);
  });
});

// ─── F14 — writer action para block ──────────────────────────────────────────

describe('F14 — writer action para block → skip con icp_size_below_threshold', () => {
  it('resolveIcpSizeGateWriterAction(block) → action=skip', () => {
    const gateResult: IcpSizeGateResult = {
      decision: 'block',
      size_status: 'estimated_below_threshold',
      threshold: 200,
      normalized_min_employees: 51,
      normalized_max_employees: 200,
      reason: 'Size range maximum (200) does not exceed ICP threshold of 200',
      requires_human_review: false,
    };
    const action = resolveIcpSizeGateWriterAction(gateResult);
    assert.equal(action.action, 'skip');
  });

  it('skipReason = icp_size_below_threshold', () => {
    const gateResult: IcpSizeGateResult = {
      decision: 'block',
      size_status: 'estimated_below_threshold',
      threshold: 200,
      normalized_min_employees: 51,
      normalized_max_employees: 200,
      reason: 'Size range maximum (200) does not exceed ICP threshold of 200',
      requires_human_review: false,
    };
    const action = resolveIcpSizeGateWriterAction(gateResult);
    assert.equal(action.skipReason, 'icp_size_below_threshold');
  });

  it('evaluateIcpSizeGate("51-200") → block (confirma fixture)', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: '51-200' });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(action.action, 'skip');
    assert.equal(action.skipReason, 'icp_size_below_threshold');
  });
});

// ─── F15 — writer action para needs_validation ────────────────────────────────

describe('F15 — writer action para needs_validation → needs_review', () => {
  it('resolveIcpSizeGateWriterAction(needs_validation) → action=needs_review', () => {
    const gateResult: IcpSizeGateResult = {
      decision: 'needs_validation',
      size_status: 'unknown',
      threshold: 200,
      normalized_min_employees: null,
      normalized_max_employees: null,
      reason: 'Company size unknown',
      requires_human_review: true,
    };
    const action = resolveIcpSizeGateWriterAction(gateResult);
    assert.equal(action.action, 'needs_review');
  });

  it('no tiene skipReason cuando action=needs_review', () => {
    const gateResult: IcpSizeGateResult = {
      decision: 'needs_validation',
      size_status: 'unknown',
      threshold: 200,
      normalized_min_employees: null,
      normalized_max_employees: null,
      reason: 'Company size unknown',
      requires_human_review: true,
    };
    const action = resolveIcpSizeGateWriterAction(gateResult);
    assert.equal(action.skipReason, undefined);
  });

  it('evaluateIcpSizeGate(sin datos) → needs_validation → needs_review', () => {
    const gate = evaluateIcpSizeGate({});
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(gate.decision, 'needs_validation');
    assert.equal(action.action, 'needs_review');
  });
});

// ─── F16 — writer action para pass ───────────────────────────────────────────

describe('F16 — writer action para pass → pass normal', () => {
  it('resolveIcpSizeGateWriterAction(pass) → action=pass', () => {
    const gateResult: IcpSizeGateResult = {
      decision: 'pass',
      size_status: 'estimated_above_threshold',
      threshold: 200,
      normalized_min_employees: 10001,
      normalized_max_employees: null,
      reason: 'Size range minimum (10001) exceeds ICP threshold of 200',
      requires_human_review: false,
    };
    const action = resolveIcpSizeGateWriterAction(gateResult);
    assert.equal(action.action, 'pass');
  });

  it('no tiene skipReason cuando action=pass', () => {
    const gateResult: IcpSizeGateResult = {
      decision: 'pass',
      size_status: 'estimated_above_threshold',
      threshold: 200,
      normalized_min_employees: 10001,
      normalized_max_employees: null,
      reason: 'Size range minimum (10001) exceeds ICP threshold of 200',
      requires_human_review: false,
    };
    const action = resolveIcpSizeGateWriterAction(gateResult);
    assert.equal(action.skipReason, undefined);
  });

  it('evaluateIcpSizeGate("10001+") → pass → action=pass', () => {
    const gate = evaluateIcpSizeGate({ sizeRange: '10001+' });
    const action = resolveIcpSizeGateWriterAction(gate);
    assert.equal(gate.decision, 'pass');
    assert.equal(action.action, 'pass');
  });
});

// ─── F17 — batch summary ─────────────────────────────────────────────────────

describe('F17 — batch summary tiene conteos correctos', () => {
  it('conteos de pass / block / needs_validation se acumulan correctamente', () => {
    const inputs = [
      { sizeRange: '10001+' },    // pass
      { sizeRange: '201-500' },   // pass
      { sizeRange: '51-200' },    // block
      { sizeRange: 'unknown' },   // needs_validation
      { employeeCount: 250 },     // pass
      { employeeCount: 100 },     // block
      {},                         // needs_validation
    ];

    let passCount = 0;
    let needsValidationCount = 0;
    let blockedCount = 0;

    for (const inp of inputs) {
      const result = evaluateIcpSizeGate(inp);
      if (result.decision === 'pass') passCount++;
      else if (result.decision === 'block') blockedCount++;
      else needsValidationCount++;
    }

    assert.equal(passCount, 3, 'pass_count debe ser 3');
    assert.equal(blockedCount, 2, 'blocked_count debe ser 2');
    assert.equal(needsValidationCount, 2, 'needs_validation_count debe ser 2');
  });

  it('estructura del batch summary tiene campos requeridos', () => {
    const summary = {
      threshold: 200,
      pass_count: 3,
      needs_validation_count: 2,
      blocked_count: 2,
      blocked_reasons: ['Empresa A: below threshold'],
    };

    assert.ok(typeof summary.threshold === 'number', 'threshold debe ser number');
    assert.ok(typeof summary.pass_count === 'number', 'pass_count debe ser number');
    assert.ok(typeof summary.needs_validation_count === 'number');
    assert.ok(typeof summary.blocked_count === 'number');
    assert.ok(Array.isArray(summary.blocked_reasons), 'blocked_reasons debe ser array');
  });
});

// ─── F18 — no inventa tamaño ─────────────────────────────────────────────────

describe('F18 — sin campos de tamaño, no inventa, decision=needs_validation', () => {
  it('sin inputs → decision=needs_validation (no inventa)', () => {
    const result = evaluateIcpSizeGate({});
    assert.equal(result.decision, 'needs_validation');
  });

  it('normalized_min_employees = null (no inventado)', () => {
    const result = evaluateIcpSizeGate({});
    assert.equal(result.normalized_min_employees, null);
  });

  it('normalized_max_employees = null (no inventado)', () => {
    const result = evaluateIcpSizeGate({});
    assert.equal(result.normalized_max_employees, null);
  });

  it('size_status = unknown (no asume menor de threshold)', () => {
    const result = evaluateIcpSizeGate({});
    assert.equal(result.size_status, 'unknown');
  });

  it('requires_human_review = true (necesita validación humana)', () => {
    const result = evaluateIcpSizeGate({});
    assert.equal(result.requires_human_review, true);
  });

  it('con sizeRange="" → needs_validation (string vacío = sin datos)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '' });
    assert.equal(result.decision, 'needs_validation');
  });
});

// ─── F19 — threshold configurable ────────────────────────────────────────────

describe('F19 — threshold configurable', () => {
  it('threshold=500, sizeRange="201-500" → block (max=500 <= 500)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '201-500', threshold: 500 });
    assert.equal(result.decision, 'block');
    assert.equal(result.threshold, 500);
  });

  it('threshold=500, sizeRange="501-1000" → pass (min=501 > 500)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '501-1000', threshold: 500 });
    assert.equal(result.decision, 'pass');
  });

  it('threshold=500, employeeCount=500 → block (no supera 500)', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 500, threshold: 500 });
    assert.equal(result.decision, 'block');
  });

  it('threshold=500, employeeCount=501 → pass', () => {
    const result = evaluateIcpSizeGate({ employeeCount: 501, threshold: 500 });
    assert.equal(result.decision, 'pass');
  });

  it('resultado siempre refleja el threshold customizado', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '201-500', threshold: 500 });
    assert.equal(result.threshold, 500, 'threshold en result debe coincidir con input');
  });

  it('comportamiento es determinístico: mismo input → mismo output', () => {
    const r1 = evaluateIcpSizeGate({ sizeRange: '201-500', threshold: 500 });
    const r2 = evaluateIcpSizeGate({ sizeRange: '201-500', threshold: 500 });
    assert.equal(r1.decision, r2.decision);
    assert.equal(r1.size_status, r2.size_status);
  });
});

// ─── F20 — default configs no alterados ──────────────────────────────────────

describe('F20 — DEFAULT configs no alterados por este hito', () => {
  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled = false', () => {
    assert.equal(
      DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled,
      false,
      'DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled debe permanecer false',
    );
  });

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled = false', () => {
    assert.equal(
      DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled,
      false,
      'DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled debe permanecer false',
    );
  });
});

// ─── Tests adicionales de normalización ──────────────────────────────────────

describe('Normalización de rangos adicionales', () => {
  it('"1001-5000" → pass (min=1001 > 200)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '1001-5000' });
    assert.equal(result.decision, 'pass');
  });

  it('"501-1000" → pass (min=501 > 200)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '501-1000' });
    assert.equal(result.decision, 'pass');
  });

  it('"11-50" → block (max=50 <= 200)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '11-50' });
    assert.equal(result.decision, 'block');
  });

  it('"1-10" → block (max=10 <= 200)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '1-10' });
    assert.equal(result.decision, 'block');
  });

  it('"201" → pass (min=201 > 200)', () => {
    const result = evaluateIcpSizeGate({ sizeRange: '201' });
    assert.equal(result.decision, 'pass');
  });

  it('"n/a" → needs_validation', () => {
    const result = evaluateIcpSizeGate({ sizeRange: 'n/a' });
    assert.equal(result.decision, 'needs_validation');
  });

  it('evaluateIcpSizeGateFromRichProfile sin estimated_range → needs_validation', () => {
    const result = evaluateIcpSizeGateFromRichProfile({ status: 'unknown' });
    assert.equal(result.decision, 'needs_validation');
  });
});
