/**
 * Tests — wizard-context-normalizer (L2.7)
 *
 * Cubre:
 *   A. parseAdditionalCriteriaTokens — tokenización del criterio libre
 *   B. NormalizedWizardContext — estructura canónica del contexto
 *   C. extractEmployeeThresholdFromText — extracción de umbral de empleados
 *
 * Sin llamadas a red. Sin API keys. Funciones puras.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAdditionalCriteriaTokens,
  normalizeWizardContext,
  extractEmployeeThresholdFromText,
  NORMALIZER_VERSION,
} from '../wizard-context-normalizer';
import type { ResolvedWizardExecution } from '../wizard-execution-types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeResolved(overrides: Partial<ResolvedWizardExecution> = {}): ResolvedWizardExecution {
  return {
    userId: 'user-1',
    clientRequestId: 'req-1',
    mode: 'exploratory',
    country: { code: 'CO', name: 'Colombia' },
    catalog: { version: '2024-01' },
    industry: { id: 'edu-1', slug: 'educacion', name: 'Educación' },
    subindustries: [
      { id: 'sub-1', slug: 'formacion-corporativa', name: 'Formación Corporativa', applicableCountries: ['CO'] },
      { id: 'sub-2', slug: 'lms', name: 'LMS', applicableCountries: ['CO'] },
    ],
    additionalCriteria: null,
    systemControls: {
      targetCount: 25,
      minimumEmployees: 200,
      employeeThresholdMode: 'hard_filter',
    },
    ...overrides,
  };
}

// ─── A. parseAdditionalCriteriaTokens ────────────────────────────────────────

describe('parseAdditionalCriteriaTokens', () => {
  it('A1. string vacío → []', () => {
    assert.deepEqual(parseAdditionalCriteriaTokens(''), []);
  });

  it('A2. null → []', () => {
    assert.deepEqual(parseAdditionalCriteriaTokens(null), []);
  });

  it('A3. undefined → []', () => {
    assert.deepEqual(parseAdditionalCriteriaTokens(undefined), []);
  });

  it('A4. solo espacios → []', () => {
    assert.deepEqual(parseAdditionalCriteriaTokens('   '), []);
  });

  it('A5. español con conectores — conserva términos comerciales', () => {
    const tokens = parseAdditionalCriteriaTokens('empresas de formación corporativa en ventas para PYMES');
    assert.ok(tokens.includes('formacion') || tokens.includes('formacion corporativa') || tokens.includes('ventas'), `tokens: ${JSON.stringify(tokens)}`);
    assert.ok(!tokens.includes('de'), 'no debe incluir "de"');
    assert.ok(!tokens.includes('en'), 'no debe incluir "en"');
    assert.ok(!tokens.includes('para'), 'no debe incluir "para"');
    assert.ok(!tokens.includes('empresas'), 'no debe incluir "empresas"');
  });

  it('A6. B2B y SaaS se conservan como tokens útiles', () => {
    const tokens = parseAdditionalCriteriaTokens('solo empresas B2B SaaS');
    assert.ok(tokens.includes('b2b'), `tokens: ${JSON.stringify(tokens)}`);
    assert.ok(tokens.includes('saas'), `tokens: ${JSON.stringify(tokens)}`);
    assert.ok(!tokens.includes('solo'), 'no debe incluir "solo"');
    assert.ok(!tokens.includes('empresas'), 'no debe incluir "empresas"');
  });

  it('A7. LMS se conserva (allowlist de cortos)', () => {
    const tokens = parseAdditionalCriteriaTokens('plataformas LMS para capacitación comercial');
    assert.ok(tokens.includes('lms'), `tokens: ${JSON.stringify(tokens)}`);
  });

  it('A8. más de 5 tokens resulta en máximo 5', () => {
    const tokens = parseAdditionalCriteriaTokens(
      'ventas comercial capacitacion gestion innovacion transformacion digital futuro',
    );
    assert.ok(tokens.length <= 5, `tokens exceden 5: ${JSON.stringify(tokens)}`);
  });

  it('A9. número puro (umbral empleados) no aparece en tokens', () => {
    const tokens = parseAdditionalCriteriaTokens('con más de 200 empleados y presencia regional');
    assert.ok(!tokens.includes('200'), 'número puro no debe aparecer');
    assert.ok(!tokens.includes('200+'), 'número+ puro no debe aparecer');
  });

  it('A10. términos genéricos de empresa eliminados', () => {
    const tokens = parseAdditionalCriteriaTokens('grandes organizaciones del sector');
    assert.ok(!tokens.includes('organizaciones'), 'no debe incluir "organizaciones"');
    assert.ok(!tokens.includes('sector'), 'no debe incluir "sector"');
  });

  it('A11. inglés con conectores — conserva términos relevantes', () => {
    const tokens = parseAdditionalCriteriaTokens('B2B companies with strong sales training programs');
    assert.ok(tokens.includes('b2b'), `tokens: ${JSON.stringify(tokens)}`);
    assert.ok(!tokens.includes('with'), 'no debe incluir "with"');
    assert.ok(!tokens.includes('the'), 'no debe incluir "the"');
    assert.ok(!tokens.includes('companies'), 'no debe incluir "companies"');
  });

  it('A12. no genera tokens de 1 caracter', () => {
    const tokens = parseAdditionalCriteriaTokens('a b c d e f g');
    assert.deepEqual(tokens, [], `no debe haber tokens de 1 char: ${JSON.stringify(tokens)}`);
  });

  it('A13. sin duplicados', () => {
    const tokens = parseAdditionalCriteriaTokens('ventas ventas ventas capacitacion');
    const unique = [...new Set(tokens)];
    assert.deepEqual(tokens, unique, 'no debe haber duplicados');
  });
});

// ─── B. normalizeWizardContext ────────────────────────────────────────────────

describe('normalizeWizardContext', () => {
  it('B1. countryCode correcto', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.equal(ctx.countryCode, 'CO');
  });

  it('B2. country correcto', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.equal(ctx.country, 'Colombia');
  });

  it('B3. sectorKey normalizado sin acentos y minúsculas', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.equal(ctx.sectorKey, 'educacion');
  });

  it('B4. subindustries son los nombres canónicos del catálogo', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.deepEqual(ctx.subindustries, ['Formación Corporativa', 'LMS']);
  });

  it('B5. subindustryKeys normalizados sin acentos', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.ok(ctx.subindustryKeys.includes('formacion corporativa'), `keys: ${JSON.stringify(ctx.subindustryKeys)}`);
    assert.ok(ctx.subindustryKeys.includes('lms'));
  });

  it('B6. additionalCriteriaTokens extraídos correctamente', () => {
    const resolved = makeResolved({
      additionalCriteria: 'plataformas LMS para capacitación comercial',
    });
    const ctx = normalizeWizardContext(resolved);
    assert.ok(ctx.additionalCriteriaTokens.includes('lms'), `tokens: ${JSON.stringify(ctx.additionalCriteriaTokens)}`);
  });

  it('B7. additionalCriteriaRaw preservado', () => {
    const resolved = makeResolved({ additionalCriteria: 'texto libre' });
    const ctx = normalizeWizardContext(resolved);
    assert.equal(ctx.additionalCriteriaRaw, 'texto libre');
  });

  it('B8. targetEmployeeThreshold desde systemControls', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.equal(ctx.targetEmployeeThreshold, 200);
  });

  it('B9. targetEmployeeThreshold null si minimumEmployees = 0', () => {
    const resolved = makeResolved({
      systemControls: { targetCount: 25, minimumEmployees: 0, employeeThresholdMode: 'hard_filter' },
    });
    const ctx = normalizeWizardContext(resolved);
    assert.equal(ctx.targetEmployeeThreshold, null);
  });

  it('B10. version = L2.7', () => {
    const ctx = normalizeWizardContext(makeResolved());
    assert.equal(ctx.version, NORMALIZER_VERSION);
    assert.equal(ctx.version, 'L2.7');
  });

  it('B11. provider informativo queda en ctx.provider', () => {
    const ctx = normalizeWizardContext(makeResolved(), 'apollo_organizations');
    assert.equal(ctx.provider, 'apollo_organizations');
  });

  it('B12. sin subindustrias: subindustries vacío y subindustryKeys vacío', () => {
    const resolved = makeResolved({ subindustries: [] });
    const ctx = normalizeWizardContext(resolved);
    assert.deepEqual(ctx.subindustries, []);
    assert.deepEqual(ctx.subindustryKeys, []);
  });

  it('B13. additionalCriteriaTokens vacío si criteria es null', () => {
    const ctx = normalizeWizardContext(makeResolved({ additionalCriteria: null }));
    assert.deepEqual(ctx.additionalCriteriaTokens, []);
  });
});

// ─── C. extractEmployeeThresholdFromText ──────────────────────────────────────

describe('extractEmployeeThresholdFromText', () => {
  it('C1. "más de 200 empleados" → 200', () => {
    assert.equal(extractEmployeeThresholdFromText('con más de 200 empleados'), 200);
  });

  it('C2. "200+" → 200', () => {
    assert.equal(extractEmployeeThresholdFromText('empresas con 200+ empleados'), 200);
  });

  it('C3. "más de 500" → 500', () => {
    assert.equal(extractEmployeeThresholdFromText('mas de 500 colaboradores'), 500);
  });

  it('C4. texto sin número → null', () => {
    assert.equal(extractEmployeeThresholdFromText('solo empresas B2B'), null);
  });

  it('C5. null → null', () => {
    assert.equal(extractEmployeeThresholdFromText(null), null);
  });

  it('C6. vacío → null', () => {
    assert.equal(extractEmployeeThresholdFromText(''), null);
  });
});
