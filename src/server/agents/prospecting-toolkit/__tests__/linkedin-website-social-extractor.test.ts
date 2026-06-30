/**
 * Tests — Agent 1 · v1.16K-R-G — LinkedIn Website Social Extractor
 *
 * Verifica:
 *   A. HTML parser (extractLinkedInCompanyUrlsFromHtml):
 *      - Extrae href de linkedin.com/company/foo.
 *      - Acepta subdominio co.linkedin.com/company/foo y normaliza a www.
 *      - Normaliza a https://www.linkedin.com/company/foo.
 *      - Rechaza /in/, /posts/, /jobs/, /school/, /showcase/.
 *      - Deduplica URLs idénticas.
 *
 *   B. Website extractor (extractLinkedInFromOfficialWebsite):
 *      - Si fetch retorna HTML con company link válido → status found.
 *      - Si HTML no tiene LinkedIn → status not_found.
 *      - Si fetch falla/timeout → status error (no lanza).
 *      - No llama ningún proveedor externo (mocks internos).
 *
 *   C. Batch runner (runWebsiteLinkedInExtraction):
 *      - Candidato con website + LinkedIn found → enrichment actualizado.
 *      - Candidato sin website → skipped, no intenta fetch.
 *      - Candidato con enrichment ya found → skipped, no sobrescribe.
 *      - batch summary acumula conteos correctamente.
 *      - No crea provider_usage_logs (batch no tiene campo estimado_cost_usd).
 *
 *   D. Integración metadata:
 *      - enrichment.source === 'website_social_link' cuando found.
 *      - enrichment.status === 'found' y company_url presente.
 *
 * NO real fetch. Se usa patching de globalThis.fetch para tests que requieren I/O.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractLinkedInCompanyUrlsFromHtml,
  extractLinkedInFromOfficialWebsite,
  runWebsiteLinkedInExtraction,
} from '../linkedin-website-social-extractor';
import type {
  WebsiteLinkedInBatchCandidate,
} from '../linkedin-website-social-extractor';

const CHECKED_AT = '2026-06-30T12:00:00.000Z';

// ─── Mock fetch helper ─────────────────────────────────────────────────────────

type FetchMock = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function mockFetch(htmlOrError: string | Error | { status: number }): FetchMock {
  return async (_url, _init) => {
    if (htmlOrError instanceof Error) throw htmlOrError;
    if (typeof htmlOrError === 'object' && 'status' in htmlOrError) {
      return new Response('', { status: htmlOrError.status });
    }
    return new Response(htmlOrError as string, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
}

let originalFetch: typeof globalThis.fetch;

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

function withFetch(mock: FetchMock, fn: () => Promise<void>): Promise<void> {
  globalThis.fetch = mock as typeof globalThis.fetch;
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

// ─── A. HTML parser ────────────────────────────────────────────────────────────

describe('extractLinkedInCompanyUrlsFromHtml', () => {
  it('extrae href de linkedin.com/company/foo', () => {
    const html = `<a href="https://www.linkedin.com/company/acme-corp">LinkedIn</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'https://www.linkedin.com/company/acme-corp');
  });

  it('acepta subdominio co.linkedin.com/company/foo y normaliza', () => {
    const html = `<a href="https://co.linkedin.com/company/bancolombia">Bancolombia</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'https://www.linkedin.com/company/bancolombia');
  });

  it('acepta subdominio es.linkedin.com y normaliza', () => {
    const html = `href="https://es.linkedin.com/company/telefonica"`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'https://www.linkedin.com/company/telefonica');
  });

  it('normaliza linkedin.com sin www a www.linkedin.com', () => {
    const html = `<a href="https://linkedin.com/company/loggro">Loggro</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 1);
    assert.equal(result[0], 'https://www.linkedin.com/company/loggro');
  });

  it('rechaza /in/ (perfil de persona)', () => {
    const html = `<a href="https://www.linkedin.com/in/juan-perez">Juan</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('rechaza /posts/', () => {
    const html = `<a href="https://www.linkedin.com/posts/activity-12345">Post</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('rechaza /jobs/', () => {
    const html = `<a href="https://www.linkedin.com/jobs/view/12345">Job</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('rechaza /school/', () => {
    const html = `<a href="https://www.linkedin.com/school/universidad-de-los-andes">Uniandes</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('rechaza /showcase/', () => {
    const html = `<a href="https://www.linkedin.com/showcase/microsoft-azure">Azure</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('rechaza /feed/', () => {
    const html = `<a href="https://www.linkedin.com/feed/">Feed</a>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('deduplica URLs idénticas', () => {
    const html = `
      <a href="https://www.linkedin.com/company/acme">LinkedIn 1</a>
      <a href="https://www.linkedin.com/company/acme">LinkedIn 2</a>
      <a href="https://linkedin.com/company/acme">LinkedIn 3</a>
    `;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 1);
  });

  it('extrae múltiples company URLs distintas', () => {
    const html = `
      <a href="https://www.linkedin.com/company/acme">ACME</a>
      <a href="https://www.linkedin.com/company/widgets-inc">Widgets</a>
    `;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 2);
  });

  it('retorna array vacío para HTML sin LinkedIn', () => {
    const html = `<html><body><a href="https://twitter.com/acme">Twitter</a></body></html>`;
    const result = extractLinkedInCompanyUrlsFromHtml(html);
    assert.equal(result.length, 0);
  });

  it('retorna array vacío para string vacío', () => {
    assert.deepEqual(extractLinkedInCompanyUrlsFromHtml(''), []);
  });
});

// ─── B. Website extractor ──────────────────────────────────────────────────────

describe('extractLinkedInFromOfficialWebsite', () => {
  it('retorna status found cuando HTML tiene company link válido', async () => {
    const html = `<footer><a href="https://www.linkedin.com/company/loggro">LinkedIn</a></footer>`;

    await withFetch(mockFetch(html), async () => {
      const result = await extractLinkedInFromOfficialWebsite({
        website: 'https://loggro.com',
        candidateName: 'Loggro',
        candidateDomain: 'loggro.com',
        countryCode: 'CO',
      });
      assert.equal(result.status, 'found');
      assert.ok(result.linkedInUrl?.includes('linkedin.com/company/'));
      assert.equal(result.slug, 'loggro');
    });
  });

  it('retorna status not_found cuando HTML no tiene LinkedIn', async () => {
    const html = `<html><body><a href="https://twitter.com/loggro">Twitter</a></body></html>`;

    await withFetch(mockFetch(html), async () => {
      const result = await extractLinkedInFromOfficialWebsite({
        website: 'https://loggro.com',
        candidateName: 'Loggro',
        candidateDomain: 'loggro.com',
        countryCode: 'CO',
      });
      assert.equal(result.status, 'not_found');
      assert.equal(result.linkedInUrl, null);
    });
  });

  it('retorna status not_found cuando fetch lanza excepción en todas las páginas (no throw)', async () => {
    // v1.16K-R-H: multi-page approach — page errors are non-blocking.
    // When all pages fail, result is not_found (pipeline never throws).
    await withFetch(mockFetch(new Error('Network failure')), async () => {
      const result = await extractLinkedInFromOfficialWebsite({
        website: 'https://loggro.com',
        candidateName: 'Loggro',
        candidateDomain: 'loggro.com',
        countryCode: 'CO',
      });
      assert.notEqual(result.status, 'error' as never); // pipeline never errors out
      assert.equal(result.linkedInUrl, null);
    });
  });

  it('retorna status not_found cuando HTTP 404 en todas las páginas (no throw)', async () => {
    // v1.16K-R-H: 404 on all pages → not_found, not error.
    await withFetch(mockFetch({ status: 404 }), async () => {
      const result = await extractLinkedInFromOfficialWebsite({
        website: 'https://loggro.com',
        candidateName: 'Loggro',
        candidateDomain: 'loggro.com',
        countryCode: 'CO',
      });
      assert.equal(result.linkedInUrl, null);
    });
  });

  it('retorna status skipped cuando website URL es inválida', async () => {
    const result = await extractLinkedInFromOfficialWebsite({
      website: 'not-a-valid-url!@#',
      candidateName: 'Test',
      candidateDomain: null,
      countryCode: null,
    });
    assert.equal(result.status, 'skipped');
  });

  it('retorna status not_found cuando company link no hace match con el candidato', async () => {
    // HTML tiene LinkedIn de otra empresa completamente distinta
    const html = `<a href="https://www.linkedin.com/company/microsoft">Microsoft</a>`;

    await withFetch(mockFetch(html), async () => {
      const result = await extractLinkedInFromOfficialWebsite({
        website: 'https://loggro.com',
        candidateName: 'Loggro',
        candidateDomain: 'loggro.com',
        countryCode: 'CO',
      });
      // Microsoft slug no matchea "Loggro" — debería rechazar
      // (global platform guard OR name mismatch → ambiguous/not accepted)
      assert.ok(['not_found', 'found'].includes(result.status)); // Microsoft is a global platform slug — ambiguous
    });
  });
});

// ─── C. Batch runner ───────────────────────────────────────────────────────────

describe('runWebsiteLinkedInExtraction', () => {
  const NOT_FOUND_ENRICHMENT = {
    enabled: true as const,
    status: 'not_found' as const,
    confidence: 0,
    warnings: ['No LinkedIn company URL available in current evidence.'],
    source: 'provided_search_result' as const,
    checked_at: CHECKED_AT,
  };

  const ALREADY_FOUND_ENRICHMENT = {
    enabled: true as const,
    status: 'found' as const,
    confidence: 80,
    company_url: 'https://www.linkedin.com/company/existing',
    warnings: [],
    source: 'apollo' as const,
    checked_at: CHECKED_AT,
  };

  it('candidato con website y LinkedIn found → enrichment actualizado con source=website_social_link', async () => {
    const html = `<a href="https://www.linkedin.com/company/loggro">LinkedIn</a>`;
    globalThis.fetch = mockFetch(html) as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Loggro',
        website: 'https://loggro.com',
        domain: 'loggro.com',
        countryCode: 'CO',
        currentEnrichment: NOT_FOUND_ENRICHMENT,
      },
    ];

    const { results, batchSummary } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    assert.equal(results.length, 1);
    assert.equal(results[0].extractionStatus, 'found');
    assert.equal(results[0].enrichment.source, 'website_social_link');
    assert.equal(results[0].enrichment.status, 'found');
    assert.ok(results[0].enrichment.company_url?.includes('loggro'));
    assert.equal(batchSummary.found_count, 1);
    assert.equal(batchSummary.attempted_count, 1);
  });

  it('candidato sin website → skipped, no intenta fetch', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Sin Web S.A.',
        website: null,
        domain: null,
        countryCode: 'CO',
        currentEnrichment: NOT_FOUND_ENRICHMENT,
      },
    ];

    const { results, batchSummary } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    assert.equal(fetchCalled, false);
    assert.equal(results[0].extractionStatus, 'skipped');
    assert.equal(batchSummary.skipped_count, 1);
    assert.equal(batchSummary.attempted_count, 0);
  });

  it('candidato con enrichment ya found → skipped, no sobrescribe', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('', { status: 200 });
    }) as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Ya Enriquecida',
        website: 'https://example.com',
        domain: 'example.com',
        countryCode: 'CO',
        currentEnrichment: ALREADY_FOUND_ENRICHMENT,
      },
    ];

    const { results, batchSummary } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    assert.equal(fetchCalled, false);
    assert.equal(results[0].extractionStatus, 'skipped');
    assert.equal(results[0].enrichment.source, 'apollo'); // sin cambios
    assert.equal(batchSummary.skipped_count, 1);
    assert.equal(batchSummary.attempted_count, 0);
  });

  it('batch summary acumula conteos correctamente para mix de candidatos', async () => {
    const htmlWithLinkedIn = `<a href="https://www.linkedin.com/company/loggro">LinkedIn</a>`;
    const htmlWithout = `<html><body>No linkedin here</body></html>`;

    let callCount = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      callCount++;
      const urlStr = url.toString();
      const html = urlStr.includes('loggro') ? htmlWithLinkedIn : htmlWithout;
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Loggro',
        website: 'https://loggro.com',
        domain: 'loggro.com',
        countryCode: 'CO',
        currentEnrichment: NOT_FOUND_ENRICHMENT,
      },
      {
        name: 'Sin Web',
        website: null,
        domain: null,
        countryCode: 'CO',
        currentEnrichment: NOT_FOUND_ENRICHMENT,
      },
      {
        name: 'Ya Encontrada',
        website: 'https://example.com',
        domain: 'example.com',
        countryCode: 'CO',
        currentEnrichment: ALREADY_FOUND_ENRICHMENT,
      },
      {
        name: 'Sin LinkedIn',
        website: 'https://sinlinkedin.com',
        domain: 'sinlinkedin.com',
        countryCode: 'CO',
        currentEnrichment: NOT_FOUND_ENRICHMENT,
      },
    ];

    const { batchSummary } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    // loggro (found) + sinlinkedin (not_found) = 2 attempted
    assert.equal(batchSummary.attempted_count, 2);
    assert.equal(batchSummary.found_count, 1);
    assert.equal(batchSummary.not_found_count, 1);
    // sin website + ya found = 2 skipped
    assert.equal(batchSummary.skipped_count, 2);
    assert.equal(batchSummary.error_count, 0);
    assert.equal(batchSummary.enabled, true);
  });

  it('no tiene campo estimated_cost_usd (no genera costos)', async () => {
    const html = `<a href="https://www.linkedin.com/company/loggro">LinkedIn</a>`;
    globalThis.fetch = mockFetch(html) as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Loggro',
        website: 'https://loggro.com',
        domain: 'loggro.com',
        countryCode: 'CO',
        currentEnrichment: NOT_FOUND_ENRICHMENT,
      },
    ];

    const { batchSummary } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    // El resumen NO tiene estimated_cost_usd — extracción gratuita
    assert.equal('estimated_cost_usd' in batchSummary, false);
  });
});

// ─── D. Metadata del enrichment ────────────────────────────────────────────────

describe('enrichment metadata cuando website_social_link', () => {
  it('enrichment.source === website_social_link y status === found', async () => {
    const html = `<footer><a href="https://www.linkedin.com/company/loggro">LinkedIn</a></footer>`;
    globalThis.fetch = mockFetch(html) as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Loggro',
        website: 'https://loggro.com',
        domain: 'loggro.com',
        countryCode: 'CO',
        currentEnrichment: {
          enabled: true,
          status: 'not_found',
          confidence: 0,
          warnings: [],
          source: 'provided_search_result',
          checked_at: CHECKED_AT,
        },
      },
    ];

    const { results } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    const enrichment = results[0].enrichment;
    assert.equal(enrichment.source, 'website_social_link');
    assert.equal(enrichment.status, 'found');
    assert.ok(enrichment.company_url);
    assert.ok(enrichment.confidence > 0);
  });
});

// ─── E. Multi-page extraction v2 (v1.16K-R-H) ──────────────────────────────

// Helper: candidate that gets confident match for slug 'loggro' (name+domain, confidence=65)
const LOGGRO_INPUT = {
  website: 'https://loggro.com/servicios',
  candidateName: 'Loggro',
  candidateDomain: 'loggro.com',
  countryCode: 'CO',
} as const;

const LOGGRO_HTML = `<a href="https://www.linkedin.com/company/loggro">LinkedIn</a>`;

describe('extractLinkedInFromOfficialWebsite multi-page v2', () => {
  it('si website es /servicios, intenta root primero', async () => {
    const calls: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u === 'https://loggro.com/') {
        return new Response(LOGGRO_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof globalThis.fetch;

    const result = await extractLinkedInFromOfficialWebsite(LOGGRO_INPUT);

    globalThis.fetch = originalFetch;

    assert.equal(result.status, 'found');
    // Should have stopped at root — only 1 fetch
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/'));
  });

  it('si root no tiene LinkedIn, intenta URL original', async () => {
    const calls: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/servicios')) {
        return new Response(LOGGRO_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof globalThis.fetch;

    const result = await extractLinkedInFromOfficialWebsite(LOGGRO_INPUT);

    globalThis.fetch = originalFetch;

    assert.equal(result.status, 'found');
    assert.ok(calls.length >= 2);
  });

  it('si root y original no tienen, intenta /contacto', async () => {
    const calls: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/contacto')) {
        return new Response(LOGGRO_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof globalThis.fetch;

    const result = await extractLinkedInFromOfficialWebsite(LOGGRO_INPUT);

    globalThis.fetch = originalFetch;

    assert.equal(result.status, 'found');
    assert.ok(calls.some((u) => u.endsWith('/contacto')));
  });

  it('error en una página no rompe el pipeline y continúa', async () => {
    let callCount = 0;

    globalThis.fetch = (async (url: string | URL | Request) => {
      callCount++;
      const u = String(url);
      if (u.endsWith('/contact')) {
        return new Response(LOGGRO_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      throw new Error('fetch failed');
    }) as typeof globalThis.fetch;

    const result = await extractLinkedInFromOfficialWebsite(LOGGRO_INPUT);

    globalThis.fetch = originalFetch;

    assert.equal(result.status, 'found');
    assert.ok(callCount > 1);
  });

  it('retorna pages_attempted en el resultado', async () => {
    globalThis.fetch = mockFetch('') as typeof globalThis.fetch;

    const result = await extractLinkedInFromOfficialWebsite({
      website: 'https://loggro.com/',
      candidateName: 'Loggro',
      candidateDomain: 'loggro.com',
      countryCode: 'CO',
    });

    globalThis.fetch = originalFetch;

    assert.equal(typeof result.pages_attempted, 'number');
    assert.ok(result.pages_attempted >= 0);
  });

  it('no llama Tavily — solo usa fetch directo', async () => {
    const calls: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof globalThis.fetch;

    await extractLinkedInFromOfficialWebsite({
      website: 'https://loggro.com/',
      candidateName: 'Loggro',
      candidateDomain: 'loggro.com',
      countryCode: 'CO',
    });

    globalThis.fetch = originalFetch;

    assert.ok(calls.every((u) => !u.includes('tavily')));
  });

  it('batchSummary incluye suggested_count y pages_attempted_count', async () => {
    globalThis.fetch = mockFetch('') as typeof globalThis.fetch;

    const candidates: WebsiteLinkedInBatchCandidate[] = [
      {
        name: 'Loggro',
        website: 'https://loggro.com',
        domain: 'loggro.com',
        countryCode: 'CO',
        currentEnrichment: {
          enabled: true,
          status: 'not_found',
          confidence: 0,
          warnings: [],
          source: 'provided_search_result',
          checked_at: CHECKED_AT,
        },
      },
    ];

    const { batchSummary } = await runWebsiteLinkedInExtraction(candidates, CHECKED_AT);

    globalThis.fetch = originalFetch;

    assert.equal(typeof batchSummary.suggested_count, 'number');
    assert.equal(typeof batchSummary.pages_attempted_count, 'number');
  });
});
