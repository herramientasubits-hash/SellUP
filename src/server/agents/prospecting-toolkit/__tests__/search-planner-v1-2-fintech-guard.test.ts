/**
 * Tests — Search Planner v1.2 Fintech Base Guard (Hito v1.2)
 *
 * Verifica los criterios de aceptación para v1.2:
 *   CA1: Colombia + Tecnología general sin señal fintech → no "fintech" en ninguna query
 *   CA2: Colombia + Tecnología general sin señal fintech → no "pagos" en ninguna query
 *   CA3: criteria con "ERP CRM HR Tech LMS automatización" no activa fintech
 *   CA4: criteria con "fintech pagos" sí activa queries fintech
 *   CA5: subindustries ["Fintech"] activa queries fintech
 *   CA6: la query de reemplazo contiene señal ERP/CRM/SaaS corporativo
 *   CA7: snapshot de executableQueries Colombia + Tecnología general (no fintech)
 *   CA8: cap standard ≤ 10
 *   CA9: no queries vacías
 *   CA10: criteria con open banking activa fintech
 *   CA11: criteria con wallet activa fintech
 *   CA12: Colombia + Tecnología, el caso positivo completo (subindustry Fintech) conserva queries fintech
 *
 * Puramente determinístico — sin I/O, sin llamadas externas, sin Tavily.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchPlan, getExecutableQueriesFromSearchPlan } from '../search-planner';

// ─── Helper ───────────────────────────────────────────────────────────────────

function buildPlan(overrides: Partial<Parameters<typeof buildSearchPlan>[0]> = {}) {
  return buildSearchPlan({
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    subindustries: [],
    additionalCriteria: null,
    targetCount: 25,
    searchDepth: 'standard',
    ...overrides,
  });
}

const SPEC_ADDITIONAL_CRITERIA =
  'Empresas B2B en Colombia con operación real verificable. ' +
  'Priorizar proveedores de software empresarial, ERP, CRM, HR Tech, LMS, automatización ' +
  'o servicios tecnológicos corporativos. Excluir marketplaces, directorios, blogs, medios, ' +
  'foros, glosarios, páginas educativas genéricas, artículos informativos y páginas de partners ' +
  'que no representen una empresa prospecto real.';

// ─── CA1: no "fintech" en búsqueda general ────────────────────────────────────

describe('v1.2 CA1 — Colombia + Tecnología general sin señal fintech: no "fintech" en ninguna query', () => {
  it('executableQueries con subindustries=[] y criteria=null no contienen "fintech"', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: [], additionalCriteria: null }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('fintech'),
      `Queries no deben contener "fintech":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('executableQueries con additionalCriteria sin señal fintech no contienen "fintech"', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: SPEC_ADDITIONAL_CRITERIA }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('fintech'),
      `Queries con criteria B2B tech no deben contener "fintech":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA2: no "pagos" en búsqueda general ─────────────────────────────────────

describe('v1.2 CA2 — Colombia + Tecnología general sin señal fintech: no "pagos" en ninguna query', () => {
  it('executableQueries con subindustries=[] y criteria=null no contienen "pagos"', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: [], additionalCriteria: null }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('pagos'),
      `Queries no deben contener "pagos":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('executableQueries con additionalCriteria B2B tech no contienen "pagos"', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: SPEC_ADDITIONAL_CRITERIA }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('pagos'),
      `Queries con criteria B2B tech no deben contener "pagos":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA3: criteria con ERP/CRM/HR Tech no activa fintech ─────────────────────

describe('v1.2 CA3 — criteria con "ERP CRM HR Tech LMS automatización" no activa fintech', () => {
  it('no "fintech" con criteria que menciona ERP CRM HR Tech LMS', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: SPEC_ADDITIONAL_CRITERIA }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('fintech'),
      `criteria ERP/CRM/LMS no debe activar fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('no "Colombia Fintech" source-guided con criteria B2B tech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: SPEC_ADDITIONAL_CRITERIA }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('colombia fintech'),
      `criteria B2B tech no debe activar Colombia Fintech source-guided:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA4: criteria "fintech pagos" activa queries fintech ────────────────────

describe('v1.2 CA4 — criteria con "fintech pagos" activa queries fintech', () => {
  it('criteria con "fintech" activa fintech queries', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'empresas de fintech y pagos para clientes corporativos' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech') || allText.includes('pagos'),
      `criteria "fintech" debe activar queries fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('criteria con "pasarela de pagos" activa fintech queries', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'proveedores de pasarela de pagos corporativos' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech') || allText.includes('pagos'),
      `criteria "pasarela de pagos" debe activar fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA5: subindustries ["Fintech"] activa queries fintech ───────────────────

describe('v1.2 CA5 — subindustries ["Fintech"] activa queries fintech', () => {
  it('subindustry Fintech activa señal fintech en queries', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: ['Fintech'] }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech'),
      `subindustria Fintech debe activar queries fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('subindustry Fintech incluye Colombia Fintech source-guided', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: ['Fintech'] }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('colombia fintech') || allText.includes('fintech asociadas'),
      `subindustria Fintech debe incluir Colombia Fintech source-guided:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA6: query de reemplazo tiene señal ERP/CRM/SaaS ────────────────────────

describe('v1.2 CA6 — query de reemplazo contiene señal ERP/CRM/SaaS', () => {
  it('R1 contiene al menos una query con ERP, CRM o SaaS cuando no hay señal fintech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: [], additionalCriteria: null, searchDepth: 'deep' }),
    );
    const r1Queries = queries.filter((q) => q.round === 1);
    const r1Text = r1Queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      r1Text.includes('erp') || r1Text.includes('crm') || r1Text.includes('saas'),
      `R1 debe incluir query ERP/CRM/SaaS como reemplazo:\n${r1Queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA7: snapshot de executableQueries Colombia + Tecnología general ─────────

describe('v1.2 CA7 — snapshot Colombia + Tecnología general (no fintech)', () => {
  it('snapshot imprime las queries finales (informativo, siempre pasa)', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    for (const [i, q] of queries.entries()) {
      // eslint-disable-next-line no-console
      console.log(`Q${i + 1} [R${q.round}][${q.priority.toUpperCase()}] ${q.queryText}`);
    }
    assert.ok(queries.length > 0);
  });

  it('R1 no contiene "fintech" ni "pagos"', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    const r1Text = queries
      .filter((q) => q.round === 1)
      .map((q) => q.queryText)
      .join(' ')
      .toLowerCase();
    assert.ok(!r1Text.includes('fintech'), `R1 no debe contener "fintech":\n${r1Text}`);
    assert.ok(!r1Text.includes('pagos'), `R1 no debe contener "pagos":\n${r1Text}`);
  });

  it('R1 contiene gestión talento y ciberseguridad (queries base preservadas)', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    const r1Text = queries
      .filter((q) => q.round === 1)
      .map((q) => q.queryText)
      .join(' ')
      .toLowerCase();
    assert.ok(
      r1Text.includes('talento') || r1Text.includes('nomina') || r1Text.includes('nómina'),
      `R1 debe conservar query de gestión talento/nómina:\n${r1Text}`,
    );
    assert.ok(
      r1Text.includes('ciberseguridad'),
      `R1 debe conservar query de ciberseguridad:\n${r1Text}`,
    );
  });
});

// ─── CA8: cap standard ≤ 10 ──────────────────────────────────────────────────

describe('v1.2 CA8 — cap standard ≤ 10 (sin romper)', () => {
  it('executableQueries no supera 10 en standard depth', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    assert.ok(
      queries.length <= 10,
      `standard no debe superar 10 queries, got ${queries.length}`,
    );
  });

  it('total sigue siendo 9 queries en Colombia + Tecnología general standard', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    // R1: 3 base (sin fintech) + 1 Fedesoft = 4
    // R2: 3 base + 2 source-guided = 5
    assert.equal(
      queries.length, 9,
      `Expected 9 queries, got ${queries.length}:\n${queries.map((q) => `[R${q.round}][${q.priority}] ${q.queryText}`).join('\n')}`,
    );
  });
});

// ─── CA9: no queries vacías ───────────────────────────────────────────────────

describe('v1.2 CA9 — no queries vacías', () => {
  it('todas las queries tienen queryText no vacío', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan());
    for (const q of queries) {
      assert.ok(q.queryText.trim().length > 0, 'queryText no debe estar vacío');
    }
  });
});

// ─── CA10: open banking activa fintech ───────────────────────────────────────

describe('v1.2 CA10 — criteria con "open banking" activa fintech (término nuevo v1.2)', () => {
  it('criteria "open banking" activa queries fintech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'plataformas open banking para empresas corporativas Colombia' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech') || allText.includes('pagos'),
      `criteria "open banking" debe activar fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA11: wallet activa fintech ─────────────────────────────────────────────

describe('v1.2 CA11 — criteria con "wallet" activa fintech (término nuevo v1.2)', () => {
  it('criteria "wallet" activa queries fintech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'empresas con soluciones de wallet digital empresarial' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech') || allText.includes('pagos'),
      `criteria "wallet" debe activar fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA12: caso positivo completo conserva queries fintech ───────────────────

describe('v1.2 CA12 — caso positivo: subindustry Fintech conserva queries fintech (no rompe positivo)', () => {
  it('Colombia + Tecnología + subindustry Fintech tiene Colombia Fintech source-guided', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: ['Fintech'], searchDepth: 'deep' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('colombia fintech') || allText.includes('fintech asociadas'),
      `Colombia + Fintech debe conservar Colombia Fintech source-guided:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('Colombia + Tecnología + criteria fintech conserva "fintech" en queries', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'empresas fintech de pagos B2B Colombia', searchDepth: 'deep' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech'),
      `criteria fintech debe conservar queries fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('Colombia + Tecnología + criteria adquirencia activa fintech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'proveedores de adquirencia y procesamiento de pagos' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('fintech') || allText.includes('pagos'),
      `criteria "adquirencia" debe activar fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});
