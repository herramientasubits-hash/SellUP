/**
 * Q3F-5AW.2 (Phase 1) — Prospect candidate identity_key.
 *
 * T5 — Writer/helper poblan identity_key determinística cuando hay identidad.
 * T6 — identity_key queda null cuando no hay identidad suficiente (insert sigue OK).
 *
 * Sin Supabase real, sin Apollo/Tavily/Lusha/HubSpot, sin LLM. Cliente admin
 * es un fake in-memory que captura el candidateInsert.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buildProspectCandidateIdentityKey } from '../prospect-candidate-identity-key';
import { writeProspectingCandidates } from '../candidate-writer';
import type {
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';

// ─── T5/T6 — helper puro ──────────────────────────────────────────────────────

describe('buildProspectCandidateIdentityKey — composición determinística (T5)', () => {
  it('prefiere tax + país cuando hay identificador fiscal', () => {
    const key = buildProspectCandidateIdentityKey({
      name: 'Siesa Enterprise',
      domain: 'siesa.com',
      taxIdentifier: '805.027.653-1',
      countryCode: 'CO',
    });
    // normalizeTaxIdentifier("805.027.653-1") → "8050276531"; país namespaced en minúscula
    assert.equal(key, 'tax:co:8050276531');
  });

  it('cae a dominio normalizado cuando no hay tax', () => {
    const key = buildProspectCandidateIdentityKey({
      name: 'Example Corp',
      website: 'https://www.Example.com/contacto',
      countryCode: 'CO',
    });
    assert.equal(key, 'domain:example.com');
  });

  it('cae a nombre canónico cuando no hay tax ni dominio', () => {
    const key = buildProspectCandidateIdentityKey({ name: 'Siesa Enterprise' });
    // buildIdentityKey("Siesa Enterprise") → "siesa"
    assert.equal(key, 'name:siesa');
  });

  it('es determinística: mismas entradas → misma clave', () => {
    const input = { name: 'Loggro', domain: 'loggro.com', countryCode: 'CO' };
    assert.equal(
      buildProspectCandidateIdentityKey(input),
      buildProspectCandidateIdentityKey(input),
    );
  });

  it('no usa tax si el país falta (ambos requeridos)', () => {
    const key = buildProspectCandidateIdentityKey({
      name: 'Acme',
      taxIdentifier: '900123456',
      domain: 'acme.io',
    });
    assert.equal(key, 'domain:acme.io');
  });
});

describe('buildProspectCandidateIdentityKey — null cuando no hay identidad (T6)', () => {
  it('retorna null sin nombre, dominio ni tax', () => {
    assert.equal(buildProspectCandidateIdentityKey({}), null);
  });

  it('retorna null cuando el nombre es una frase no-empresa y no hay dominio/tax', () => {
    // "SaaS y plataformas" → buildIdentityKey devuelve '' (isNonCompanyPhrase)
    assert.equal(
      buildProspectCandidateIdentityKey({ name: 'SaaS y plataformas' }),
      null,
    );
  });

  it('no rompe con tax demasiado corto y sin otra señal', () => {
    assert.equal(
      buildProspectCandidateIdentityKey({ taxIdentifier: '12', countryCode: 'CO' }),
      null,
    );
  });
});

// ─── T5 (writer-integration) — el writer persiste identity_key ────────────────

function makeCandidate(
  overrides: Partial<ProspectingPipelineCandidate>,
): ProspectingPipelineCandidate {
  return {
    name: 'Contarerp',
    domain: 'contarerp.com.co',
    website: 'https://contarerp.com.co',
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
    sourceUrl: 'https://contarerp.com.co',
    sourceTitle: 'Contarerp',
    sourceSnippet: 'ERP colombiano',
    inferredNameSource: 'title',
    ...overrides,
  } as ProspectingPipelineCandidate;
}

function makePipelineOutput(
  candidates: ProspectingPipelineCandidate[],
): ProspectingPipelineOutput {
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

/** Fake admin que captura la fila insertada en prospect_candidates. */
function makeCapturingAdmin(captured: Record<string, unknown>[]): SupabaseClient {
  let insertedCandidateCount = 0;
  const client = {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};

      obj.select = () => {
        if (table === 'prospect_batches') {
          return { eq: () => ({ gte: () => Promise.resolve({ data: [], error: null }) }) };
        }
        if (table === 'prospect_candidates') {
          return {
            in: (_col: string) => {
              if (_col === 'domain') return Promise.resolve({ data: [], error: null });
              return { not: () => Promise.resolve({ data: [], error: null }) };
            },
          };
        }
        return { data: [], error: null };
      };

      obj.insert = (row: unknown) => {
        if (table === 'prospect_batches') {
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'batch-1' }, error: null }) }) };
        }
        if (table === 'prospect_candidates') {
          insertedCandidateCount++;
          captured.push(row as Record<string, unknown>);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: `cand-${insertedCandidateCount}` }, error: null }),
            }),
          };
        }
        return Promise.resolve({ data: null, error: null });
      };

      obj.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
      return obj;
    },
  } as unknown as SupabaseClient;
  return client;
}

describe('writeProspectingCandidates — persiste identity_key (T5)', () => {
  it('candidato válido con dominio propio → candidateInsert.identity_key poblada', async () => {
    const captured: Record<string, unknown>[] = [];
    const admin = makeCapturingAdmin(captured);

    const result = await writeProspectingCandidates(
      {
        pipelineOutput: makePipelineOutput([makeCandidate({})]),
        triggeredByUserId: null,
        ownerId: null,
        batchName: null,
        source: 'agent_1',
        dryRun: false,
        extraBatchMetadata: null,
      },
      admin,
    );

    assert.equal(result.candidatesCreated, 1);
    assert.equal(captured.length, 1);
    const insert = captured[0];
    assert.ok('identity_key' in insert, 'candidateInsert debe incluir identity_key');
    assert.equal(insert.identity_key, 'domain:contarerp.com.co');
  });
});
