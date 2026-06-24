/**
 * Tests — Agent 1 v1.16E — Controlled Rich Enrichment Integration Gate
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase real.
 * Mock provider e inyección controlada.
 *
 * F1  — default sin override → 0 provider calls, no rich_profile_enrichment en batch
 * F2  — override enabled + mock + elegible → 1 call, metadata actualizado
 * F3  — override disabled (config.enabled=false) → 0 calls
 * F4  — maxPerBatch=2 con 5 elegibles → calls ≤2
 * F5  — duplicate_guard_blocked → 0 calls para ese candidato
 * F6  — evidence_policy_blocked → 0 calls
 * F7  — low_confidence (score < minConfidenceScore) → skipped low_confidence
 * F8  — vendor / content_provider / technology_provider → non_sales_relationship
 * F9  — missing domain/website → skipped missing_domain_or_website
 * F10 — partial city/size merge → merge correcto
 * F11 — not_found → rich_profile no inventa city/size
 * F12 — provider failed → failed_count incrementa, no crash
 * F13 — metadata preservation: linkedin/scoring/evidence_policy/duplicate_guard presentes
 * F14 — usage payloads generados con campos correctos
 * F15 — tavily + dryRun=false + missing batchId → 0 calls, guard_missing_batch_id
 * F16 — tavily + dryRun=false + missing usageLoggerFn → 0 calls, guard_missing_usage_logger
 * F17 — tavily + dryRun=false + missing unitCostUsd → 0 calls, guard_missing_unit_cost
 * F18 — writeProspectingCandidates pasa richProfileEnrichmentOverride → mock llamado
 * F19 — writeProspectingCandidates sin override → comportamiento legacy intacto
 * F20 — DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG y DEFAULT_LINKEDIN_SEARCH_CONFIG siguen false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
  createMockRichProfileEnrichmentProvider,
  runRichProfileEnrichmentBatch,
  mergeRichProfileEnrichmentResult,
  evaluateRichProfileEnrichmentEligibility,
} from '../rich-profile-enrichment';
import type {
  RichProfileEnrichmentCandidate,
  RichProfileEnrichmentConfig,
} from '../rich-profile-enrichment';

import { DEFAULT_LINKEDIN_SEARCH_CONFIG } from '../linkedin-company-search';
import { buildCandidateRichProfileV1 } from '../candidate-rich-profile';
import type { CandidateRichProfileV1 } from '../candidate-rich-profile';

import { writeProspectingCandidates } from '../candidate-writer';
import type {
  RichProfileEnrichmentOverride,
} from '../candidate-writer';
import type {
  CandidateWriterInput,
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Constants ────────────────────────────────────────────────────────────────

const FIXED_TS = '2026-06-23T12:00:00.000Z';
const fixedClock = () => FIXED_TS;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildProfile(overrides?: Partial<Parameters<typeof buildCandidateRichProfileV1>[0]>): CandidateRichProfileV1 {
  return buildCandidateRichProfileV1({
    name: 'Acme Corp',
    website: 'https://acmecorp.com.co',
    domain: 'acmecorp.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    clockFn: fixedClock,
    ...overrides,
  });
}

function baseCandidate(overrides?: Partial<RichProfileEnrichmentCandidate>): RichProfileEnrichmentCandidate {
  return {
    candidateId: '0',
    name: 'Acme Corp',
    domain: 'acmecorp.com.co',
    website: 'https://acmecorp.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    confidenceScore: 75,
    richProfile: buildProfile(),
    isBlockedByDuplicateGuard: false,
    isBlockedByEvidencePolicy: false,
    ...overrides,
  };
}

function enabledMockConfig(overrides?: Partial<RichProfileEnrichmentConfig>): RichProfileEnrichmentConfig {
  return {
    ...DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
    enabled: true,
    provider: 'mock',
    maxPerBatch: 10,
    maxQueriesPerCandidate: 1,
    minConfidenceScore: 60,
    ...overrides,
  };
}

// ─── Fake admin client for writer integration tests ───────────────────────────

type FakeAdminStats = {
  batchUpdates: Array<Record<string, unknown>>;
  candidateInserts: Array<Record<string, unknown>>;
};

function makeFakeAdmin(stats: FakeAdminStats): SupabaseClient {
  let candSeq = 0;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  // .eq('source', 'agent_1').gte(...) → for buildRecentIdentityKeySet
                  gte: () => Promise.resolve({ data: [], error: null }),
                  // .eq('id', ...).single() → no existing batch
                  single() {
                    return Promise.resolve({ data: null, error: { message: 'Not found' } });
                  },
                };
              },
            };
          },
          insert(_data: Record<string, unknown>) {
            return {
              select(_c: string) {
                return {
                  single() {
                    return Promise.resolve({ data: { id: 'batch-v16e-test' }, error: null });
                  },
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdates.push({ ...data } as Record<string, unknown>);
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }

      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            return {
              in(_col: string, _vals: unknown[]) {
                return {
                  // Thenable: .in('domain', ...) awaited directly (buildNoveltyIndex)
                  then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
                    return Promise.resolve({ data: [], error: null }).then(resolve);
                  },
                  // .in('status').in('domain').limit() for fetchActiveCandidatesForGuard
                  in() {
                    return { limit: () => Promise.resolve({ data: [], error: null }) };
                  },
                  // .in('status').eq('country_code').limit() for fetchActiveCandidatesForGuard
                  eq() {
                    return { limit: () => Promise.resolve({ data: [], error: null }) };
                  },
                  not: () => Promise.resolve({ data: [], error: null }),
                  limit: () => Promise.resolve({ data: [], error: null }),
                };
              },
              not(_col: string, _op: string, _val: unknown) {
                return {
                  then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
                    return Promise.resolve({ data: [], error: null }).then(resolve);
                  },
                  neq: () => Promise.resolve({ data: [], error: null }),
                };
              },
            };
          },
          insert(data: Record<string, unknown>) {
            candSeq++;
            stats.candidateInserts.push({ ...data } as Record<string, unknown>);
            return {
              select(_c: string) {
                return {
                  single() {
                    return Promise.resolve({ data: { id: `cand-v16e-${candSeq}` }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'prospect_candidate_audit') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }

      if (table === 'provider_usage_logs') {
        return {
          select(_cols: string) {
            return { eq: () => Promise.resolve({ data: [], error: null }) };
          },
        };
      }

      return {
        select() { return { eq: () => Promise.resolve({ data: [], error: null }) }; },
        insert() { return Promise.resolve({ data: null, error: null }); },
        update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
      };
    },
  } as unknown as SupabaseClient;
}

// Pipeline candidate that passes all gates (CO, real domain, B2B software snippet)
function makePipelineCandidate(overrides: Partial<ProspectingPipelineCandidate> & { name: string }): ProspectingPipelineCandidate {
  return {
    domain: 'acmecorp.com.co',
    website: 'https://acmecorp.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourceUrl: 'https://acmecorp.com.co',
    sourceTitle: 'Acme Corp — Software ERP para empresas colombianas',
    sourceSnippet: 'Acme Corp es una empresa de software ERP y CRM para el mercado B2B colombiano. Soluciones para PYMES.',
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
    websiteVerification: null,
    duplicateCheck: null,
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 75,
      fitScore: 70,
      dataCompletenessScore: 0.8,
      recommendedAction: 'add_to_pipeline',
      reasons: ['strong_b2b_signal'],
      warnings: [],
      blockers: [],
      fitBreakdown: null,
    },
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function makePipelineOutput(candidates: ProspectingPipelineCandidate[]): ProspectingPipelineOutput {
  return {
    candidates,
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: candidates.length || 1,
      searchDepth: 'standard',
    },
    summary: {
      requested: candidates.length || 1,
      returned: candidates.length,
      highQualityNew: candidates.length,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
    },
    metadata: {
      provider: 'mock',
      pipelineVersion: 'test-v1.16E',
      executedAt: FIXED_TS,
    },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

function makeWriterInput(overrides: Partial<CandidateWriterInput> = {}): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput([]),
    triggeredByUserId: 'user-v16e-test',
    ownerId: 'user-v16e-test',
    source: 'agent_1',
    dryRun: false,
    ...overrides,
  };
}

// ─── F1: default sin override → 0 provider calls ─────────────────────────────

describe('F1 — default sin override → 0 provider calls, no rich_profile_enrichment en batch', () => {
  it('runRichProfileEnrichmentBatch con DEFAULT config → 0 calls, 0 payloads', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate()];

    const output = await runRichProfileEnrichmentBatch(candidates, {
      config: DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG,
      providerFn,
    });

    assert.equal(callCount(), 0);
    assert.equal(output.usagePayloads.length, 0);
    assert.equal(output.enrichedProfiles.length, 0);
    assert.equal(output.batchMetadata.enabled, false);
    assert.equal(output.batchMetadata.attempted_query_count, 0);
  });

  it('writeProspectingCandidates sin override → no rich_profile_enrichment en batch metadata', async () => {
    const stats: FakeAdminStats = { batchUpdates: [], candidateInserts: [] };
    const admin = makeFakeAdmin(stats);
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    await writeProspectingCandidates(
      makeWriterInput({
        pipelineOutput: makePipelineOutput([makePipelineCandidate({ name: 'Acme Corp' })]),
      }),
      admin,
      undefined,
      undefined, // no richProfileEnrichmentOverride
    );

    assert.equal(callCount(), 0, 'provider should not be called without override');

    // Verify batch metadata does NOT contain rich_profile_enrichment
    const lastUpdate = stats.batchUpdates.at(-1);
    assert.ok(lastUpdate, 'batch should have been updated');
    const meta = (lastUpdate['metadata'] ?? {}) as Record<string, unknown>;
    assert.equal(
      Object.prototype.hasOwnProperty.call(meta, 'rich_profile_enrichment'),
      false,
      'batch metadata must not have rich_profile_enrichment when no override',
    );
  });
});

// ─── F2: override enabled + mock + elegible → 1 call ─────────────────────────

describe('F2 — override enabled + mock + elegible → 1 call, metadata actualizado', () => {
  it('runRichProfileEnrichmentBatch: 1 eligible candidate → 1 call, profile merged', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');
    const candidates = [baseCandidate({ candidateId: '0' })];

    const output = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledMockConfig(),
      providerFn,
      batchId: 'batch-test',
      unitCostUsd: 0.01,
      clockFn: fixedClock,
    });

    assert.equal(callCount(), 1, 'provider must be called exactly once');
    assert.equal(output.enrichedProfiles.length, 1);
    assert.equal(output.enrichedProfiles[0].enrichedProfile.location.city, 'Bogotá');
    assert.equal(output.enrichedProfiles[0].enrichedProfile.size.estimated_range, '201-500');
    assert.equal(output.batchMetadata.found_count, 1);
    assert.equal(output.batchMetadata.attempted_query_count, 1);
  });
});

// ─── F3: override disabled → 0 calls ─────────────────────────────────────────

describe('F3 — override disabled (config.enabled=false) → 0 calls', () => {
  it('runRichProfileEnrichmentBatch con enabled=false → 0 calls', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: { ...enabledMockConfig(), enabled: false },
      providerFn,
    });

    assert.equal(callCount(), 0);
    assert.equal(output.enrichedProfiles.length, 0);
    assert.equal(output.batchMetadata.skipped_count, 1);
    assert.ok(output.batchMetadata.skipped_reasons['enrichment_disabled'] >= 1);
  });
});

// ─── F4: maxPerBatch=2 con 5 elegibles → calls ≤2 ────────────────────────────

describe('F4 — maxPerBatch=2 con 5 elegibles → provider calls ≤2', () => {
  it('batch cap limita el número de queries totales', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const candidates = Array.from({ length: 5 }, (_, i): RichProfileEnrichmentCandidate => ({
      candidateId: String(i),
      name: `Company ${i}`,
      domain: `company${i}.com.co`,
      website: `https://company${i}.com.co`,
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Software',
      confidenceScore: 75,
      richProfile: buildProfile({ name: `Company ${i}`, domain: `company${i}.com.co`, website: `https://company${i}.com.co` }),
      isBlockedByDuplicateGuard: false,
      isBlockedByEvidencePolicy: false,
    }));

    const output = await runRichProfileEnrichmentBatch(candidates, {
      config: enabledMockConfig({ maxPerBatch: 2 }),
      providerFn,
      batchId: 'batch-test',
      clockFn: fixedClock,
    });

    assert.ok(callCount() <= 2, `provider calls (${callCount()}) must be ≤ 2`);
    assert.ok(output.batchMetadata.attempted_query_count <= 2);
    assert.ok(output.batchMetadata.skipped_count >= 3);
  });
});

// ─── F5: duplicate_guard_blocked → 0 calls ───────────────────────────────────

describe('F5 — duplicate_guard_blocked → 0 provider calls para ese candidato', () => {
  it('evaluateRichProfileEnrichmentEligibility retorna duplicate_guard_blocked', () => {
    const candidate = baseCandidate({ isBlockedByDuplicateGuard: true });
    const result = evaluateRichProfileEnrichmentEligibility(candidate, enabledMockConfig());
    assert.equal(result.eligible, false);
    assert.equal((result as { eligible: false; reason: string }).reason, 'duplicate_guard_blocked');
  });

  it('runRichProfileEnrichmentBatch: blocked candidato → 0 calls', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const output = await runRichProfileEnrichmentBatch(
      [baseCandidate({ isBlockedByDuplicateGuard: true })],
      { config: enabledMockConfig(), providerFn, batchId: 'batch-test' },
    );

    assert.equal(callCount(), 0);
    assert.ok(output.batchMetadata.skipped_reasons['duplicate_guard_blocked'] >= 1);
  });
});

// ─── F6: evidence_policy_blocked → 0 calls ───────────────────────────────────

describe('F6 — evidence_policy_blocked → 0 provider calls', () => {
  it('evaluateRichProfileEnrichmentEligibility retorna evidence_policy_blocked', () => {
    const candidate = baseCandidate({ isBlockedByEvidencePolicy: true });
    const result = evaluateRichProfileEnrichmentEligibility(candidate, enabledMockConfig());
    assert.equal(result.eligible, false);
    assert.equal((result as { eligible: false; reason: string }).reason, 'evidence_policy_blocked');
  });
});

// ─── F7: low_confidence → skipped ────────────────────────────────────────────

describe('F7 — low_confidence (score < minConfidenceScore) → skipped low_confidence', () => {
  it('candidate con confidenceScore=40 es inelegible (min=60)', () => {
    const candidate = baseCandidate({ confidenceScore: 40 });
    const config = enabledMockConfig({ minConfidenceScore: 60 });
    const result = evaluateRichProfileEnrichmentEligibility(candidate, config);

    assert.equal(result.eligible, false);
    assert.equal((result as { eligible: false; reason: string }).reason, 'low_confidence');
  });
});

// ─── F8: vendor / content_provider / technology_provider → no enriquece ──────

describe('F8 — vendor / content_provider / technology_provider → non_sales_relationship', () => {
  for (const relType of ['vendor', 'content_provider', 'technology_provider'] as const) {
    it(`relationship_type=${relType} → non_sales_relationship`, () => {
      const profile = buildProfile();
      const profileWithRelType: CandidateRichProfileV1 = {
        ...profile,
        classification: { ...profile.classification, relationship_type: relType },
      };
      const candidate = baseCandidate({ richProfile: profileWithRelType });
      const result = evaluateRichProfileEnrichmentEligibility(candidate, enabledMockConfig());

      assert.equal(result.eligible, false);
      assert.equal((result as { eligible: false; reason: string }).reason, 'non_sales_relationship');
    });
  }
});

// ─── F9: missing domain/website → skipped ────────────────────────────────────

describe('F9 — missing domain/website → skipped missing_domain_or_website', () => {
  it('candidate sin domain ni website no es elegible', () => {
    const candidate = baseCandidate({ domain: null, website: null });
    const result = evaluateRichProfileEnrichmentEligibility(candidate, enabledMockConfig());

    assert.equal(result.eligible, false);
    assert.equal((result as { eligible: false; reason: string }).reason, 'missing_domain_or_website');
  });
});

// ─── F10: partial city/size merge → merge correcto ───────────────────────────

describe('F10 — partial city/size merge → merge correcto', () => {
  it('partial_city_only: city se llena, size permanece unknown', () => {
    const profile = buildProfile();

    const result = mergeRichProfileEnrichmentResult(
      profile,
      { status: 'partial', city: 'Medellín', size_range: null, confidence: 60 },
      { externalCallUsed: true, estimatedCostUsd: 0.01 },
    );

    assert.equal(result.location.city, 'Medellín');
    assert.equal(result.size.status, 'unknown');
    assert.equal(result.provenance.enrichment_level, 'controlled');
    assert.equal(result.provenance.external_calls_used, true);
    assert.ok(result.provenance.cost_usd > 0);
  });

  it('partial_size_only: size se llena, city permanece null', () => {
    const profile = buildProfile();

    const result = mergeRichProfileEnrichmentResult(
      profile,
      { status: 'partial', city: null, size_range: '51-200', confidence: 55 },
      { externalCallUsed: true, estimatedCostUsd: 0.01 },
    );

    assert.equal(result.location.city, null);
    assert.equal(result.size.estimated_range, '51-200');
    assert.equal(result.size.status, 'estimated');
  });
});

// ─── F11: not_found → no city/size inventado ─────────────────────────────────

describe('F11 — not_found → rich_profile no inventa city ni size', () => {
  it('runRichProfileEnrichmentBatch not_found → city/size sin cambio', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('not_found');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: enabledMockConfig(),
      providerFn,
      batchId: 'batch-test',
    });

    assert.equal(output.batchMetadata.not_found_count, 1);
    assert.equal(output.enrichedProfiles.length, 1);

    const enriched = output.enrichedProfiles[0].enrichedProfile;
    assert.equal(enriched.location.city, null, 'city debe permanecer null');
    assert.equal(enriched.size.status, 'unknown', 'size debe permanecer unknown');
  });
});

// ─── F12: provider failed → failed_count++, no crash ─────────────────────────

describe('F12 — provider failed → failed_count incrementa, pipeline no revienta', () => {
  it('provider failed no lanza exception al llamador', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('failed');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: enabledMockConfig(),
      providerFn,
      batchId: 'batch-test',
    });

    assert.equal(output.batchMetadata.failed_count, 1);
    assert.equal(output.batchMetadata.found_count, 0);
    // enrichedProfiles still contains an entry for the failed candidate
    assert.equal(output.enrichedProfiles.length, 1);
    assert.equal(output.enrichedProfiles[0].providerResult.status, 'failed');
  });
});

// ─── F13: metadata preservation ──────────────────────────────────────────────

describe('F13 — metadata preservation: linkedin_enrichment, scoring, etc. siguen presentes', () => {
  it('mergeRichProfileEnrichmentResult no borra campos existentes del profile', () => {
    const profile = buildProfile();

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      { status: 'found', city: 'Bogotá', size_range: '201-500', confidence: 80, evidence_url: 'https://acmecorp.com.co/about' },
      { externalCallUsed: true, estimatedCostUsd: 0.01 },
    );

    // Fields from original profile preserved
    assert.equal(merged.company.name, profile.company.name);
    assert.equal(merged.company.domain, profile.company.domain);
    assert.equal(merged.classification.industry, profile.classification.industry);
    assert.equal(merged.confidence.confidence_score, profile.confidence.confidence_score);
    assert.equal(merged.provenance.generated_by, profile.provenance.generated_by);

    // New fields applied
    assert.equal(merged.location.city, 'Bogotá');
    assert.equal(merged.size.estimated_range, '201-500');
    assert.equal(merged.provenance.enrichment_level, 'controlled');
  });

  it('writeProspectingCandidates: candidate metadata preserva linkedin_enrichment y scoring', async () => {
    const stats: FakeAdminStats = { batchUpdates: [], candidateInserts: [] };
    const admin = makeFakeAdmin(stats);
    const { providerFn } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const override: RichProfileEnrichmentOverride = {
      config: enabledMockConfig(),
      providerFn,
      unitCostUsd: 0.01,
    };

    await writeProspectingCandidates(
      makeWriterInput({
        pipelineOutput: makePipelineOutput([makePipelineCandidate({ name: 'Acme Corp' })]),
      }),
      admin,
      undefined,
      override,
    );

    const inserted = stats.candidateInserts[0];
    assert.ok(inserted, 'should have one candidate insert');
    const meta = (inserted['metadata'] ?? {}) as Record<string, unknown>;

    // Original metadata fields must be present
    assert.ok(Object.prototype.hasOwnProperty.call(meta, 'scoring'), 'scoring must be preserved');
    assert.ok(Object.prototype.hasOwnProperty.call(meta, 'linkedin_enrichment'), 'linkedin_enrichment must be preserved');
    assert.ok(Object.prototype.hasOwnProperty.call(meta, 'country_evidence'), 'country_evidence must be preserved');
    assert.ok(Object.prototype.hasOwnProperty.call(meta, 'rich_profile'), 'rich_profile must be present');
  });
});

// ─── F14: usage payloads generados ───────────────────────────────────────────

describe('F14 — usage payloads generados con campos correctos', () => {
  it('payload tiene feature=rich_profile_enrichment, operation_key y cost present', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: enabledMockConfig(),
      providerFn,
      batchId: 'batch-test',
      userId: 'user-test',
      unitCostUsd: 0.01,
      clockFn: fixedClock,
    });

    assert.equal(output.usagePayloads.length, 1);
    const payload = output.usagePayloads[0];
    assert.equal(payload.feature, 'rich_profile_enrichment');
    assert.equal(payload.agent, 'agent_1');
    assert.equal(payload.provider, 'mock');
    assert.ok(payload.estimated_cost_usd >= 0);
    assert.ok(payload.usage_key.includes('rich_profile_enrichment'));
    assert.equal(payload.query_type, 'company_profile');
    assert.equal(payload.batch_id, 'batch-test');
  });
});

// ─── F15: tavily + dryRun=false + missing batchId → guard ────────────────────

describe('F15 — tavily + dryRun=false + missing batchId → 0 calls, guard_missing_batch_id', () => {
  it('production guard bloquea cuando batchId es null', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: { ...enabledMockConfig(), provider: 'tavily' },
      providerFn,
      batchId: null,   // ← missing
      usageLoggerFn: async () => {},
      unitCostUsd: 0.01,
      dryRun: false,
    });

    assert.equal(callCount(), 0, 'provider must not be called without batchId');
    assert.ok(output.batchMetadata.skipped_reasons['guard_missing_batch_id'] >= 1);
    assert.equal(output.batchMetadata.attempted_query_count, 0);
  });
});

// ─── F16: tavily + dryRun=false + missing usageLoggerFn → guard ──────────────

describe('F16 — tavily + dryRun=false + missing usageLoggerFn → 0 calls', () => {
  it('production guard bloquea cuando usageLoggerFn está ausente', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: { ...enabledMockConfig(), provider: 'tavily' },
      providerFn,
      batchId: 'batch-test',
      usageLoggerFn: undefined, // ← missing
      unitCostUsd: 0.01,
      dryRun: false,
    });

    assert.equal(callCount(), 0);
    assert.ok(output.batchMetadata.skipped_reasons['guard_missing_usage_logger'] >= 1);
  });
});

// ─── F17: tavily + dryRun=false + missing unitCostUsd → guard ────────────────

describe('F17 — tavily + dryRun=false + missing unitCostUsd → 0 calls', () => {
  it('production guard bloquea cuando unitCostUsd no está definido', async () => {
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: { ...enabledMockConfig(), provider: 'tavily' },
      providerFn,
      batchId: 'batch-test',
      usageLoggerFn: async () => {},
      unitCostUsd: undefined, // ← missing
      dryRun: false,
    });

    assert.equal(callCount(), 0);
    assert.ok(output.batchMetadata.skipped_reasons['guard_missing_unit_cost'] >= 1);
  });
});

// ─── F18: writeProspectingCandidates pasa richProfileEnrichmentOverride ───────

describe('F18 — writeProspectingCandidates pasa richProfileEnrichmentOverride → mock llamado', () => {
  it('override llega al batch runner y el mock provider es invocado', async () => {
    const stats: FakeAdminStats = { batchUpdates: [], candidateInserts: [] };
    const admin = makeFakeAdmin(stats);
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    const override: RichProfileEnrichmentOverride = {
      config: enabledMockConfig(),
      providerFn,
      unitCostUsd: 0.01,
    };

    const result = await writeProspectingCandidates(
      makeWriterInput({
        pipelineOutput: makePipelineOutput([makePipelineCandidate({ name: 'Acme Corp' })]),
      }),
      admin,
      undefined,
      override,
    );

    assert.ok(callCount() >= 1, 'provider must be called at least once');
    assert.ok(result.candidatesCreated >= 0, 'writer should complete without error');

    // Batch metadata should contain rich_profile_enrichment
    const lastUpdate = stats.batchUpdates.at(-1);
    if (lastUpdate) {
      const meta = (lastUpdate['metadata'] ?? {}) as Record<string, unknown>;
      assert.ok(
        Object.prototype.hasOwnProperty.call(meta, 'rich_profile_enrichment'),
        'batch metadata must include rich_profile_enrichment when override used',
      );
    }
  });
});

// ─── F19: sin override → comportamiento legacy intacto ───────────────────────

describe('F19 — writeProspectingCandidates sin override → comportamiento legacy intacto', () => {
  it('sin override: provider no llamado, batch metadata sin rich_profile_enrichment', async () => {
    const stats: FakeAdminStats = { batchUpdates: [], candidateInserts: [] };
    const admin = makeFakeAdmin(stats);
    const { providerFn, callCount } = createMockRichProfileEnrichmentProvider('found_city_and_size');

    // Call WITHOUT override — providerFn is NOT passed anywhere
    const result = await writeProspectingCandidates(
      makeWriterInput({
        pipelineOutput: makePipelineOutput([makePipelineCandidate({ name: 'Acme Corp' })]),
      }),
      admin,
      undefined,
      undefined, // no override
    );

    assert.equal(callCount(), 0, 'provider must not be called without override');
    assert.ok(result.candidatesCreated >= 0, 'writer should work normally without override');

    const lastUpdate = stats.batchUpdates.at(-1);
    if (lastUpdate) {
      const meta = (lastUpdate['metadata'] ?? {}) as Record<string, unknown>;
      assert.equal(
        Object.prototype.hasOwnProperty.call(meta, 'rich_profile_enrichment'),
        false,
        'batch metadata must NOT have rich_profile_enrichment without override',
      );
    }
  });
});

// ─── F20: default configs siguen false ───────────────────────────────────────

describe('F20 — DEFAULT configs siguen false (no activados por defecto)', () => {
  it('DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled === false', () => {
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.enabled, false);
    assert.equal(DEFAULT_RICH_PROFILE_ENRICHMENT_CONFIG.provider, 'disabled');
  });

  it('DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled === false', () => {
    assert.equal(DEFAULT_LINKEDIN_SEARCH_CONFIG.enabled, false);
  });
});

// ─── F21: not_found + description + official evidence_url → provenance correcto ─

describe('F21 — not_found con description + official evidence_url → provenance correcto post-merge', () => {
  it('mergeRichProfileEnrichmentResult: not_found + description + evidence_url → enrichment_level=controlled, external_calls_used=true, cost acumulado, city null, size null', () => {
    const profile = buildProfile();

    const merged = mergeRichProfileEnrichmentResult(
      profile,
      {
        status: 'not_found',
        city: null,
        size_range: null,
        hq_country: null,
        evidence_url: 'https://sofka.com.co',
        description: 'Sofka Technologies es una empresa de software con presencia en LATAM.',
        confidence: 30,
        warnings: [],
      },
      { externalCallUsed: true, estimatedCostUsd: 0.008 },
    );

    // City and size must remain unset
    assert.equal(merged.location.city, null, 'city debe permanecer null');
    assert.equal(merged.size.status, 'unknown', 'size debe permanecer unknown');
    assert.equal(merged.size.estimated_range, null, 'size_range debe permanecer null');

    // Description should be populated (was empty before)
    assert.ok(
      merged.description.short && merged.description.short.length > 0,
      'description.short debe ser llenada desde provider result',
    );

    // Evidence URL should be populated (was null before)
    assert.ok(
      merged.evidence.primary_url && merged.evidence.primary_url.includes('sofka.com.co'),
      `evidence.primary_url debe apuntar a sofka.com.co, got: ${merged.evidence.primary_url}`,
    );

    // Provenance: external call must be tracked correctly
    assert.equal(
      merged.provenance.enrichment_level,
      'controlled',
      'enrichment_level debe ser "controlled" aunque status sea not_found',
    );
    assert.equal(
      merged.provenance.external_calls_used,
      true,
      'external_calls_used debe ser true cuando se hizo llamada externa',
    );
    assert.ok(
      merged.provenance.cost_usd >= 0.008,
      `cost_usd debe acumular 0.008, got: ${merged.provenance.cost_usd}`,
    );

    // missing_fields must still contain city and size
    assert.ok(
      merged.notes.missing_fields?.includes('city'),
      `missing_fields debe seguir incluyendo "city", got: ${JSON.stringify(merged.notes.missing_fields)}`,
    );
    assert.ok(
      merged.notes.missing_fields?.includes('size'),
      `missing_fields debe seguir incluyendo "size", got: ${JSON.stringify(merged.notes.missing_fields)}`,
    );
  });

  it('runRichProfileEnrichmentBatch: not_found con mock → enrichedProfile.provenance.enrichment_level=controlled', async () => {
    const { providerFn } = createMockRichProfileEnrichmentProvider('not_found');

    const output = await runRichProfileEnrichmentBatch([baseCandidate()], {
      config: enabledMockConfig(),
      providerFn,
      batchId: 'batch-provenance-test',
      unitCostUsd: 0.008,
      clockFn: fixedClock,
    });

    assert.equal(output.batchMetadata.not_found_count, 1);
    assert.equal(output.enrichedProfiles.length, 1);

    const prov = output.enrichedProfiles[0].enrichedProfile.provenance;
    assert.equal(
      prov.enrichment_level,
      'controlled',
      'enrichment_level debe ser controlled después de merge de not_found',
    );
    assert.equal(
      prov.external_calls_used,
      true,
      'external_calls_used debe ser true (mock simula llamada externa)',
    );
    assert.ok(
      prov.cost_usd >= 0.008,
      `cost_usd debe acumular ≥0.008, got: ${prov.cost_usd}`,
    );
  });
});
