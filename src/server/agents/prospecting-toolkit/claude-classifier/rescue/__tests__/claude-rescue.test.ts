/**
 * Tests — Agente 1 · Rescate con Claude (AGENT1-CLAUDE-RESCUE-1).
 *
 * Sin red ni base de datos: Claude, Supabase y los reclamos son dobles.
 */

import { officialSizeSignal } from '../official-size-signal';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideRescue, quoteNamesIndustry, rangeProvesBelowThreshold, storedSmallSizeDiscard } from '../rescue-decision';
import { buildCandidateRescuePatch, buildLinkedInEnrichmentFromClaude, resolveCompletenessConditions, rescueStillPending } from '../rescue-patch';
import {
  buildDispositionAdmissionOrigin,
  buildDispositionStaysEvidence,
  needsDispositionRescue,
  type RescuableDispositionRow,
} from '../rescue-dispositions';
import {
  needsCandidateRescue,
  RESCUE_CONCURRENCY,
  rescueBatchWithClaude,
  RESCUE_RUN_DEADLINE_MS,
  type RescueBatchDeps,
} from '../rescue-batch';
import type { ClassifiableCandidateRow } from '../../classification-metadata';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, type CompanyClassificationResult } from '../../types';

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

  it('sector de otro lote con cita COMPROBADA y tamaño desconocido → descartar por sector', () => {
    // Con tamaño UBITS se reasigna la industria (claude-rescue-reassign.test.ts).
    const d = decideRescue(
      result({ sector: { ...result().sector!, matchesCurrentIndustry: false, industryName: 'Minería' }, employeeRange: null }),
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
    assert.deepEqual(d, {
      kind: 'admit',
      sectorConfirmed: false,
      sizeConfirmed: true,
      linkedinConfirmed: false,
      sectorMismatchUnconfirmed: true,
    });
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
      classify: async () => result({ sector: { ...result().sector!, matchesCurrentIndustry: false }, employeeRange: null }),
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
    // A lo sumo una empresa por hilo llega a empezar antes del plazo.
    assert.ok(s.ok && s.candidatesCompleted <= RESCUE_CONCURRENCY);
    assert.ok(s.ok && s.remaining >= many.length - RESCUE_CONCURRENCY);
  });

  it('un candidato ya rescatado no se vuelve a procesar', () => {
    const done = candidate({
      metadata: {
        ...REVIEW_METADATA,
        claude_rescue: { decision: 'admit', contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION },
      },
    });
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
    // Tamaño desconocido: aquí se prueba el filtro de DESCARTE (con tamaño UBITS se reasigna).
    result({ sector: { ...result().sector!, industryName: 'Retail', matchesCurrentIndustry: false, confidence: 0.95, ...overrides }, employeeRange: null });

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

  it('lote del piloto de Claude: sin completitud y sin tamaño ⇒ se revisa; con tamaño estimado, no', () => {
    const pilot = { ...candidate(), source_primary: 'web_ai', metadata: { icp_size_gate: { size_status: 'unknown' } } };
    assert.equal(needsCandidateRescue(pilot, NOW), false);
    assert.equal(needsCandidateRescue(pilot, NOW, { includeUnassessed: true }), true);
    const sized = { ...pilot, metadata: { icp_size_gate: { size_status: 'estimated_above_threshold' } } };
    assert.equal(needsCandidateRescue(sized, NOW, { includeUnassessed: true }), false);
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

  it('un medio en un lote de Tecnología (cita comprobada, confianza alta) se descarta — aunque tenga otra macro y tamaño (02-10)', async () => {
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
    assert.equal(s.ok && s.reassigned, 0);
  });
});

describe('G. etiqueta honesta (Prod 30-09: «admit» sin sector confirmado)', () => {
  it('sólo tamaño completado + sector distinto sin confirmar → data_completed con aviso', () => {
    const decision = decideRescue(
      result({ sector: { ...result().sector!, industryName: 'Minería', matchesCurrentIndustry: false, verification: 'source_listed' } }),
      { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' },
    );
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: result(), decision, minEmployees: 200, decidedAt: AT });
    const rescue = p.metadata.claude_rescue as Record<string, unknown>;
    assert.equal(rescue.decision, 'data_completed');
    assert.equal(rescue.sector_warning, 'claude_sector_mismatch_unconfirmed');
    assert.equal(p.status, undefined);
  });

  it('sector confirmado → admit sin aviso', () => {
    const decision = decideRescue(result(), { icpMinEmployees: 200 });
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: result(), decision, minEmployees: 200, decidedAt: AT });
    const rescue = p.metadata.claude_rescue as Record<string, unknown>;
    assert.equal(rescue.decision, 'admit');
    assert.equal(rescue.sector_warning, null);
  });
});

// ─── H. «¿Pertenece a la industria buscada?» (Prod 30-09: medios sin veredicto) ─

describe('H. respuesta directa sobre la industria buscada', () => {
  const media = (fit: Partial<NonNullable<CompanyClassificationResult['requestedIndustryFit']>> = {}) =>
    result({
      sector: null,
      requestedIndustryFit: {
        fits: false,
        quote: 'Diario de mayor circulación del país con noticias nacionales e internacionales',
        sourceUrl: 'https://clinica.pe/',
        confidence: 0.9,
        verification: 'quote_verified',
        ...fit,
      },
    });

  it('medio sin macro del catálogo + «no pertenece» con cita comprobada → descarta', () => {
    const d = decideRescue(media(), { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' });
    assert.equal(d.kind, 'discard');
    assert.match(d.kind === 'discard' ? d.detail : '', /no es Tecnología/);
  });

  it('«no pertenece» sin cita comprobada → no descarta, deja aviso', () => {
    const d = decideRescue(media({ verification: 'source_listed' }), { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' });
    assert.notEqual(d.kind, 'discard');
    assert.equal((d.kind === 'admit' || d.kind === 'unchanged') && d.sectorMismatchUnconfirmed, true);
  });

  it('catálogo dice Tecnología pero la respuesta directa dice que no → no decide (contradicción)', () => {
    const d = decideRescue(
      result({
        requestedIndustryFit: { fits: false, quote: 'Diario de noticias del país y del mundo', sourceUrl: 'https://clinica.pe/', confidence: 0.9, verification: 'quote_verified' },
      }),
      { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' },
    );
    assert.notEqual(d.kind, 'discard');
    assert.equal(d.kind === 'admit' && d.sectorConfirmed, false);
  });

  it('«sí pertenece» con cita comprobada confirma el sector aunque no haya macro', () => {
    const d = decideRescue(
      result({
        sector: null,
        requestedIndustryFit: { fits: true, quote: 'Somos una empresa de servicios de TI y software', sourceUrl: 'https://clinica.pe/', confidence: 0.9, verification: 'quote_verified' },
      }),
      { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' },
    );
    assert.equal(d.kind === 'admit' && d.sectorConfirmed, true);
  });

  it('filas sin veredicto de la versión anterior se reintentan; lo decidido no', () => {
    assert.equal(rescueStillPending({ decision: 'data_completed', contract_version: 'a1.v1' }, NOW), true);
    assert.equal(rescueStillPending({ decision: 'unchanged', contract_version: 'a1.v1' }, NOW), true);
    assert.equal(rescueStillPending({ decision: 'discard', contract_version: 'a1.v1' }, NOW), false);
    // «admit» viejo con sector confirmado es final; sin sector confirmado se reintenta (KFC, Prod 30-09).
    assert.equal(
      rescueStillPending({ decision: 'admit', contract_version: 'a1.v1' }, NOW, { sector: { matches_current_industry: true } }),
      false,
    );
    assert.equal(rescueStillPending({ decision: 'admit', contract_version: 'a1.v1' }, NOW, { sector: null }), true);
    assert.equal(rescueStillPending({ decision: 'unchanged', contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION }, NOW), false);
  });
});

// ─── I. Cita de búsqueda con confianza muy alta (decisión de la dueña 30-09) ─

describe('I. descarte con cita de búsqueda y confianza ≥ 0,95', () => {
  const ctx = { icpMinEmployees: 200, requestedIndustryName: 'Tecnología' };
  const kfc = (confidence: number, quote = 'Cadena estadounidense de restaurantes de comida rápida especializada en pollo frito') =>
    result({
      sector: {
        ...result().sector!,
        industryName: 'Consumo Masivo',
        matchesCurrentIndustry: false,
        verification: 'source_listed',
        confidence,
        quote,
      },
      requestedIndustryFit: { fits: false, quote, sourceUrl: 'https://pe.linkedin.com/company/kfc', confidence, verification: 'source_listed' },
      employeeRange: null,
    });

  it('KFC (búsqueda, 0,95) → descarta', () => {
    assert.equal(decideRescue(kfc(0.95), ctx).kind, 'discard');
  });

  it('búsqueda con 0,9 → NO descarta', () => {
    assert.notEqual(decideRescue(kfc(0.9), ctx).kind, 'discard');
  });

  it('Majestic: la cita nombra «tecnología» → NO descarta aunque la confianza sea alta', () => {
    assert.notEqual(
      decideRescue(kfc(0.95, 'tienda virtual que ofrece una selección única en tecnología, juguetes y hogar'), ctx).kind,
      'discard',
    );
  });

  it('medio sin macro, sólo «no pertenece» por búsqueda con 0,95 → descarta', () => {
    const d = decideRescue(
      result({
        sector: null,
        requestedIndustryFit: {
          fits: false,
          quote: 'Conglomerado peruano de medios dueño de diarios y canales de televisión',
          sourceUrl: 'https://en.wikipedia.org/wiki/El_Comercio',
          confidence: 0.95,
          verification: 'source_listed',
        },
      }),
      ctx,
    );
    assert.equal(d.kind, 'discard');
  });
});

// ─── J. Descarte por tamaño (decisión de la dueña 02-10) ─────────────────────

const LINKEDIN_SMALL = {
  min: 11,
  max: 50,
  quote: 'De 11 a 50 empleados',
  sourceUrl: 'https://pe.linkedin.com/company/pequena',
  confidence: 0.9,
  verification: 'source_listed' as const,
  status: 'estimated' as const,
};

function storedSmall(overrides: Record<string, unknown> = {}, gate: Record<string, unknown> = { threshold: 200, size_status: 'unknown' }) {
  return {
    icp_size_gate: gate,
    claude_classification: {
      employee_range: {
        min: 11,
        max: 50,
        quote: 'De 11 a 50 empleados',
        source_url: 'https://pe.linkedin.com/company/pequena',
        confidence: 0.9,
        verification: 'source_listed',
        ...overrides,
      },
    },
  };
}

describe('J. descarte por tamaño bajo el umbral', () => {
  it('tamaño de LinkedIn (fuente listada) con confianza ≥ 0,85 → descartar por tamaño', () => {
    const d = decideRescue(result({ employeeRange: LINKEDIN_SMALL }), CTX);
    assert.equal(d.kind === 'discard' && d.reason, 'claude_size_below_min');
    assert.equal(d.kind === 'discard' && d.sourceUrl, LINKEDIN_SMALL.sourceUrl);
    assert.match(d.kind === 'discard' ? d.detail : '', /menos de 200 empleados.*De 11 a 50/);
  });

  it('fuente listada con confianza baja → NO se descarta', () => {
    const d = decideRescue(result({ employeeRange: { ...LINKEDIN_SMALL, confidence: 0.8 } }), CTX);
    assert.deepEqual(d, { kind: 'admit', sectorConfirmed: true, sizeConfirmed: false, linkedinConfirmed: false });
  });

  it('sólo se descarta si el MÁXIMO está bajo el umbral: 150–300, 51–200 y sin máximo se quedan', () => {
    for (const range of [{ min: 150, max: 300 }, { min: 51, max: 200 }, { min: 51, max: null }]) {
      const d = decideRescue(
        result({ employeeRange: { ...LINKEDIN_SMALL, ...range, verification: 'quote_verified', confidence: 1 } }),
        CTX,
      );
      assert.equal(d.kind, 'admit', JSON.stringify(range));
    }
    assert.equal(rangeProvesBelowThreshold({ max: 199, verification: 'quote_verified', confidence: 0.6 }, 200), true);
    assert.equal(rangeProvesBelowThreshold({ max: 199, verification: 'quote_verified', confidence: 0.5 }, 200), false);
    assert.equal(rangeProvesBelowThreshold({ max: 199, verification: 'rejected', confidence: 1 }, 200), false);
  });

  it('si otro proveedor ya confirmó o dejó pasar el tamaño, Claude no lo contradice', () => {
    const small = result({ employeeRange: LINKEDIN_SMALL });
    assert.equal(decideRescue(small, { ...CTX, sizeAlreadyConfirmed: true }).kind, 'admit');
    assert.equal(decideRescue(small, { ...CTX, sizePassedIcpGate: true }).kind, 'admit');
  });

  it('el descarte por tamaño deja icp_size_gate bloqueado con la cita', () => {
    const r = result({ employeeRange: LINKEDIN_SMALL });
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: r, decision: decideRescue(r, CTX), minEmployees: 200, decidedAt: AT })!;
    assert.equal(p.status, 'discarded');
    const gate = p.metadata.icp_size_gate as Record<string, unknown>;
    assert.equal(gate.decision, 'block');
    assert.equal(gate.size_status, 'estimated_below_threshold');
    assert.equal(gate.normalized_max_employees, 50);
    assert.equal(gate.threshold, 200);
  });

  it('clasificación guardada: descarta sólo con máximo < umbral, fuente y sin tamaño de otro proveedor', () => {
    assert.equal(storedSmallSizeDiscard(storedSmall(), 200)?.reason, 'claude_size_below_min');
    assert.equal(storedSmallSizeDiscard(storedSmall({ max: 300 }), 200), null);
    assert.equal(storedSmallSizeDiscard(storedSmall({ max: null }), 200), null);
    assert.equal(storedSmallSizeDiscard(storedSmall({ confidence: 0.7 }), 200), null);
    assert.equal(storedSmallSizeDiscard(storedSmall({ source_url: null }), 200), null);
    assert.equal(storedSmallSizeDiscard(storedSmall({}, { size_status: 'confirmed_above_threshold' }), 200), null);
    assert.equal(storedSmallSizeDiscard(storedSmall({}, { size_status: 'unknown', decision: 'pass' }), 200), null);
    assert.equal(storedSmallSizeDiscard({ icp_size_gate: { size_status: 'unknown' } }, 200), null);
    assert.equal(storedSmallSizeDiscard(null, 200), null);
  });

  it('lote: la fila ya clasificada como pequeña pasa a Descartadas SIN volver a llamar a Claude', async () => {
    let classifyCalls = 0;
    const row = candidate({ id: 'small', metadata: storedSmall() });
    const { deps, writes } = fakeDeps({
      loadReviewCandidates: async () => [row],
      loadDispositions: async () => [],
      classify: async (company) => (classifyCalls++, result({ candidateId: company.candidateId })),
      patchCandidate: async (id, build) => {
        const patch = build(row.metadata);
        if (!patch) return false;
        writes.push({ id, patch });
        return true;
      },
    });
    const summary = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: null }, deps);
    assert.equal(classifyCalls, 0);
    assert.equal(summary.ok && summary.candidatesDiscarded, 1);
    assert.equal(summary.ok && summary.estimatedCostUsd, 0);
    assert.equal(writes.length, 1);
    const patch = writes[0].patch as { status: string; review_notes: string; metadata: Record<string, Record<string, unknown>> };
    assert.equal(patch.status, 'discarded');
    assert.match(patch.review_notes, /menos de 200 empleados/);
    assert.equal(patch.metadata.icp_size_gate.decision, 'block');
    assert.equal(patch.metadata.claude_rescue.from_stored_classification, true);
    assert.equal(patch.metadata.claude_rescue.discard_reason, 'claude_size_below_min');
  });
});

describe('E. SOURCES-CL-RESCUE-OFFICIAL-IDENTITY-1 — número fiscal de lo que Claude admite', () => {
  const identity = {
    columns: { tax_identifier: '96582310-7', tax_identifier_type: 'RUT', legal_name: 'GRIFOLS CHILE S A', legal_status: null },
    metadata: { status: 'matched', sourceKey: 'cl_sii_registry' },
  };

  it('candidato admitido sin número fiscal ⇒ se busca y se guarda en el candidato', async () => {
    const asked: string[] = [];
    const f = fakeDeps({
      loadDispositions: async () => [],
      resolveOfficialIdentity: async (input) => (asked.push(input.name), identity),
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.deepEqual(asked, ['Clínica']);
    const patch = f.writes.at(-1)!.patch as Record<string, unknown>;
    assert.equal(patch.tax_identifier, '96582310-7');
    assert.equal(patch.tax_identifier_type, 'RUT');
    assert.deepEqual((patch.metadata as Record<string, unknown>).official_source_enrichment, identity.metadata);
  });

  it('candidato que ya trae número fiscal ⇒ no se busca', async () => {
    let calls = 0;
    const f = fakeDeps({
      loadDispositions: async () => [],
      loadReviewCandidates: async () => [candidate({ tax_identifier: '20123456789' })],
      resolveOfficialIdentity: async () => (calls++, identity),
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(calls, 0);
  });

  it('descartada que vuelve a revisión ⇒ el candidato nuevo trae el número fiscal en sus columnas', async () => {
    const origins: Array<{ columns?: Record<string, unknown>; metadata: Record<string, unknown> }> = [];
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      resolveOfficialIdentity: async () => identity,
      admitDisposition: async (id, origin) => (origins.push(origin), `new-${id}`),
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(origins[0].columns?.tax_identifier, '96582310-7');
    assert.deepEqual(origins[0].metadata.official_source_enrichment, identity.metadata);
  });

  it('descartada del buscador gratuito (ya con número fiscal) ⇒ no se busca', async () => {
    let calls = 0;
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => [disposition({ evidence: { tax_identifier_present: true } })],
      resolveOfficialIdentity: async () => (calls++, identity),
    });
    await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(calls, 0);
  });
});

const NO_SIZE_GATE = { ...REVIEW_METADATA, icp_size_gate: { threshold: 200, decision: 'review', size_status: 'unknown' } };

describe('F. SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — tamaño medido por la fuente oficial (dueña 06-10)', () => {
  const small = (max: number, quote: string, verification: 'quote_verified' | 'source_listed' = 'quote_verified') =>
    result({
      employeeRange: { min: max, max, quote, sourceUrl: 'https://x.example/', confidence: 0.9, verification, status: 'estimated' },
    });

  it('tabla: CL y EC 100, DO y PE 200 si viene del buscador gratuito; el resto no mide', () => {
    assert.deepEqual(officialSizeSignal({ countryCode: 'cl', fromFreeLayer: true }), { measured: true, minEmployees: 100 });
    assert.deepEqual(officialSizeSignal({ countryCode: 'EC', fromFreeLayer: true }), { measured: true, minEmployees: 100 });
    assert.deepEqual(officialSizeSignal({ countryCode: 'DO', fromFreeLayer: true }), { measured: true, minEmployees: 200 });
    assert.deepEqual(officialSizeSignal({ countryCode: 'PE', fromFreeLayer: true }), { measured: true, minEmployees: 200 });
    for (const code of ['AR', 'CO', 'MX', null]) {
      assert.deepEqual(officialSizeSignal({ countryCode: code, fromFreeLayer: true }), { measured: false, minEmployees: 200 }, String(code));
    }
    assert.equal(officialSizeSignal({ countryCode: 'CL', fromFreeLayer: false }).measured, false);
  });

  it('descartada del buscador gratuito de RD: «170 empleados» de una nota vieja ya NO la descarta (Equifax)', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => [
        disposition({ country_code: 'DO', round_origin: 'free_source', evidence: { tax_identifier_present: true } }),
      ],
      classify: async () => small(170, 'la empresa cuenta con un experimentado equipo local de 170 empleados'),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });

  it('descartada del buscador gratuito de Chile con 150 según Claude ⇒ no se descarta (umbral 100)', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => [disposition({ country_code: 'CL', round_origin: 'free_source' })],
      classify: async () => small(150, '150 colaboradores'),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 1);
  });

  it('Argentina (sin tamaño oficial): «11-50» sigue descartando como siempre', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => [disposition({ country_code: 'AR', round_origin: 'free_source' })],
      classify: async () => small(50, 'Tamaño de la empresa: De 11 a 50 empleados'),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    assert.equal(s.ok && s.dispositionsKept, 1);
  });

  it('candidato del buscador gratuito de Chile en revisión: Claude no lo descarta por tamaño', async () => {
    const f = fakeDeps({
      loadDispositions: async () => [],
      loadReviewCandidates: async () => [candidate({ country_code: 'CL', source_primary: 'public_source', metadata: NO_SIZE_GATE })],
      classify: async () => small(80, '80 colaboradores'),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.candidatesDiscarded, 0);
  });

  it('el mismo candidato de Apollo (no oficial) sí se descarta', async () => {
    const f = fakeDeps({
      loadDispositions: async () => [],
      loadReviewCandidates: async () => [candidate({ country_code: 'CL', source_primary: 'apollo', metadata: NO_SIZE_GATE })],
      classify: async () => small(80, '80 colaboradores'),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.candidatesDiscarded, 1);
  });
});


// ─── K. AGENT1-DELIVERY-CAP-HARD-1 — máximo 10 por búsqueda ───────────────────

describe('K. el rescate no pasa del tope de entrega', () => {
  const three = [disposition({ id: 'd1' }), disposition({ id: 'd2', domain: 'b.pe' }), disposition({ id: 'd3', domain: 'c.pe' })];

  it('con el lote lleno no revisa descartadas: cero gasto, se quedan en Descartadas', async () => {
    const classified: Array<string | null | undefined> = [];
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => three,
      deliverySlots: async () => 0,
      classify: async (company) => (classified.push(company.candidateId), result({ candidateId: company.candidateId })),
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(classified.length, 0);
    assert.equal(f.admitted.length, 0);
    assert.equal(s.dispositionsCapped, 3);
    assert.equal(s.remaining, 0, 'lo que no cabe no cuenta como pendiente: el rescate no se relanza por eso');
    assert.equal(s.estimatedCostUsd, 0);
  });

  it('con un lugar libre admite una y deja las demás sin revisar', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => three,
      deliverySlots: async () => 1,
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(f.admitted.length, 1);
    assert.equal(s.dispositionsAdmitted, 1);
    assert.equal(s.dispositionsCapped, 2);
  });

  it('lugar apartado por una revisión que no entra: la siguiente espera y lo usa (Prod CR × Servicios bbc7a8ad)', async () => {
    const f = fakeDeps({
      loadReviewCandidates: async () => [],
      loadDispositions: async () => three,
      deliverySlots: async () => 1,
      classify: async (company) => {
        if (company.candidateId !== 'd1') return result({ candidateId: company.candidateId });
        await new Promise((resolve) => setTimeout(resolve, 20));
        return result({ candidateId: company.candidateId, sector: { ...result().sector!, matchesCurrentIndustry: false }, employeeRange: null });
      },
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.dispositionsAdmitted, 1, 'd1 no entra y su lugar pasa a otra');
    assert.equal(s.dispositionsCapped, 1, 'el lote queda lleno: la tercera sí se queda sin revisar');
  });

  it('los candidatos ya en revisión se siguen completando aunque el lote esté lleno (no ocupan lugar nuevo)', async () => {
    const f = fakeDeps({ loadDispositions: async () => [], deliverySlots: async () => 0 });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.candidatesCompleted, 1);
  });

  it('sin tope o si no se puede leer, el rescate sigue como antes', async () => {
    for (const deliverySlots of [async () => null, async () => { throw new Error('boom'); }]) {
      const f = fakeDeps({ loadReviewCandidates: async () => [], loadDispositions: async () => three, deliverySlots });
      const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
      assert.equal(s.ok && s.dispositionsAdmitted, 3);
      assert.equal(s.ok && s.dispositionsCapped, 0);
    }
  });
});
