/**
 * Tavily — las filas de búsqueda web escriben `target_completeness` para que el
 * rescate de Claude las vea y, completadas, cuenten para la meta.
 *
 * Prod 30-09 (lotes ff1ba9f2, 1e9fd646, 26f57743): 34 filas en revisión, 0 con
 * `target_completeness`, 0 rescatadas. Sin Supabase real. Sin Tavily. Sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { writeProspectingCandidates } from '../candidate-writer';
import { needsCandidateRescue } from '../claude-classifier/rescue/rescue-batch';
import { resolveWebDiscoveryCompanyFieldStatuses } from '../web-discovery-target-completeness';
import type { ProspectingPipelineOutput, ProspectingPipelineCandidate } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Helpers (el mismo doble que external-platform-ownership-gate.test.ts) ────

function makeCandidate(overrides: Partial<ProspectingPipelineCandidate> & { name: string }): ProspectingPipelineCandidate {
  return {
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
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
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
    metadata: { provider: 'mock', pipelineVersion: 'test', executedAt: new Date().toISOString() },
    warnings: [],
  } as unknown as ProspectingPipelineOutput;
}

/**
 * 🔴 El doble de Supabase, puesto al día con el contrato REAL del writer.
 *
 * Siete pruebas de esta suite llevaban rojas desde CUT-3B4 («Nexen must be
 * persisted» y compañía) con 0 filas escritas. La causa NO era producción: sin
 * método `rpc` la forma de un objeto no prueba nada sobre el esquema, así que
 * el writer degrada CERRADO (`identity_fence_snapshot_degraded`). Ese
 * fail-closed es correcto y no se toca.
 *
 * Se responde `PGRST202` —lo que diría una base sin la migración 126, el estado
 * real de Producción—, igual que `canonical-identity-gate-writer.test.ts` y
 * `business-fit-gate.test.ts`, y se completan las dos cadenas que producción
 * encadena: la siembra del registro de identidad y los nombres previos.
 */
function makeFakeAdminClient(inserted: Record<string, unknown>[]): SupabaseClient {
  let insertedCandidateCount = 0;

  const client = {
    rpc: async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function read_batch_identity_snapshot in the schema cache',
      },
    }),
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
            // Siembra del registro de identidad del lote: 0 filas, lote nuevo.
            eq: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
            in: (_col: string) => {
              if (_col === 'domain') return Promise.resolve({ data: [], error: null });
              // La cadena real de nombres previos termina en `.neq(...)`.
              return {
                not: () => ({ neq: () => Promise.resolve({ data: [], error: null }) }),
              };
            },
          };
        }
        return Promise.resolve({ data: [], error: null });
      };

      obj.insert = (payload: unknown) => {
        if (table === 'prospect_batches') {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'test-batch-id' }, error: null }),
            }),
          };
        }
        if (table === 'prospect_candidates') {
          insertedCandidateCount++;
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            inserted.push(row as Record<string, unknown>);
          }
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: `cand-${insertedCandidateCount}` }, error: null }),
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


type Completeness = { failed_conditions?: string[]; counts_toward_target?: boolean };

async function writeWithProvider(
  provider: string,
  candidate: { name: string; domain: string; snippet: string } = {
    name: 'Nexen', domain: 'nexen.com.co', snippet: 'Software empresarial Colombia',
  },
  extra: Partial<ProspectingPipelineCandidate> = {},
) {
  const candidates = [
    makeCandidate({
      name: candidate.name,
      website: `https://${candidate.domain}`,
      domain: candidate.domain,
      sourceSnippet: candidate.snippet,
      ...extra,
    }),
  ];
  const pipelineOutput = makePipelineOutput(candidates);
  pipelineOutput.metadata = { ...pipelineOutput.metadata, provider } as typeof pipelineOutput.metadata;
  const inserted: Record<string, unknown>[] = [];
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
    makeFakeAdminClient(inserted),
  );
  return { result, inserted };
}

describe('resolveWebDiscoveryCompanyFieldStatuses', () => {
  it('fuera de Tavily devuelve null (Apollo, Lusha y mock no cambian)', () => {
    for (const provider of ['apollo_organizations', 'mock', 'lusha', null, undefined]) {
      assert.equal(resolveWebDiscoveryCompanyFieldStatuses({ provider, writerLinkedinVerified: true }), null);
    }
  });

  it('Tavily: el tamaño nunca lo trae el proveedor', () => {
    const statuses = resolveWebDiscoveryCompanyFieldStatuses({ provider: 'tavily', writerLinkedinVerified: true });
    assert.equal(statuses?.employeeCountStatus, 'not_returned');
  });

  it('Tavily: el LinkedIn cuenta sólo si el writer lo verificó', () => {
    assert.equal(
      resolveWebDiscoveryCompanyFieldStatuses({ provider: 'tavily', writerLinkedinVerified: true })?.linkedinStatus,
      'confirmed',
    );
    assert.equal(
      resolveWebDiscoveryCompanyFieldStatuses({ provider: 'tavily', writerLinkedinVerified: false })?.linkedinStatus,
      'not_returned',
    );
  });
});

describe('writer — filas de Tavily con target_completeness', () => {
  it('la fila de Tavily sin tamaño escribe el bloque con employee_count_status fallido', async () => {
    const { result, inserted } = await writeWithProvider('tavily');
    assert.equal(result.candidatesCreated, 1);
    const metadata = inserted[0]?.metadata as Record<string, unknown>;
    const completeness = metadata?.target_completeness as Completeness | undefined;
    assert.ok(completeness, 'la fila de Tavily debe traer target_completeness');
    assert.equal(completeness.counts_toward_target, false);
    assert.ok(completeness.failed_conditions?.includes('employee_count_status'));
    assert.ok(completeness.failed_conditions?.includes('linkedin_status'));
  });

  it('esa fila queda seleccionable por el rescate de Claude', async () => {
    const { inserted } = await writeWithProvider('tavily');
    const row = inserted[0] as Record<string, unknown>;
    assert.equal(row.status, 'needs_review');
    assert.equal(
      needsCandidateRescue(
        {
          id: 'cand-1',
          industry_id: null,
          name: row.name as string,
          website: row.website as string,
          domain: row.domain as string,
          country_code: 'CO',
          country: 'Colombia',
          status: row.status as string,
          source_primary: row.source_primary as string,
          metadata: row.metadata as Record<string, unknown>,
        },
        Date.now(),
      ),
      true,
    );
  });

  it('una corrida sin proveedor estructurado (mock) sigue sin el bloque', async () => {
    const { result, inserted } = await writeWithProvider('mock');
    assert.equal(result.candidatesCreated, 1);
    const metadata = inserted[0]?.metadata as Record<string, unknown>;
    assert.equal(metadata?.target_completeness, undefined);
  });
});

describe('AGENT1-LINKEDIN-OPTIONAL-INSTITUTIONS-1 — el writer no exige LinkedIn a una entidad pública', () => {
  it('alcaldía .gov.co: target_completeness sin linkedin_status y con el motivo', async () => {
    const { result, inserted } = await writeWithProvider('tavily', {
      name: 'Alcaldía de Ibagué', domain: 'ibague.gov.co', snippet: 'Alcaldía Municipal de Ibagué, Tolima, Colombia',
    });
    assert.equal(result.candidatesCreated, 1);
    const completeness = (inserted[0]?.metadata as Record<string, unknown>)?.target_completeness as Record<string, unknown>;
    assert.ok(completeness);
    assert.equal((completeness.failed_conditions as string[]).includes('linkedin_status'), false);
    assert.ok((completeness.failed_conditions as string[]).includes('employee_count_status'), 'el tamaño se sigue exigiendo');
    assert.equal(completeness.linkedin_required, false);
    assert.equal(completeness.linkedin_requirement_reason, 'public_or_education_domain');
  });

  it('empresa comercial: el LinkedIn sigue siendo condición', async () => {
    const { inserted } = await writeWithProvider('tavily');
    const completeness = (inserted[0]?.metadata as Record<string, unknown>)?.target_completeness as Record<string, unknown>;
    assert.ok((completeness.failed_conditions as string[]).includes('linkedin_status'));
    assert.equal(completeness.linkedin_required, true);
  });
});

describe('AGENT1-SIZE-OFFICIAL-REGISTRY-WORKERS-1 — los trabajadores del registro oficial cuentan como tamaño', () => {
  function withWorkforce(workers: number, strong = true): Partial<ProspectingPipelineCandidate> {
    return {
      officialSourceIdentity: {
        officialSourceMetadata: {
          strongIdentityAvailable: strong,
          ...(strong ? { workforce: { workers, year: new Date().getUTCFullYear() - 2, source: 'cl_sii_registry' } } : {}),
        },
        typedColumns: {},
        strongIdentityAvailable: strong,
      },
    } as unknown as Partial<ProspectingPipelineCandidate>;
  }

  it('≥ 200 trabajadores informados: la fila de Tavily ya no falla por tamaño', async () => {
    const { result, inserted } = await writeWithProvider('tavily', undefined, withWorkforce(350));
    assert.equal(result.candidatesCreated, 1);
    const metadata = inserted[0]?.metadata as Record<string, unknown>;
    const completeness = metadata?.target_completeness as Completeness;
    assert.equal(completeness.failed_conditions?.includes('employee_count_status'), false);
    // El LinkedIn se sigue exigiendo: el registro no lo sustituye.
    assert.ok(completeness.failed_conditions?.includes('linkedin_status'));
    const gate = metadata?.icp_size_gate as Record<string, unknown> | undefined;
    assert.equal(gate?.size_status, 'estimated_above_threshold');
  });

  it('entre 50 y 199 trabajadores informados: ni bloquea ni cuenta (queda como hoy)', async () => {
    const { result, inserted } = await writeWithProvider('tavily', undefined, withWorkforce(120));
    assert.equal(result.candidatesCreated, 1);
    const completeness = (inserted[0]?.metadata as Record<string, unknown>)?.target_completeness as Completeness;
    assert.ok(completeness.failed_conditions?.includes('employee_count_status'));
  });

  it('AGENT1-SIZE-OFFICIAL-REGISTRY-SMALL-1 — menos de 50 informados: el writer no la guarda (pequeña)', async () => {
    const { result } = await writeWithProvider('tavily', undefined, withWorkforce(12));
    assert.equal(result.candidatesCreated, 0);
    assert.ok(result.skipped.some((entry) => /icp_size_below_threshold/.test(JSON.stringify(entry))));
  });

  it('sin identidad fuerte el dato no se usa', async () => {
    const { inserted } = await writeWithProvider('tavily', undefined, withWorkforce(350, false));
    const completeness = (inserted[0]?.metadata as Record<string, unknown>)?.target_completeness as Completeness;
    assert.ok(completeness.failed_conditions?.includes('employee_count_status'));
  });
});
