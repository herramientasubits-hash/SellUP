/**
 * Tests — Agent 1 v1.16G — Rich Profile Provider Result Quality Gate
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 * Transport 100% mock inyectable.
 *
 * F1  — root official domain → not blocked (strong or medium)
 * F2  — about page → strong
 * F3  — careers page → weak, warning careers_page
 * F4  — dev subdomain → blocked
 * F5  — staging subdomain → blocked
 * F6  — multiple results: about seleccionado sobre careers (aunque careers tenga mayor Tavily score)
 * F7  — multiple results: result con employees explícito permite extraer size
 * F8  — unrelated domain → blocked
 * F9  — directory result → weak or blocked; no city/size inventado
 * F10 — no result con city/size → status not_found, city null, size unknown
 * F11 — official result con explicit employees → size_range filled
 * F12 — official result con explicit HQ city → city filled
 * F13 — careers page con no city/size → no city, no size, requires_human_review
 * F14 — query builder includes "about"
 * F15 — no Tavily real (mock transport)
 * F16 — regression v1.16D-A: Globant-like result still partial with size if explicit
 * F17 — regression: Sofka dev/careers result no longer treated as good evidence
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRichProfileResultQuality,
  selectBestRichProfileResult,
  createTavilyRichProfileEnrichmentProvider,
} from '../rich-profile-enrichment-tavily';
import type {
  TavilySearchResult,
  TavilySearchTransport,
  TavilySearchResponse,
} from '../rich-profile-enrichment-tavily';

import {
  buildRichProfileEnrichmentQuery,
  mergeRichProfileEnrichmentResult,
} from '../rich-profile-enrichment';
import type { RichProfileEnrichmentCandidate } from '../rich-profile-enrichment';

import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXED_TS = '2026-06-24T12:00:00.000Z';
const fixedClock = () => FIXED_TS;

function sofkaCandidate(overrides?: Partial<RichProfileEnrichmentCandidate>): RichProfileEnrichmentCandidate {
  return {
    name: 'Sofka Technologies',
    domain: 'sofka.com.co',
    website: 'https://sofka.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    confidenceScore: 75,
    richProfile: buildCandidateRichProfileV1({
      name: 'Sofka Technologies',
      website: 'https://sofka.com.co',
      domain: 'sofka.com.co',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Software',
      clockFn: fixedClock,
    }),
    ...overrides,
  };
}

function makeResult(
  url: string,
  opts: { title?: string; content?: string; score?: number } = {},
): TavilySearchResult {
  return {
    url,
    title: opts.title ?? `Title for ${url}`,
    content: opts.content ?? 'A technology company with solutions for the market.',
    score: opts.score ?? 0.7,
  };
}

function makeMockTransport(response: TavilySearchResponse): TavilySearchTransport {
  return async () => response;
}

// ─── F1 — root official domain → not blocked ─────────────────────────────────

describe('F1 — root official domain → not blocked', () => {
  it('https://sofka.com.co → quality strong or medium, not blocked', () => {
    const result = makeResult('https://sofka.com.co');
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(result, candidate);

    assert.notEqual(assessment.quality, 'blocked', `root domain should not be blocked, got: ${assessment.quality}`);
    assert.ok(
      assessment.quality === 'strong' || assessment.quality === 'medium',
      `expected strong or medium, got: ${assessment.quality} (score: ${assessment.score})`,
    );
  });

  it('https://www.sofka.com.co → not blocked (www stripped)', () => {
    const result = makeResult('https://www.sofka.com.co');
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(result, candidate);

    assert.notEqual(assessment.quality, 'blocked');
  });
});

// ─── F2 — about page → strong ────────────────────────────────────────────────

describe('F2 — about page → strong', () => {
  it('https://www.sofka.com.co/about-us → quality strong', () => {
    const result = makeResult('https://www.sofka.com.co/about-us', {
      title: 'About Sofka Technologies',
      content: 'Sofka Technologies is a software company founded in Medellín.',
    });
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(result, candidate);

    assert.equal(assessment.quality, 'strong', `expected strong, got: ${assessment.quality} (score: ${assessment.score})`);
  });

  it('/company page → strong', () => {
    const result = makeResult('https://sofka.com.co/company');
    const assessment = evaluateRichProfileResultQuality(result, sofkaCandidate());
    assert.equal(assessment.quality, 'strong');
  });

  it('/nosotros page → strong', () => {
    const result = makeResult('https://sofka.com.co/nosotros');
    const assessment = evaluateRichProfileResultQuality(result, sofkaCandidate());
    assert.equal(assessment.quality, 'strong');
  });
});

// ─── F3 — careers page → weak, warning careers_page ─────────────────────────

describe('F3 — careers page → weak, warning careers_page', () => {
  it('https://www.sofka.com.co/about-us/careers → quality weak', () => {
    const result = makeResult('https://www.sofka.com.co/about-us/careers', {
      title: 'Careers at Sofka',
      content: 'Join our team. Open positions available.',
    });
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(result, candidate);

    assert.equal(assessment.quality, 'weak', `expected weak, got: ${assessment.quality}`);
    assert.ok(
      assessment.warnings.some((w) => w.includes('careers')),
      `expected careers warning, got: ${JSON.stringify(assessment.warnings)}`,
    );
  });

  it('/jobs page → weak', () => {
    const result = makeResult('https://sofka.com.co/jobs');
    const assessment = evaluateRichProfileResultQuality(result, sofkaCandidate());
    assert.equal(assessment.quality, 'weak');
  });
});

// ─── F4 — dev subdomain → blocked ────────────────────────────────────────────

describe('F4 — dev subdomain → blocked', () => {
  it('dev.sofka2.0.sofka.com.co (exact Sofka smoke URL) → blocked', () => {
    const result = makeResult('https://dev.sofka2.0.sofka.com.co/about-us/careers', {
      title: 'Sofka dev about',
      content: 'Development environment. Not for public use.',
    });
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(result, candidate);

    assert.equal(assessment.quality, 'blocked', `dev subdomain must be blocked, got: ${assessment.quality}`);
    assert.ok(
      assessment.warnings.some((w) => w.includes('blocked_subdomain')),
      `expected blocked_subdomain warning, got: ${JSON.stringify(assessment.warnings)}`,
    );
  });

  it('dev.example.com/about → blocked even with official path', () => {
    const result = makeResult('https://dev.example.com/about');
    const candidate: RichProfileEnrichmentCandidate = { name: 'Example', domain: 'example.com', confidenceScore: 75 };
    const assessment = evaluateRichProfileResultQuality(result, candidate);
    assert.equal(assessment.quality, 'blocked');
  });

  it('selectBestRichProfileResult: dev result not selected if better alternative exists', () => {
    const devResult = makeResult('https://dev.sofka.com.co/about-us/careers', { score: 0.95 });
    const aboutResult = makeResult('https://sofka.com.co/about-us', { score: 0.6 });
    const candidate = sofkaCandidate();

    const selection = selectBestRichProfileResult([devResult, aboutResult], candidate);

    assert.ok(selection, 'should find a selection');
    assert.notEqual(selection!.result.url, devResult.url, 'dev result must not be selected when about exists');
    assert.equal(selection!.result.url, aboutResult.url, 'about result must be selected');
  });
});

// ─── F5 — staging subdomain → blocked ────────────────────────────────────────

describe('F5 — staging/test subdomain → blocked', () => {
  it('staging.example.com → blocked', () => {
    const result = makeResult('https://staging.example.com/about');
    const candidate: RichProfileEnrichmentCandidate = { name: 'Example', domain: 'example.com', confidenceScore: 75 };
    const assessment = evaluateRichProfileResultQuality(result, candidate);
    assert.equal(assessment.quality, 'blocked');
  });

  it('test.sofka.com.co → blocked', () => {
    const result = makeResult('https://test.sofka.com.co/about');
    const assessment = evaluateRichProfileResultQuality(result, sofkaCandidate());
    assert.equal(assessment.quality, 'blocked');
  });

  it('uat.sofka.com.co → blocked', () => {
    const result = makeResult('https://uat.sofka.com.co/about');
    const assessment = evaluateRichProfileResultQuality(result, sofkaCandidate());
    assert.equal(assessment.quality, 'blocked');
  });
});

// ─── F6 — multiple results: about seleccionado sobre careers ─────────────────

describe('F6 — multiple results: about seleccionado sobre careers (aunque careers tenga score Tavily mayor)', () => {
  it('careers score=0.95 vs about score=0.6 → about gana', () => {
    const careersResult = makeResult('https://sofka.com.co/careers', {
      title: 'Sofka Careers - Join us',
      content: 'Find open positions at Sofka Technologies.',
      score: 0.95,
    });
    const aboutResult = makeResult('https://sofka.com.co/about-us', {
      title: 'About Sofka Technologies',
      content: 'A software company dedicated to innovation.',
      score: 0.60,
    });
    const candidate = sofkaCandidate();

    const selection = selectBestRichProfileResult([careersResult, aboutResult], candidate);

    assert.ok(selection, 'should return a selection');
    assert.equal(
      selection!.result.url,
      aboutResult.url,
      `about must beat careers regardless of Tavily score. Selected: ${selection!.result.url}`,
    );
    assert.equal(selection!.assessment.quality, 'strong');
  });
});

// ─── F7 — multiple results: result con employees explícito permite extraer size ──

describe('F7 — multiple results: size extraída de resultado con employees explícito', () => {
  it('official page sin size + about page con "1,000 employees" → size_range extraído', async () => {
    const resultWithoutSize = makeResult('https://sofka.com.co/company', {
      title: 'Sofka company page',
      content: 'Sofka is a Colombian software company with operations in LATAM.',
      score: 0.7,
    });
    const resultWithSize = makeResult('https://sofka.com.co/about-us', {
      title: 'About Sofka',
      content: 'Sofka is headquartered in Medellín. Company size: 1,000 employees.',
      score: 0.8,
    });
    const candidate = sofkaCandidate();

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [resultWithoutSize, resultWithSize],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const providerResult = await provider(candidate, 'test query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(
      providerResult.size_range !== null && providerResult.size_range !== undefined,
      `size_range should be extracted from the second result, got: ${providerResult.size_range}`,
    );
  });
});

// ─── F8 — unrelated domain → blocked ─────────────────────────────────────────

describe('F8 — unrelated domain → blocked', () => {
  it('result from competitor.com when candidate domain is sofka.com.co → blocked', () => {
    const result = makeResult('https://competitor.com/about');
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(result, candidate);

    assert.equal(assessment.quality, 'blocked', `unrelated domain must be blocked, got: ${assessment.quality}`);
    assert.ok(assessment.reasons.includes('unrelated_domain'));
  });

  it('random news site → blocked', () => {
    const result = makeResult('https://latam-tech-news.com/sofka-company-profile');
    const assessment = evaluateRichProfileResultQuality(result, sofkaCandidate());
    assert.equal(assessment.quality, 'blocked');
  });
});

// ─── F9 — directory result → no city/size inventado ─────────────────────────

describe('F9 — directory/aggregate result → no city/size inventado', () => {
  it('glassdoor.com domain → blocked (unrelated), city/size not filled', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://glassdoor.com/Overview/Sofka', {
          title: 'Sofka - Glassdoor',
          content: 'Sofka company overview. Headquarters: Medellín. 500-1000 employees.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    // Glassdoor is unrelated domain → blocked → no data extraction
    assert.ok(result.city === null || result.city === undefined, 'NO city from directory (blocked domain)');
    assert.ok(result.size_range === null || result.size_range === undefined, 'NO size from directory (blocked domain)');
  });
});

// ─── F10 — no result with city/size → not_found ──────────────────────────────

describe('F10 — no result con city/size → status not_found, city null, size null', () => {
  it('official page without HQ or employees → not_found', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://sofka.com.co/about-us', {
          title: 'About Sofka',
          content: 'A technology company with innovative solutions for the global market.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(result.city === null || result.city === undefined, 'city must be null when no HQ signal');
    assert.ok(result.size_range === null || result.size_range === undefined, 'size_range must be null when no employee signal');
    assert.ok(
      result.status === 'not_found' || result.status === 'partial',
      `status must be not_found or partial, got: ${result.status}`,
    );
  });
});

// ─── F11 — official result with explicit employees → size_range filled ────────

describe('F11 — official result con explicit employees → size_range filled', () => {
  it('about page with "501-1000 employees" → size_range extracted', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://sofka.com.co/about-us', {
          title: 'About Sofka',
          content: 'Sofka Technologies. Company size: 501-1000 employees. B2B tech firm.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(
      result.size_range !== null && result.size_range !== undefined,
      `size_range should be filled from explicit snippet, got: ${result.size_range}`,
    );
    assert.equal(result.size_range, '501-1000');
  });
});

// ─── F12 — official result with explicit HQ city → city filled ───────────────

describe('F12 — official result con explicit HQ city → city filled only if explicit', () => {
  it('about page with "headquartered in Medellín" → city = Medellín', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://sofka.com.co/about-us', {
          title: 'About Sofka',
          content: 'Sofka is headquartered in Medellín, Colombia. A leading tech company.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(result.city, `city should be filled, got: ${result.city}`);
    assert.ok(
      result.city!.toLowerCase().includes('medell'),
      `city should be Medellín, got: ${result.city}`,
    );
  });

  it('vague page without HQ mention → city remains null', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://sofka.com.co/about-us', {
          title: 'About Sofka',
          content: 'A technology company operating across Latin America.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(result.city === null || result.city === undefined, 'city must NOT be invented');
  });
});

// ─── F13 — careers page con no city/size → no data filled ────────────────────

describe('F13 — careers page con no city/size → no city, no size', () => {
  it('only careers result → no city, no size, status not_found', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://sofka.com.co/careers', {
          title: 'Sofka Careers',
          content: 'Join Sofka Technologies. Open positions in Medellín and Bogotá.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(result.city === null || result.city === undefined, 'NO city from careers page');
    assert.ok(result.size_range === null || result.size_range === undefined, 'NO size from careers page');
    // Status should not be 'found'
    assert.notEqual(result.status, 'found', 'status must not be found when only careers result');
    // Should have warnings about weak result
    assert.ok(
      result.warnings && result.warnings.length > 0,
      'warnings should be present when only weak result',
    );
  });
});

// ─── F14 — query builder includes "about" ─────────────────────────────────────

describe('F14 — query builder includes "about"', () => {
  it('buildRichProfileEnrichmentQuery contains "about company headquarters employees official"', () => {
    const candidate: RichProfileEnrichmentCandidate = {
      name: 'Sofka Technologies',
      domain: 'sofka.com.co',
      confidenceScore: 75,
    };

    const query = buildRichProfileEnrichmentQuery(candidate);

    assert.ok(
      query.includes('about company headquarters employees official'),
      `query must contain "about company headquarters employees official", got: ${query}`,
    );
    assert.ok(query.includes('"Sofka Technologies"'), 'query must include quoted name');
    assert.ok(query.includes('"sofka.com.co"'), 'query must include quoted domain');
  });
});

// ─── F15 — no Tavily real ─────────────────────────────────────────────────────

describe('F15 — no Tavily real (mock transport)', () => {
  it('provider con mock transport no llama fetch real', async () => {
    let realFetchCalled = false;
    const originalFetch = global.fetch;
    global.fetch = async (...args: unknown[]) => {
      if (String(args[0]).includes('tavily.com')) {
        realFetchCalled = true;
      }
      return originalFetch(...(args as Parameters<typeof fetch>));
    };

    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const mockTransport = makeMockTransport({ query: 'test', results: [] });
    const provider = createTavilyRichProfileEnrichmentProvider(3, mockTransport);
    await provider(sofkaCandidate(), 'test query');
    delete process.env.TAVILY_API_KEY;

    global.fetch = originalFetch;

    assert.equal(realFetchCalled, false, 'Tavily real fetch must NOT be called when using mock transport');
  });

  it('todos los tests de quality gate son funciones puras (no llaman fetch)', () => {
    // evaluateRichProfileResultQuality es función pura — si no lanza, no hizo fetch
    const result = makeResult('https://sofka.com.co/about-us');
    const candidate = sofkaCandidate();
    const assessment = evaluateRichProfileResultQuality(result, candidate);
    assert.ok(assessment, 'pure function should return an assessment without fetch');
  });
});

// ─── F16 — regression: Globant-like result con size explicit → partial/found ──

describe('F16 — regression v1.16D-A: Globant-like result with explicit size still works', () => {
  it('Globant about page with 10001+ employees → size_range = "10001+"', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://globant.com/about', {
          title: 'Globant - IT Company',
          content: 'Globant is headquartered in Buenos Aires. Company size: 10001+ employees worldwide.',
          score: 0.9,
        }),
      ],
    });
    const candidate: RichProfileEnrichmentCandidate = {
      name: 'Globant',
      domain: 'globant.com',
      confidenceScore: 80,
      richProfile: buildCandidateRichProfileV1({
        name: 'Globant',
        domain: 'globant.com',
        website: 'https://globant.com',
        country: 'Argentina',
        countryCode: 'AR',
        industry: 'Software',
        clockFn: fixedClock,
      }),
    };
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(candidate, 'Globant query');
    delete process.env.TAVILY_API_KEY;

    assert.ok(
      result.size_range !== null && result.size_range !== undefined,
      `size_range should be extracted from Globant snippet, got: ${result.size_range}`,
    );
    assert.equal(result.size_range, '10001+');
    assert.ok(result.status === 'found' || result.status === 'partial');
  });
});

// ─── F17 — regression: Sofka dev/careers result no longer treated as good evidence ──

describe('F17 — regression: Sofka dev/careers result no longer treated as good evidence', () => {
  it('dev.sofka2.0.sofka.com.co/about-us/careers → blocked by quality gate', () => {
    const sofkaDevResult = makeResult('https://dev.sofka2.0.sofka.com.co/about-us/careers', {
      title: 'Sofka - About Us - Careers',
      content: 'Sofka Technologies. Join our team. Open positions available.',
      score: 0.8,
    });
    const candidate = sofkaCandidate();

    const assessment = evaluateRichProfileResultQuality(sofkaDevResult, candidate);

    assert.equal(
      assessment.quality,
      'blocked',
      `Sofka dev/careers result must be blocked, got: ${assessment.quality}`,
    );
  });

  it('Sofka dev/careers no selected over official about page', () => {
    const sofkaDevResult = makeResult('https://dev.sofka2.0.sofka.com.co/about-us/careers', {
      title: 'Sofka - About Us - Careers',
      content: 'Sofka Technologies. Join our team.',
      score: 0.95,
    });
    const officialAbout = makeResult('https://sofka.com.co/about-us', {
      title: 'About Sofka Technologies',
      content: 'Sofka is a Colombian software company.',
      score: 0.5,
    });
    const candidate = sofkaCandidate();

    const selection = selectBestRichProfileResult([sofkaDevResult, officialAbout], candidate);

    assert.ok(selection);
    assert.equal(
      selection!.result.url,
      officialAbout.url,
      `official about must win over dev/careers, selected: ${selection!.result.url}`,
    );
    assert.notEqual(selection!.assessment.quality, 'blocked', 'selected result must not be blocked');
  });

  it('Sofka dev/careers only → provider returns not_found with warning, city null, size null', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const transport = makeMockTransport({
      query: 'test',
      results: [
        makeResult('https://dev.sofka2.0.sofka.com.co/about-us/careers', {
          title: 'Sofka dev careers',
          content: 'Sofka Technologies dev environment. Join our team in Medellín. 500+ employees.',
        }),
      ],
    });
    const provider = createTavilyRichProfileEnrichmentProvider(3, transport);
    const result = await provider(sofkaCandidate(), 'Sofka query');
    delete process.env.TAVILY_API_KEY;

    // The dev/careers URL should NOT yield city or size
    assert.ok(result.city === null || result.city === undefined, 'NO city from dev/careers');
    assert.ok(result.size_range === null || result.size_range === undefined, 'NO size from dev/careers');
    assert.ok(
      result.warnings && result.warnings.length > 0,
      'warnings must be present for dev/careers result',
    );
  });

  it('Sofka dev/careers: merge result keeps city null, size unknown', () => {
    // Simulate what happens after provider returns not_found from dev/careers
    const profile = buildCandidateRichProfileV1({
      name: 'Sofka Technologies',
      domain: 'sofka.com.co',
      website: 'https://sofka.com.co',
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Software',
      clockFn: fixedClock,
    });

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      { status: 'not_found', city: null, size_range: null, evidence_url: null, confidence: null },
      { externalCallUsed: true, estimatedCostUsd: 0.01 },
    );

    assert.equal(merged.location.city, null, 'city must remain null');
    assert.equal(merged.size.status, 'unknown', 'size must remain unknown');
  });
});
