/**
 * Tests — Apollo Organizations Query Mapping (L2.11-A)
 *
 * Verifica la corrección raíz: q_keywords → q_organization_keyword_tags[].
 * Apollo ignora silenciosamente q_keywords en /mixed_companies/search.
 *
 * Escenarios:
 *   A. Organization Search ya no envía q_keywords — usa q_organization_keyword_tags
 *   B. Metadata indica campo correcto (apollo_keyword_filter_field, deprecated flag)
 *   C. Employee range threshold 200 — rangos correctos
 *   D. Employee range threshold null — no se envía filtro
 *   E. Tags LMS no incluyen términos genéricos education/university/school
 *   F. Search pack metadata intacta (pack_key, apollo_keywords_sent backward compat)
 *   G. mapEmployeeThresholdToApolloRanges — helper puro
 *   H. Tavily regression — no imports Tavily
 *   I. Lusha no activado
 *
 * Sin llamadas a red. Sin API keys. Funciones puras.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildApolloOrganizationsSearchParams,
  mapEmployeeThresholdToApolloRanges,
  APOLLO_QUERY_MAPPING_VERSION,
} from '../apollo-organizations-query-mapping';
import type { WebSearchInput } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<WebSearchInput> = {}): WebSearchInput {
  return {
    query: 'plataformas lms capacitacion comercial Colombia',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Educación',
    maxResults: 5,
    provider: 'apollo_organizations',
    subindustries: ['Formación Corporativa'],
    additionalCriteriaTokens: ['lms', 'plataformas', 'capacitacion', 'comercial'],
    ...overrides,
  };
}

const BANNED_GENERIC = ['education', 'higher education', 'university', 'school'];

// ─── A. Ya no envía q_keywords ────────────────────────────────────────────────

describe('A. Organization Search ya no envía q_keywords — usa q_organization_keyword_tags', () => {
  it('A1. params NO tiene q_keywords', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(!('q_keywords' in params), `q_keywords NO debe estar en el payload Apollo. params: ${JSON.stringify(Object.keys(params))}`);
  });

  it('A2. params SÍ tiene q_organization_keyword_tags como array', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(Array.isArray(params.q_organization_keyword_tags), 'q_organization_keyword_tags debe ser array');
    assert.ok(params.q_organization_keyword_tags!.length > 0, 'debe tener al menos 1 tag');
  });

  it('A3. tags incluyen señales LMS para wizard LMS', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const tags = params.q_organization_keyword_tags!;
    const hasLms = tags.some(t => t.toLowerCase().includes('lms') || t.toLowerCase().includes('learning management'));
    assert.ok(hasLms, `tags deben incluir señal LMS. Tags: ${JSON.stringify(tags)}`);
  });

  it('A4. organization_locations contiene Colombia', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(params.organization_locations?.includes('Colombia'), 'Colombia debe estar en organization_locations');
  });

  it('A5. per_page respeta cappedMaxResults', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 3);
    assert.equal(params.per_page, 3);
  });

  it('A6. page = 1', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(params.page, 1);
  });

  it('A7. sin subindustria — sector fallback también usa q_organization_keyword_tags', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: [], additionalCriteriaTokens: [] }),
      5,
    );
    assert.ok(!('q_keywords' in params), 'q_keywords no debe estar en payload aunque sea fallback sector');
    assert.ok(Array.isArray(params.q_organization_keyword_tags), 'q_organization_keyword_tags debe estar como array');
  });
});

// ─── B. Metadata indica campo correcto ───────────────────────────────────────

describe('B. Metadata L2.11 — campo correcto y deprecated flag', () => {
  it('B1. apollo_keyword_filter_field = "q_organization_keyword_tags"', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.apollo_keyword_filter_field, 'q_organization_keyword_tags');
  });

  it('B2. deprecated_q_keywords_sent = false', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.deprecated_q_keywords_sent, false);
  });

  it('B3. apollo_keyword_tags_sent es array con las tags enviadas', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(Array.isArray(meta.apollo_keyword_tags_sent), 'apollo_keyword_tags_sent debe ser array');
    assert.ok(meta.apollo_keyword_tags_sent.length > 0, 'debe tener tags');
  });

  it('B4. apollo_keyword_tags_sent === apollo_keywords_sent_array', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.deepEqual(meta.apollo_keyword_tags_sent, meta.apollo_keywords_sent_array);
  });

  it('B5. mapping_version = v1.L2.11-A', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.mapping_version, APOLLO_QUERY_MAPPING_VERSION);
    assert.ok(meta.mapping_version.includes('L2.11'), `versión esperada L2.11: ${meta.mapping_version}`);
  });

  it('B6. normalized_context_version = L2.11', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.normalized_context_version, 'L2.11');
  });
});

// ─── C. Employee range threshold 200 ─────────────────────────────────────────

describe('C. Employee range — threshold 200', () => {
  it('C1. params incluye organization_num_employees_ranges cuando threshold = 200', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 200 }),
      5,
    );
    assert.ok(Array.isArray(params.organization_num_employees_ranges), 'organization_num_employees_ranges debe ser array');
    assert.ok(params.organization_num_employees_ranges!.length > 0, 'debe haber rangos');
  });

  it('C2. rangos incluyen "200,500" cuando threshold = 200', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 200 }),
      5,
    );
    const ranges = params.organization_num_employees_ranges!;
    assert.ok(ranges.includes('200,500'), `"200,500" debe estar en rangos: ${JSON.stringify(ranges)}`);
  });

  it('C3. rangos incluyen todos los segmentos 200+ esperados', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 200 }),
      5,
    );
    const ranges = params.organization_num_employees_ranges!;
    const expected = ['200,500', '500,1000', '1000,5000', '5000,10000', '10000,20000', '20000,50000', '50000,1000000'];
    for (const r of expected) {
      assert.ok(ranges.includes(r), `rango "${r}" debe estar presente. Rangos: ${JSON.stringify(ranges)}`);
    }
  });

  it('C4. employee_range_filter_enabled = true cuando threshold está presente', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 200 }),
      5,
    );
    assert.equal(meta.employee_range_filter_enabled, true);
  });

  it('C5. apollo_employee_ranges_sent refleja los rangos enviados', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 200 }),
      5,
    );
    assert.ok(meta.apollo_employee_ranges_sent.length > 0, 'apollo_employee_ranges_sent debe tener rangos');
    assert.ok(meta.apollo_employee_ranges_sent.includes('200,500'));
  });

  it('C6. employee_threshold_source = "input.targetEmployeeThreshold"', () => {
    const { meta } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 200 }),
      5,
    );
    assert.equal(meta.employee_threshold_source, 'input.targetEmployeeThreshold');
  });

  it('C7. threshold 500 — rangos empiezan desde "500,1000"', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: 500 }),
      5,
    );
    const ranges = params.organization_num_employees_ranges!;
    assert.ok(!ranges.includes('200,500'), '"200,500" NO debe estar con threshold=500');
    assert.ok(ranges.includes('500,1000'), '"500,1000" debe estar con threshold=500');
  });
});

// ─── D. Employee range threshold null ─────────────────────────────────────────

describe('D. Employee range — threshold null/undefined', () => {
  it('D1. params NO incluye organization_num_employees_ranges cuando threshold es null', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: null }),
      5,
    );
    assert.ok(!params.organization_num_employees_ranges || params.organization_num_employees_ranges.length === 0,
      'no debe haber rangos con threshold null');
  });

  it('D2. params NO incluye organization_num_employees_ranges cuando threshold es undefined', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ targetEmployeeThreshold: undefined }),
      5,
    );
    assert.ok(!params.organization_num_employees_ranges || params.organization_num_employees_ranges.length === 0,
      'no debe haber rangos con threshold undefined');
  });

  it('D3. employee_range_filter_enabled = false cuando sin threshold', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.employee_range_filter_enabled, false);
  });

  it('D4. apollo_employee_ranges_sent = [] cuando sin threshold', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.deepEqual(meta.apollo_employee_ranges_sent, []);
  });

  it('D5. employee_threshold_source = null cuando sin threshold', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.equal(meta.employee_threshold_source, null);
  });
});

// ─── E. No terms genéricos en tags LMS ────────────────────────────────────────

describe('E. Tags LMS no contienen términos genéricos', () => {
  it('E1. tags de pack LMS no incluyen "education" exacto', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: ['Formación Corporativa'], additionalCriteriaTokens: ['lms', 'plataformas'] }),
      5,
    );
    const tags = params.q_organization_keyword_tags ?? [];
    for (const banned of BANNED_GENERIC) {
      const found = tags.find(t => t.toLowerCase() === banned.toLowerCase());
      assert.ok(!found, `tag genérico "${banned}" no debe estar en tags: ${JSON.stringify(tags)}`);
    }
  });

  it('E2. tags de sector fallback Educación sin subindustria — no incluye "education" ni "university"', () => {
    const { params } = buildApolloOrganizationsSearchParams(
      makeInput({ subindustries: [], additionalCriteriaTokens: [] }),
      5,
    );
    const tags = params.q_organization_keyword_tags ?? [];
    assert.ok(!tags.some(t => t.toLowerCase() === 'university'), `"university" no debe estar en tags: ${JSON.stringify(tags)}`);
    assert.ok(!tags.some(t => t.toLowerCase() === 'school'), `"school" no debe estar en tags: ${JSON.stringify(tags)}`);
  });

  it('E3. tags no contienen nombre del país', () => {
    const { params } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const tags = params.q_organization_keyword_tags ?? [];
    assert.ok(!tags.some(t => t.toLowerCase().includes('colombia')), `Colombia no debe estar en tags: ${JSON.stringify(tags)}`);
  });
});

// ─── F. Search pack metadata intacta ─────────────────────────────────────────

describe('F. Search pack metadata backward compat', () => {
  it('F1. apollo_search_pack.pack_key = lms_vendors cuando criteria tiene LMS signals', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(meta.apollo_search_pack, 'apollo_search_pack debe estar presente');
    assert.equal(meta.apollo_search_pack!.pack_key, 'lms_vendors');
  });

  it('F2. apollo_keywords_sent sigue siendo string (backward compat)', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(
      typeof meta.apollo_keywords_sent === 'string' || meta.apollo_keywords_sent === null,
      'apollo_keywords_sent debe ser string o null para backward compat',
    );
  });

  it('F3. apollo_keywords_sent_array refleja las tags reales enviadas', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(Array.isArray(meta.apollo_keywords_sent_array), 'debe ser array');
    assert.ok(meta.apollo_keywords_sent_array.length > 0, 'debe tener tags');
  });

  it('F4. apollo_search_pack.build_strategy presente', () => {
    const { meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    assert.ok(meta.apollo_search_pack?.build_strategy, 'build_strategy debe estar presente');
  });
});

// ─── G. mapEmployeeThresholdToApolloRanges helper ────────────────────────────

describe('G. mapEmployeeThresholdToApolloRanges — helper puro', () => {
  it('G1. threshold null → []', () => {
    assert.deepEqual(mapEmployeeThresholdToApolloRanges(null), []);
  });

  it('G2. threshold undefined → []', () => {
    assert.deepEqual(mapEmployeeThresholdToApolloRanges(undefined), []);
  });

  it('G3. threshold 200 → 7 rangos desde "200,500"', () => {
    const ranges = mapEmployeeThresholdToApolloRanges(200);
    assert.equal(ranges[0], '200,500');
    assert.equal(ranges.length, 7);
  });

  it('G4. threshold 500 → rangos desde "500,1000"', () => {
    const ranges = mapEmployeeThresholdToApolloRanges(500);
    assert.equal(ranges[0], '500,1000');
    assert.ok(!ranges.includes('200,500'), '"200,500" no debe estar con threshold=500');
  });

  it('G5. threshold 1000 → rangos desde "1000,5000"', () => {
    const ranges = mapEmployeeThresholdToApolloRanges(1000);
    assert.equal(ranges[0], '1000,5000');
  });

  it('G6. threshold 50000 → solo rango "50000,1000000"', () => {
    const ranges = mapEmployeeThresholdToApolloRanges(50000);
    assert.deepEqual(ranges, ['50000,1000000']);
  });

  it('G7. resultado es inmutable (array nuevo cada llamada)', () => {
    const r1 = mapEmployeeThresholdToApolloRanges(200);
    const r2 = mapEmployeeThresholdToApolloRanges(200);
    assert.notEqual(r1, r2, 'debe retornar array nuevo cada vez');
    assert.deepEqual(r1, r2);
  });
});

// ─── H. Tavily regression ─────────────────────────────────────────────────────

describe('H. Tavily regression', () => {
  it('H1. buildApolloOrganizationsSearchParams no lanza error', () => {
    assert.doesNotThrow(() => {
      buildApolloOrganizationsSearchParams(makeInput(), 5);
    });
  });

  it('H2. apollo-organizations-query-mapping no tiene imports de Tavily (verificación de fuente)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-organizations-query-mapping.ts'),
      'utf-8',
    );
    // Verificar que no hay import statements con tavily (menciones en comentarios son OK)
    const importLines = src.split('\n').filter(l => l.trim().startsWith('import'));
    const hasTavilyImport = importLines.some(l => l.toLowerCase().includes('tavily'));
    assert.ok(!hasTavilyImport, `query mapping Apollo no debe importar Tavily. Import lines: ${importLines.join('; ')}`);
  });
});

// ─── I. Lusha no activado ─────────────────────────────────────────────────────

describe('I. Lusha no activado', () => {
  it('I1. resultado de buildApolloOrganizationsSearchParams no menciona Lusha', () => {
    const { params, meta } = buildApolloOrganizationsSearchParams(makeInput(), 5);
    const str = JSON.stringify({ params, meta }).toLowerCase();
    assert.ok(!str.includes('lusha'), 'el resultado no debe mencionar Lusha');
  });

  it('I2. apollo-organizations-query-mapping.ts no importa Lusha', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/apollo-organizations-query-mapping.ts'),
      'utf-8',
    );
    assert.ok(!src.toLowerCase().includes('lusha'), 'query mapping no debe mencionar Lusha');
  });
});
