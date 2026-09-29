/**
 * Tests — lectura de `metadata.claude_classification` para la UI (AGENT1-CLAUDE-CLASSIFIER-1).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readClaudeClassificationDisplay } from '../claude-classification-display';

const BASE = {
  outcome: 'classified',
  classified_at: '2026-09-29T00:00:00.000Z',
  sector: {
    industry_name: 'Salud & Farmacéuticos',
    subindustry_name: null,
    matches_current_industry: true,
    quote: 'Somos una clínica privada',
    source_url: 'https://www.clinica.pe/',
    verification: 'quote_verified',
  },
  employee_range: {
    min: 1001,
    max: 5000,
    quote: '1001-5000 empleados',
    source_url: 'https://pe.linkedin.com/company/clinica',
    verification: 'source_listed',
  },
  rejected: [{ field: 'subindustry', reason: 'x' }],
  is_operating_company: true,
  estimated_cost_usd: 0.03,
};

describe('readClaudeClassificationDisplay', () => {
  it('sin sugerencia → null', () => {
    assert.equal(readClaudeClassificationDisplay({}), null);
    assert.equal(readClaudeClassificationDisplay(null), null);
  });

  it('muestra sector y tamaño estimado con su fuente', () => {
    const d = readClaudeClassificationDisplay({ claude_classification: BASE });
    assert.equal(d?.sector?.label, 'Salud & Farmacéuticos');
    assert.equal(d?.sector?.matchesCurrentIndustry, true);
    assert.match(d?.employeeRange?.label ?? '', /estimado/);
    assert.equal(d?.rejectedCount, 1);
  });

  it('nunca muestra URLs que no sean http(s)', () => {
    const d = readClaudeClassificationDisplay({
      claude_classification: { ...BASE, sector: { ...BASE.sector, source_url: 'javascript:alert(1)' } },
    });
    assert.equal(d?.sector, null);
  });

  it('outcome desconocido → null', () => {
    assert.equal(readClaudeClassificationDisplay({ claude_classification: { ...BASE, outcome: 'raro' } }), null);
  });

  it('"más de N" cuando no hay máximo', () => {
    const d = readClaudeClassificationDisplay({
      claude_classification: { ...BASE, employee_range: { ...BASE.employee_range, max: null } },
    });
    assert.match(d?.employeeRange?.label ?? '', /^Más de/);
  });
});
