/**
 * Q3F-5BB.3 — Lusha read-only preview: núcleo puro.
 *
 * Cubre: request builder + guardrails, validación de subindustria,
 * normalización/gate de calidad, y el core inyectable executeLushaPreview
 * (429, API key faltante, Lusha 400, no writes, no enrich).
 * Node built-in test runner. Sin DOM, sin red, sin servicios reales.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type {
  LushaCompanyProspectingV3Company,
  LushaCompanyProspectingV3Request,
  LushaCompanyProspectingV3Result,
} from '@/server/integrations/lusha-client';
import {
  isSubIndustryValidForSector,
  resolveLushaSectorOption,
  getLushaSectorOptions,
} from '@/server/prospect-batches/lusha-sector-mapping';
import {
  buildLushaPreviewRequest,
  normalizeLushaPreviewCompany,
  normalizeLushaPreviewCompanies,
  executeLushaPreview,
  resolveLushaCountryName,
  type LushaPreviewCriteria,
  type LushaPreviewDeps,
  type LushaPreviewInput,
} from '@/server/prospect-batches/lusha-preview';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInclude(request: LushaCompanyProspectingV3Request) {
  return request.filters?.companies?.include ?? {};
}

function makeCompany(overrides: Partial<LushaCompanyProspectingV3Company> = {}): LushaCompanyProspectingV3Company {
  return {
    id: 'c1',
    name: 'Empresa Demo',
    domain: 'demo.com',
    country: 'Colombia',
    countryIso2: null,
    industry: 'Healthcare',
    employeeCount: 300,
    employeeCountExact: 300,
    employeeCountMin: null,
    employeeCountMax: null,
    linkedinUrl: 'https://linkedin.com/company/demo',
    ...overrides,
  };
}

const HEALTHCARE_CRITERIA: LushaPreviewCriteria = {
  expectedCountryName: 'Colombia',
  expectedCountryIso2: 'CO',
  sectorKey: 'healthcare',
  sectorLabel: 'Salud',
  matchKeywords: resolveLushaSectorOption('healthcare')!.matchKeywords,
  sizeBand: { min: 201, max: 5000 },
  minScore: 70,
};

function okProviderResult(results: LushaCompanyProspectingV3Company[], creditsCharged = 1): LushaCompanyProspectingV3Result {
  return { ok: true, status: 'success', resultsReturned: results.length, creditsCharged, results };
}

// ── A. Request builder + guardrails ────────────────────────────────────────────

describe('A. buildLushaPreviewRequest', () => {
  test('1. incluye mainIndustriesIds', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.deepEqual(getInclude(req).mainIndustriesIds, [11]);
  });

  test('2. incluye subIndustriesIds cuando viene', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11], subIndustryId: 59 });
    assert.deepEqual(getInclude(req).subIndustriesIds, [59]);
  });

  test('3. no incluye subIndustriesIds cuando no viene', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.equal(getInclude(req).subIndustriesIds, undefined);
  });

  test('4. incluye searchText solo cuando viene no vacío', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11], searchText: 'telemedicina' });
    assert.equal(getInclude(req).searchText, 'telemedicina');
  });

  test('5. no incluye searchText vacío / solo espacios', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11], searchText: '   ' });
    assert.equal(getInclude(req).searchText, undefined);
  });

  test('6. page siempre 0', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.equal(req.pagination?.page, 0);
  });

  test('7. size siempre 10', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.equal(req.pagination?.size, 10);
  });

  test('8. no hay forma de forzar size > 10 desde el input (builder lo hardcodea)', () => {
    // El builder no acepta size como parámetro: cualquier input produce size=10.
    const req = buildLushaPreviewRequest({
      countryName: 'Colombia',
      mainIndustriesIds: [11],
      sizeBand: { min: 201, max: 5000 },
      searchText: 'x',
      subIndustryId: 59,
    });
    assert.equal(req.pagination?.size, 10);
  });

  test('9. no emite technologies', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.equal(getInclude(req).technologies, undefined);
  });

  test('10. no emite intentTopics', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.equal(getInclude(req).intentTopics, undefined);
  });

  test('11. no emite signals', () => {
    const req = buildLushaPreviewRequest({ countryName: 'Colombia', mainIndustriesIds: [11] });
    assert.equal('signals' in req, false);
    assert.equal(req.signals, undefined);
  });
});

// ── B. Mapping / subindustria ──────────────────────────────────────────────────

describe('B. subindustria por sector', () => {
  test('12. sector Salud permite sub 59 (Hospitals & Clinics)', () => {
    assert.equal(isSubIndustryValidForSector('healthcare', 59), true);
  });

  test('13. sector Educación permite sub 24 y 23', () => {
    assert.equal(isSubIndustryValidForSector('education', 24), true);
    assert.equal(isSubIndustryValidForSector('education', 23), true);
  });

  test('14. sector Tecnología permite sub 129 (Software Development)', () => {
    assert.equal(isSubIndustryValidForSector('technology', 129), true);
  });

  test('15. subindustria que no pertenece al sector es inválida', () => {
    // 24 (Higher Education) NO pertenece a Salud.
    assert.equal(isSubIndustryValidForSector('healthcare', 24), false);
    assert.equal(isSubIndustryValidForSector('healthcare', null), false);
    assert.equal(isSubIndustryValidForSector('unknown-sector', 59), false);
  });

  test('getLushaSectorOptions expone 3 sectores con label y subindustrias', () => {
    const options = getLushaSectorOptions();
    assert.equal(options.length, 3);
    assert.deepEqual(options.map((o) => o.key), ['healthcare', 'education', 'technology']);
    for (const opt of options) {
      assert.ok(opt.label.length > 0);
      assert.ok(opt.subIndustries.length > 0);
    }
  });
});

// ── C. Normalización / gate ─────────────────────────────────────────────────────

describe('C. normalización y gate', () => {
  test('16. país correcto pasa', () => {
    const c = normalizeLushaPreviewCompany(makeCompany({ country: 'Colombia' }), HEALTHCARE_CRITERIA);
    assert.equal(c.passesGate, true);
    assert.ok(!c.issues.includes('country_mismatch'));
  });

  test('16b. país por ISO2 anidado también pasa', () => {
    const c = normalizeLushaPreviewCompany(makeCompany({ country: null, countryIso2: 'CO' }), HEALTHCARE_CRITERIA);
    assert.equal(c.issues.includes('country_mismatch'), false);
  });

  test('17. país incorrecto falla', () => {
    const c = normalizeLushaPreviewCompany(makeCompany({ country: 'Mexico', countryIso2: 'MX' }), HEALTHCARE_CRITERIA);
    assert.equal(c.passesGate, false);
    assert.ok(c.issues.includes('country_mismatch'));
  });

  test('18. dominio faltante falla', () => {
    const c = normalizeLushaPreviewCompany(makeCompany({ domain: null }), HEALTHCARE_CRITERIA);
    assert.equal(c.passesGate, false);
    assert.ok(c.issues.includes('missing_domain'));
  });

  test('19. duplicado por dominio se marca', () => {
    const list = normalizeLushaPreviewCompanies(
      [
        makeCompany({ id: 'a', domain: 'acme.com' }),
        makeCompany({ id: 'b', domain: 'www.acme.com' }), // mismo dominio normalizado
      ],
      HEALTHCARE_CRITERIA,
    );
    assert.equal(list[0].issues.includes('duplicate_domain'), false);
    assert.equal(list[1].issues.includes('duplicate_domain'), true);
    assert.equal(list[1].passesGate, false);
  });

  test('20. employee exact fuera de rango: warning tolerante, no fail si el resto está bien', () => {
    // exact=50 fuera de banda 201–5000; país+dominio+industria OK.
    const c = normalizeLushaPreviewCompany(
      makeCompany({ employeeCount: 50, employeeCountExact: 50 }),
      HEALTHCARE_CRITERIA,
    );
    assert.ok(c.issues.includes('employees_out_of_range'));
    assert.equal(c.passesGate, true); // 100 - 15 = 85 >= 70
  });

  test('21. score >= 70 pasa', () => {
    const c = normalizeLushaPreviewCompany(makeCompany(), HEALTHCARE_CRITERIA);
    assert.ok(c.score >= 70);
    assert.equal(c.passesGate, true);
  });

  test('22. score bajo falla (sin dominio ni país)', () => {
    const c = normalizeLushaPreviewCompany(
      makeCompany({ domain: null, country: 'Mexico', countryIso2: 'MX' }),
      HEALTHCARE_CRITERIA,
    );
    assert.ok(c.score < 70);
    assert.equal(c.passesGate, false);
  });

  test('resolveLushaCountryName mapea código a nombre inglés Lusha', () => {
    assert.equal(resolveLushaCountryName('CO'), 'Colombia');
    assert.equal(resolveLushaCountryName('MX'), 'Mexico');
    assert.equal(resolveLushaCountryName('ZZ'), null);
  });
});

// ── D. executeLushaPreview (core inyectable) ────────────────────────────────────

describe('D. executeLushaPreview boundaries', () => {
  const baseInput: LushaPreviewInput = {
    countryCode: 'CO',
    sectorKey: 'healthcare',
    subIndustryId: null,
    sizeBandKey: '201-5000',
    searchText: null,
  };

  test('23. solo usa resolveApiKey + searchCompanies (sin dependencias de escritura)', async () => {
    let apiKeyCalls = 0;
    let searchCalls = 0;
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => {
        apiKeyCalls++;
        return 'fake-key';
      },
      searchCompanies: async () => {
        searchCalls++;
        return okProviderResult([makeCompany()]);
      },
    };
    // Las únicas dos capacidades del core son lectura de key + búsqueda.
    // No existe ninguna dependencia de write/enrich/hubspot en la superficie.
    assert.deepEqual(Object.keys(deps).sort(), ['resolveApiKey', 'searchCompanies']);
    const res = await executeLushaPreview(deps, baseInput);
    assert.equal(res.ok, true);
    assert.equal(apiKeyCalls, 1);
    assert.equal(searchCalls, 1);
  });

  test('24. la request a Lusha es de prospecting (no enrich) con guardrails', async () => {
    let captured: LushaCompanyProspectingV3Request | null = null;
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => 'fake-key',
      searchCompanies: async (_key, req) => {
        captured = req;
        return okProviderResult([makeCompany()]);
      },
    };
    await executeLushaPreview(deps, baseInput);
    assert.ok(captured);
    const req = captured as LushaCompanyProspectingV3Request;
    assert.equal(req.pagination?.page, 0);
    assert.equal(req.pagination?.size, 10);
    assert.equal('signals' in req, false);
    assert.equal(getInclude(req).technologies, undefined);
    assert.equal(getInclude(req).intentTopics, undefined);
    assert.deepEqual(getInclude(req).mainIndustriesIds, [11]);
  });

  test('subindustria inválida se descarta con warning (no se envía)', async () => {
    let captured: LushaCompanyProspectingV3Request | null = null;
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => 'fake-key',
      searchCompanies: async (_key, req) => {
        captured = req;
        return okProviderResult([]);
      },
    };
    const res = await executeLushaPreview(deps, { ...baseInput, subIndustryId: 24 }); // 24 = Educación
    assert.ok(res.warnings.includes('subindustry_not_in_sector'));
    assert.ok(captured);
    const req = captured as LushaCompanyProspectingV3Request;
    assert.equal(getInclude(req).subIndustriesIds, undefined);
    assert.equal(res.requestSummary.subIndustryId, null);
  });

  test('25. maneja 429 (rate limited)', async () => {
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => 'fake-key',
      searchCompanies: async () => ({ ok: false, status: 'rate_limited', resultsReturned: 0 }),
    };
    const res = await executeLushaPreview(deps, baseInput);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'rate_limited');
    assert.ok(res.warnings.includes('rate_limited'));
  });

  test('26. maneja API key faltante (provider_unavailable) sin llamar a searchCompanies', async () => {
    let searchCalls = 0;
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => null,
      searchCompanies: async () => {
        searchCalls++;
        return okProviderResult([]);
      },
    };
    const res = await executeLushaPreview(deps, baseInput);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'provider_unavailable');
    assert.equal(searchCalls, 0);
  });

  test('27. maneja Lusha 400 (provider_error)', async () => {
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => 'fake-key',
      searchCompanies: async () => ({
        ok: false,
        status: 'provider_error',
        httpStatus: 400,
        resultsReturned: 0,
        errorMessage: 'bad request',
      }),
    };
    const res = await executeLushaPreview(deps, baseInput);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'provider_error');
  });

  test('sector no soportado → missing_mapping (sin llamar a Lusha)', async () => {
    let searchCalls = 0;
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => 'fake-key',
      searchCompanies: async () => {
        searchCalls++;
        return okProviderResult([]);
      },
    };
    const res = await executeLushaPreview(deps, { ...baseInput, sectorKey: 'nope' });
    assert.equal(res.status, 'missing_mapping');
    assert.equal(searchCalls, 0);
  });

  test('success con creditsCharged expuesto en billing (máx 1)', async () => {
    const deps: LushaPreviewDeps = {
      resolveApiKey: async () => 'fake-key',
      searchCompanies: async () => okProviderResult([makeCompany()], 1),
    };
    const res = await executeLushaPreview(deps, baseInput);
    assert.equal(res.status, 'success');
    assert.equal(res.billing.creditsCharged, 1);
    assert.equal(res.billing.expectedMaxCredits, 1);
    assert.equal(res.results.length, 1);
  });
});
