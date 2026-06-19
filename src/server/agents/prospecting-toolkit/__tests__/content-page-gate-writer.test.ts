/**
 * Tests — Content-page gate e intra-batch identity dedup en el Writer (Hito 16AB.43.28)
 *
 * Fixture A — URLs de content-page bloqueadas por el writer (skip reason: content_page)
 * Fixture B — Intra-batch identity dedup: dos entradas con mismo identityKey → una bloqueada
 * Fixture C — Orden de gates: content_page + intra_batch_dedupe + target_cap
 * Fixture D — Metadatos precision_gate en skipped reflejan counts correctos
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
    domain: 'testcompany.com.co',
    website: 'https://testcompany.com.co',
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
    sourceUrl: 'https://testcompany.com.co',
    sourceTitle: 'Test Company',
    sourceSnippet: 'Test snippet',
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
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

function makeFakeAdminClient(): SupabaseClient {
  let insertedCandidateCount = 0;

  const client = {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};

      obj.select = () => {
        if (table === 'prospect_batches') {
          return {
            eq: () => ({
              gte: () => Promise.resolve({ data: [], error: null }),
            }),
          };
        }
        if (table === 'prospect_candidates') {
          return {
            in: (_col: string, _vals: string[]) => {
              if (_col === 'domain') {
                return Promise.resolve({ data: [], error: null });
              }
              return {
                not: () => Promise.resolve({ data: [], error: null }),
              };
            },
          };
        }
        return Promise.resolve({ data: [], error: null });
      };

      obj.insert = () => {
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

// ─── Fixture A — Content-page URLs bloqueadas ────────────────────────────────

describe('Fixture A — Content-page URLs blocked by writer', () => {
  const CONTENT_PAGE_CASES: Array<{ name: string; website: string; domain: string; label: string }> = [
    {
      name: 'Pragma Academia',
      website: 'https://pragma.com.co/academia/conceptos/transformacion-digital',
      domain: 'pragma.com.co',
      label: '/academia/ path',
    },
    {
      name: 'Línea Datascan Casos Éxito',
      website: 'https://lineadatascan.com/nosotros/casos-exito',
      domain: 'lineadatascan.com',
      label: 'casos-exito slug',
    },
    {
      name: 'N-iX Nearshore',
      website: 'https://n-ix.com/nearshore-software-development-colombia',
      domain: 'n-ix.com',
      label: 'nearshore-software-development slug',
    },
    {
      name: 'Universidad VIU Expertos',
      website: 'https://universidadviu.com/co/actualidad/nuestros-expertos/algo',
      domain: 'universidadviu.com',
      label: '/actualidad/ path',
    },
    {
      name: 'Paradigma Solutions Blog',
      website: 'https://paradigmasolutions.com/blog/3-casos-de-exito-transformacion',
      domain: 'paradigmasolutions.com',
      label: 'casos-de-exito slug in blog',
    },
  ];

  for (const { name, website, domain, label } of CONTENT_PAGE_CASES) {
    it(`blocks content-page candidate (${label}): ${website}`, async () => {
      const candidates = [makeCandidate({ name, website, domain })];
      const pipelineOutput = makePipelineOutput(candidates);
      const admin = makeFakeAdminClient();

      const result = await writeProspectingCandidates(
        {
          pipelineOutput,
          triggeredByUserId: null,
          ownerId: null,
          batchName: null,
          source: 'agent_1',
          dryRun: false,
          extraBatchMetadata: null,
        },
        admin,
      );

      assert.equal(result.candidatesCreated, 0, `Content-page candidate must not be persisted: ${label}`);
      const skipped = result.skipped.find((s) => s.reason === 'content_page');
      assert.ok(skipped, `Must have a skipped entry with reason=content_page for ${label}`);
      assert.equal(skipped!.name, name);
    });
  }

  it('legitimate company URL is NOT blocked', async () => {
    const candidates = [
      makeCandidate({
        name: 'GTD Colombia',
        website: 'https://gtdcolombia.com/soluciones/servicios-ti',
        domain: 'gtdcolombia.com',
      }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
      },
      admin,
    );

    assert.equal(result.candidatesCreated, 1, 'GTD Colombia must be persisted');
    assert.ok(!result.skipped.some((s) => s.reason === 'content_page'), 'Must not be skipped as content_page');
  });
});

// ─── Fixture B — Intra-batch identity dedupe ──────────────────────────────────

describe('Fixture B — Intra-batch identity dedup keeps best-ranked, skips duplicate', () => {
  it('Pragma appears twice in same batch → one persisted, one skipped as intra_batch_identity_duplicate', async () => {
    const candidates = [
      makeCandidate({
        name: 'Pragma',
        website: 'https://pragma.com.co',
        domain: 'pragma.com.co',
      }),
      makeCandidate({
        name: 'Pragma',
        website: 'https://www.pragma.com.co',
        domain: 'pragma.com.co',
      }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
      },
      admin,
    );

    const intraDupes = result.skipped.filter((s) => s.reason === 'intra_batch_identity_duplicate');
    assert.equal(intraDupes.length, 1, 'Exactly one Pragma entry must be deduplicated');
    assert.equal(result.candidatesCreated, 1, 'Exactly one Pragma must be persisted');
  });

  it('Two companies with different names are both persisted', async () => {
    const candidates = [
      makeCandidate({ name: 'Pragma', website: 'https://pragma.com.co', domain: 'pragma.com.co' }),
      makeCandidate({ name: 'Softland', website: 'https://softland.com', domain: 'softland.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
      },
      admin,
    );

    assert.equal(result.skipped.filter((s) => s.reason === 'intra_batch_identity_duplicate').length, 0);
    assert.equal(result.candidatesCreated, 2);
  });
});

// ─── Fixture C — Gate order: content_page → intra_batch_dedupe → target_cap ──

describe('Fixture C — Gate order: content_page + intra_batch_dedupe + target_cap', () => {
  it('3 content-page + 1 intra-batch dup + 3 valid with cap=2 → 2 persisted, 6 skipped', async () => {
    const candidates = [
      // content-page blocked
      makeCandidate({ name: 'Pragma Academia', website: 'https://pragma.com.co/academia/conceptos/algo', domain: 'pragma.com.co' }),
      makeCandidate({ name: 'Blog Post', website: 'https://acme.com/blog/post-1', domain: 'acme.com' }),
      makeCandidate({ name: 'Nearshore Guide', website: 'https://n-ix.com/nearshore-software-development-colombia', domain: 'n-ix.com' }),
      // intra-batch dup (same identity key as 5th entry)
      makeCandidate({ name: 'Siesa', website: 'https://www.siesa.com', domain: 'siesa.com' }),
      // valid — persisted up to cap
      makeCandidate({ name: 'Siesa Enterprise', website: 'https://siesa.com', domain: 'siesa.com' }),
      makeCandidate({ name: 'Bielcom', website: 'https://bielcom.com.co', domain: 'bielcom.com.co' }),
      makeCandidate({ name: 'Datatecnologia', website: 'https://datatecnologia.com.co', domain: 'datatecnologia.com.co' }),
      makeCandidate({ name: 'Internexa', website: 'https://internexa.com', domain: 'internexa.com' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
        targetPersistibleCandidates: 2,
      },
      admin,
    );

    assert.ok(result.candidatesCreated <= 2, `Must respect target cap of 2, created=${result.candidatesCreated}`);
    assert.ok(
      result.skipped.some((s) => s.reason === 'content_page'),
      'Must have content_page skips',
    );
  });
});

// ─── Fixture D — precision_gate metadata counts match skipped reasons ─────────

describe('Fixture D — Skipped counts reflect precision_gate counters', () => {
  it('2 content-page + 1 intra-batch dup → skipped counts match', async () => {
    const candidates = [
      makeCandidate({ name: 'Content Page 1', website: 'https://acme.com/blog/post-1', domain: 'acme.com' }),
      makeCandidate({ name: 'Content Page 2', website: 'https://pragma.com.co/academia/conceptos/erp', domain: 'pragma.com.co' }),
      makeCandidate({ name: 'Pragma', website: 'https://pragma.com.co', domain: 'pragma.com.co' }),
      makeCandidate({ name: 'Pragma', website: 'https://www.pragma.com.co', domain: 'pragma.com.co' }),
      makeCandidate({ name: 'Legitimate Corp', website: 'https://legitimatecorp.com.co', domain: 'legitimatecorp.com.co' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);
    const admin = makeFakeAdminClient();

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
      },
      admin,
    );

    const contentPageSkips = result.skipped.filter((s) => s.reason === 'content_page');
    const intraDupeSkips = result.skipped.filter((s) => s.reason === 'intra_batch_identity_duplicate');

    assert.equal(contentPageSkips.length, 2, 'Must have exactly 2 content_page skips');
    assert.equal(intraDupeSkips.length, 1, 'Must have exactly 1 intra_batch_identity_duplicate skip');
    assert.equal(result.candidatesCreated, 2, 'Must persist both Pragma + Legitimate Corp (dedupe keeps one Pragma)');
  });

  it('dryRun=true — content-page gate still counts (no DB calls)', async () => {
    const candidates = [
      makeCandidate({ name: 'Blog Post', website: 'https://acme.com/blog/my-post', domain: 'acme.com' }),
      makeCandidate({ name: 'Real Company', website: 'https://realcompany.com.co', domain: 'realcompany.com.co' }),
    ];
    const pipelineOutput = makePipelineOutput(candidates);

    const result = await writeProspectingCandidates(
      {
        pipelineOutput,
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: true,
        extraBatchMetadata: null,
      },
    );

    assert.equal(result.dryRun, true);
    assert.equal(result.candidatesCreated, 0, 'dryRun must not persist anything');
  });
});
