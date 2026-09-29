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
