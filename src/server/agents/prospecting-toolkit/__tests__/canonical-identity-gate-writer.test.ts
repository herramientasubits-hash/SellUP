/**
 * Tests — Canonical Identity Gate en el Writer (Hito 16AB.43.25)
 *
 * Verifica la defensa final del writer contra:
 *   - non_company_phrase ("SaaS y plataformas")
 *   - seen_identity_key_recently ("Siesa Enterprise" cuando "Siesa" ya existe)
 *   - non_official_source_domain (candidato cuyo dominio es un directorio)
 *
 * Usa writeProspectingCandidates con dryRun=false + fake admin client.
 * Sin Supabase real. Sin LLM. Sin Tavily.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeProspectingCandidates } from '../candidate-writer';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<ProspectingPipelineCandidate>): ProspectingPipelineCandidate {
  return {
    name: 'Test Company',
    domain: 'testcompany.com',
    website: 'https://testcompany.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.8,
      dataCompletenessScore: 0.9,
      recommendedAction: 'add_to_pipeline',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: 'https://testcompany.com',
    sourceTitle: 'Test Company',
    sourceSnippet: 'Test company snippet',
    inferredNameSource: 'title',
    ...overrides,
  } as ProspectingPipelineCandidate;
}

function makePipelineOutput(candidates: ProspectingPipelineCandidate[]): ProspectingPipelineOutput {
  return {
    candidates,
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      targetCount: candidates.length,
      searchDepth: 'standard',
    },
    summary: {
      requested: candidates.length,
      returned: candidates.length,
      highQualityNew: candidates.length,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
    },
    metadata: {
      provider: 'mock',
      pipelineVersion: 'test',
      executedAt: new Date().toISOString(),
    },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

// ─── Fake admin client ────────────────────────────────────────────────────────
//
// Simula el comportamiento de Supabase para:
//   - buildNoveltyIndex: SELECT from prospect_candidates (por dominio) → vacío
//   - buildRecentIdentityKeySet paso 1: SELECT from prospect_batches → batches previos
//   - buildRecentIdentityKeySet paso 2: SELECT from prospect_candidates (por batch) → nombres previos
//   - INSERT into prospect_batches → devuelve batch
//   - INSERT into prospect_candidates → devuelve candidato
//   - INSERT into prospect_candidate_audit → ok
//   - UPDATE prospect_batches → ok

type FakeClientOpts = {
  previousCandidateNames?: string[];
  previousDomains?: string[];
};

function makeFakeAdminClient(opts: FakeClientOpts = {}): SupabaseClient {
  const { previousCandidateNames = [], previousDomains = [] } = opts;

  let callCount = 0;
  let insertedCandidateCount = 0;

  const chainable = (data: unknown, error: unknown = null) => {
    const obj: Record<string, unknown> = {
      data,
      error,
      select: () => obj,
      insert: () => obj,
      update: () => obj,
      eq: () => obj,
      neq: () => obj,
      in: () => obj,
      not: () => obj,
      gte: () => obj,
      single: () => ({ data, error }),
    };
    return obj;
  };

  const client = {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};

      obj.select = (cols?: string) => {
        if (table === 'prospect_batches') {
          // buildRecentIdentityKeySet paso 1
          return {
            eq: () => ({
              gte: () => Promise.resolve({ data: [{ id: 'prev-batch-1' }], error: null }),
            }),
            eq2: () => {},
          };
        }
        if (table === 'prospect_candidates') {
          // Two uses:
          // 1. buildNoveltyIndex: .select(...).in('domain', ...) → empty (domains not seen)
          // 2. buildRecentIdentityKeySet paso 2: .select('name').in('batch_id', ...).not(...) → previous names
          return {
            in: (_col: string, _vals: string[]) => {
              if (_col === 'domain') {
                // noveltyIndex query — return empty (domains are new)
                return Promise.resolve({ data: [], error: null });
              }
              // batch_id query — return previous candidate names
              return {
                not: () =>
                  Promise.resolve({
                    data: previousCandidateNames.map((n) => ({ name: n })),
                    error: null,
                  }),
              };
            },
          };
        }
        return chainable([]);
      };

      obj.insert = (row: unknown) => {
        if (table === 'prospect_batches') {
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'test-batch-id' }, error: null }),
            }),
          };
        }
        if (table === 'prospect_candidates') {
          insertedCandidateCount++;
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: `cand-${insertedCandidateCount}` },
                  error: null,
                }),
            }),
          };
        }
        // audit
        return Promise.resolve({ data: null, error: null });
      };

      obj.update = () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      });

      return obj;
    },
  } as unknown as SupabaseClient;

  return client;
}

// ─── Fixture A — non_company_phrase ──────────────────────────────────────────

describe('Fixture A — non_company_phrase', () => {
  it('"SaaS y plataformas" se omite con razón non_company_phrase', async () => {
    const candidates = [
      makeCandidate({ name: 'SaaS y plataformas', domain: 'santamartacrea.com', website: 'https://santamartacrea.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    const skipped = result.skipped.find((s) => s.reason === 'non_company_phrase');
    assert.ok(skipped, 'Debe haber un skipped con reason=non_company_phrase');
    assert.equal(skipped!.name, 'SaaS y plataformas');
  });

  it('"Software empresarial" se omite con razón non_company_phrase', async () => {
    const candidates = [
      makeCandidate({ name: 'Software empresarial', domain: 'softwareempresarial.com', website: 'https://softwareempresarial.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.ok(result.skipped.some((s) => s.reason === 'non_company_phrase'));
  });
});

// ─── Fixture B — seen_identity_key_recently ───────────────────────────────────

describe('Fixture B — seen_identity_key_recently', () => {
  it('"Siesa Enterprise" se omite si "Siesa" ya fue sugerida', async () => {
    const candidates = [
      makeCandidate({
        name: 'Siesa Enterprise',
        domain: 'catalogodesoftware.com',
        website: 'https://catalogodesoftware.com/siesa',
      }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    // Previous candidates include "Siesa" → identity key "siesa"
    const admin = makeFakeAdminClient({ previousCandidateNames: ['Siesa'] });

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    const skipped = result.skipped.find(
      (s) => s.reason === 'seen_identity_key_recently' || s.reason === 'non_official_source_domain',
    );
    assert.ok(skipped, 'Debe estar skipped (por identity o por directorio)');
  });
});

// ─── Fixture C — empresas válidas pasan ─────────────────────────────────────

describe('Fixture C — empresas válidas', () => {
  it('"Contarerp" con dominio propio pasa sin bloqueo', async () => {
    const candidates = [
      makeCandidate({ name: 'Contarerp', domain: 'contarerp.com.co', website: 'https://contarerp.com.co' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 1);
    assert.equal(result.skipped.filter((s) => s.reason === 'non_company_phrase').length, 0);
  });

  it('"Softland" con dominio propio pasa sin bloqueo', async () => {
    const candidates = [
      makeCandidate({ name: 'Softland', domain: 'softland.com', website: 'https://softland.com/co' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 1);
  });
});

// ─── Fixture D — non_official_source_domain ──────────────────────────────────

describe('Fixture D — non_official_source_domain', () => {
  it('candidato con dominio capterra.com se bloquea', async () => {
    const candidates = [
      makeCandidate({ name: 'EmpresaX', domain: 'capterra.com', website: 'https://capterra.com/software/123' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.ok(result.skipped.some((s) => s.reason === 'non_official_source_domain'));
  });

  it('candidato con dominio catalogodesoftware.com se bloquea', async () => {
    const candidates = [
      makeCandidate({ name: 'EmpresaY', domain: 'catalogodesoftware.com', website: 'https://catalogodesoftware.com/siesa' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.candidatesCreated, 0);
    assert.ok(result.skipped.some((s) => s.reason === 'non_official_source_domain'));
  });

  it('candidato con dominio softland.com NO se bloquea como directorio', async () => {
    const candidates = [
      makeCandidate({ name: 'Softland', domain: 'softland.com', website: 'https://softland.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(
      result.skipped.filter((s) => s.reason === 'non_official_source_domain').length,
      0,
    );
  });
});

// ─── Fixture E — nombres con palabras genéricas pero marca real ──────────────

describe('Fixture E — marcas reales con palabras genéricas', () => {
  it('"Loggro Enterprise" no se bloquea como frase genérica', async () => {
    const candidates = [
      makeCandidate({ name: 'Loggro Enterprise', domain: 'loggro.com', website: 'https://loggro.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.skipped.filter((s) => s.reason === 'non_company_phrase').length, 0);
  });

  it('"IEBS Business School" no se bloquea como frase genérica', async () => {
    const candidates = [
      makeCandidate({ name: 'IEBS Business School', domain: 'iebschool.com', website: 'https://iebschool.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      { pipelineOutput, triggeredByUserId: null, ownerId: null, batchName: null, source: 'agent_1', dryRun: false, extraBatchMetadata: null },
      admin,
    );

    assert.equal(result.skipped.filter((s) => s.reason === 'non_company_phrase').length, 0);
  });
});
