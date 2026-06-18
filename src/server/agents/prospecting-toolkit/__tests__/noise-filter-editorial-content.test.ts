/**
 * Tests — Editorial content + help/docs path blocking (Hito 16AB.43.21)
 *
 * Verifica §9 del hito:
 *   9.1 Títulos editoriales de Corrida 2 son bloqueados
 *   9.2 Paths de blog/ayuda/docs en dominios corporativos son bloqueados
 *   9.3 Páginas help/support (ej. zendesk.es/help/...) son bloqueadas
 *   9.4 Empresas válidas de Corrida 2 siguen pasando los filtros
 *   9.5 Batch mixto: solo persisten candidatos válidos
 *
 * Uses Node.js built-in test runner. Sin IA, sin red, sin DB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySearchResult,
  isProspectableCompanyResult,
} from '../noise-filter';
import type { WebSearchResult } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<WebSearchResult>): WebSearchResult {
  return {
    title: 'Empresa Test',
    url: 'https://empresa.com',
    rank: 1,
    provider: 'mock',
    ...overrides,
  };
}

// ── 9.1 Títulos editoriales de Corrida 2 bloqueados ──────────────────────────

describe('9.1 — Corrida 2 editorial titles are blocked', () => {
  it('blocks "Guía y reseñas" title (EDITORIAL_TITLE_START_RE)', () => {
    const r = makeResult({
      title: 'Guía y reseñas',
      url: 'https://zendesk.es/',
    });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
    assert.equal(c.resultType, 'content_page');
  });

  it('blocks "5 Ventajas Definitivas del Nearshore" title (RANKING_TITLE_RE listicle)', () => {
    const r = makeResult({
      title: '5 Ventajas Definitivas del Nearshore',
      url: 'https://desarrollodesoftware.com.co/',
    });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
  });

  it('blocks "Soluciones y estrategia de tecnología" title (CONTENT_PAGE_TITLE_SIGNALS)', () => {
    const r = makeResult({
      title: 'Soluciones y estrategia de tecnología para tu empresa',
      url: 'https://sisinternational.com/',
    });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
  });

  it('blocks "Cómo mejorar la estrategia tecnológica" title (EDITORIAL_TITLE_START_RE)', () => {
    const r = makeResult({
      title: 'Cómo mejorar la estrategia tecnológica de tu empresa',
      url: 'https://empresa.com/',
    });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
  });

  it('blocks "Beneficios del software de gestión" title (EDITORIAL_TITLE_START_RE)', () => {
    const r = makeResult({
      title: 'Beneficios del software de gestión empresarial',
      url: 'https://empresa.co/',
    });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
  });

  it('blocks "Tendencias del sector tecnológico" title (SECTOR_REPORT_TITLE_SIGNALS)', () => {
    const r = makeResult({
      title: 'Tendencias del sector tecnológico 2025',
      url: 'https://empresa.com/',
    });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
  });

  it('isProspectableCompanyResult also blocks editorial titles', () => {
    const r = makeResult({
      title: 'Guía y reseñas de software empresarial',
      url: 'https://empresa.com/',
    });
    const res = isProspectableCompanyResult(r);
    assert.equal(res.isProspectable, false);
    assert.equal(res.resultType, 'content_page');
  });
});

// ── 9.2 Paths de blog/ayuda/docs en dominios corporativos bloqueados ──────────

describe('9.2 — Help/docs paths on corporate domains are blocked', () => {
  it('blocks /blog/ path on a corporate domain', () => {
    const r = makeResult({ url: 'https://empresa.com/blog/articulo-sobre-tecnologia' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks /help/ path on a corporate domain (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/help/getting-started' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks /docs/ path on a corporate domain (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/docs/api-reference' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks /academy/ path on a corporate domain (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/academy/curso-erp' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks /learn/ path on a corporate domain (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/learn/what-is-crm' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks /knowledge/ path on a corporate domain (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/knowledge/faq-general' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks /support/ path on a corporate domain (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/support/tickets' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });
});

// ── 9.3 Páginas help/support de plataformas conocidas bloqueadas ──────────────

describe('9.3 — Help/support pages on any domain are blocked', () => {
  it('blocks zendesk.es/help/... (detected in Corrida 2)', () => {
    const r = makeResult({
      title: 'Guía y reseñas',
      url: 'https://zendesk.es/help/es/articles/123456',
    });
    // Either title OR path should trigger the block
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected blocked, got: ${c.reason}`);
  });

  it('blocks brand.com/support/tickets', () => {
    const r = makeResult({ url: 'https://brand.com/support/how-to-open-ticket' });
    assert.equal(classifySearchResult(r).shouldKeep, false);
  });

  it('blocks empresa.com/docs/... via /docs/ path pattern (nuevo 16AB.43.21)', () => {
    const r = makeResult({ url: 'https://empresa.com/docs/api-reference' });
    const c = classifySearchResult(r);
    assert.equal(c.shouldKeep, false, `Expected /docs/ path to be blocked, got: ${c.reason}`);
  });
});

// ── 9.4 Empresas válidas de Corrida 2 siguen pasando ─────────────────────────

describe('9.4 — Valid Corrida 2 companies still pass the filter', () => {
  it('passes mokev.net via classifySearchResult (no blog/content patterns matched)', () => {
    // Note: isProspectableCompanyResult uses a strict TLD allowlist that excludes .net —
    // this is pre-existing filter design, not broken by 16AB.43.21.
    // classifySearchResult (the primary noise gate) correctly keeps it.
    const r = makeResult({
      title: 'Mokev — Soluciones tecnológicas',
      url: 'https://mokev.net/',
    });
    assert.equal(classifySearchResult(r).shouldKeep, true);
  });

  it('passes innowise.com (official company site)', () => {
    const r = makeResult({
      title: 'Innowise Group — Software Development',
      url: 'https://innowise.com/',
    });
    assert.equal(classifySearchResult(r).shouldKeep, true);
    assert.equal(isProspectableCompanyResult(r).isProspectable, true);
  });

  it('passes axented.com (official company site)', () => {
    const r = makeResult({
      title: 'Axented — Digital transformation',
      url: 'https://axented.com/',
    });
    assert.equal(classifySearchResult(r).shouldKeep, true);
    assert.equal(isProspectableCompanyResult(r).isProspectable, true);
  });

  it('passes siesa.com (ERP software company)', () => {
    const r = makeResult({
      title: 'SIESA — Software empresarial para Colombia',
      url: 'https://siesa.com/',
    });
    assert.equal(classifySearchResult(r).shouldKeep, true);
    assert.equal(isProspectableCompanyResult(r).isProspectable, true);
  });

  it('passes mastercard.com (global corporate homepage)', () => {
    const r = makeResult({
      title: 'Mastercard — Connecting Everyone to Priceless Possibilities',
      url: 'https://mastercard.com/',
    });
    assert.equal(classifySearchResult(r).shouldKeep, true);
  });
});

// ── 9.5 Batch mixto: solo persisten candidatos válidos ───────────────────────

describe('9.5 — Mixed batch: only valid candidates survive', () => {
  const BATCH: WebSearchResult[] = [
    // Valid companies
    makeResult({ title: 'Mokev — Tech', url: 'https://mokev.net/' }),
    makeResult({ title: 'Innowise Group', url: 'https://innowise.com/' }),
    makeResult({ title: 'Axented Digital', url: 'https://axented.com/' }),
    makeResult({ title: 'SIESA ERP', url: 'https://siesa.com/' }),
    makeResult({ title: 'GlobalTech Colombia', url: 'https://globaltech.com.co/' }),
    // Editorial / content results (should be blocked)
    makeResult({ title: 'Guía y reseñas de herramientas', url: 'https://zendesk.es/help/123' }),
    makeResult({ title: '5 Ventajas Definitivas del Nearshore', url: 'https://dev.com.co/' }),
    makeResult({ title: 'Soluciones y estrategia de tecnología', url: 'https://sis.com/' }),
    makeResult({ title: 'Cómo elegir el mejor software', url: 'https://blog.empresa.com/' }),
    makeResult({ title: 'Tendencias del sector TI 2025', url: 'https://empresa.com/' }),
    makeResult({ title: 'Top 10 empresas de software en Colombia', url: 'https://ranking.co/' }),
  ];

  it('keeps exactly the 5 valid companies, blocks 6 editorial/content results', () => {
    const kept = BATCH.filter((r) => classifySearchResult(r).shouldKeep);
    const blocked = BATCH.filter((r) => !classifySearchResult(r).shouldKeep);
    assert.equal(kept.length, 5, `Expected 5 kept, got ${kept.length}: ${kept.map((r) => r.title).join(', ')}`);
    assert.equal(blocked.length, 6, `Expected 6 blocked, got ${blocked.length}`);
  });

  it('all blocked results have resultType content_page, blog_article, directory, or sector_report', () => {
    const CONTENT_TYPES = new Set(['content_page', 'blog_article', 'directory', 'sector_report']);
    const blocked = BATCH.filter((r) => !classifySearchResult(r).shouldKeep);
    for (const r of blocked) {
      const c = classifySearchResult(r);
      assert.ok(
        CONTENT_TYPES.has(c.resultType),
        `"${r.title}" blocked with unexpected type: ${c.resultType}`,
      );
    }
  });
});
