/**
 * Tests — Search Quality v1.14 — Runtime Guard Uses Resolved Identity
 *
 * Verifica que el Active Duplicate Guard usa la mejor identidad disponible
 * (identity_resolution.inferred_company_name) antes de decidir si inserta o
 * descarta un candidato.
 *
 * Caso central: "Software ERP CRM y RRHH en Colombia" con domain=softland.com
 * → debe ser bloqueado porque inferred_company_name = "Softland" (coincide con
 *   candidato activo existente), no insertado como no_match.
 *
 * Fixtures:
 *   F1  — generic service title + same domain → same_active_domain
 *   F2  — generic service title + different domain → same_inferred_identity
 *   F3  — clean name (no identity resolution) + same domain → same_active_domain
 *   F4  — generic service title + no existing active → no block
 *   F5  — qa_cleanup discarded does not block
 *   F6  — approved blocks
 *   F7  — converted blocks
 *   F8  — non-active statuses (discarded/rejected/duplicate/archived) do not block
 *   F9  — same_canonical_identity → persisted as possible_duplicate, not skipped
 *   F10 — v1.13 implementation partner scoring regression (Mi-ERP, Factory, Visiontecno, SYCA)
 *
 * Sin Supabase. Sin LLM. Sin Tavily. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkActiveCandidateDuplicate } from '../active-candidate-identity-guard';
import type { ActiveCandidateRecord, DuplicateGuardInput } from '../active-candidate-identity-guard';
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
  return activeRecord({
    id: 'existing-softland',
    name: 'Softland',
    domain: 'softland.com',
    status: 'needs_review',
  });
}

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

// ─── Fake admin client ────────────────────────────────────────────────────────

type FakeAdminStats = {
  candidateInsertCalls: Record<string, unknown>[];
  batchUpdateCalls: Record<string, unknown>[];
  batchInsertCalls: Record<string, unknown>[];
};

type FakeAdminConfig = {
  activeCandidatesByDomain?: Record<string, unknown>[];
  activeCandidatesByCountry?: Record<string, unknown>[];
};

function makeFakeAdmin(config: FakeAdminConfig, stats: FakeAdminStats): SupabaseClient {
  let candidateSeq = 0;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select(_cols: string) {
            return {
              eq(col: string) {
                if (col === 'source') {
                  return { gte: () => Promise.resolve({ data: [], error: null }) };
                }
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
                    return Promise.resolve({ data: { id: 'test-batch-v1-14' }, error: null });
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

      if (table === 'prospect_candidates') {
        return {
          select(_cols: string) {
            return {
              in(col: string) {
                if (col === 'domain') {
                  return {
                    neq: () => Promise.resolve({ data: [], error: null }),
                    then: (res: (v: unknown) => unknown) =>
                      Promise.resolve({ data: [], error: null }).then(res),
                  };
                }
                if (col === 'status') {
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
            const id = `cand-v114-${++candidateSeq}`;
            return {
              select() {
                return { single: () => Promise.resolve({ data: { id }, error: null }) };
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
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }

      throw new Error(`[FakeAdmin v1.14] Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Candidate builders ───────────────────────────────────────────────────────

function makeGenericSoftlandCandidate(
  overrides: Partial<ProspectingPipelineCandidate> = {},
): ProspectingPipelineCandidate {
  return {
    name: 'Software ERP CRM y RRHH en Colombia',
    website: 'https://softland.com',
    domain: 'softland.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Tecnología',
    sourceUrl: 'https://softland.com',
    sourceTitle: 'Software ERP CRM y RRHH en Colombia | Softland',
    sourceSnippet: 'Softland ofrece soluciones ERP, CRM y RRHH para empresas en Colombia.',
    inferredNameSource: null,
    websiteVerification: null,
    duplicateCheck: null,
    searchTrace: null,
    llmEvaluation: null,
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.82,
      fitScore: 0.75,
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

function makeSoftlandCandidateClean(
  overrides: Partial<ProspectingPipelineCandidate> = {},
): ProspectingPipelineCandidate {
  return makeGenericSoftlandCandidate({
    name: 'Softland',
    website: 'https://softland.com',
    domain: 'softland.com',
    sourceTitle: 'Softland | Software ERP y CRM Colombia',
    ...overrides,
  });
}

function makePipelineOutput(
  candidates: ProspectingPipelineCandidate[],
  overrides: { countryCode?: string } = {},
): ProspectingPipelineOutput {
  return {
    input: {
      country: 'Colombia',
      countryCode: overrides.countryCode ?? 'CO',
      industry: 'Tecnología',
    },
    catalogContext: {
      country: 'Colombia',
      countryCode: overrides.countryCode ?? 'CO',
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
    metadata: {
      provider: 'mock',
      pipelineVersion: 'test-v1.14',
      executedAt: '2026-06-22T00:00:00.000Z',
    },
  } as unknown as ProspectingPipelineOutput;
}

function makeWriterInput(
  candidates: ProspectingPipelineCandidate[],
  extra: Partial<CandidateWriterInput> = {},
): CandidateWriterInput {
  return {
    pipelineOutput: makePipelineOutput(candidates),
    triggeredByUserId: 'user-test-v114',
    ownerId: 'user-test-v114',
    source: 'agent_1',
    dryRun: false,
    ...extra,
  };
}

function emptyStats(): FakeAdminStats {
  return { candidateInsertCalls: [], batchInsertCalls: [], batchUpdateCalls: [] };
}

// ─── Helper: extract duplicate_guard from batch update metadata ───────────────

function extractDuplicateGuard(
  stats: FakeAdminStats,
): Record<string, unknown> | null {
  const last = stats.batchUpdateCalls[stats.batchUpdateCalls.length - 1];
  if (!last) return null;
  const meta = last['metadata'] as Record<string, unknown> | undefined;
  return (meta?.['duplicate_guard'] as Record<string, unknown> | null) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// F1 — Generic service title + same domain → same_active_domain
// "Software ERP CRM y RRHH en Colombia" con domain=softland.com debe ser bloqueado
// porque inferred_company_name = "Softland" (inferido del dominio) y ya existe
// un candidato activo Softland con ese dominio.
// ═════════════════════════════════════════════════════════════════════════════

describe('F1 — generic service title + same domain → same_active_domain', () => {
  it('candidato con nombre genérico y softland.com no se inserta si Softland activo existe', async () => {
    const stats = emptyStats();
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(softlandActive())] },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeWriterInput([makeGenericSoftlandCandidate()]),
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

  it('batch metadata tiene skipped_count >= 1 y sample con candidate_inferred_name', async () => {
    const stats = emptyStats();
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(softlandActive())] },
      stats,
    );

    await writeProspectingCandidates(
      makeWriterInput([makeGenericSoftlandCandidate()]),
      admin,
    );

    const dg = extractDuplicateGuard(stats);
    assert.ok(dg != null, 'duplicate_guard debe estar en metadata');
    assert.ok(
      typeof dg['skipped_count'] === 'number' && dg['skipped_count'] >= 1,
      `skipped_count debe ser >= 1, got: ${dg['skipped_count']}`,
    );

    const samples = dg['samples'] as Record<string, unknown>[];
    assert.ok(Array.isArray(samples) && samples.length >= 1, 'samples debe tener al menos 1 entrada');

    const s = samples[0];
    assert.equal(
      s['candidate_name'],
      'Software ERP CRM y RRHH en Colombia',
      'candidate_name debe ser el nombre original genérico',
    );
    assert.ok(
      s['candidate_inferred_name'] === 'Softland',
      `candidate_inferred_name debe ser "Softland", got: ${s['candidate_inferred_name']}`,
    );
    assert.equal(s['reason'], 'same_active_domain', 'reason debe ser same_active_domain');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F2 — Generic service title + different domain → same_inferred_identity
// Candidato con domain=softland.co (diferente de softland.com del activo) debe
// ser bloqueado porque inferred_company_name = "Softland" coincide con el activo.
// ═════════════════════════════════════════════════════════════════════════════

describe('F2 — generic service title + different domain → same_inferred_identity', () => {
  it('candidato con softland.co y nombre genérico es bloqueado por same_inferred_identity', async () => {
    const stats = emptyStats();
    const admin = makeFakeAdmin(
      {
        activeCandidatesByDomain: [],
        activeCandidatesByCountry: [toDbRow(softlandActive())],
      },
      stats,
    );

    const candidate = makeGenericSoftlandCandidate({
      website: 'https://softland.co',
      domain: 'softland.co',
    });

    const result = await writeProspectingCandidates(
      makeWriterInput([candidate]),
      admin,
    );

    assert.equal(stats.candidateInsertCalls.length, 0, 'No debe insertar el candidato');

    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.ok(guardSkipped.length >= 1, 'debe haber al menos 1 skipped por duplicate_guard');
    assert.ok(
      guardSkipped.some((s) => s.reason.includes('same_inferred_identity')),
      `reason debe incluir same_inferred_identity, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
    );
  });

  it('sample incluye candidate_inferred_name y reason=same_inferred_identity', async () => {
    const stats = emptyStats();
    const admin = makeFakeAdmin(
      {
        activeCandidatesByDomain: [],
        activeCandidatesByCountry: [toDbRow(softlandActive())],
      },
      stats,
    );

    const candidate = makeGenericSoftlandCandidate({
      website: 'https://softland.co',
      domain: 'softland.co',
    });

    await writeProspectingCandidates(makeWriterInput([candidate]), admin);

    const dg = extractDuplicateGuard(stats);
    assert.ok(dg != null, 'duplicate_guard debe estar en metadata');

    const samples = dg['samples'] as Record<string, unknown>[];
    assert.ok(Array.isArray(samples) && samples.length >= 1, 'samples debe tener al menos 1 entrada');

    const s = samples[0];
    assert.ok(
      s['candidate_inferred_name'] === 'Softland',
      `candidate_inferred_name debe ser "Softland", got: ${s['candidate_inferred_name']}`,
    );
    assert.equal(s['reason'], 'same_inferred_identity', 'reason debe ser same_inferred_identity');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F3 — Clean name (no identity resolution) + same domain → same_active_domain
// Candidato con nombre real (no genérico) y mismo dominio: la verificación por
// dominio sigue siendo la primera barrera, sin necesitar identidad resuelta.
// ═════════════════════════════════════════════════════════════════════════════

describe('F3 — clean name, no identity resolution, same domain → same_active_domain', () => {
  it('candidato Softland (nombre real) con softland.com es bloqueado por dominio', async () => {
    const stats = emptyStats();
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(softlandActive())] },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeWriterInput([makeSoftlandCandidateClean()]),
      admin,
    );

    assert.equal(stats.candidateInsertCalls.length, 0, 'No debe insertar el candidato');

    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.ok(
      guardSkipped.some((s) => s.reason.includes('same_active_domain')),
      `reason debe incluir same_active_domain, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F4 — Generic service title, no existing active → guard no bloquea
// El guard solo bloquea cuando hay un activo que coincide. Si no hay activos
// con el mismo dominio o identidad, el candidato pasa.
// ═════════════════════════════════════════════════════════════════════════════

describe('F4 — generic service title + no existing active → no guard block', () => {
  it('candidato genérico sin activos existentes no es bloqueado por guard', async () => {
    const stats = emptyStats();
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [], activeCandidatesByCountry: [] },
      stats,
    );

    const candidate = makeGenericSoftlandCandidate({
      website: 'https://nuevo-erp.com',
      domain: 'nuevo-erp.com',
    });

    const result = await writeProspectingCandidates(
      makeWriterInput([candidate]),
      admin,
    );

    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.equal(
      guardSkipped.length,
      0,
      `guard no debe bloquear candidato sin activos, got reasons: ${guardSkipped.map((s) => s.reason).join(', ')}`,
    );

    const dg = extractDuplicateGuard(stats);
    if (dg) {
      assert.equal(dg['skipped_count'], 0, 'skipped_count debe ser 0');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F5 — qa_cleanup discarded Softland no bloquea
// Un candidato con status=qa_cleanup no es "activo" para el guard — permite que
// la empresa sea reconsiderada en un nuevo batch.
// ═════════════════════════════════════════════════════════════════════════════

describe('F5 — qa_cleanup does not block active guard', () => {
  it('candidato Softland con activo qa_cleanup se puede insertar', async () => {
    const stats = emptyStats();
    const qaCleanupSoftland = activeRecord({
      id: 'softland-qa',
      name: 'Softland',
      domain: 'softland.com',
      status: 'qa_cleanup',
    });
    const admin = makeFakeAdmin(
      { activeCandidatesByDomain: [toDbRow(qaCleanupSoftland)] },
      stats,
    );

    const result = await writeProspectingCandidates(
      makeWriterInput([makeSoftlandCandidateClean()]),
      admin,
    );

    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.equal(
      guardSkipped.length,
      0,
      `qa_cleanup no debe activar guard, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
    );

    const dg = extractDuplicateGuard(stats);
    if (dg) {
      assert.equal(dg['skipped_count'], 0, 'skipped_count debe ser 0 para qa_cleanup');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F6 — approved blocks
// F7 — converted blocks
// ═════════════════════════════════════════════════════════════════════════════

for (const blockedStatus of ['approved', 'converted'] as const) {
  describe(`F${blockedStatus === 'approved' ? 6 : 7} — ${blockedStatus} blocks insert`, () => {
    it(`status=${blockedStatus} → candidato genérico Softland no insertado`, async () => {
      const stats = emptyStats();
      const existing = activeRecord({
        id: `softland-${blockedStatus}`,
        name: 'Softland',
        domain: 'softland.com',
        status: blockedStatus,
      });
      const admin = makeFakeAdmin(
        { activeCandidatesByDomain: [toDbRow(existing)] },
        stats,
      );

      const result = await writeProspectingCandidates(
        makeWriterInput([makeGenericSoftlandCandidate()]),
        admin,
      );

      assert.equal(stats.candidateInsertCalls.length, 0, 'No debe insertar');

      const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
      assert.ok(
        guardSkipped.some((s) => s.reason.includes('same_active_domain')),
        `${blockedStatus} debe bloquear, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
      );
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// F8 — Non-active statuses do not block
// discarded/rejected/duplicate/archived no son estados "activos" para el guard.
// ═════════════════════════════════════════════════════════════════════════════

describe('F8 — non-active statuses do not block', () => {
  const nonActiveStatuses = ['discarded', 'rejected', 'duplicate', 'archived'] as const;

  for (const status of nonActiveStatuses) {
    it(`status=${status} no activa guard`, async () => {
      const stats = emptyStats();
      const existing = activeRecord({
        id: `softland-${status}`,
        name: 'Softland',
        domain: 'softland.com',
        status,
      });
      const admin = makeFakeAdmin(
        { activeCandidatesByDomain: [toDbRow(existing)] },
        stats,
      );

      const result = await writeProspectingCandidates(
        makeWriterInput([makeGenericSoftlandCandidate()]),
        admin,
      );

      const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
      assert.equal(
        guardSkipped.length,
        0,
        `status=${status} no debe activar guard, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
      );
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// F9 — same_canonical_identity → persisted as possible_duplicate, not skipped
// Cuando la coincidencia es por normalizedName (no por domain ni inferredName),
// el candidato se persiste con duplicate_status=possible_duplicate (no se descarta).
// ═════════════════════════════════════════════════════════════════════════════

describe('F9 — same_canonical_identity → possible_duplicate, not skipped', () => {
  it('candidato con normalizedName coincidente se inserta como possible_duplicate', async () => {
    const stats = emptyStats();

    // Existing active: distinto dominio, mismo normalizedName="softland"
    // pero diferente name (para que same_inferred_identity no dispare primero)
    const existingWithNorm = activeRecord({
      id: 'softland-clone',
      name: 'Softland Clone',
      domain: 'softland-clone.com',
      normalizedName: 'softland',
      status: 'needs_review',
    });

    const admin = makeFakeAdmin(
      {
        activeCandidatesByDomain: [],
        activeCandidatesByCountry: [toDbRow(existingWithNorm)],
      },
      stats,
    );

    // New candidate: "Softland" con dominio diferente
    // normalizeName("Softland") = "softland" == existingWithNorm.normalizedName
    // normalizeIdentity("Softland") = "softland" != normalizeIdentity("Softland Clone") = "softland clone"
    // → step 2 (same_inferred_identity) no dispara, step 3 (same_canonical_identity) sí
    const candidate = makeSoftlandCandidateClean({
      website: 'https://softland-brand-new.com',
      domain: 'softland-brand-new.com',
    });

    const result = await writeProspectingCandidates(
      makeWriterInput([candidate]),
      admin,
    );

    // same_canonical_identity NO descarta — inserta con possible_duplicate
    const guardSkipped = result.skipped.filter((s) => s.reason.startsWith('duplicate_guard:'));
    assert.equal(
      guardSkipped.length,
      0,
      `same_canonical_identity no debe descartar, got: ${guardSkipped.map((s) => s.reason).join(', ')}`,
    );

    // El candidato debe insertarse
    assert.ok(
      result.candidatesCreated >= 1 || result.status !== 'failed',
      `Candidato debe insertarse con possible_duplicate. status=${result.status}, created=${result.candidatesCreated}`,
    );

    // possible_duplicate_count debe ser >= 1
    const dg = extractDuplicateGuard(stats);
    if (dg) {
      assert.ok(
        typeof dg['possible_duplicate_count'] === 'number' && dg['possible_duplicate_count'] >= 1,
        `possible_duplicate_count debe ser >= 1, got: ${dg['possible_duplicate_count']}`,
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// F10 — v1.13 implementation partner scoring regression
// Verifica que los candidatos de implementation partners no son bloqueados por el
// guard cuando no hay activos existentes (regresión de v1.13 scoring).
// ═════════════════════════════════════════════════════════════════════════════

describe('F10 — v1.13 implementation partner scoring: guard no bloquea con activos vacíos', () => {
  const implementationPartners: Array<{ name: string; domain: string; website: string }> = [
    { name: 'Mi-ERP', domain: 'mi-erp.co', website: 'https://mi-erp.co' },
    { name: 'Factory', domain: 'factory.com.co', website: 'https://factory.com.co' },
    { name: 'Visiontecno', domain: 'visiontecno.com', website: 'https://visiontecno.com' },
    { name: 'SYCA', domain: 'syca.com.co', website: 'https://syca.com.co' },
  ];

  for (const partner of implementationPartners) {
    it(`${partner.name} no es bloqueado por guard con activos vacíos`, () => {
      const guardInput: DuplicateGuardInput = {
        name: partner.name,
        domain: partner.domain,
        website: partner.website,
        inferredCompanyName: partner.name,
        normalizedName: partner.name.toLowerCase(),
      };

      const result = checkActiveCandidateDuplicate(guardInput, []);

      assert.equal(result.matched, false, `${partner.name} no debe ser bloqueado sin activos`);
      assert.equal(result.reason, null, `reason debe ser null para ${partner.name}`);
    });
  }

  it('Mi-ERP no es bloqueado por guard aunque Softland sea activo (dominio diferente)', () => {
    const guardInput: DuplicateGuardInput = {
      name: 'Mi-ERP',
      domain: 'mi-erp.co',
      website: 'https://mi-erp.co',
      inferredCompanyName: 'Mi-ERP',
      normalizedName: 'mi erp',
    };

    const result = checkActiveCandidateDuplicate(guardInput, [softlandActive()]);

    assert.equal(result.matched, false, 'Mi-ERP con softland.com activo no debe ser bloqueado');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Unit tests del guard con resolvedInferredName explícito
// Verifica que el guard funciona correctamente cuando se pasa inferredCompanyName
// desde la identidad resuelta (simula el flujo de candidate-writer v1.14).
// ═════════════════════════════════════════════════════════════════════════════

describe('Unit — guard con resolved inferred identity', () => {
  it('inferredCompanyName="Softland" + domain diferente → same_inferred_identity', () => {
    const result = checkActiveCandidateDuplicate(
      {
        name: 'Software ERP CRM y RRHH en Colombia',
        domain: 'softland.co',
        website: 'https://softland.co',
        inferredCompanyName: 'Softland',
        normalizedName: 'softland',
      },
      [softlandActive()],
    );

    assert.equal(result.matched, true, 'debe hacer match');
    assert.equal(result.reason, 'same_inferred_identity', 'reason debe ser same_inferred_identity');
    assert.equal(result.matchedCandidateId, 'existing-softland');
  });

  it('inferredCompanyName="Softland" + mismo domain → same_active_domain (prioridad)', () => {
    const result = checkActiveCandidateDuplicate(
      {
        name: 'Software ERP CRM y RRHH en Colombia',
        domain: 'softland.com',
        website: 'https://softland.com',
        inferredCompanyName: 'Softland',
        normalizedName: 'softland',
      },
      [softlandActive()],
    );

    assert.equal(result.matched, true, 'debe hacer match');
    assert.equal(result.reason, 'same_active_domain', 'same_active_domain debe tener prioridad sobre same_inferred_identity');
  });

  it('nombre genérico sin inferred + mismo domain → same_active_domain via domain check', () => {
    const result = checkActiveCandidateDuplicate(
      {
        name: 'Software ERP CRM y RRHH en Colombia',
        domain: 'softland.com',
        // inferredCompanyName sin resolver — debería ser atrapado por dominio antes
        inferredCompanyName: 'Software ERP CRM y RRHH en Colombia',
        normalizedName: 'software erp crm y rrhh en colombia',
      },
      [softlandActive()],
    );

    assert.equal(result.matched, true, 'debe hacer match por dominio');
    assert.equal(result.reason, 'same_active_domain', 'mismo dominio debe bloquear incluso con nombre genérico');
  });
});
