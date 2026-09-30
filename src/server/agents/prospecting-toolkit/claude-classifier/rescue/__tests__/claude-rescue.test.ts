/**
 * Tests — Agente 1 · Rescate con Claude (AGENT1-CLAUDE-RESCUE-1).
 *
 * Sin red ni base de datos: Claude, Supabase y los reclamos son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideRescue, quoteNamesIndustry } from '../rescue-decision';
import { buildCandidateRescuePatch, buildLinkedInEnrichmentFromClaude, resolveCompletenessConditions, rescueStillPending } from '../rescue-patch';
import {
  buildDispositionAdmissionOrigin,
  buildDispositionStaysEvidence,
  needsDispositionRescue,
  type RescuableDispositionRow,
} from '../rescue-dispositions';
import { needsCandidateRescue, rescueBatchWithClaude, RESCUE_RUN_DEADLINE_MS, type RescueBatchDeps } from '../rescue-batch';
import type { ClassifiableCandidateRow } from '../../classification-metadata';
import type { CompanyClassificationResult } from '../../types';

const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const AT = '2026-09-30T12:00:00.000Z';
const SALUD = 'Salud & Farmacéuticos';

function result(overrides: Partial<CompanyClassificationResult> = {}): CompanyClassificationResult {
  return {
    candidateId: 'c1',
    outcome: 'classified',
    sector: {
      industryId: 'salud',
      industryName: SALUD,
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: true,
      quote: 'Somos una clínica privada con más de 1.200 colaboradores',
      sourceUrl: 'https://clinica.pe/',
      confidence: 0.9,
      verification: 'quote_verified',
    },
    employeeRange: {
      min: 1001,
      max: 5000,
      quote: 'De 1.001 a 5.000 empleados',
      sourceUrl: 'https://pe.linkedin.com/company/clinica',
      confidence: 0.7,
      verification: 'source_listed',
      status: 'estimated',
    },
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://clinica.pe/',
    usage: {
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 5000,
      outputTokens: 300,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 1,
      webFetchRequests: 0,
      estimatedCostUsd: 0.035,
      pricingSource: 'table',
    },
    errorCode: null,
    durationMs: 10,
    pageSource: 'own_fetch',
    ...overrides,
  };
}

const CTX = { icpMinEmployees: 200 };

// ─── A. La decisión ──────────────────────────────────────────────────────────

describe('A. decideRescue', () => {
  it('sector del lote + tamaño ≥200 → admitir con ambos confirmados', () => {
    assert.deepEqual(decideRescue(result(), CTX), { kind: 'admit', sectorConfirmed: true, sizeConfirmed: true, linkedinConfirmed: false });
  });

  it('sector de otro lote con cita COMPROBADA → descartar por sector', () => {
    const d = decideRescue(
      result({ sector: { ...result().sector!, matchesCurrentIndustry: false, industryName: 'Minería' } }),
      CTX,
    );
    assert.equal(d.kind, 'discard');
    assert.equal(d.kind === 'discard' && d.reason, 'claude_sector_mismatch');
  });

  it('sector de otro lote con cita SIN comprobar → no descarta; sólo completa el tamaño', () => {
    const d = decideRescue(
      result({ sector: { ...result().sector!, matchesCurrentIndustry: false, verification: 'source_listed' } }),
      CTX,
    );
    assert.deepEqual(d, { kind: 'admit', sectorConfirmed: false, sizeConfirmed: true, linkedinConfirmed: false });
  });

  it('LinkedIn verificado se marca como confirmado', () => {
    const d = decideRescue(
      result({ linkedin: { url: 'https://www.linkedin.com/company/clinica', slug: 'clinica', source: 'website_social_link' } }),
      CTX,
    );
    assert.equal(d.kind === 'admit' && d.linkedinConfirmed, true);
  });

  it('menos de 200 con cita comprobada → descartar por tamaño', () => {
    const d = decideRescue(
      result({ employeeRange: { ...result().employeeRange!, min: 51, max: 200 - 1, verification: 'quote_verified', confidence: 0.9 } }),
      CTX,
    );
    assert.equal(d.kind === 'discard' && d.reason, 'claude_size_below_min');
  });

  it('rango que cruza el umbral (150–300) → sector confirmado, tamaño no', () => {
    const d = decideRescue(result({ employeeRange: { ...result().employeeRange!, min: 150, max: 300 } }), CTX);
    assert.deepEqual(d, { kind: 'admit', sectorConfirmed: true, sizeConfirmed: false, linkedinConfirmed: false });
  });

  it('sin veredicto (sitio caído, nada verificable) → sin cambios', () => {
    assert.equal(decideRescue(result({ outcome: 'website_unreachable', sector: null, employeeRange: null }), CTX).kind, 'unchanged');
    assert.equal(decideRescue(result({ outcome: 'nothing_verifiable', sector: null, employeeRange: null }), CTX).kind, 'unchanged');
  });
});

// ─── B. Qué se escribe en un candidato ──────────────────────────────────────

const REVIEW_METADATA = {
  target_completeness: {
    failed_conditions: ['subindustry_match', 'employee_count_status'],
    blocking_reasons: ['subindustry_match'],
    review_only_reasons: ['subindustry_match'],
    requested_subindustries: [],
    complete_valid: false,
    counts_toward_target: false,
  },
  icp_size_gate: { threshold: 200, decision: 'pass', size_status: 'unknown' },
  otro: 'se conserva',
};

describe('B. buildCandidateRescuePatch', () => {
  it('admitir: queda completo, cuenta para la meta, ICP >200 y tamaño estimado en columnas', () => {
    const p = buildCandidateRescuePatch({
      metadata: REVIEW_METADATA,
      result: result(),
      decision: { kind: 'admit', sectorConfirmed: true, sizeConfirmed: true, linkedinConfirmed: false },
      minEmployees: 200,
      decidedAt: AT,
    });
    const tc = p.metadata.target_completeness as Record<string, unknown>;
    assert.deepEqual(tc.failed_conditions, []);
    assert.equal(tc.counts_toward_target, true);
    assert.equal((p.metadata.icp_size_gate as Record<string, unknown>).size_status, 'estimated_above_threshold');
    assert.equal(p.employee_count, 1001);
    assert.equal(p.employee_count_status, 'estimated_100_plus');
    assert.equal(p.employee_count_confidence, 70);
    assert.equal(p.status, undefined, 'admitir NUNCA cambia el estado: nada se aprueba solo');
    assert.equal(p.metadata.otro, 'se conserva');
  });

  it('descartar: pasa a discarded con el motivo de Claude', () => {
    const p = buildCandidateRescuePatch({
      metadata: REVIEW_METADATA,
      result: result(),
      decision: { kind: 'discard', reason: 'claude_sector_mismatch', detail: 'Según Claude es Minería', sourceUrl: 'https://x.pe' },
      minEmployees: 200,
      decidedAt: AT,
    });
    assert.equal(p.status, 'discarded');
    assert.match(p.review_notes ?? '', /Claude/);
    assert.equal((p.metadata.claude_rescue as Record<string, unknown>).discard_reason, 'claude_sector_mismatch');
  });

  it('otras condiciones pendientes (p. ej. LinkedIn) siguen impidiendo contar para la meta', () => {
    const { completeness } = resolveCompletenessConditions(
      { failed_conditions: ['subindustry_match', 'linkedin_status'], requested_subindustries: [] },
      { kind: 'admit', sectorConfirmed: true, sizeConfirmed: false, linkedinConfirmed: false },
    );
    assert.deepEqual(completeness?.failed_conditions, ['linkedin_status']);
    assert.equal(completeness?.counts_toward_target, false);
  });

  it('con subindustrias pedidas, la macroindustria no resuelve subindustry_match', () => {
    const { resolved } = resolveCompletenessConditions(
      { failed_conditions: ['subindustry_match'], requested_subindustries: ['x'] },
      { kind: 'admit', sectorConfirmed: true, sizeConfirmed: false, linkedinConfirmed: false },
    );
    assert.deepEqual(resolved, []);
  });

  it('no muta la metadata recibida', () => {
    const original = JSON.parse(JSON.stringify(REVIEW_METADATA));
    buildCandidateRescuePatch({
      metadata: REVIEW_METADATA,
      result: result(),
      decision: { kind: 'admit', sectorConfirmed: true, sizeConfirmed: true, linkedinConfirmed: false },
      minEmployees: 200,
      decidedAt: AT,
    });
    assert.deepEqual(REVIEW_METADATA, original);
  });

  it('sitio caído → marca reintentable', () => {
    const p = buildCandidateRescuePatch({
      metadata: REVIEW_METADATA,
      result: result({ outcome: 'website_unreachable', sector: null, employeeRange: null }),
      decision: { kind: 'unchanged', why: 'not_classified' },
      minEmployees: 200,
      decidedAt: AT,
    });
    assert.equal((p.metadata.claude_rescue as Record<string, unknown>).decision, 'retryable');
    assert.equal(rescueStillPending(p.metadata.claude_rescue, NOW), true);
  });
});

// ─── C. Descartadas por falta de datos ──────────────────────────────────────

function disposition(overrides: Partial<RescuableDispositionRow> = {}): RescuableDispositionRow {
  return {
    id: 'd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'Clínica X',
    domain: 'clinica.pe',
    country_code: 'PE',
    industry: SALUD,
    reason_code: 'sub_industry_branch_parent_only',
    evidence: {},
    ...overrides,
  };
}

describe('C. descartadas', () => {
  it('sólo se rescatan los motivos de «faltaba un dato»', () => {
    assert.equal(needsDispositionRescue(disposition(), NOW), true);
    assert.equal(needsDispositionRescue(disposition({ reason_code: 'enrichment_budget_exhausted_final' }), NOW), true);
    assert.equal(needsDispositionRescue(disposition({ reason_code: 'hubspot_duplicate_final' }), NOW), false);
    assert.equal(needsDispositionRescue(disposition({ reason_code: 'cooldown_final' }), NOW), false);
    assert.equal(needsDispositionRescue(disposition({ domain: null }), NOW), false);
    assert.equal(needsDispositionRescue(disposition({ status: 'sent_to_review' }), NOW), false);
  });

  it('una ya decidida no se vuelve a pagar; una reintentable sí', () => {
    const done = disposition({ evidence: { claude_rescue: { decision: 'discard' } } });
    const retry = disposition({ evidence: { claude_rescue: { decision: 'retryable' } } });
    assert.equal(needsDispositionRescue(done, NOW), false);
    assert.equal(needsDispositionRescue(retry, NOW), true);
  });

  it('al admitir, el candidato nuevo trae la clasificación, el tamaño y una nota de rescate (no human_override)', () => {
    const origin = buildDispositionAdmissionOrigin(result(), { kind: 'admit', sectorConfirmed: true, sizeConfirmed: true, linkedinConfirmed: false }, 200, AT);
    assert.equal(origin.kind, 'claude_rescue');
    assert.match(origin.reviewNote, /Rescatada por Claude/);
    assert.equal(origin.columns?.employee_count, 1001);
    assert.ok(origin.metadata.claude_classification);
    assert.equal('human_override' in origin.metadata, false);
  });

  it('si se queda en Descartadas, la evidencia guarda la clasificación de Claude', () => {
    const e = buildDispositionStaysEvidence({ previa: 1 }, result(), { kind: 'unchanged', why: 'sector_unknown' }, AT);
    assert.equal(e.previa, 1);
    assert.ok(e.claude_classification);
    assert.equal((e.claude_rescue as Record<string, unknown>).decision, 'unchanged');
  });
});

// ─── D. El lote completo ─────────────────────────────────────────────────────

function candidate(overrides: Partial<ClassifiableCandidateRow> = {}): ClassifiableCandidateRow {
  return {
    id: 'c1',
    industry_id: null,
    industry: SALUD,
    name: 'Clínica',
    website: 'clinica.pe',
    domain: 'clinica.pe',
    country_code: 'PE',
    country: 'Perú',
    status: 'needs_review',
    metadata: REVIEW_METADATA,
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<RescueBatchDeps> = {}) {
  const writes: Array<{ id: string; patch: unknown }> = [];
  const evidenceWrites: Array<{ id: string; evidence: unknown }> = [];
  const admitted: string[] = [];
  const claimed: string[][] = [];
  const logs: unknown[] = [];
  const candidateMeta = new Map<string, Record<string, unknown> | null>();
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: 'claude-haiku-4-5-20251001', apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [{ industryId: 'salud', industryName: SALUD, industryDescription: null, subindustries: [] }],
    loadReviewCandidates: async () => [candidate()],
    loadDispositions: async () => [disposition()],
    loadBatchIndustryId: async () => 'salud',
    classify: async (company) => result({ candidateId: company.candidateId }),
    logUsage: async (input) => (logs.push(input), true),
    patchCandidate: async (id, build) => {
      const patch = build(candidateMeta.get(id) ?? REVIEW_METADATA);
      if (!patch) return false;
      candidateMeta.set(id, patch.metadata);
      writes.push({ id, patch });
      return true;
    },
    patchDispositionEvidence: async (id, build) => {
      const evidence = build({});
      if (!evidence) return false;
      evidenceWrites.push({ id, evidence });
      return true;
    },
    admitDisposition: async (id) => (admitted.push(id), `new-${id}`),
    claimIdentities: async (_batch, ids) => void claimed.push([...ids]),
    nowIso: () => AT,
    nowMs: () => NOW,
    ...overrides,
  };
  return { deps, writes, evidenceWrites, admitted, claimed, logs };
}

describe('D. rescueBatchWithClaude', () => {
  it('completa el candidato, rescata la descartada y reclama su identidad', async () => {
    const f = fakeDeps();
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.candidatesCompleted, 1);
    assert.equal(s.dispositionsAdmitted, 1);
    assert.deepEqual(f.admitted, ['d1']);
    assert.deepEqual(f.claimed, [['new-d1']]);
    assert.equal(f.logs.length, 2);
    assert.equal((f.logs[0] as { metadata: { flow: string } }).metadata.flow, 'claude_rescue');
    assert.ok(s.estimatedCostUsd > 0);
  });

  it('una descartada que NO pasa se queda en Descartadas con la evidencia', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      classify: async () => result({ sector: { ...result().sector!, matchesCurrentIndustry: false } }),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsKept, 1);
    assert.equal(f.admitted.length, 0);
    assert.equal(f.claimed.length, 0);
  });

  it('si otra corrida ya reclamó la fila, no se paga', async () => {
    let calls = 0;
    const f = fakeDeps({
      patchCandidate: async () => false,
      patchDispositionEvidence: async () => false,
      classify: async () => (calls++, result()),
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(calls, 0);
  });

  it('sin modelo Anthropic activo → no hace nada', async () => {
    const f = fakeDeps({ resolveActiveModel: async () => ({ error: 'active_provider_is_not_anthropic:openai' }) });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, false);
    assert.equal(f.writes.length, 0);
  });

  it('respeta el tiempo límite (no empieza empresas nuevas)', async () => {
    let clock = NOW;
    const many = Array.from({ length: 12 }, (_, i) => candidate({ id: `c${i}` }));
    const f = fakeDeps({
      loadReviewCandidates: async () => many,
      loadDispositions: async () => [],
      nowMs: () => clock,
      classify: async (company) => ((clock += RESCUE_RUN_DEADLINE_MS), result({ candidateId: company.candidateId })),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.ok(s.ok && s.candidatesCompleted <= 4);
    assert.ok(s.ok && s.remaining >= 8);
  });

  it('un candidato ya rescatado no se vuelve a procesar', () => {
    const done = candidate({ metadata: { ...REVIEW_METADATA, claude_rescue: { decision: 'admit' } } });
    assert.equal(needsCandidateRescue(done, NOW), false);
    assert.equal(needsCandidateRescue(candidate(), NOW), true);
  });
});

// ─── E. LinkedIn (para que Tavily y Apollo sin LinkedIn puedan contar) ──────

describe('E. LinkedIn en el rescate', () => {
  const LI = { url: 'https://www.linkedin.com/company/clinica', slug: 'clinica', source: 'website_social_link' as const };

  it('resuelve linkedin_status y escribe linkedin_enrichment canónico', () => {
    const p = buildCandidateRescuePatch({
      metadata: {
        ...REVIEW_METADATA,
        target_completeness: { failed_conditions: ['employee_count_status', 'linkedin_status'], requested_subindustries: [] },
      },
      result: result({ linkedin: LI }),
      decision: { kind: 'admit', sectorConfirmed: true, sizeConfirmed: true, linkedinConfirmed: true },
      minEmployees: 200,
      decidedAt: AT,
    });
    const tc = p.metadata.target_completeness as Record<string, unknown>;
    assert.deepEqual(tc.failed_conditions, []);
    assert.equal(tc.counts_toward_target, true);
    const li = p.metadata.linkedin_enrichment as Record<string, unknown>;
    assert.equal(li.status, 'found');
    assert.equal(li.company_url, LI.url);
    assert.equal(li.source, 'website_social_link');
  });

  it('nunca pisa un LinkedIn ya encontrado', () => {
    const previous = { status: 'found', company_url: 'https://www.linkedin.com/company/original' };
    assert.deepEqual(buildLinkedInEnrichmentFromClaude(previous, result({ linkedin: LI }), AT), previous);
  });

  it('una descartada no vuelve a revisión si sólo se confirmó LinkedIn/tamaño (no el sector)', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      classify: async () =>
        result({ sector: { ...result().sector!, matchesCurrentIndustry: false, verification: 'source_listed' }, linkedin: LI }),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(f.admitted.length, 0);
    assert.equal(s.ok && s.dispositionsKept, 1);
    const ev = f.evidenceWrites.at(-1)!.evidence as Record<string, Record<string, unknown>>;
    assert.equal(ev.claude_rescue.decision, 'unchanged');
  });
});

// ─── F. Descartes más prudentes y Lusha (Prod 30-09, Perú × Tecnología) ─────

describe('F. descartes prudentes', () => {
  const mismatch = (overrides: Partial<NonNullable<CompanyClassificationResult['sector']>> = {}) =>
    result({ sector: { ...result().sector!, industryName: 'Retail', matchesCurrentIndustry: false, confidence: 0.95, ...overrides } });

  it('MASPLAY: la cita dice «EMPRESA DE TECNOLOGIA» en un lote de Tecnología → NO descarta', () => {
    const d = decideRescue(mismatch({ quote: 'MASPLAY.PE EMPRESA DE TECNOLOGIA', confidence: 0.95 }), {
      icpMinEmployees: 200,
      requestedIndustryName: 'Tecnología',
    });
    assert.notEqual(d.kind, 'discard');
  });

  it('confianza 0,7 → NO descarta', () => {
    const d = decideRescue(mismatch({ confidence: 0.7 }), { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' });
    assert.notEqual(d.kind, 'discard');
  });

  it('confianza alta, cita comprobada y sin nombrar la industria → sí descarta', () => {
    const d = decideRescue(
      mismatch({ quote: 'Multimarca especializada en venta de zapatillas y accesorios' }),
      { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' },
    );
    assert.equal(d.kind, 'discard');
  });

  it('quoteNamesIndustry ignora tildes y mayúsculas', () => {
    assert.equal(quoteNamesIndustry('Somos una empresa de TECNOLOGIA', 'Tecnología'), true);
    assert.equal(quoteNamesIndustry('Venta de calzado deportivo', 'Tecnología'), false);
  });

  it('un tamaño ya confirmado por el proveedor no se contradice', () => {
    const d = decideRescue(
      result({ employeeRange: { ...result().employeeRange!, min: 11, max: 50, verification: 'quote_verified', confidence: 0.95 } }),
      { icpMinEmployees: 200, sizeAlreadyConfirmed: true },
    );
    assert.notEqual(d.kind, 'discard');
  });
});

describe('F2. Lusha entra al rescate para revisar el sector', () => {
  const lushaRow = candidate({
    id: 'l1',
    source_primary: 'lusha',
    industry: 'Technology, Information & Media',
    metadata: { icp_size_gate: { size_status: 'confirmed_above_threshold', threshold: 200 } },
  });

  it('una fila de Lusha sin target_completeness es elegible', () => {
    assert.equal(needsCandidateRescue(lushaRow, NOW), true);
    assert.equal(needsCandidateRescue({ ...lushaRow, source_primary: 'apollo' }, NOW), false);
  });

  it('se compara contra la industria PEDIDA, no contra la etiqueta de Lusha', async () => {
    const seen: Array<{ currentIndustryId: string | null; currentIndustryName: string | null }> = [];
    const f = fakeDeps({
      loadReviewCandidates: async () => [lushaRow],
      loadDispositions: async () => [],
      loadBatchIndustryId: async () => 'salud',
      classify: async (company) => {
        seen.push({ currentIndustryId: company.currentIndustryId, currentIndustryName: company.currentIndustryName });
        return result({ candidateId: company.candidateId });
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.deepEqual(seen, [{ currentIndustryId: 'salud', currentIndustryName: null }]);
    assert.equal(s.ok && s.candidatesDiscarded, 0);
  });

  it('un medio en un lote de Tecnología (cita comprobada, confianza alta) se descarta', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [lushaRow],
      loadDispositions: async () => [],
      classify: async (company) =>
        result({
          candidateId: company.candidateId,
          sector: {
            ...result().sector!,
            industryName: 'Compañía de Servicios',
            matchesCurrentIndustry: false,
            quote: 'Diario de mayor circulación del país con noticias nacionales e internacionales',
            confidence: 0.9,
          },
        }),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.candidatesDiscarded, 1);
  });
});
