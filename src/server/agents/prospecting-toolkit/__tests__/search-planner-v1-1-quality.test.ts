/**
 * Tests — Search Planner v1.1 Query Quality Refinement (Hito 16AD.1.1)
 *
 * Verifica los criterios de aceptación para v1.1:
 *   CA1: ninguna query contiene "pymes"
 *   CA2: ninguna query contiene "ANDICOM"
 *   CA3: ninguna query contiene "Colombia Fintech" con subindustries=[] y criteria=null
 *   CA4: con subindustry Fintech, Colombia Fintech puede aparecer
 *   CA5: additionalCriteria con "pagos" o "fintech" activa Colombia Fintech
 *   CA6: nearshore/desarrollo software queda HIGH o MEDIUM, no LOW
 *   CA7: implementador ERP/CRM/SaaS queda HIGH o MEDIUM, no LOW
 *   CA8: executableQueries mantiene cap 10 en standard depth
 *   CA9: no hay queries vacías
 *   CA10: todas las queries tienen source = search_planner_v1
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

// ─── CA1-CA3: queries prohibidas en búsqueda general ─────────────────────────

describe('v1.1 CA1 — ninguna query contiene "pymes"', () => {
  it('executableQueries no contienen la palabra pymes', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan());
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('pymes'),
      `Queries no deben contener "pymes":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

describe('v1.1 CA2 — ninguna query contiene "ANDICOM"', () => {
  it('executableQueries no contienen ANDICOM', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan());
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('andicom'),
      `Queries no deben contener "ANDICOM":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('Colombia + Tecnología con subindustry Ciberseguridad tampoco contiene ANDICOM', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ subindustries: ['Ciberseguridad'] }));
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('andicom'),
      `Queries con Ciberseguridad no deben contener ANDICOM:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

describe('v1.1 CA3 — no "Colombia Fintech" con subindustries=[] y criteria=null', () => {
  it('executableQueries no contienen Colombia Fintech en búsqueda general', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: [], additionalCriteria: null }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('colombia fintech'),
      `Sin subindustria fintech, queries no deben contener "Colombia Fintech":\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA4-CA5: Colombia Fintech condicional ────────────────────────────────────

describe('v1.1 CA4 — con subindustry Fintech, Colombia Fintech puede aparecer', () => {
  it('subindustry Fintech activa señal fintech en queries', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ subindustries: ['Fintech'] }));
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('colombia fintech') || allText.includes('fintech asociadas'),
      `Con subindustria Fintech debe haber señal fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('subindustry Infraestructura de Pagos activa señal fintech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ subindustries: ['Infraestructura de Pagos'] }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('colombia fintech') || allText.includes('fintech') || allText.includes('pagos'),
      `Con subindustria de pagos debe haber señal fintech/pagos:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

describe('v1.1 CA5 — additionalCriteria con fintech/pagos activa Colombia Fintech', () => {
  it('criteria "fintech" activa Colombia Fintech source-guided', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'empresas de fintech y pagos Colombia' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('colombia fintech') || allText.includes('fintech asociadas'),
      `criteria con "fintech" debe activar Colombia Fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('criteria "pagos" activa Colombia Fintech source-guided', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'plataformas de medios de pago empresariales' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      allText.includes('colombia fintech') || allText.includes('fintech asociadas'),
      `criteria con "pago" debe activar Colombia Fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });

  it('criteria sin señal fintech NO activa Colombia Fintech', () => {
    const queries = getExecutableQueriesFromSearchPlan(
      buildPlan({ additionalCriteria: 'empresas con más de 500 empleados en Bogotá' }),
    );
    const allText = queries.map((q) => q.queryText).join(' ').toLowerCase();
    assert.ok(
      !allText.includes('colombia fintech'),
      `criteria sin fintech/pagos no debe activar Colombia Fintech:\n${queries.map((q) => q.queryText).join('\n')}`,
    );
  });
});

// ─── CA6-CA7: prioridades actualizadas en R2 ─────────────────────────────────

describe('v1.1 CA6 — nearshore/desarrollo software no queda LOW', () => {
  it('query nearshore en R2 tiene prioridad HIGH o MEDIUM', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'deep' }));
    const nearshore = queries.find(
      (q) => q.round === 2 &&
        (q.queryText.toLowerCase().includes('nearshore') ||
          (q.queryText.toLowerCase().includes('desarrollo software') &&
            q.queryText.toLowerCase().includes('medell'))),
    );
    if (nearshore) {
      assert.ok(
        nearshore.priority === 'high' || nearshore.priority === 'medium',
        `nearshore debe ser HIGH o MEDIUM, got "${nearshore.priority}": "${nearshore.queryText}"`,
      );
    }
  });

  it('familia software_factory en R2 no es LOW', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'deep' }));
    const softwareFactory = queries.filter(
      (q) => q.round === 2 && q.familyKey.includes('software_factory'),
    );
    for (const q of softwareFactory) {
      assert.notEqual(
        q.priority, 'low',
        `software_factory R2 no debe ser LOW: "${q.queryText}"`,
      );
    }
  });
});

describe('v1.1 CA7 — implementador ERP/CRM/SaaS no queda LOW', () => {
  it('query implementador en R2 tiene prioridad HIGH o MEDIUM', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'deep' }));
    const impl = queries.find(
      (q) => q.round === 2 && q.queryText.toLowerCase().includes('implementador'),
    );
    if (impl) {
      assert.ok(
        impl.priority === 'high' || impl.priority === 'medium',
        `implementador debe ser HIGH o MEDIUM, got "${impl.priority}": "${impl.queryText}"`,
      );
    }
  });

  it('query software empresarial en R2 tiene prioridad HIGH o MEDIUM', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'deep' }));
    const swEmp = queries.find(
      (q) => q.round === 2 && q.queryText.toLowerCase().includes('software empresarial'),
    );
    if (swEmp) {
      assert.ok(
        swEmp.priority === 'high' || swEmp.priority === 'medium',
        `software empresarial debe ser HIGH o MEDIUM, got "${swEmp.priority}": "${swEmp.queryText}"`,
      );
    }
  });

  it('familia implementation_provider en R2 no es LOW', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'deep' }));
    const implProviders = queries.filter(
      (q) => q.round === 2 && q.familyKey.includes('implementation_provider'),
    );
    for (const q of implProviders) {
      assert.notEqual(
        q.priority, 'low',
        `implementation_provider R2 no debe ser LOW: "${q.queryText}"`,
      );
    }
  });
});

// ─── CA8-CA10: invariantes estructurales ──────────────────────────────────────

describe('v1.1 CA8 — cap de 10 queries en standard', () => {
  it('executableQueries no supera 10 en searchDepth standard', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    assert.ok(
      queries.length <= 10,
      `standard debe tener <= 10 queries, got ${queries.length}`,
    );
  });

  it('devuelve exactamente 9 queries en Colombia + Tecnología general standard (4 R1 + 5 R2)', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    // R1: 3 base + 1 Fedesoft = 4 (Colombia Fintech excluida sin señal fintech)
    // R2: 3 base + 2 source-guided = 5
    assert.equal(queries.length, 9, `Expected 9 queries, got ${queries.length}:\n${queries.map((q) => `[R${q.round}][${q.priority}] ${q.queryText}`).join('\n')}`);
  });
});

describe('v1.1 CA9 — no hay queries vacías', () => {
  it('todas las queries tienen queryText no vacío', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan());
    for (const q of queries) {
      assert.ok(q.queryText.trim().length > 0, 'queryText no debe estar vacío');
    }
  });

  it('todas las queries tienen familyKey no vacío', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan());
    for (const q of queries) {
      assert.ok(q.familyKey.length > 0, `query debe tener familyKey: "${q.queryText}"`);
    }
  });
});

describe('v1.1 CA10 — source = search_planner_v1 en todas las queries', () => {
  it('todas las queries tienen source = search_planner_v1', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan());
    for (const q of queries) {
      assert.equal(
        q.source, 'search_planner_v1',
        `query debe tener source search_planner_v1: "${q.queryText}"`,
      );
    }
  });
});

// ─── Snapshot: antes/después de las 10 queries ───────────────────────────────

describe('v1.1 Snapshot — queries finales Colombia + Tecnología standard', () => {
  it('imprime las 9 queries ordenadas (snapshot informativo)', () => {
    const queries = getExecutableQueriesFromSearchPlan(buildPlan({ searchDepth: 'standard' }));
    // Este test siempre pasa — sirve como snapshot visible en la salida del test runner
    for (const [i, q] of queries.entries()) {
      // eslint-disable-next-line no-console
      console.log(`Q${i + 1} [R${q.round}][${q.priority.toUpperCase()}] ${q.queryText}`);
    }
    assert.ok(queries.length > 0);
  });
});
