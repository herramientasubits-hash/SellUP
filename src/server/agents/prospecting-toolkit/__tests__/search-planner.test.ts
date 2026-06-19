/**
 * Tests — Search Planner v0 (Hito 16AC)
 *
 * Verifica:
 *   - Colombia + Tecnología produce modo exploratory
 *   - RUES no aparece como fuente primaria de discovery
 *   - blockedSourceTypes contiene landing_page, blog, forum, glossary, marketplace
 *   - employeeCountPolicy = 'unknown_allowed_for_manual_review'
 *   - Tamaño desconocido no bloquea (sizePolicy.gateImplemented = false)
 *   - El plan contiene query families de R1 y R2
 *   - negativeMemoryPolicy respeta 90 días y blockCandidatesWithNullReviewedAt
 *   - Estructura de output estable para snapshot de campos requeridos
 *   - subindustries vacías son aceptadas
 *   - additionalCriteria null es aceptado
 *
 * Puramente determinístico — sin I/O, sin llamadas externas.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPlan } from '../search-planner';
import type { SearchPlanV0 } from '../search-planner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildColombiaTeçnología(overrides: Partial<Parameters<typeof buildSearchPlan>[0]> = {}): SearchPlanV0 {
  return buildSearchPlan({
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    subindustries: [],
    additionalCriteria: null,
    targetCount: 10,
    searchDepth: 'standard',
    ...overrides,
  });
}

// ─── Modo y estructura base ───────────────────────────────────────────────────

describe('Search Plan v0 — estructura base', () => {
  it('produce modo exploratory', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.mode, 'exploratory');
  });

  it('refleja country y countryCode correctamente', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.countryCode, 'CO');
    assert.equal(plan.countryName, 'Colombia');
  });

  it('refleja canonicalIndustry correctamente', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.canonicalIndustry, 'Tecnología');
  });

  it('metadata.planVersion es search_planner_v0', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.metadata.planVersion, 'search_planner_v0');
  });

  it('metadata.generatedAt es un string ISO', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(typeof plan.metadata.generatedAt === 'string');
    assert.ok(plan.metadata.generatedAt.length > 0);
  });

  it('metadata.searchDepth refleja el input', () => {
    const plan = buildColombiaTeçnología({ searchDepth: 'deep' });
    assert.equal(plan.metadata.searchDepth, 'deep');
  });

  it('metadata.targetCount refleja el input', () => {
    const plan = buildColombiaTeçnología({ targetCount: 15 });
    assert.equal(plan.metadata.targetCount, 15);
  });
});

// ─── Source Strategy — RUES ───────────────────────────────────────────────────

describe('Source Strategy — RUES no es fuente primaria', () => {
  it('RUES aparece en doNotUseAsPrimary', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(
      plan.sourceStrategy.doNotUseAsPrimary.includes('RUES'),
      'RUES debe estar en doNotUseAsPrimary'
    );
  });

  it('co_rues aparece en doNotUseAsPrimary', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(
      plan.sourceStrategy.doNotUseAsPrimary.includes('co_rues'),
      'co_rues debe estar en doNotUseAsPrimary'
    );
  });

  it('primaryDiscoveryApproach es hybrid_sector_signal_and_web_validation', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(
      plan.sourceStrategy.primaryDiscoveryApproach,
      'hybrid_sector_signal_and_web_validation'
    );
  });
});

// ─── Source Strategy — Blocked source types ───────────────────────────────────

describe('Source Strategy — blockedSourceTypes', () => {
  it('bloquea landing_page', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('landing_page'));
  });

  it('bloquea blog', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('blog'));
  });

  it('bloquea forum', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('forum'));
  });

  it('bloquea glossary', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('glossary'));
  });

  it('bloquea marketplace', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('marketplace'));
  });

  it('bloquea generic_article', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('generic_article'));
  });

  it('bloquea job_board', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('job_board'));
  });
});

// ─── Source Strategy — Allowed source types ───────────────────────────────────

describe('Source Strategy — allowedSourceTypes', () => {
  it('permite official_company_site', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.allowedSourceTypes.includes('official_company_site'));
  });

  it('permite industry_association', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.allowedSourceTypes.includes('industry_association'));
  });

  it('permite linkedin_company', () => {
    const plan = buildColombiaTeçnología();
    assert.ok(plan.sourceStrategy.allowedSourceTypes.includes('linkedin_company'));
  });
});

// ─── Política de tamaño ───────────────────────────────────────────────────────

describe('Size Policy — tamaño desconocido no bloquea', () => {
  it('sizePolicy.status es not_blocking', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.sizePolicy.status, 'not_blocking');
  });

  it('sizePolicy.gateImplemented es false', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.sizePolicy.gateImplemented, false);
  });

  it('sizePolicy.unknownAllowed es true', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.sizePolicy.unknownAllowed, true);
  });

  it('sizePolicy.unknownRequiresHumanReview es true', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.sizePolicy.unknownRequiresHumanReview, true);
  });

  it('sizePolicy.unknownSizeStatus es unknown', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.sizePolicy.unknownSizeStatus, 'unknown');
  });

  it('sizePolicy.thresholdMinEmployees es 200', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.sizePolicy.thresholdMinEmployees, 200);
  });
});

// ─── Política de evidencia mínima ─────────────────────────────────────────────

describe('Minimum Evidence Policy', () => {
  it('employeeCountPolicy es unknown_allowed_for_manual_review', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(
      plan.minimumEvidencePolicy.employeeCountPolicy,
      'unknown_allowed_for_manual_review'
    );
  });

  it('requiresOfficialDomain es true', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.minimumEvidencePolicy.requiresOfficialDomain, true);
  });

  it('requiresCountrySignal es true', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.minimumEvidencePolicy.requiresCountrySignal, true);
  });

  it('employeeCountThreshold es 200', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.minimumEvidencePolicy.employeeCountThreshold, 200);
  });
});

// ─── Política de memoria negativa ─────────────────────────────────────────────

describe('Negative Memory Policy', () => {
  it('respeta 90 días para discarded/rejected/blocked', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.negativeMemoryPolicy.respectDiscardedRejectedBlockedWithinDays, 90);
  });

  it('blockCandidatesWithNullReviewedAt es true', () => {
    const plan = buildColombiaTeçnología();
    assert.equal(plan.negativeMemoryPolicy.blockCandidatesWithNullReviewedAt, true);
  });
});

// ─── Query Families ───────────────────────────────────────────────────────────

describe('Query Families — Colombia + Tecnología', () => {
  it('produce al menos una familia de R1', () => {
    const plan = buildColombiaTeçnología();
    const r1Families = plan.queryFamilies.filter((f) => f.round === 1);
    assert.ok(r1Families.length > 0, 'debe tener al menos una familia de R1');
  });

  it('produce al menos una familia de R2', () => {
    const plan = buildColombiaTeçnología();
    const r2Families = plan.queryFamilies.filter((f) => f.round === 2);
    assert.ok(r2Families.length > 0, 'debe tener al menos una familia de R2');
  });

  it('metadata.round1QueryCount coincide con queries de R1', () => {
    const plan = buildColombiaTeçnología();
    const r1QueryCount = plan.queryFamilies
      .filter((f) => f.round === 1)
      .reduce((acc, f) => acc + f.queryCount, 0);
    assert.equal(plan.metadata.round1QueryCount, r1QueryCount);
  });

  it('metadata.round2QueryCount coincide con queries de R2', () => {
    const plan = buildColombiaTeçnología();
    const r2QueryCount = plan.queryFamilies
      .filter((f) => f.round === 2)
      .reduce((acc, f) => acc + f.queryCount, 0);
    assert.equal(plan.metadata.round2QueryCount, r2QueryCount);
  });

  it('cada familia tiene al menos una query', () => {
    const plan = buildColombiaTeçnología();
    for (const family of plan.queryFamilies) {
      assert.ok(
        family.queries.length > 0,
        `familia ${family.key} debe tener al menos una query`
      );
    }
  });

  it('cada familia tiene intent no vacío', () => {
    const plan = buildColombiaTeçnología();
    for (const family of plan.queryFamilies) {
      assert.ok(
        family.intent.length > 0,
        `familia ${family.key} debe tener un intent`
      );
    }
  });

  it('cada familia tiene priority válida', () => {
    const plan = buildColombiaTeçnología();
    const validPriorities = new Set(['high', 'medium', 'low']);
    for (const family of plan.queryFamilies) {
      assert.ok(
        validPriorities.has(family.priority),
        `familia ${family.key} tiene priority inválida: ${family.priority}`
      );
    }
  });
});

// ─── Subindustrias ────────────────────────────────────────────────────────────

describe('Subindustrias opcionales', () => {
  it('acepta subindustries vacías sin error', () => {
    assert.doesNotThrow(() => buildColombiaTeçnología({ subindustries: [] }));
  });

  it('acepta additionalCriteria null sin error', () => {
    assert.doesNotThrow(() => buildColombiaTeçnología({ additionalCriteria: null }));
  });

  it('acepta subindustria Fintech y no cambia source strategy', () => {
    const plan = buildColombiaTeçnología({ subindustries: ['Fintech'] });
    assert.equal(plan.sourceStrategy.primaryDiscoveryApproach, 'hybrid_sector_signal_and_web_validation');
    assert.ok(plan.sourceStrategy.doNotUseAsPrimary.includes('RUES'));
  });

  it('con subindustria Fintech produce al menos una familia R1', () => {
    const plan = buildColombiaTeçnología({ subindustries: ['Fintech'] });
    const r1 = plan.queryFamilies.filter((f) => f.round === 1);
    assert.ok(r1.length > 0);
  });
});

// ─── Otros países ─────────────────────────────────────────────────────────────

describe('Otros países — estructura base se mantiene', () => {
  it('México + Tecnología produce modo exploratory', () => {
    const plan = buildSearchPlan({
      country: 'México',
      countryCode: 'MX',
      industry: 'Tecnología',
      subindustries: [],
      targetCount: 5,
    });
    assert.equal(plan.mode, 'exploratory');
    assert.ok(plan.sourceStrategy.doNotUseAsPrimary.includes('RUES'));
    assert.ok(plan.sourceStrategy.blockedSourceTypes.includes('landing_page'));
  });
});
