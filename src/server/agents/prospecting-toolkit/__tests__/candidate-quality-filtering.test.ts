// Tests — Candidate quality filtering calibration — Hito 16AB.43.22
//
// Validates that the noise-filter correctly distinguishes valid company candidates
// from editorial content, blog/help paths, and associations. Also verifies that
// company names containing words like "Business", "School", "Software", "Enterprise",
// or "Solutions" are not incorrectly blocked by isSentenceOrPhraseName.
//
// No real Tavily, Apollo, HubSpot, or LLM calls. All tests use in-memory fixtures.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterNoiseResults,
  isSentenceOrPhraseName,
} from '@/server/agents/prospecting-toolkit/noise-filter';
import type { WebSearchResult } from '@/server/agents/prospecting-toolkit/types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeResult(
  url: string,
  title: string,
  snippet?: string,
): WebSearchResult {
  return { url, title, snippet: snippet ?? null, rank: 1, provider: 'mock' };
}

// ── Fixture 1: 4 valid + 3 editorial titles + 2 blog/help + 1 association ────

const FIXTURE_MIXED_10: WebSearchResult[] = [
  // 4 valid corporate candidates
  makeResult('https://www.axented.com/', 'Axented'),
  makeResult('https://www.siesa.com/', 'Siesa ERP Colombia'),
  makeResult('https://www.loggro.com/', 'Loggro'),
  makeResult('https://puntored.co/', 'Puntored'),

  // 3 editorial titles — blocked by CONTENT_PAGE_TITLE_SIGNALS or EDITORIAL_TITLE_START_RE
  makeResult('https://articulos.co/', 'Guía y reseñas de software ERP 2024'),
  makeResult('https://content.co/', '5 Ventajas Definitivas del ERP para Pymes'),
  makeResult('https://softwaretech.co/', 'Tendencias del ERP en Colombia 2025'),

  // 2 blog/help paths — blocked by BLOG_PATH_PATTERNS
  makeResult('https://empresa.co/blog/erp-2025', 'ERP Colombia'),
  makeResult('https://empresa.co/help/primeros-pasos', 'Primeros pasos con el software'),

  // 1 association/catalog source — blocked by ASSOCIATION_CHAMBER_DOMAINS
  makeResult('https://fedesoft.org/miembros', 'Fedesoft - Software Colombia'),
];

describe('22.B.1 — Fixture 1: 4 valid + 6 noise (mixed types)', () => {
  it('exactly 4 results pass the noise filter', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    assert.equal(result.keptCount, 4, `Expected 4 kept, got ${result.keptCount}. Kept: ${result.kept.map((r) => r.url).join(', ')}`);
  });

  it('exactly 6 results are filtered out', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    assert.equal(result.filteredCount, 6, `Expected 6 filtered, got ${result.filteredCount}`);
  });

  it('by_result_type is populated with filtered counts', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    const total = Object.values(result.by_result_type).reduce((a, b) => a + b, 0);
    assert.equal(total, 6, `by_result_type counts should sum to 6 filtered results, got ${total}`);
  });

  it('by_result_type includes content_page entries for editorial titles', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    const contentPage = result.by_result_type['content_page'] ?? 0;
    assert.ok(contentPage >= 3, `Expected at least 3 content_page discards, got ${contentPage}`);
  });

  it('by_result_type includes blog_article entries for blog/help paths', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    const blogArticle = result.by_result_type['blog_article'] ?? 0;
    assert.ok(blogArticle >= 2, `Expected at least 2 blog_article discards, got ${blogArticle}`);
  });

  it('by_result_type includes association_or_chamber entry for fedesoft', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    const assoc = result.by_result_type['association_or_chamber'] ?? 0;
    assert.ok(assoc >= 1, `Expected at least 1 association_or_chamber discard, got ${assoc}`);
  });

  it('valid company URLs are among the kept results', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    const keptUrls = result.kept.map((r) => r.url);
    assert.ok(keptUrls.some((u) => u.includes('axented.com')), 'axented.com should be kept');
    assert.ok(keptUrls.some((u) => u.includes('siesa.com')), 'siesa.com should be kept');
    assert.ok(keptUrls.some((u) => u.includes('loggro.com')), 'loggro.com should be kept');
    assert.ok(keptUrls.some((u) => u.includes('puntored.co')), 'puntored.co should be kept');
  });
});

// ── Fixture 2: 7 valid + 3 known-noise domains ───────────────────────────────

const FIXTURE_MOSTLY_VALID_10: WebSearchResult[] = [
  // 7 valid corporate candidates
  makeResult('https://www.axented.com/', 'Axented'),
  makeResult('https://www.siesa.com/', 'Siesa'),
  makeResult('https://www.loggro.com/', 'Loggro'),
  makeResult('https://innowise.com/', 'Innowise'),
  makeResult('https://puntored.co/', 'Puntored'),
  makeResult('https://mokev.net/', 'Mokev'),
  makeResult('https://loopay.co/', 'Loopay'),

  // 3 known-noise sources
  makeResult('https://computrabajo.com/empresas', 'Empleos TI Colombia'),     // job_board
  makeResult('https://semana.com/tecnologia/erp', 'Las mejores ERP en 2025'), // news_or_media
  makeResult('https://capterra.com/erp-software/', 'Top ERP Software'),       // software_directory
];

describe('22.B.2 — Fixture 2: 7 valid + 3 known-noise domains', () => {
  it('exactly 7 results pass the noise filter', () => {
    const result = filterNoiseResults(FIXTURE_MOSTLY_VALID_10);
    assert.equal(result.keptCount, 7, `Expected 7 kept, got ${result.keptCount}. Kept: ${result.kept.map((r) => r.url).join(', ')}`);
  });

  it('exactly 3 results are filtered out', () => {
    const result = filterNoiseResults(FIXTURE_MOSTLY_VALID_10);
    assert.equal(result.filteredCount, 3, `Expected 3 filtered, got ${result.filteredCount}`);
  });

  it('by_result_type counts sum to 3', () => {
    const result = filterNoiseResults(FIXTURE_MOSTLY_VALID_10);
    const total = Object.values(result.by_result_type).reduce((a, b) => a + b, 0);
    assert.equal(total, 3, `by_result_type should sum to 3, got ${total}`);
  });

  it('job_board is counted in by_result_type', () => {
    const result = filterNoiseResults(FIXTURE_MOSTLY_VALID_10);
    const jobBoard = result.by_result_type['job_board'] ?? 0;
    assert.ok(jobBoard >= 1, `Expected at least 1 job_board, got ${jobBoard}`);
  });

  it('news_or_media is counted in by_result_type', () => {
    const result = filterNoiseResults(FIXTURE_MOSTLY_VALID_10);
    const media = result.by_result_type['news_or_media'] ?? 0;
    assert.ok(media >= 1, `Expected at least 1 news_or_media, got ${media}`);
  });

  it('software_directory is counted in by_result_type', () => {
    const result = filterNoiseResults(FIXTURE_MOSTLY_VALID_10);
    const softDir = result.by_result_type['software_directory'] ?? 0;
    assert.ok(softDir >= 1, `Expected at least 1 software_directory, got ${softDir}`);
  });
});

// ── Fixture 3: Company names with generic words must not be blocked ───────────
//
// Validates that isSentenceOrPhraseName does NOT block valid company names
// that contain common English/Spanish business words. These names appeared
// as possibly valid candidates from Corrida 3 analysis.

const VALID_COMPANY_NAMES_WITH_GENERIC_WORDS = [
  'IEBS Business School',
  'Loggro Enterprise',
  'Educa EdTech Group',
  'Siesa',
  'Innowise',
  'Mastercard',
  'Intive',
  'Axented',
  'Mokev',
  'CELA Business Solutions',
  'Pragma Software',
  'PSL Corp',
];

describe('22.B.3 — Valid company names with generic words must not be blocked', () => {
  for (const name of VALID_COMPANY_NAMES_WITH_GENERIC_WORDS) {
    it(`isSentenceOrPhraseName("${name}") returns false`, () => {
      assert.equal(
        isSentenceOrPhraseName(name),
        false,
        `"${name}" was incorrectly identified as a sentence/phrase — valid company names with words like Business, School, Software, Enterprise, Solutions must not be blocked`,
      );
    });
  }
});

// ── Fixture 4: Sentence/phrase names must be blocked ─────────────────────────
//
// Ensures that names which ARE sentences or editorial phrases remain blocked
// after any calibration changes.

// Note: "Colombia está conquistando el mercado EdTech" starts with a proper noun
// so isSentenceOrPhraseName cannot detect it deterministically without risking
// false positives on valid company names starting with country names. That case
// is handled by the LLM evaluator downstream.
const SENTENCE_NAMES_TO_BLOCK = [
  'Trabajamos por fortalecer y representar al sector TI',
  'La fintech Cobre será la primera en recibir',
  'Fortaleciendo el ecosistema EdTech en Colombia',
  'Guía y reseñas de las mejores plataformas',
  'Cómo elegir el mejor software ERP para tu empresa',
  'Las mejores empresas de tecnología en Bogotá 2025',
];

describe('22.B.4 — Sentence/phrase names remain blocked after calibration', () => {
  for (const name of SENTENCE_NAMES_TO_BLOCK) {
    it(`isSentenceOrPhraseName("${name}") returns true`, () => {
      assert.equal(
        isSentenceOrPhraseName(name),
        true,
        `"${name}" was not identified as a sentence/phrase — editorial content must remain blocked`,
      );
    });
  }
});

// ── Fixture 5: by_result_type structure integrity ────────────────────────────

describe('22.B.5 — by_result_type structure integrity', () => {
  it('empty input returns empty by_result_type', () => {
    const result = filterNoiseResults([]);
    assert.deepEqual(result.by_result_type, {});
  });

  it('all-valid input returns empty by_result_type', () => {
    const allValid: WebSearchResult[] = [
      makeResult('https://axented.com/', 'Axented'),
      makeResult('https://siesa.com/', 'Siesa'),
    ];
    const result = filterNoiseResults(allValid);
    assert.deepEqual(result.by_result_type, {});
    assert.equal(result.keptCount, 2);
    assert.equal(result.filteredCount, 0);
  });

  it('by_result_type keys are valid WebSearchResultType values', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    const validTypes = new Set([
      'official_company_site', 'company_profile', 'directory', 'marketplace',
      'job_board', 'blog_article', 'content_page', 'social_post', 'social_page',
      'software_directory', 'startup_database', 'business_database',
      'association_or_chamber', 'event_or_congress', 'academic_source',
      'pdf_document', 'news_or_media', 'sector_report', 'non_prospectable_source', 'unknown',
    ]);
    for (const key of Object.keys(result.by_result_type)) {
      assert.ok(validTypes.has(key), `Unexpected result type key: "${key}"`);
    }
  });

  it('by_result_type values are positive integers', () => {
    const result = filterNoiseResults(FIXTURE_MIXED_10);
    for (const [key, count] of Object.entries(result.by_result_type)) {
      assert.ok(typeof count === 'number' && count > 0, `by_result_type["${key}"] = ${count} is not a positive integer`);
    }
  });
});
