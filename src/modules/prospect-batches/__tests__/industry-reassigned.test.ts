/**
 * «De otra industria» a la vista: el predicado que usan las tablas y el lote, y
 * que dice lo mismo que el rescate de la IA.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INDUSTRY_REASSIGNED_REASON,
  describeIndustrySplit,
  isIndustryReassigned,
  otherIndustryHint,
} from '../industry-reassigned';
import {
  INDUSTRY_REASSIGNED_CONDITION,
  buildReassignedCompleteness,
} from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-patch';

describe('isIndustryReassigned', () => {
  it('usa el mismo motivo que escribe el rescate', () => {
    assert.equal(INDUSTRY_REASSIGNED_REASON, INDUSTRY_REASSIGNED_CONDITION);
  });

  it('reconoce lo que deja buildReassignedCompleteness', () => {
    assert.equal(isIndustryReassigned({ target_completeness: buildReassignedCompleteness(null) }), true);
  });

  it('si falta target_completeness, mira la decisión del rescate', () => {
    assert.equal(isIndustryReassigned({ claude_rescue: { decision: 'reassign' } }), true);
    assert.equal(isIndustryReassigned({ claude_rescue: { decision: 'admit' } }), false);
  });

  it('una empresa normal, o sin metadata, no es de otra industria', () => {
    assert.equal(isIndustryReassigned({ target_completeness: { review_only_reasons: ['linkedin_status'] } }), false);
    assert.equal(isIndustryReassigned(null), false);
    assert.equal(isIndustryReassigned([]), false);
  });
});

describe('textos', () => {
  it('el tooltip dice la industria real y que no cuenta para la meta, sin nombrar proveedores', () => {
    const hint = otherIndustryHint('Propiedad & Construcción');
    assert.match(hint, /^Es de Propiedad & Construcción/);
    assert.match(hint, /no cuenta para la meta/);
    assert.doesNotMatch(hint + otherIndustryHint(null), /Claude|Apollo|Lusha|Tavily/);
  });

  it('el reparto: 8 de Tecnología · 2 de otra industria', () => {
    assert.equal(
      describeIndustrySplit({ total: 10, reassigned: 2, requestedIndustry: 'Tecnología' }),
      '8 de Tecnología · 2 de otra industria',
    );
    assert.equal(describeIndustrySplit({ total: 10, reassigned: 0, requestedIndustry: 'Tecnología' }), null);
    assert.equal(
      describeIndustrySplit({ total: 3, reassigned: 1, requestedIndustry: null }),
      '2 de la industria buscada · 1 de otra industria',
    );
  });
});
