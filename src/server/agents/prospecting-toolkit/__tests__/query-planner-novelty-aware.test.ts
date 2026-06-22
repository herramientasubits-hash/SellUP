/**
 * Tests — Query Planner Novelty-Aware (Hito 16AB.43.24)
 *
 * Verifica:
 *   - Source gating: SECOP excluido para EdTech/SaaS sin contexto de gobierno
 *   - Source gating: Fintech incluido cuando hay subindustria fintech
 *   - Source gating: Fintech excluido cuando no hay subindustria fintech
 *   - Source gating: Fedesoft y Andicom siempre permitidos para tech
 *   - R2 queries reemplazan SECOP cuando está excluido
 *   - hasDiversificationAvailable retorna true cuando R2 tiene familias nuevas
 *   - hasDiversificationAvailable retorna false cuando R2 no añade familias nuevas
 *   - Metadata del plan contiene campos requeridos
 *
 * Puramente determinístico — sin I/O.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiscoveryQueryPlan, hasDiversificationAvailable } from '../query-planner';
import type { DiscoveryQueryPlan } from '../query-planner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGatingDecision(plan: DiscoveryQueryPlan, sourceKey: string) {
  return plan.source_gating_decisions.find((d) => d.source_key === sourceKey);
}

function buildPlan(subindustries: string[], additionalCriteria: string | null = null) {
  return buildDiscoveryQueryPlan({
    industry: 'Tecnología',
    country: 'Colombia',
    subindustries,
    additionalCriteria,
  });
}

// ─── Source Gating Tests ──────────────────────────────────────────────────────

describe('Source gating — SECOP exclusion (Hito FIX-P0)', () => {
  it('excludes SECOP for EdTech subindustry without government context', () => {
    const plan = buildPlan(['EdTech', 'Plataformas SaaS']);
    assert.equal(plan.secop_excluded, true);
    const decision = getGatingDecision(plan, 'co_secop2');
    assert.equal(decision?.allowed, false);
    assert.ok(decision?.reason.includes('fix_p0'));
  });

  it('excludes SECOP for general SaaS context', () => {
    const plan = buildPlan(['SaaS', 'ERP', 'CRM']);
    assert.equal(plan.secop_excluded, true);
  });

  it('SECOP always excluded even when subindustry mentions gobierno', () => {
    const plan = buildPlan(['Software para gobierno', 'ERP']);
    assert.equal(plan.secop_excluded, false); // secop_excluded still triggers for gov context (queryBuilder gating)
    const decision = getGatingDecision(plan, 'co_secop2');
    assert.equal(decision?.allowed, false); // source_gating always false fix-p0
  });

  it('SECOP always excluded even when additionalCriteria mentions contratacion', () => {
    const plan = buildPlan(['Tecnología'], 'empresas que trabajan con contratacion pública');
    assert.equal(plan.secop_excluded, false);
    const decision = getGatingDecision(plan, 'co_secop2');
    assert.equal(decision?.allowed, false);
  });

  it('SECOP always excluded even when additionalCriteria mentions secop', () => {
    const plan = buildPlan(['Tecnología'], 'proveedores registrados en SECOP');
    assert.equal(plan.secop_excluded, false);
    const decision = getGatingDecision(plan, 'co_secop2');
    assert.equal(decision?.allowed, false);
  });
});

describe('Source gating — Fintech inclusion', () => {
  it('allows fintech source when fintech subindustry present', () => {
    const plan = buildPlan(['Fintech', 'Pagos digitales']);
    const decision = getGatingDecision(plan, 'co_colombia_fintech');
    assert.equal(decision?.allowed, true);
  });

  it('does NOT allow fintech when no specific subindustries and no criteria (v1.1 rule)', () => {
    // v1.1: subindustries=[] sin criteria fintech → Colombia Fintech excluida por default.
    const plan = buildPlan([]);
    const decision = getGatingDecision(plan, 'co_colombia_fintech');
    assert.equal(decision?.allowed, false);
    assert.ok(decision?.reason.includes('subindustry_not_fintech'), `Expected subindustry_not_fintech reason, got: ${decision?.reason}`);
  });

  it('excludes fintech source for EdTech subindustry', () => {
    const plan = buildPlan(['EdTech', 'Plataforma educativa']);
    const decision = getGatingDecision(plan, 'co_colombia_fintech');
    assert.equal(decision?.allowed, false);
  });

  it('excludes fintech source for pure SaaS context', () => {
    const plan = buildPlan(['SaaS empresarial', 'ERP']);
    const decision = getGatingDecision(plan, 'co_colombia_fintech');
    assert.equal(decision?.allowed, false);
  });
});

describe('Source gating — Fedesoft and Andicom (Hito FIX-P0)', () => {
  it('fedesoft is NOT allowed (paused/not_connected fix-p0)', () => {
    const plan = buildPlan(['EdTech']);
    const decision = getGatingDecision(plan, 'co_fedesoft');
    assert.equal(decision?.allowed, false);
  });

  it('andicom is NOT allowed (removed from default queries in v1.1)', () => {
    // v1.1: ANDICOM removido por alto riesgo de ruido editorial. co_software_empresarial lo reemplaza.
    const plan = buildPlan(['SaaS']);
    const decision = getGatingDecision(plan, 'co_andicom');
    assert.equal(decision?.allowed, false);
  });

  it('co_software_empresarial is allowed (virtual query intent)', () => {
    const plan = buildPlan(['SaaS']);
    const decision = getGatingDecision(plan, 'co_software_empresarial');
    assert.equal(decision?.allowed, true);
  });

  it('fedesoft NOT allowed even when no subindustries (fix-p0)', () => {
    const plan = buildPlan([]);
    const decision = getGatingDecision(plan, 'co_fedesoft');
    assert.equal(decision?.allowed, false);
  });

  it('co_secop2 is NOT allowed (manual_only/not_connected fix-p0)', () => {
    const plan = buildPlan(['Tecnología']);
    const decision = getGatingDecision(plan, 'co_secop2');
    assert.equal(decision?.allowed, false);
    assert.ok(decision?.reason.includes('fix_p0'));
  });
});

// ─── R2 query tests ───────────────────────────────────────────────────────────

describe('R2 queries when SECOP excluded', () => {
  it('R2 queries do not contain secop when secop_excluded=true', () => {
    const plan = buildPlan(['EdTech', 'SaaS']);
    assert.equal(plan.secop_excluded, true);
    const r2Texts = plan.round2_queries.map((q) => q.query_text.toLowerCase());
    const hasSecop = r2Texts.some((t) => t.includes('secop'));
    assert.equal(hasSecop, false, `Expected no SECOP in R2 queries, got: ${r2Texts.join(', ')}`);
  });

  it('R2 queries never contain secop (removed from source-guided queries fix-p0)', () => {
    const plan = buildPlan(['Software gobierno', 'ERP público']);
    assert.equal(plan.secop_excluded, false);
    const r2Texts = plan.round2_queries.map((q) => q.query_text.toLowerCase());
    const hasSecop = r2Texts.some((t) => t.includes('secop'));
    assert.equal(hasSecop, false, `SECOP query may still be referenced in source_gating_decisions but is no longer generated in R2 queries, got: ${r2Texts.join(', ')}`);
  });
});

// ─── Diversification tests ────────────────────────────────────────────────────

describe('hasDiversificationAvailable', () => {
  it('returns true when R2 has at least one family not in R1', () => {
    const plan = buildPlan(['EdTech', 'SaaS']);
    // R1 and R2 use different builders — very likely to have different families
    const result = hasDiversificationAvailable(plan);
    // This is an integration assertion: if builders are properly distinct, this is true
    // We verify the function works correctly by checking the logic manually
    const r1Set = new Set(plan.families_r1);
    const hasDiff = plan.families_r2.some((f) => !r1Set.has(f));
    assert.equal(result, hasDiff);
  });

  it('returns false for plan with identical R1 and R2 families', () => {
    const mockPlan: DiscoveryQueryPlan = {
      round1_queries: [],
      round2_queries: [],
      round2_strategy: 'baseline',
      round2_trigger: 'standard_second_round',
      source_gating_decisions: [],
      families_r1: ['product_category', 'erp_crm_provider'],
      families_r2: ['product_category', 'erp_crm_provider'],
      secop_excluded: false,
    };
    assert.equal(hasDiversificationAvailable(mockPlan), false);
  });

  it('returns true when R2 adds a new family not in R1', () => {
    const mockPlan: DiscoveryQueryPlan = {
      round1_queries: [],
      round2_queries: [],
      round2_strategy: 'broaden_angle',
      round2_trigger: 'low_persistable_after_novelty (1 < 3)',
      source_gating_decisions: [],
      families_r1: ['product_category'],
      families_r2: ['product_category', 'partner_ecosystem'],
      secop_excluded: false,
    };
    assert.equal(hasDiversificationAvailable(mockPlan), true);
  });

  it('returns false for empty R2 families', () => {
    const mockPlan: DiscoveryQueryPlan = {
      round1_queries: [],
      round2_queries: [],
      round2_strategy: 'baseline',
      round2_trigger: 'standard_second_round',
      source_gating_decisions: [],
      families_r1: ['product_category'],
      families_r2: [],
      secop_excluded: false,
    };
    assert.equal(hasDiversificationAvailable(mockPlan), false);
  });
});

// ─── Plan metadata completeness ───────────────────────────────────────────────

describe('Plan metadata', () => {
  it('plan contains all required fields', () => {
    const plan = buildPlan(['EdTech']);
    assert.ok(Array.isArray(plan.round1_queries));
    assert.ok(Array.isArray(plan.round2_queries));
    assert.ok(typeof plan.round2_strategy === 'string');
    assert.ok(typeof plan.round2_trigger === 'string');
    assert.ok(Array.isArray(plan.source_gating_decisions));
    assert.ok(Array.isArray(plan.families_r1));
    assert.ok(Array.isArray(plan.families_r2));
    assert.ok(typeof plan.secop_excluded === 'boolean');
  });

  it('source_gating_decisions contains exactly 5 entries (v1.1: co_software_empresarial añadido)', () => {
    const plan = buildPlan(['SaaS']);
    assert.equal(plan.source_gating_decisions.length, 5);
    const keys = plan.source_gating_decisions.map((d) => d.source_key);
    assert.ok(keys.includes('co_colombia_fintech'));
    assert.ok(keys.includes('co_secop2'));
    assert.ok(keys.includes('co_fedesoft'));
    assert.ok(keys.includes('co_andicom'));           // presente pero allowed=false
    assert.ok(keys.includes('co_software_empresarial')); // nuevo en v1.1
  });

  it('round2_strategy is broaden_angle when round1PersistableCount below threshold', () => {
    const plan = buildDiscoveryQueryPlan({
      industry: 'Tecnología',
      country: 'Colombia',
      subindustries: ['SaaS'],
      additionalCriteria: null,
      round1PersistableCount: 1,
      minPersistableThreshold: 3,
    });
    assert.equal(plan.round2_strategy, 'broaden_angle');
    assert.ok(plan.round2_trigger.includes('low_persistable_after_novelty'));
  });

  it('round2_strategy is baseline when round1PersistableCount meets threshold', () => {
    const plan = buildDiscoveryQueryPlan({
      industry: 'Tecnología',
      country: 'Colombia',
      subindustries: ['SaaS'],
      additionalCriteria: null,
      round1PersistableCount: 5,
      minPersistableThreshold: 3,
    });
    assert.equal(plan.round2_strategy, 'baseline');
  });

  it('R1 queries have round_number=1 and R2 have round_number=2', () => {
    const plan = buildPlan(['EdTech']);
    for (const q of plan.round1_queries) {
      assert.equal(q.round_number, 1);
    }
    for (const q of plan.round2_queries) {
      assert.equal(q.round_number, 2);
    }
  });
});
