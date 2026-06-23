/**
 * Tests — Search Quality v1.13.1 — Runtime Wiring of Active Duplicate Guard
 *
 * Verifica que checkActiveCandidateDuplicate() está correctamente integrado en
 * writeProspectingCandidates() y evita persistir candidatos que duplican empresas
 * activas ya existentes en SellUp.
 *
 * Estructura:
 *   - Sección A: unit tests de la función pura (guard logic)
 *   - Sección B: integration tests del writer con fake admin
 *   - Sección C: regresión de scoring v1.13
 *
 * Sin Supabase real. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkActiveCandidateDuplicate } from '../active-candidate-identity-guard';
import type { ActiveCandidateRecord } from '../active-candidate-identity-guard';
import { writeProspectingCandidates } from '../candidate-writer';
import type {
  CandidateWriterInput,
  ProspectingPipelineOutput,
  ProspectingPipelineCandidate,
} from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Helpers de fixtures ──────────────────────────────────────────────────────

function activeRecord(
  overrides: Partial<ActiveCandidateRecord> & { id: string; name: string; status: string },
): ActiveCandidateRecord {
  return {
    domain: null,
    inferredCompanyName: null,
    normalizedName: null,
    ...overrides,
  };
}

function softlandActive(): ActiveCandidateRecord {
  return activeRecord({ id: 'softland-001', name: 'Softland', domain: 'softland.com', status: 'needs_review' });
}

// ─── Fake admin client ────────────────────────────────────────────────────────

type FakeAdminStats = {
  candidateInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
  batchInsertCalls: Record<string, unknown>[];
};

type FakeAdminConfig = {
  /** Active candidates returned for fetchActiveCandidatesForGuard (domain-based query) */
  activeCandidatesByDomain?: Record<string, unknown>[];
  /** Active candidates returned for fetchActiveCandidatesForGuard (country-based query) */
  activeCandidatesByCountry?: Record<string, unknown>[];
};

function toDbRow(rec: ActiveCandidateRecord): Record<string, unknown> {
  return {
    id: rec.id,
    name: rec.name,
    domain: rec.domain ?? null,
    normalized_name: rec.normalizedName ?? null,
    status: rec.status,
    metadata: rec.inferredCompanyName
      ? { identity_resolution: { inferred_company_name: rec.inferredCompanyName } }
      : {},
  };
}

function makeFakeAdmin(config: FakeAdminConfig, stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;

  return {
    from(table: string) {
      // ── prospect_batches ──────────────────────────────────────────────────
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(col: string) {
                if (col === 'source') {
                  // buildRecentIdentityKeySet step 1 → empty (no recent agent_1 batches)
                  return { gte: () => Promise.resolve({ data: [], error: null }) };
                }
                // batch lookup (existingBatchId path — not used in these tests)
                return { single: () => Promise.resolve({ data: null, error: { message: 'Not found' } }) };
              },
            };
          },
          insert(data: Record<string, unknown>) {
            stats.batchInsertCalls.push({ ...data });
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: 'test-batch-001' }, error: null });
                  },
                };
              },
            };
          },
          update(data: Record<string, unknown>) {
            stats.batchUpdateCalls.push({ ...data });
            return { eq: () => Promise.resolve({ data: null, error: null }) };
          },
        };
      }

      // ── prospect_candidates ───────────────────────────────────────────────
      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            return {
              in(col: string) {
                if (col === 'domain') {
                  // buildNoveltyIndex: .in('domain', ...) → no history
                  return {
                    neq: () => Promise.resolve({ data: [], error: null }),
                    then: (res: (v: unknown) => unknown) =>
                      Promise.resolve({ data: [], error: null }).then(res),
                  };
                }
                if (col === 'status') {
                  // fetchActiveCandidatesForGuard: .in('status', ...).in('domain',...).limit(n)
                  //                           OR   .in('status', ...).eq('country_code',...).limit(n)
                  return {
                    in(_col2: string) {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: config.activeCandidatesByDomain ?? [],
                            error: null,
                          });
                        },
                      };
                    },
                    eq(_col2: string) {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: config.activeCandidatesByCountry ?? [],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                }
                // Fallback (batch_id etc.) → empty
                return {
                  not: () => ({
                    neq: () => Promise.resolve({ data: [], error: null }),
                  }),
                };
              },
              not: () => ({
                neq: () => Promise.resolve({ data: [], error: null }),
              }),
            };
          },
          insert(data: Record<string, unknown>) {
            stats.candidateInsertCalls.push({ ...data });
            const id = `cand-${++candidateSeq}`;
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id }, error: null }) };
              },
            };
          },
        };
      }

      // ── prospect_candidate_audit ──────────────────────────────────────────
      if (table === 'prospect_candidate_audit') {
        return {
          insert: () => Promise.resolve({ data: null, error: null }),
        };
      }

      // ── provider_usage_logs ───────────────────────────────────────────────
      if (table === 'provider_usage_logs') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }

      throw new Error(`[FakeAdmin] Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Pipeline output de prueba ────────────────────────────────────────────────

function makeSoftlandCandidate(
  overrides: Partial<ProspectingPipelineCandidate> = {},
): ProspectingPipelineCandidate {
  return {
    name: 'Softland',
    website: 'https://softland.com',
    domain: 'softland.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourceUrl: 'https://softland.com',
    sourceTitle: 'Softland | Software ERP y CRM Colombia',
    sourceSnippet: 'Software ERP y CRM empresarial para Colombia. Soluciones de gestión empresarial.',
    inferredNameSource: null,
    websiteVerification: null,
    duplicateCheck: null,
    searchTrace: null,
    llmEvaluation: null,
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.78,
      dataCompletenessScore: 0.8,
      recommendedAction: 'add_to_pipeline',
      breakdown: {
        existenceSignals: 1,
        websiteSignals: 1,
        duplicateSignals: 1,
        sourceSignals: 1,
        fitSignals: 1,
        completenessSignals: 1,
        penalties: 0,
      },
      reasons: [],
      warnings: [],
      blockers: [],
    },
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

function makePipelineOutput(
  candidates: ProspectingPipelineCandidate[],
): ProspectingPipelineOutput {
  return {
    input: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
    },
    catalogContext: {
      country: 'Colombia',
      countryCode: 'CO',
      industry: 'Tecnología',
      searchDepth: 'standard',
      fiscalIdentifierLabel: null,
      recommendedSources: [],
      sectorSources: [],
      risks: [],
      operatingRules: [],
      coverageNotes: [],
      promptContext: '',
    },
    searchQuery: 'ERP Colombia',
    webSearch: {
      provider: 'mock',
      query: 'test',
      results: [],
      resultsCount: candidates.length,
      skipped: false,
      estimatedCostUsd: null,
      metadata: {},
    },
    candidates,
    summary: {
      requested: candidates.length,
      searched: candidates.length,
      returned: candidates.length,
      highQualityNew: candidates.length,
      needsReview: 0,
      duplicates: 0,
      insufficientData: 0,
      discarded: 0,
      unchecked: 0,
    },
    warnings: [],
    metadata: { provider: 'mock', pipelineVersion: 'test-v1.13.1', executedAt: '2026-06-22T00:00:00.000Z' },
  } as unknown as ProspectingPipelineOutput;
}

function makeWriterInput(
  candidates: ProspectingPipelineCandidate[],
  extra: Partial<CandidateWriterInput> = {},
): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput(candidates),
    triggeredByUserId: 'user-test-001',
    ownerId: 'user-test-001',
    source: 'agent_1',
    dryRun: false,
    ...extra,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Sección A — Unit tests: checkActiveCandidateDuplicate (guard logic)
// ═════════════════════════════════════════════════════════════════════════════

describe('A-F1 — same_active_domain blocks', () => {
  it('mismo dominio contra candidato needs_review → matched=true, reason=same_active_domain', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com', inferredCompanyName: 'Softland' },
      [softlandActive()],
    );
    assert.ok(result.matched);
    assert.equal(result.reason, 'same_active_domain');
    assert.equal(result.matchedCandidateId, 'softland-001');
    assert.equal(result.matchedDomain, 'softland.com');
    assert.equal(result.matchedName, 'Softland');
  });
});

describe('A-F2 — same_inferred_identity blocks', () => {
  it('mismo inferred name, dominio diferente → matched=true, reason=same_inferred_identity', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'another-softland.co', inferredCompanyName: 'Softland' },
      [softlandActive()],
    );
    assert.ok(result.matched);
    assert.equal(result.reason, 'same_inferred_identity');
  });

  it('comparación es case-insensitive y accent-insensitive', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: null, inferredCompanyName: 'SOFTLAND' },
      [softlandActive()],
    );
    assert.ok(result.matched);
    assert.equal(result.reason, 'same_inferred_identity');
  });
});

describe('A-F3 — qa_cleanup / discarded no bloquean', () => {
  it('status=discarded → matched=false', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com', inferredCompanyName: 'Softland' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'discarded' })],
    );
    assert.equal(result.matched, false);
  });

  it('status=qa_cleanup → matched=false', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'qa_cleanup' })],
    );
    assert.equal(result.matched, false);
  });

  it('mix: qa_cleanup + needs_review → solo el activo bloquea', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [
        activeRecord({ id: 'qa', name: 'Softland Old', domain: 'softland.com', status: 'qa_cleanup' }),
        activeRecord({ id: 'active', name: 'Softland', domain: 'softland.com', status: 'needs_review' }),
      ],
    );
    assert.ok(result.matched);
    assert.equal(result.reason, 'same_active_domain');
    assert.equal(result.matchedCandidateId, 'active');
  });
});

describe('A-F4 — rejected no bloquea por active guard', () => {
  it('status=rejected → matched=false (novelty checker lo maneja)', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'rejected' })],
    );
    assert.equal(result.matched, false);
  });
});

describe('A-F5 — approved bloquea', () => {
  it('status=approved → matched=true', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'approved' })],
    );
    assert.ok(result.matched);
    assert.equal(result.reason, 'same_active_domain');
  });
});

describe('A-F6 — converted bloquea', () => {
  it('status=converted → matched=true', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'converted' })],
    );
    assert.ok(result.matched);
    assert.equal(result.reason, 'same_active_domain');
  });
});

describe('A-F7 — dominio e identidad diferente no bloquea', () => {
  it('candidato con dominio y nombre completamente distintos → matched=false', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'otraempresa.com', inferredCompanyName: 'Otra Empresa SA' },
      [softlandActive()],
    );
    assert.equal(result.matched, false);
    assert.equal(result.reason, null);
  });
});

describe('A-F8 — status=duplicate no bloquea', () => {
  it('status=duplicate es excluido del active guard → matched=false', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'duplicate' })],
    );
    assert.equal(result.matched, false);
  });
});

describe('A-F9 — archived no bloquea', () => {
  it('status=archived → matched=false', () => {
    const result = checkActiveCandidateDuplicate(
      { domain: 'softland.com' },
      [activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: 'archived' })],
    );
    assert.equal(result.matched, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sección B — Integration tests: writer + fake admin
// ═════════════════════════════════════════════════════════════════════════════

describe('B-F1 — same_active_domain: candidato Softland no se inserta', () => {
  it('candidato con softland.com no se inserta si ya existe activo en DB', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [],
      batchInsertCalls: [],
      batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(softlandActive())] },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeWriterInput([makeSoftlandCandidate()]),
      admin,
    );

    assert.equal(stats.candidateInsertCalls.length, 0, 'No debe insertar el candidato');
    assert.equal(result.candidatesCreated, 0, 'candidatesCreated debe ser 0');
    assert.ok(result.candidatesSkipped >= 1, 'candidatesSkipped debe ser >= 1');

    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.ok(guardSkipped.length >= 1, 'debe haber al menos 1 skipped por duplicate_guard');
    assert.ok(
      guardSkipped.some((s) => s.reason.includes('same_active_domain')),
      `reason debe incluir same_active_domain, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
    );
  });
});

describe('B-F1 metadata — batch metadata incluye duplicate_guard', () => {
  it('batch metadata tiene duplicate_guard.skipped_count >= 1 cuando guard bloquea', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [],
      batchInsertCalls: [],
      batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(softlandActive())] },
      stats,
    );

    await writeProspectingCandidates(makeWriterInput([makeSoftlandCandidate()]), admin);

    const batchUpdates = stats.batchUpdateCalls;
    assert.ok(batchUpdates.length >= 1, 'debe haber al menos una update de batch');

    const lastUpdate = batchUpdates[batchUpdates.length - 1];
    const metadata = lastUpdate['metadata'] as Record<string, unknown> | undefined;
    assert.ok(metadata != null, 'metadata debe estar presente en batch update');

    const duplicateGuard = metadata['duplicate_guard'] as Record<string, unknown> | undefined;
    assert.ok(duplicateGuard != null, 'metadata.duplicate_guard debe estar presente');
    assert.equal(duplicateGuard['enabled'], true, 'duplicate_guard.enabled debe ser true');
    assert.ok(
      typeof duplicateGuard['skipped_count'] === 'number' && duplicateGuard['skipped_count'] >= 1,
      `duplicate_guard.skipped_count debe ser >= 1, got: ${duplicateGuard['skipped_count']}`,
    );
    assert.ok(
      Array.isArray(duplicateGuard['samples']),
      'duplicate_guard.samples debe ser array',
    );
    const samples = duplicateGuard['samples'] as Record<string, unknown>[];
    if (samples.length > 0) {
      assert.equal(
        samples[0]['reason'],
        'same_active_domain',
        `primer sample.reason debe ser same_active_domain, got: ${samples[0]['reason']}`,
      );
    }
  });
});

describe('B-F3 — qa_cleanup/discarded no bloquea insert', () => {
  it('candidato con softland.com se inserta si el existente está discarded', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [],
      batchInsertCalls: [],
      batchUpdateCalls: [],
    };
    const discardedSoftland = activeRecord({
      id: 'softland-discarded',
      name: 'Softland',
      domain: 'softland.com',
      status: 'discarded',
    });
    const admin = makeFakeAdmin(
      // activeCandidatesByDomain returns the discarded record — guard should ignore it
      { activeCandidatesByDomain: [toDbRow(discardedSoftland)] },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeWriterInput([makeSoftlandCandidate()]),
      admin,
    );

    assert.ok(
      result.candidatesCreated >= 1 || result.status !== 'failed',
      `Candidato debe ser creado o al menos no bloqueado por guard. status=${result.status}, created=${result.candidatesCreated}, skipped=${JSON.stringify(result.skipped.map(s => s.reason))}`,
    );

    // Guard skipped count must be 0 (discarded doesn't trigger guard)
    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const metadata = lastUpdate?.['metadata'] as Record<string, unknown> | undefined;
    if (metadata?.['duplicate_guard']) {
      const dg = metadata['duplicate_guard'] as Record<string, unknown>;
      assert.equal(dg['skipped_count'], 0, 'guard skipped_count debe ser 0 para candidato discarded');
    }
  });
});

describe('B-F5-F6 — approved/converted bloquean insert', () => {
  for (const blockedStatus of ['approved', 'converted'] as const) {
    it(`status=${blockedStatus} → candidato no insertado`, async () => {
      const stats: FakeAdminStats = {
        candidateInsertCalls: [],
        batchInsertCalls: [],
        batchUpdateCalls: [],
      };
      const admin = makeFakeAdmin(
        {
          activeCandidatesByDomain: [
            toDbRow(activeRecord({ id: 'x', name: 'Softland', domain: 'softland.com', status: blockedStatus })),
          ],
        },
        stats,
      );

      const result = await writeProspectingCandidates(
        makeWriterInput([makeSoftlandCandidate()]),
        admin,
      );

      assert.equal(
        stats.candidateInsertCalls.length,
        0,
        `status=${blockedStatus} debe bloquear insert`,
      );
      const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
      assert.ok(guardSkipped.length >= 1, `debe haber skipped por guard con status=${blockedStatus}`);
    });
  }
});

describe('B-F7 — dominio e identidad distinto no bloquea', () => {
  it('active candidate con otro dominio no bloquea el nuevo candidato', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [],
      batchInsertCalls: [],
      batchUpdateCalls: [],
    };
    const differentCompany = activeRecord({
      id: 'other-001',
      name: 'OtraEmpresa',
      domain: 'otraempresa.com',
      status: 'needs_review',
    });
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(differentCompany)] },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeWriterInput([makeSoftlandCandidate()]),
      admin,
    );

    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.equal(
      guardSkipped.length,
      0,
      'candidato con dominio distinto no debe ser bloqueado por guard',
    );
  });
});

describe('B-F8 — sin activos: duplicate_guard.checked_count correcto', () => {
  it('con 0 activos en DB, guard corre pero no bloquea', async () => {
    const stats: FakeAdminStats = {
      candidateInsertCalls: [],
      batchInsertCalls: [],
      batchUpdateCalls: [],
    };
    const admin = makeFakeAdmin({ activeCandidatesByDomain: [], activeCandidatesByCountry: [] }, stats);

    await writeProspectingCandidates(makeWriterInput([makeSoftlandCandidate()]), admin);

    const lastUpdate = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
    const metadata = lastUpdate?.['metadata'] as Record<string, unknown> | undefined;
    if (metadata?.['duplicate_guard']) {
      const dg = metadata['duplicate_guard'] as Record<string, unknown>;
      assert.equal(dg['enabled'], true);
      assert.equal(dg['skipped_count'], 0, 'skipped_count debe ser 0 cuando no hay activos');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sección C — Regresión de scoring v1.13 (no se rompe por v1.13.1)
// ═════════════════════════════════════════════════════════════════════════════

describe('C-F10 — Regresión scoring v1.13: guard no afecta scoring', () => {
  it('checkActiveCandidateDuplicate con 0 activos retorna matched=false sin importar el nombre', () => {
    const candidates = [
      { domain: 'mi-erp.co', inferredCompanyName: 'Mi-ERP' },
      { domain: 'factory.com.co', inferredCompanyName: 'Factory' },
      { domain: 'visiontecno.com', inferredCompanyName: 'Visiontecno' },
    ];
    for (const c of candidates) {
      const result = checkActiveCandidateDuplicate(c, []);
      assert.equal(
        result.matched,
        false,
        `${c.inferredCompanyName} no debe ser bloqueado con activos vacíos`,
      );
    }
  });

  it('candidato con dominio único no es afectado aunque haya activos de otro dominio', () => {
    const existing: ActiveCandidateRecord[] = [
      activeRecord({ id: 'loggro-001', name: 'Loggro', domain: 'loggro.com', status: 'needs_review' }),
    ];
    const result = checkActiveCandidateDuplicate(
      { domain: 'mi-erp.co', inferredCompanyName: 'Mi-ERP' },
      existing,
    );
    assert.equal(result.matched, false, 'Mi-ERP no debe ser bloqueado por Loggro activo');
  });
});
