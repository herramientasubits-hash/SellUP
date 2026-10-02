/**
 * AGENT1-TAVILY-V2-1 § 2 — lista de `exclude_domains` para Tavily.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TAVILY_EXCLUDE_DOMAINS_MAX,
  TAVILY_STATIC_EXCLUDE_DOMAINS,
  buildTavilyExcludeDomains,
} from '../tavily-exclude-domains';
import { classifySearchResult } from '../noise-filter';

describe('buildTavilyExcludeDomains', () => {
  it('sin historial, envía sólo el ruido fijo', () => {
    const out = buildTavilyExcludeDomains({ seenThisRun: [], negativeMemory: [] });
    assert.deepEqual(out.domains, [...TAVILY_STATIC_EXCLUDE_DOMAINS]);
    assert.equal(out.staticCount, TAVILY_STATIC_EXCLUDE_DOMAINS.length);
    assert.equal(out.truncatedCount, 0);
  });

  it('prioriza lo visto en esta corrida sobre la memoria negativa', () => {
    const out = buildTavilyExcludeDomains({
      seenThisRun: ['claro.com.co', 'https://www.bancolombia.com/'],
      negativeMemory: ['exito.com'],
    });
    const tail = out.domains.slice(TAVILY_STATIC_EXCLUDE_DOMAINS.length);
    assert.deepEqual(tail, ['claro.com.co', 'bancolombia.com', 'exito.com']);
    assert.equal(out.seenThisRunCount, 2);
    assert.equal(out.negativeMemoryCount, 1);
  });

  it('normaliza y no repite dominios', () => {
    const out = buildTavilyExcludeDomains({
      seenThisRun: ['WWW.Claro.com.co', 'claro.com.co', 'linkedin.com'],
      negativeMemory: ['claro.com.co', '', '   '],
    });
    assert.equal(new Set(out.domains).size, out.domains.length);
    assert.equal(out.seenThisRunCount, 1);
    assert.equal(out.negativeMemoryCount, 0);
  });

  it('nunca supera el tope documentado de 150 y cuenta lo que no cupo', () => {
    const many = Array.from({ length: 300 }, (_, i) => `empresa${i}.com`);
    const out = buildTavilyExcludeDomains({ seenThisRun: many.slice(0, 100), negativeMemory: many.slice(100) });
    assert.equal(out.domains.length, TAVILY_EXCLUDE_DOMAINS_MAX);
    assert.equal(out.staticCount + out.seenThisRunCount + out.negativeMemoryCount, TAVILY_EXCLUDE_DOMAINS_MAX);
    assert.equal(out.truncatedCount, 300 - out.seenThisRunCount - out.negativeMemoryCount);
    // lo visto en la corrida entra completo antes que la memoria
    assert.equal(out.seenThisRunCount, 100);
  });

  it('es determinista', () => {
    const a = buildTavilyExcludeDomains({ seenThisRun: ['a.com', 'b.com'], negativeMemory: ['c.com'] });
    const b = buildTavilyExcludeDomains({ seenThisRun: ['a.com', 'b.com'], negativeMemory: ['c.com'] });
    assert.deepEqual(a, b);
  });
});

describe('TAVILY_STATIC_EXCLUDE_DOMAINS', () => {
  it('cabe con holgura en el tope (deja cupo para lo ya visto)', () => {
    assert.ok(TAVILY_STATIC_EXCLUDE_DOMAINS.length <= 50);
  });

  it('nunca excluye a una institución que es cliente', () => {
    for (const d of TAVILY_STATIC_EXCLUDE_DOMAINS) {
      assert.doesNotMatch(d, /\.(edu|gov|gob)(\.[a-z]{2})?$/, d);
    }
  });

  it('todo lo excluido de antemano lo descartaría el filtro local de todos modos', () => {
    for (const d of TAVILY_STATIC_EXCLUDE_DOMAINS) {
      const verdict = classifySearchResult({ title: 'Página', url: `https://www.${d}/x`, snippet: 'texto' });
      // LinkedIn de empresa es la única excepción del filtro local (tiene su
      // propia búsqueda dirigida); en descubrimiento no aporta sitio oficial.
      if (d === 'linkedin.com') continue;
      assert.equal(verdict.shouldKeep, false, `${d} pasaría el filtro local: se pagaría y luego se tiraría`);
    }
  });
});

// ─── AGENT1-TAVILY-QUERY-SPACE-1 — los huecos se gastan en dominios del país ──

import { isCountryDomain, prioritizeCountryDomains } from '../tavily-exclude-domains';

describe('AGENT1-TAVILY-QUERY-SPACE-1 — memoria negativa priorizada por país', () => {
  it('isCountryDomain reconoce el ccTLD y sus segundos niveles', () => {
    assert.equal(isCountryDomain('ins.gov.co', 'CO'), true);
    assert.equal(isCountryDomain('empresa.com.co', 'CO'), true);
    assert.equal(isCountryDomain('empresa.com.mx', 'CO'), false);
    assert.equal(isCountryDomain('empresa.com', 'CO'), false);
    assert.equal(isCountryDomain('agency.gov', 'US'), true);
    assert.equal(isCountryDomain('empresa.co', null), false);
  });

  it('prioritizeCountryDomains pone primero los del país sin perder ninguno', () => {
    const out = prioritizeCountryDomains(['a.com', 'b.gov.co', 'c.com.mx', 'd.co'], 'CO');
    assert.deepEqual(out, ['b.gov.co', 'd.co', 'a.com', 'c.com.mx']);
  });

  it('con memoria mayor que el tope, entran los del país y se truncan los de fuera', () => {
    const foreign = Array.from({ length: 300 }, (_, i) => `empresa${i}.com.mx`);
    const local = Array.from({ length: 50 }, (_, i) => `entidad${i}.gov.co`);
    const result = buildTavilyExcludeDomains({ seenThisRun: [], negativeMemory: [...foreign, ...local], countryCode: 'CO' });
    for (const d of local) assert.ok(result.domains.includes(d), d);
    assert.equal(result.domains.length, 150);
  });

  it('sin país conserva el orden de siempre', () => {
    const result = buildTavilyExcludeDomains({ seenThisRun: [], negativeMemory: ['x.com', 'y.co'] });
    assert.ok(result.domains.indexOf('x.com') < result.domains.indexOf('y.co'));
  });
});

describe('AGENT1-TAVILY-QUERY-SPACE-1 — dominios de la celda antes que la memoria global', () => {
  it('cellDomains entra después de lo visto en la corrida y antes de la memoria', () => {
    const memory = Array.from({ length: 400 }, (_, i) => `e${i}.gov.co`);
    const result = buildTavilyExcludeDomains({
      seenThisRun: ['vista.gov.co'],
      cellDomains: ['celda.gov.co'],
      negativeMemory: memory,
      countryCode: 'CO',
    });
    assert.ok(result.domains.includes('celda.gov.co'));
    assert.equal(result.cellDomainsCount, 1);
    assert.ok(result.domains.indexOf('vista.gov.co') < result.domains.indexOf('celda.gov.co'));
    assert.ok(result.domains.indexOf('celda.gov.co') < result.domains.indexOf('e0.gov.co'));
  });
});

describe('AGENT1-TAVILY-FIRST-4 — portales de empleo del país de la corrida', () => {
  it('Perú: excluye opcionempleo.com.pe (c530fef3) y sus pares, después del ruido fijo', () => {
    const out = buildTavilyExcludeDomains({ seenThisRun: ['claro.com.pe'], negativeMemory: [], countryCode: 'PE' });
    const extra = out.domains.slice(TAVILY_STATIC_EXCLUDE_DOMAINS.length, TAVILY_STATIC_EXCLUDE_DOMAINS.length + 6);
    assert.ok(extra.includes('opcionempleo.com.pe'));
    assert.ok(extra.includes('bumeran.com.pe'));
    assert.equal(out.domains[TAVILY_STATIC_EXCLUDE_DOMAINS.length + 6], 'claro.com.pe');
    assert.equal(out.staticCount, TAVILY_STATIC_EXCLUDE_DOMAINS.length + 6);
  });
  it('sin país: nada extra', () => {
    const out = buildTavilyExcludeDomains({ seenThisRun: [], negativeMemory: [], countryCode: null });
    assert.deepEqual(out.domains, [...TAVILY_STATIC_EXCLUDE_DOMAINS]);
  });
});
