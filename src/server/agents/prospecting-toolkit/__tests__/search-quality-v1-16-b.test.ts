/**
 * Tests — Agent 1 v1.16B — Controlled Rich Enrichment Core
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 * Mock provider inyectable.
 *
 * F1  — default disabled → 0 provider calls, 0 payloads
 * F2  — enabled + mock + eligible → provider call 1, result merged
 * F3  — confidence bajo (40 < min 60) → skipped low_confidence, 0 calls
 * F4  — duplicate_guard_blocked → 0 calls
 * F5  — evidence_policy_blocked → 0 calls
 * F6  — vendor / technology_provider → 0 calls
 * F7  — content_provider → 0 calls
 * F8  — missing website/domain → skipped missing_domain_or_website
 * F9  — city found → location.city filled, source not unknown
 * F10 — size found → size.estimated_range filled, status=estimated
 * F11 — not_found → keeps city null and size unknown
 * F12 — no inventar: provider returns vague text sin city/size → city null, size unknown
 * F13 — cap total maxPerBatch=3 con 5 candidatos → calls ≤3
 * F14 — usage payloads generados → feature=rich_profile_enrichment, cost present
 * F15 — provider failed → failed_count incrementa, pipeline no revienta
 * F16 — merge no borra linkedin/evidence/scoring metadata existente
 * F17 — provenance actualizado: enrichment_level=controlled, external_calls_used=true, cost_usd>0
 * F18 — default path preserva v1.16A behavior (no enriquece nada)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  evaluateRichProfileEnrichmentEligibility,
  buildRichProfileEnrichmentQuery,
  mergeRichProfileEnrichmentResult,
  buildRichProfileEnrichmentUsagePayload,
  createMockRichProfileEnrichmentProvider,
  runRichProfileEnrichmentBatch,
} from '../rich-profile-enrichment';
import type {
  RichProfileEnrichmentCandidate,
  RichProfileEnrichmentConfig,
  RichProfileEnrichmentProviderResult,
} from '../rich-profile-enrichment';
import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';
import type { CandidateRichProfileV1 } from '../candidate-rich-profile';

// ─── Clock fijo ───────────────────────────────────────────────────────────────

const FIXED_TS = '2026-06-23T12:00:00.000Z';
const fixedClock = () => FIXED_TS;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildProfile(overrides?: Partial<Parameters<typeof buildCandidateRichProfileV1>[0]>): CandidateRichProfileV1 {
  return buildCandidateRichProfileV1({
    name: 'Acme Corp',
    website: 'https://acmecorp.com',
    domain: 'acmecorp.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    clockFn: fixedClock,
    ...overrides,
  });
}

function baseCandidate(overrides?: Partial<RichProfileEnrichmentCandidate>): RichProfileEnrichmentCandidate {
  return {
    name: 'Acme Corp',
    domain: 'acmecorp.com',
    website: 'https://acmecorp.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    confidenceScore: 75,
    richProfile: buildProfile(),
    ...overrides,
  };
}

function enabledConfig(overrides?: Partial<RichProfileEnrichmentConfig>): RichProfileEnrichmentConfig {
  return {
    ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
    enabled: true,
    provider: 'mock',
    ...overrides,
  };
}

// ─── F1 — Default disabled ────────────────────────────────────────────────────

describe('F1 — default disabled', () => {
  it('no llama al provider cuando config.enabled=false', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0, 'provider no debe ser llamado');
    assert.equal(result.usagePayloads.length, 0, 'sin usage payloads');
    assert.equal(result.enrichedProfiles.length, 0, 'sin perfiles enriquecidos');
    assert.equal(result.batchMetadata.enabled, false);
    assert.equal(result.batchMetadata.attempted_query_count, 0);
  });
});

// ─── F2 — Enabled + mock + eligible ──────────────────────────────────────────

describe('F2 — enabled + mock + eligible candidate', () => {
  it('llama al provider 1 vez y mergea el resultado', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledConfig(),
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 1, 'provider debe ser llamado 1 vez');
    assert.equal(result.enrichedProfiles.length, 1);
    assert.equal(result.usagePayloads.length, 1);
    assert.equal(result.batchMetadata.found_count, 1);
  });
});

// ─── F3 — Confidence bajo ─────────────────────────────────────────────────────

describe('F3 — confidence bajo (40 < minConfidenceScore 60)', () => {
  it('skips con razon low_confidence, 0 llamadas al provider', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidate = baseCandidate({ confidenceScore: 40 });

    const result = await runRichProfileEnrichmentBatch([candidate], {
      config: enabledConfig({ minConfidenceScore: 60 }),
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'low_confidence');
    assert.equal(result.usagePayloads.length, 0);
  });
});

// ─── F4 — duplicate_guard_blocked ────────────────────────────────────────────

describe('F4 — duplicate_guard_blocked', () => {
  it('skips con razon duplicate_guard_blocked, 0 llamadas', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidate = baseCandidate({ isBlockedByDuplicateGuard: true });

    const result = await runRichProfileEnrichmentBatch([candidate], {
      config: enabledConfig(),
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0);
    assert.equal(result.skipped[0].reason, 'duplicate_guard_blocked');
  });
});

// ─── F5 — evidence_policy_blocked ────────────────────────────────────────────

describe('F5 — evidence_policy_blocked', () => {
  it('skips con razon evidence_policy_blocked, 0 llamadas', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidate = baseCandidate({ isBlockedByEvidencePolicy: true });

    const result = await runRichProfileEnrichmentBatch([candidate], {
      config: enabledConfig(),
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0);
    assert.equal(result.skipped[0].reason, 'evidence_policy_blocked');
  });
});

// ─── F6 — vendor / technology_provider ───────────────────────────────────────

describe('F6 — vendor / technology_provider', () => {
  it('vendor: skips con non_sales_relationship', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Vendor Corp',
      domain: 'vendor.com',
      clockFn: fixedClock,
      relationshipType: 'vendor',
      notSalesProspect: true,
    });
    const candidate = baseCandidate({ richProfile: profile });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, false);
    if (!result.eligible) {
      assert.equal(result.reason, 'non_sales_relationship');
    }
  });

  it('technology_provider: skips con non_sales_relationship', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'HubSpot',
      domain: 'hubspot.com',
      clockFn: fixedClock,
    });
    // HubSpot es detectado automáticamente como technology_provider
    const candidate = baseCandidate({ name: 'HubSpot', domain: 'hubspot.com', richProfile: profile });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    // HubSpot → technology_provider → not eligible
    assert.equal(result.eligible, false);
    if (!result.eligible) {
      assert.equal(result.reason, 'non_sales_relationship');
    }
  });
});

// ─── F7 — content_provider ───────────────────────────────────────────────────

describe('F7 — content_provider', () => {
  it('skips con non_sales_relationship', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Coursera',
      domain: 'coursera.org',
      clockFn: fixedClock,
    });
    const candidate = baseCandidate({ name: 'Coursera', domain: 'coursera.org', richProfile: profile });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, false);
    if (!result.eligible) {
      assert.equal(result.reason, 'non_sales_relationship');
    }
  });
});

// ─── F8 — missing website/domain ─────────────────────────────────────────────

describe('F8 — missing website/domain', () => {
  it('skips con missing_domain_or_website', () => {
    const candidate = baseCandidate({ domain: null, website: null });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, false);
    if (!result.eligible) {
      assert.equal(result.reason, 'missing_domain_or_website');
    }
  });
});

// ─── F9 — city found ─────────────────────────────────────────────────────────

describe('F9 — city found', () => {
  it('location.city se llena, source no es unknown', () => {
    const profile = buildProfile();
    const result: RichProfileEnrichmentProviderResult = {
      status: 'found',
      city: 'Bogotá',
      hq_country: 'Colombia',
      evidence_url: 'https://acmecorp.com/about',
      confidence: 80,
    };

    const merged = mergeRichProfileEnrichmentResult(profile, result, { externalCallUsed: true, estimatedCostUsd: 0.01 });

    assert.equal(merged.location.city, 'Bogotá');
    assert.notEqual(merged.location.source, 'unknown');
  });
});

// ─── F10 — size found ────────────────────────────────────────────────────────

describe('F10 — size found', () => {
  it('size.estimated_range se llena, status=estimated', () => {
    const profile = buildProfile();
    const result: RichProfileEnrichmentProviderResult = {
      status: 'found',
      size_range: '201-500',
      confidence: 75,
    };

    const merged = mergeRichProfileEnrichmentResult(profile, result, { externalCallUsed: true, estimatedCostUsd: 0.01 });

    assert.equal(merged.size.estimated_range, '201-500');
    assert.equal(merged.size.status, 'estimated');
  });
});

// ─── F11 — not_found → no changes ────────────────────────────────────────────

describe('F11 — not_found → keeps city null and size unknown', () => {
  it('no modifica location.city ni size cuando status=not_found', () => {
    const profile = buildProfile();
    const result: RichProfileEnrichmentProviderResult = {
      status: 'not_found',
      city: null,
      size_range: null,
    };

    const merged = mergeRichProfileEnrichmentResult(profile, result, { externalCallUsed: true, estimatedCostUsd: 0.01 });

    assert.equal(merged.location.city, null);
    assert.equal(merged.size.status, 'unknown');
    assert.equal(merged.size.estimated_range, null);
  });
});

// ─── F12 — No inventar ───────────────────────────────────────────────────────

describe('F12 — no inventar cuando proveedor retorna texto vago sin city/size', () => {
  it('city null, size unknown cuando resultado no tiene valores concretos', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('vague_no_city_no_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledConfig(),
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 1);
    assert.equal(result.enrichedProfiles.length, 1);
    const enriched = result.enrichedProfiles[0].enrichedProfile;
    assert.equal(enriched.location.city, null, 'no debe inventar ciudad');
    assert.equal(enriched.size.status, 'unknown', 'no debe inventar tamaño');
    assert.equal(enriched.size.estimated_range, null);
  });
});

// ─── F13 — Cap total maxPerBatch ─────────────────────────────────────────────

describe('F13 — cap total maxPerBatch=3 con 5 candidatos elegibles', () => {
  it('provider calls ≤ 3', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = Array.from({ length: 5 }, (_, i) =>
      baseCandidate({
        name: `Company ${i + 1}`,
        domain: `company${i + 1}.com`,
        website: `https://company${i + 1}.com`,
        richProfile: buildProfile({ name: `Company ${i + 1}`, domain: `company${i + 1}.com` }),
      }),
    );

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledConfig({ maxPerBatch: 3 }),
      providerFn,
      clockFn: fixedClock,
    });

    assert.ok(callCount() <= 3, `provider fue llamado ${callCount()} veces, esperado ≤3`);
    assert.equal(result.batchMetadata.attempted_query_count, callCount());
    assert.ok(result.skipped.some((s) => s.reason === 'batch_cap_reached'));
  });
});

// ─── F14 — Usage payloads generados ──────────────────────────────────────────

describe('F14 — usage payloads generados', () => {
  it('feature=rich_profile_enrichment, estimated_cost_usd presente', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledConfig(),
      providerFn,
      unitCostUsd: 0.01,
      batchId: 'test-batch-123',
      userId: 'user-abc',
      clockFn: fixedClock,
    });

    assert.equal(result.usagePayloads.length, 1);
    const payload = result.usagePayloads[0];
    assert.equal(payload.feature, 'rich_profile_enrichment');
    assert.equal(payload.agent, 'agent_1');
    assert.equal(payload.batch_id, 'test-batch-123');
    assert.equal(payload.user_id, 'user-abc');
    assert.ok(typeof payload.estimated_cost_usd === 'number');
    assert.ok(payload.estimated_cost_usd > 0);
    assert.ok(payload.query.includes('Acme Corp'));
    assert.equal(payload.query_type, 'company_profile');
    assert.ok(payload.usage_key.includes('rich_profile_enrichment'));
  });
});

// ─── F15 — Provider failed ────────────────────────────────────────────────────

describe('F15 — provider failed', () => {
  it('failed_count incrementa, pipeline no revienta, perfiles originales preservados', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('failed');
    const candidates = [baseCandidate()];

    let threw = false;
    let result;
    try {
      result = await runRichProfileEnrichmentBatch(candidates, {
        config: enabledConfig(),
        providerFn,
        clockFn: fixedClock,
      });
    } catch {
      threw = true;
    }

    assert.equal(threw, false, 'pipeline no debe lanzar excepción');
    assert.ok(result);
    assert.equal(result.batchMetadata.failed_count, 1);
    assert.equal(result.enrichedProfiles.length, 1);
    // Original profile preserved on failure
    const enriched = result.enrichedProfiles[0].enrichedProfile;
    assert.equal(enriched.location.city, null, 'ciudad no inventada en fallo');
  });
});

// ─── F16 — Merge no borra metadata existente ─────────────────────────────────

describe('F16 — merge no borra linkedin/evidence/scoring metadata', () => {
  it('propiedades existentes del profile se preservan al merge', () => {
    const profile = buildProfile({
      sourceUrl: 'https://linkedin.com/company/acme',
      sourceTitle: 'Acme Corp | LinkedIn',
      sourceSnippet: 'Acme Corp es una empresa B2B de software.',
      confidenceScore: 80,
    });

    const result: RichProfileEnrichmentProviderResult = {
      status: 'found',
      city: 'Bogotá',
      size_range: '51-200',
    };

    const merged = mergeRichProfileEnrichmentResult(profile, result, { externalCallUsed: true, estimatedCostUsd: 0.01 });

    // Enrichment fields filled
    assert.equal(merged.location.city, 'Bogotá');
    assert.equal(merged.size.estimated_range, '51-200');

    // Existing fields preserved
    assert.equal(merged.company.name, profile.company.name);
    assert.equal(merged.company.domain, profile.company.domain);
    assert.equal(merged.confidence.confidence_score, profile.confidence.confidence_score);
    assert.equal(merged.evidence.primary_source_type, profile.evidence.primary_source_type);
    assert.equal(merged.description.short, profile.description.short);
    assert.equal(merged.classification.industry, profile.classification.industry);
    assert.equal(merged.schema_version, 'candidate_rich_profile_v1');
  });
});

// ─── F17 — Provenance actualizado ────────────────────────────────────────────

describe('F17 — provenance actualizado', () => {
  it('enrichment_level=controlled, external_calls_used=true, cost_usd>0 cuando mock-enabled', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledConfig(),
      providerFn,
      unitCostUsd: 0.02,
      clockFn: fixedClock,
    });

    assert.equal(result.enrichedProfiles.length, 1);
    const enriched = result.enrichedProfiles[0].enrichedProfile;
    const prov = enriched.provenance as { enrichment_level: string; external_calls_used: boolean; cost_usd: number };
    assert.equal(prov.enrichment_level, 'controlled');
    assert.equal(prov.external_calls_used, true);
    assert.ok(prov.cost_usd > 0, 'cost_usd debe ser mayor a 0');
  });

  it('enrichment_level=basic, external_calls_used=false en path default (sin enrichment)', () => {
    const profile = buildProfile();
    assert.equal(profile.provenance.enrichment_level, 'basic');
    assert.equal(profile.provenance.external_calls_used, false);
    assert.equal(profile.provenance.cost_usd, 0);
  });
});

// ─── F18 — Default path preserva v1.16A ──────────────────────────────────────

describe('F18 — default path preserva comportamiento v1.16A', () => {
  it('sin override, 0 calls, metadata.rich_profile igual que v1.16A', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    // Default config = disabled
    const result = await runRichProfileEnrichmentBatch(candidates, {
      config: DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
      providerFn,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 0);
    assert.equal(result.usagePayloads.length, 0);

    // v1.16A: city=null, size=unknown, enrichment_level=basic, cost=0
    const originalProfile = candidates[0].richProfile!;
    assert.equal(originalProfile.location.city, null);
    assert.equal(originalProfile.size.status, 'unknown');
    assert.equal(originalProfile.provenance.enrichment_level, 'basic');
    assert.equal(originalProfile.provenance.cost_usd, 0);
    assert.equal(originalProfile.provenance.external_calls_used, false);
  });
});

// ─── Query builder ────────────────────────────────────────────────────────────

describe('Query builder — buildRichProfileEnrichmentQuery', () => {
  it('genera query determinística con nombre y dominio', () => {
    const candidate = baseCandidate({ name: 'Globant', domain: 'globant.com' });
    const query = buildRichProfileEnrichmentQuery(candidate);

    assert.ok(query.includes('"Globant"'), 'debe incluir nombre entre comillas');
    assert.ok(query.includes('"globant.com"'), 'debe incluir dominio entre comillas');
    assert.ok(query.includes('company headquarters employees official'));
  });

  it('genera query sin dominio cuando no hay domain/website', () => {
    const candidate: RichProfileEnrichmentCandidate = {
      name: 'NoWebsite Corp',
      domain: null,
      website: null,
      confidenceScore: 70,
    };
    const query = buildRichProfileEnrichmentQuery(candidate);

    assert.ok(query.includes('"NoWebsite Corp"'));
    assert.ok(query.includes('company headquarters employees official'));
  });
});

// ─── Eligibility gate — casos adicionales ────────────────────────────────────

describe('Eligibility gate — casos adicionales', () => {
  it('sin rich_profile → skips con no_rich_profile', () => {
    const candidate = baseCandidate({ richProfile: null });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, 'no_rich_profile');
  });

  it('city y size ya conocidos → skips con city_and_size_already_known', () => {
    // Crear profile con ciudad y size conocidos via merge
    const baseP = buildProfile();
    const profileWithKnown = mergeRichProfileEnrichmentResult(
      baseP,
      { status: 'found', city: 'Bogotá', size_range: '51-200', confidence: 80 },
      { externalCallUsed: true, estimatedCostUsd: 0.01 },
    );

    const candidate = baseCandidate({ richProfile: profileWithKnown });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, 'city_and_size_already_known');
  });

  it('partner → skips con non_sales_relationship', () => {
    const profile = buildCandidateRichProfileV1({
      name: 'Partner Corp',
      domain: 'partner.com',
      clockFn: fixedClock,
      relationshipType: 'partner',
      notSalesProspect: true,
    });
    const candidate = baseCandidate({ richProfile: profile });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, false);
    if (!result.eligible) assert.equal(result.reason, 'non_sales_relationship');
  });

  it('sales_prospect elegible cuando tiene dominio y richProfile', () => {
    const profile = buildProfile({ relationshipType: 'sales_prospect' });
    const candidate = baseCandidate({ richProfile: profile });
    const config = enabledConfig();

    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);
    assert.equal(result.eligible, true);
  });
});

// ─── Usage payload builder ────────────────────────────────────────────────────

describe('Usage payload contract', () => {
  it('genera payload con todos los campos requeridos', () => {
    const candidate = baseCandidate();
    const config = enabledConfig();
    const providerResult: RichProfileEnrichmentProviderResult = {
      status: 'found',
      city: 'Bogotá',
      evidence_url: 'https://example.com',
      confidence: 80,
    };

    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate,
      query: '"Acme Corp" "acmecorp.com" company headquarters employees official',
      config,
      providerResult,
      estimatedCostUsd: 0.01,
      batchId: 'batch-xyz',
      userId: 'user-123',
      createdAt: FIXED_TS,
    });

    assert.equal(payload.feature, 'rich_profile_enrichment');
    assert.equal(payload.agent, 'agent_1');
    assert.equal(payload.query_type, 'company_profile');
    assert.equal(payload.batch_id, 'batch-xyz');
    assert.equal(payload.user_id, 'user-123');
    assert.equal(payload.candidate_name, 'Acme Corp');
    assert.equal(payload.candidate_domain, 'acmecorp.com');
    assert.equal(payload.estimated_cost_usd, 0.01);
    assert.equal(payload.selected_status, 'found');
    assert.equal(payload.selected_url, 'https://example.com');
    assert.ok(payload.usage_key.includes('rich_profile_enrichment'));
    assert.equal(payload.created_at, FIXED_TS);
  });

  it('status=skipped cuando providerResult=null', () => {
    const payload = buildRichProfileEnrichmentUsagePayload({
      candidate: baseCandidate(),
      query: 'test query',
      config: enabledConfig(),
      providerResult: null,
      estimatedCostUsd: 0,
      batchId: null,
      userId: null,
      createdAt: FIXED_TS,
    });

    assert.equal(payload.status, 'skipped');
    assert.equal(payload.selected_status, 'skipped');
  });
});

// ─── Batch metadata ───────────────────────────────────────────────────────────

describe('Batch metadata', () => {
  it('contiene conteos correctos con mix de resultados', async () => {
    const { providerFn: foundFn } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const { providerFn: notFoundFn } = createMockRichProfileEnrichmentProvider('not_found');

    // Test found path
    const foundResult = await runRichProfileEnrichmentBatch([baseCandidate({ name: 'C1', domain: 'c1.com', richProfile: buildProfile({ name: 'C1', domain: 'c1.com' }) })], {
      config: enabledConfig(),
      providerFn: foundFn,
      clockFn: fixedClock,
    });

    assert.equal(foundResult.batchMetadata.found_count, 1);
    assert.equal(foundResult.batchMetadata.not_found_count, 0);
    assert.equal(foundResult.batchMetadata.provider, 'mock');

    // Test not_found path
    const notFoundResult = await runRichProfileEnrichmentBatch([baseCandidate({ name: 'C2', domain: 'c2.com', richProfile: buildProfile({ name: 'C2', domain: 'c2.com' }) })], {
      config: enabledConfig(),
      providerFn: notFoundFn,
      clockFn: fixedClock,
    });

    assert.equal(notFoundResult.batchMetadata.not_found_count, 1);
    assert.equal(notFoundResult.batchMetadata.found_count, 0);
  });
});

// ─── Mock provider scenarios ──────────────────────────────────────────────────

describe('Mock provider — todos los scenarios', () => {
  const scenarios = ['found_city_and_size', 'partial_city_only', 'partial_size_only', 'not_found', 'failed', 'vague_no_city_no_size'] as const;

  for (const scenario of scenarios) {
    it(`scenario ${scenario} no lanza excepción`, async () => {
      const { providerFn } = createMockRichProfileEnrichmentProvider(scenario);
      let threw = false;
      try {
        await providerFn(baseCandidate(), 'test query');
      } catch {
        threw = true;
      }
      assert.equal(threw, false);
    });
  }

  it('partial_city_only → solo city, no size', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('partial_city_only');
    const res = await providerFn(baseCandidate(), 'test');
    assert.equal(res.status, 'partial');
    assert.ok(res.city);
    assert.equal(res.size_range, null);
  });

  it('partial_size_only → solo size, no city', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('partial_size_only');
    const res = await providerFn(baseCandidate(), 'test');
    assert.equal(res.status, 'partial');
    assert.equal(res.city, null);
    assert.ok(res.size_range);
  });
});
