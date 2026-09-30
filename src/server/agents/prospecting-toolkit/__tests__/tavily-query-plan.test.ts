/**
 * AGENT1-TAVILY-V2-1 § 1 — plan de consultas de Tavily sobre la macro industria.
 *
 * Lo que fija esta suite:
 *   · las consultas salen de los términos calibrados del catálogo de 12 macro
 *     industrias (los mismos que usa Apollo), nunca de literales de software;
 *   · cada término viaja UNA vez por corrida (sin repetir consultas pagadas);
 *   · la rotación depende del lote: dos vendedores el mismo día no pagan la
 *     misma primera consulta, y el mismo lote reintentado sí la repite;
 *   · el país viaja como `country` de Tavily y el idioma sólo donde la consulta
 *     está escrita en ese idioma;
 *   · el criterio adicional entra al texto, saneado y acotado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAVILY_QUERY_PLAN_VERSION,
  buildTavilyMacroQueryPlan,
  resolveTavilyCountryTargeting,
  sanitizeTavilyAdditionalCriteria,
} from '../tavily-query-plan';
import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';

const SOFTWARE_DRIFT = /\b(erp|crm|saas|software)\b/i;

function planFor(industry: string, seedKey = 'batch-a', extra: Partial<Parameters<typeof buildTavilyMacroQueryPlan>[0]> = {}) {
  return buildTavilyMacroQueryPlan({
    industry,
    country: 'Colombia',
    seedKey,
    additionalCriteria: null,
    ...extra,
  });
}

describe('buildTavilyMacroQueryPlan — resolución de la macro industria', () => {
  it('resuelve las 12 macro industrias por su nombre visible', () => {
    for (const macro of MACRO_INDUSTRIES) {
      const plan = planFor(macro.displayName);
      assert.ok(plan, `sin plan para ${macro.displayName}`);
      assert.equal(plan.macroKey, macro.key);
      assert.equal(plan.version, TAVILY_QUERY_PLAN_VERSION);
    }
  });

  it('devuelve null para una industria que no es macro (camino legacy intacto)', () => {
    assert.equal(planFor('Industria inventada'), null);
    assert.equal(planFor(''), null);
  });
});

describe('buildTavilyMacroQueryPlan — forma del plan', () => {
  it('nunca supera 4 consultas por ronda ni 4 rondas', () => {
    for (const macro of MACRO_INDUSTRIES) {
      const plan = planFor(macro.displayName)!;
      assert.ok(plan.rounds.length <= 4);
      for (const round of plan.rounds) {
        assert.ok(round.length >= 1 && round.length <= 4, `${macro.key}: ronda de ${round.length}`);
      }
    }
  });

  it('no repite ninguna consulta dentro de una corrida', () => {
    for (const macro of MACRO_INDUSTRIES) {
      const all = planFor(macro.displayName)!.rounds.flat();
      assert.equal(new Set(all).size, all.length, `${macro.key} repite consultas`);
    }
  });

  it('cada consulta sale de un término específico distinto del catálogo', () => {
    for (const macro of MACRO_INDUSTRIES) {
      const plan = planFor(macro.displayName)!;
      const all = plan.rounds.flat();
      const usedTerms = all.map((q) =>
        q.replace(/^empresa (?!industrial)/, '').replace(/ Colombia$/, ''),
      );
      for (const term of usedTerms) {
        assert.ok(macro.discovery.specific.includes(term), `${macro.key}: «${term}» no es del catálogo`);
      }
      assert.equal(new Set(usedTerms).size, usedTerms.length, `${macro.key} repite términos`);
      assert.equal(all.length, Math.min(16, macro.discovery.specific.length), macro.key);
    }
  });

  it('todas las consultas nombran el país pedido', () => {
    const plan = planFor('Retail', 'x', { country: 'Perú' })!;
    for (const q of plan.rounds.flat()) assert.match(q, /Perú/);
  });
});

describe('buildTavilyMacroQueryPlan — sin deriva a software', () => {
  it('sólo Tecnología puede llevar términos de software', () => {
    for (const macro of MACRO_INDUSTRIES) {
      if (macro.key === 'technology') continue;
      for (const q of planFor(macro.displayName)!.rounds.flat()) {
        assert.doesNotMatch(q, SOFTWARE_DRIFT, `${macro.key}: «${q}»`);
      }
    }
  });

  it('Transporte & Logística y Salud & Farmacéuticos usan su propio vocabulario', () => {
    const logistics = planFor('Transporte & Logística')!.rounds.flat().join(' ');
    assert.match(logistics, /operador logistico|freight forwarder|transporte de carga/);
    const health = planFor('Salud & Farmacéuticos')!.rounds.flat().join(' ');
    assert.doesNotMatch(health, SOFTWARE_DRIFT);
  });

  it('Gobierno no antepone «empresa» a una entidad pública', () => {
    const queries = planFor('Gobierno')!.rounds.flat();
    assert.ok(queries.includes('alcaldia Colombia'));
    for (const q of queries) {
      // La única excepción es el término del catálogo que ya ES «empresa …».
      if (q.startsWith('empresa industrial y comercial del estado')) continue;
      assert.doesNotMatch(q, /^empresa /, `«${q}»`);
    }
  });
});

describe('buildTavilyMacroQueryPlan — rotación por lote', () => {
  it('el mismo lote produce exactamente el mismo plan (reintento reproducible)', () => {
    assert.deepEqual(planFor('Retail', 'batch-123'), planFor('Retail', 'batch-123'));
  });

  it('lotes distintos empiezan por consultas distintas', () => {
    const firstQueries = new Set<string>();
    for (let i = 0; i < 20; i++) {
      firstQueries.add(planFor('Retail', `batch-${i}`)!.rounds[0][0]);
    }
    assert.ok(firstQueries.size >= 5, `20 lotes sólo usan ${firstQueries.size} primeras consultas`);
  });

  it('la rotación no pierde términos: el conjunto de consultas es el mismo', () => {
    const a = new Set(planFor('Retail', 'batch-1')!.rounds.flat());
    const b = new Set(planFor('Retail', 'batch-2')!.rounds.flat());
    assert.deepEqual([...a].sort(), [...b].sort());
  });

  it('publica el desplazamiento usado para poder auditarlo', () => {
    const plan = planFor('Retail', 'batch-9')!;
    assert.ok(Number.isInteger(plan.rotationOffset));
    assert.ok(plan.rotationOffset >= 0 && plan.rotationOffset < plan.termCount);
  });
});

describe('buildTavilyMacroQueryPlan — criterio adicional', () => {
  it('entra al texto en la mitad de las consultas de cada ronda', () => {
    const plan = planFor('Retail', 'b', { additionalCriteria: 'con sedes en Medellín' })!;
    for (const round of plan.rounds) {
      const withCriteria = round.filter((q) => q.includes('con sedes en Medellín')).length;
      assert.equal(withCriteria, Math.ceil(round.length / 2));
    }
  });

  it('sin criterio, ninguna consulta cambia', () => {
    const a = planFor('Retail', 'b', { additionalCriteria: null })!;
    const b = planFor('Retail', 'b', { additionalCriteria: '   ' })!;
    assert.deepEqual(a.rounds, b.rounds);
  });
});

describe('sanitizeTavilyAdditionalCriteria', () => {
  it('quita operadores de búsqueda y comillas, y colapsa espacios', () => {
    assert.equal(
      sanitizeTavilyAdditionalCriteria('  site:foo.com  "grandes"   -bar  empresas '),
      'grandes bar empresas',
    );
  });

  it('acota la longitud a 80 caracteres sin cortar palabras', () => {
    const long = 'palabra '.repeat(30);
    const out = sanitizeTavilyAdditionalCriteria(long)!;
    assert.ok(out.length <= 80);
    assert.ok(!out.endsWith(' '));
    assert.match(out, /^(palabra ?)+$/);
  });

  it('devuelve null si no queda texto útil', () => {
    assert.equal(sanitizeTavilyAdditionalCriteria(null), null);
    assert.equal(sanitizeTavilyAdditionalCriteria('   '), null);
    assert.equal(sanitizeTavilyAdditionalCriteria('site:x.com'), null);
  });
});

describe('resolveTavilyCountryTargeting', () => {
  it('traduce los 20 países del asistente al vocabulario de Tavily', () => {
    const expected: Record<string, string> = {
      CO: 'colombia', AR: 'argentina', MX: 'mexico', CL: 'chile', BR: 'brazil',
      PE: 'peru', UY: 'uruguay', EC: 'ecuador', PY: 'paraguay', BO: 'bolivia',
      VE: 'venezuela', GT: 'guatemala', HN: 'honduras', SV: 'el salvador',
      NI: 'nicaragua', CR: 'costa rica', PA: 'panama', DO: 'dominican republic',
      US: 'united states', ES: 'spain',
    };
    for (const [code, country] of Object.entries(expected)) {
      assert.equal(resolveTavilyCountryTargeting(code).country, country, code);
    }
  });

  it('acepta minúsculas y espacios', () => {
    assert.equal(resolveTavilyCountryTargeting(' mx ').country, 'mexico');
  });

  it('pide español sólo donde la consulta está escrita en español', () => {
    assert.equal(resolveTavilyCountryTargeting('CO').language, 'spanish');
    assert.equal(resolveTavilyCountryTargeting('ES').language, 'spanish');
    // Las consultas del catálogo no están en portugués ni en inglés: pedir ese
    // idioma contradiría el texto (la doc de Tavily pide que coincidan).
    assert.equal(resolveTavilyCountryTargeting('BR').language, null);
    assert.equal(resolveTavilyCountryTargeting('US').language, null);
  });

  it('un país desconocido no envía nada (nunca inventa un valor que Tavily rechace)', () => {
    assert.deepEqual(resolveTavilyCountryTargeting('XX'), { country: null, language: null });
    assert.deepEqual(resolveTavilyCountryTargeting(null), { country: null, language: null });
  });
});
