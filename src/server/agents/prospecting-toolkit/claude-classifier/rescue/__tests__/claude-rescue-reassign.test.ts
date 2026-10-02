/**
 * Tests — Agente 1 · Rescate con Claude: otra industria UBITS ⇒ industria corregida
 * (AGENT1-CLAUDE-RESCUE-REASSIGN-INDUSTRY-1, decisión de la dueña 01-10).
 *
 * Sin red ni base de datos: Claude, Supabase y los reclamos son dobles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideRescue } from '../rescue-decision';
import {
  attachIndustryCatalogVersion,
  buildCandidateRescuePatch,
  INDUSTRY_REASSIGNED_CONDITION,
  rescueStillPending,
} from '../rescue-patch';
import { buildDispositionReassignOrigin, type RescuableDispositionRow } from '../rescue-dispositions';
import {
  buildStoredReassignCandidatePatch,
  buildStoredReassignDispositionOrigin,
  decideStoredReassignment,
} from '../reassign-stored';
import { rescueBatchWithClaude, type RescueBatchDeps } from '../rescue-batch';
import type { ClassifiableCandidateRow } from '../../classification-metadata';
import type { CompanyClassificationResult } from '../../types';
import { resolveCandidateSubindustryStatus } from '@/modules/prospect-batches/candidate-subindustry-status-display';

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const AT = '2026-10-01T12:00:00.000Z';
const TECH = 'Tecnología';
const SALUD = 'Salud & Farmacéuticos';
const CTX = { icpMinEmployees: 200, requestedIndustryName: TECH };

/** Una clínica que apareció en una búsqueda de Tecnología. */
function clinic(overrides: Partial<CompanyClassificationResult> = {}): CompanyClassificationResult {
  return {
    candidateId: 'c1',
    outcome: 'classified',
    sector: {
      industryId: 'salud',
      industryName: SALUD,
      subindustryId: null,
      subindustryName: null,
      matchesCurrentIndustry: false,
      quote: 'Somos el único hospital pediátrico de la Región Caribe',
      sourceUrl: 'https://clinica.co/',
      confidence: 0.95,
      verification: 'quote_verified',
    },
    employeeRange: {
      min: 1001,
      max: 5000,
      quote: 'De 1.001 a 5.000 empleados',
      sourceUrl: 'https://co.linkedin.com/company/clinica',
      confidence: 0.7,
      verification: 'source_listed',
      status: 'estimated',
    },
    rejected: [],
    isOperatingCompany: true,
    pageFinalUrl: 'https://clinica.co/',
    usage: null,
    errorCode: null,
    durationMs: 10,
    ...overrides,
  };
}

const UNKNOWN_SIZE = { employeeRange: null } as const;

// ─── A. La decisión en vivo ──────────────────────────────────────────────────

describe('A. decideRescue — otra industria UBITS', () => {
  it('otra macro con cita comprobada + tamaño ≥200 → reasignar (no descartar)', () => {
    const d = decideRescue(clinic(), CTX);
    assert.equal(d.kind, 'reassign');
    if (d.kind !== 'reassign') return;
    assert.equal(d.industryId, 'salud');
    assert.equal(d.industryName, SALUD);
    assert.equal(d.sizeConfirmed, true);
    assert.match(d.detail, /^Buscada en Tecnología, según Claude es Salud/);
  });

  it('otra macro pero tamaño desconocido → se sigue descartando por sector', () => {
    const d = decideRescue(clinic(UNKNOWN_SIZE), CTX);
    assert.equal(d.kind === 'discard' && d.reason, 'claude_sector_mismatch');
  });

  it('tamaño desconocido pero el filtro ICP ya lo dejó pasar → reasignar sin confirmar tamaño', () => {
    const d = decideRescue(clinic(UNKNOWN_SIZE), { ...CTX, sizePassedIcpGate: true });
    assert.equal(d.kind, 'reassign');
    assert.equal(d.kind === 'reassign' && d.sizeConfirmed, false);
  });

  it('tamaño confirmado por el proveedor (Lusha) → reasignar', () => {
    const d = decideRescue(clinic(UNKNOWN_SIZE), { ...CTX, sizeAlreadyConfirmed: true });
    assert.equal(d.kind, 'reassign');
  });

  it('otra macro con menos de 200 comprobados → descarte (no encaja con UBITS)', () => {
    const small = clinic({
      employeeRange: { ...clinic().employeeRange!, min: 11, max: 50, verification: 'quote_verified', confidence: 0.9 },
    });
    assert.equal(decideRescue(small, CTX).kind, 'discard');
  });

  it('sin macro del catálogo (medio) + «no pertenece» → se descarta; no hay industria a la que pasarla', () => {
    const media = clinic({
      sector: null,
      requestedIndustryFit: {
        fits: false,
        quote: 'Diario de noticias nacionales',
        sourceUrl: 'https://diario.pe/',
        confidence: 0.95,
        verification: 'quote_verified',
      },
    });
    assert.equal(decideRescue(media, CTX).kind, 'discard');
  });

  it('cita que NO superó el filtro de descarte (confianza 0,7) → no reasigna ni descarta', () => {
    const weak = clinic({ sector: { ...clinic().sector!, confidence: 0.7 } });
    const d = decideRescue(weak, CTX);
    assert.notEqual(d.kind, 'reassign');
    assert.notEqual(d.kind, 'discard');
  });

  it('misma industria que la búsqueda → sigue siendo un admit normal', () => {
    const d = decideRescue(clinic({ sector: { ...clinic().sector!, matchesCurrentIndustry: true } }), CTX);
    assert.equal(d.kind, 'admit');
  });
});

// ─── B. Lo que se escribe ────────────────────────────────────────────────────

const REVIEW_METADATA = {
  target_completeness: {
    failed_conditions: ['subindustry_match'],
    blocking_reasons: [],
    review_only_reasons: ['subindustry_match'],
    complete_valid: false,
    counts_toward_target: false,
  },
  icp_size_gate: { decision: 'pass', threshold: 200 },
};

describe('B. candidato en revisión reasignado', () => {
  const decision = decideRescue(clinic(), CTX);

  it('sigue en revisión, industria corregida, nunca cuenta para la meta', () => {
    assert.equal(decision.kind, 'reassign');
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: clinic(), decision, minEmployees: 200, decidedAt: AT });
    assert.equal(p.status, undefined);
    assert.equal(p.industry, SALUD);
    assert.equal(p.industry_id, 'salud');
    assert.match(p.review_notes ?? '', /Industria corregida por Claude \(no cuenta para la meta\)/);
    const tc = p.metadata.target_completeness as Record<string, unknown>;
    assert.equal(tc.counts_toward_target, false);
    assert.equal(tc.complete_valid, false);
    assert.ok((tc.failed_conditions as string[]).includes(INDUSTRY_REASSIGNED_CONDITION));
    assert.equal(p.employee_count, 1001);
    const rescue = p.metadata.claude_rescue as Record<string, unknown>;
    assert.equal(rescue.decision, 'reassign');
    assert.equal(rescue.reassigned_industry_name, SALUD);
    assert.equal(rescue.discard_reason, null);
  });

  it('la ficha lo explica con una etiqueta propia (no «Otro»)', () => {
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: clinic(), decision, minEmployees: 200, decidedAt: AT });
    const labels = resolveCandidateSubindustryStatus(p.metadata).reviewReasons.map((r) => r.key);
    assert.ok(labels.includes('industry_reassigned'));
    assert.equal(labels.includes('other'), false);
  });

  it('una fila ya reasignada no se vuelve a procesar', () => {
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: clinic(), decision, minEmployees: 200, decidedAt: AT });
    assert.equal(rescueStillPending(p.metadata.claude_rescue, NOW, p.metadata.claude_classification), false);
  });

  it('descartada → vuelve a revisión con la industria real y sin contar para la meta', () => {
    assert.equal(decision.kind, 'reassign');
    if (decision.kind !== 'reassign') return;
    const o = buildDispositionReassignOrigin(clinic(), decision, 200, AT);
    assert.equal(o.kind, 'claude_rescue');
    assert.equal(o.columns?.industry, SALUD);
    assert.equal(o.columns?.industry_id, 'salud');
    assert.equal((o.metadata.target_completeness as Record<string, unknown>).counts_toward_target, false);
    assert.equal('human_override' in o.metadata, false);
  });
});

// ─── C. Descartes ya guardados (sin volver a llamar a Claude) ───────────────

function storedDiscard(overrides: { sector?: Record<string, unknown> | null; min?: number | null; reason?: string } = {}) {
  return {
    claude_classification: {
      sector:
        overrides.sector === undefined
          ? {
              industry_id: 'salud',
              industry_name: SALUD,
              matches_current_industry: false,
              quote: 'Hospitales Quirúrgicos y de Medicina General',
              source_url: 'https://clinica.co/',
              confidence: 0.95,
              verification: 'quote_verified',
            }
          : overrides.sector,
      employee_range: overrides.min === null ? null : { min: overrides.min ?? 1001, max: 5000, confidence: 0.7 },
    },
    claude_rescue: { decision: 'discard', discard_reason: overrides.reason ?? 'claude_sector_mismatch' },
  };
}

describe('C. decideStoredReassignment', () => {
  const base = { requestedIndustryName: TECH, icpMinEmployees: 200, sizePassedIcpGate: false };

  it('descarte por sector, otra macro, ≥200 → reasignar', () => {
    const d = decideStoredReassignment({ ...base, stored: storedDiscard() });
    assert.equal(d?.industryName, SALUD);
    assert.equal(d?.sizeConfirmed, true);
  });

  it('descarte por TAMAÑO → no se toca', () => {
    assert.equal(decideStoredReassignment({ ...base, stored: storedDiscard({ reason: 'claude_size_below_min' }) }), null);
  });

  it('el sector guardado coincidía con la búsqueda → no se toca (no era un desajuste real)', () => {
    const stored = storedDiscard({
      sector: { industry_id: 'tech', industry_name: TECH, matches_current_industry: true, quote: 'x', source_url: 'https://x.co/' },
    });
    assert.equal(decideStoredReassignment({ ...base, stored }), null);
  });

  it('sin macro (medio) → no se toca', () => {
    assert.equal(decideStoredReassignment({ ...base, stored: storedDiscard({ sector: null }) }), null);
  });

  it('tamaño menor al umbral → no se toca', () => {
    assert.equal(decideStoredReassignment({ ...base, stored: storedDiscard({ min: 120 }) }), null);
  });

  it('tamaño desconocido sólo con el filtro ICP ya superado', () => {
    assert.equal(decideStoredReassignment({ ...base, stored: storedDiscard({ min: null }) }), null);
    const d = decideStoredReassignment({ ...base, sizePassedIcpGate: true, stored: storedDiscard({ min: null }) });
    assert.equal(d?.sizeConfirmed, false);
  });

  it('el parche del candidato lo devuelve a revisión sin mutar la metadata', () => {
    const stored = storedDiscard();
    const snapshot = JSON.stringify(stored);
    const d = decideStoredReassignment({ ...base, stored })!;
    const p = buildStoredReassignCandidatePatch(stored, d, AT);
    assert.equal(JSON.stringify(stored), snapshot);
    assert.equal(p.status, 'needs_review');
    assert.equal(p.industry, SALUD);
    assert.equal(p.employee_count, 1001);
    assert.equal((p.metadata.claude_rescue as Record<string, unknown>).reopened_from_discard, true);
    assert.equal((p.metadata.target_completeness as Record<string, unknown>).counts_toward_target, false);
  });

  it('el origen de Descartadas conserva la clasificación guardada', () => {
    const stored = storedDiscard();
    const d = decideStoredReassignment({ ...base, stored })!;
    const o = buildStoredReassignDispositionOrigin(stored, d, AT);
    assert.deepEqual(o.metadata.claude_classification, stored.claude_classification);
    assert.equal(o.columns?.industry_id, 'salud');
  });
});

// ─── D. El lote completo ─────────────────────────────────────────────────────

function discardedCandidate(): ClassifiableCandidateRow {
  return {
    id: 'cd1',
    industry_id: 'tech',
    industry: TECH,
    name: 'Clínica',
    website: 'clinica.co',
    domain: 'clinica.co',
    country_code: 'CO',
    country: 'Colombia',
    status: 'discarded',
    metadata: storedDiscard(),
  };
}

function discardedDisposition(): RescuableDispositionRow {
  return {
    id: 'dd1',
    batch_id: 'b1',
    candidate_id: null,
    status: 'discarded',
    name: 'Clínica Y',
    domain: 'clinicay.co',
    country_code: 'CO',
    industry: TECH,
    reason_code: 'sub_industry_branch_parent_only',
    evidence: storedDiscard(),
  };
}

function fakeDeps(overrides: Partial<RescueBatchDeps> = {}) {
  const reopened: Array<{ id: string; patch: unknown }> = [];
  const admitted: Array<{ id: string; origin: unknown }> = [];
  const claimed: string[][] = [];
  let classifyCalls = 0;
  const deps: RescueBatchDeps = {
    resolveActiveModel: async () => ({ model: 'claude-haiku-4-5-20251001', apiKey: 'test-key' }),
    checkQuota: async () => ({ allowed: true }),
    loadCatalog: async () => [
      { industryId: 'tech', industryName: TECH, industryDescription: null, subindustries: [] },
      { industryId: 'salud', industryName: SALUD, industryDescription: null, subindustries: [] },
    ],
    loadReviewCandidates: async () => [],
    loadDispositions: async () => [],
    loadBatchIndustryId: async () => 'tech',
    classify: async (company) => (classifyCalls++, clinic({ candidateId: company.candidateId })),
    logUsage: async () => true,
    patchCandidate: async () => true,
    patchDispositionEvidence: async (_id, build) => !!build({}),
    admitDisposition: async (id, origin) => (admitted.push({ id, origin }), `new-${id}`),
    claimIdentities: async (_batch, ids) => void claimed.push([...ids]),
    loadSectorMismatchDiscards: async () => ({ candidates: [discardedCandidate()], dispositions: [discardedDisposition()] }),
    reopenDiscardedCandidate: async (id, build) => {
      const patch = build(storedDiscard());
      if (!patch) return false;
      reopened.push({ id, patch });
      return true;
    },
    nowIso: () => AT,
    nowMs: () => NOW,
    ...overrides,
  };
  return { deps, reopened, admitted, claimed, classifyCalls: () => classifyCalls };
}

describe('D. rescueBatchWithClaude — reabre descartes por sector guardados', () => {
  it('reabre el candidato y la descartada, reclama las identidades y NO llama a Claude', async () => {
    const f = fakeDeps();
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
    if (!s.ok) return;
    assert.equal(s.reassigned, 2);
    assert.equal(f.classifyCalls(), 0);
    assert.deepEqual(f.reopened.map((r) => r.id), ['cd1']);
    assert.deepEqual(f.admitted.map((a) => a.id), ['dd1']);
    assert.deepEqual(f.claimed, [['cd1', 'new-dd1']]);
    assert.equal(s.estimatedCostUsd, 0);
  });

  it('sin las dependencias nuevas, todo sigue como antes', async () => {
    const f = fakeDeps({ loadSectorMismatchDiscards: undefined, reopenDiscardedCandidate: undefined });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.reassigned, 0);
    assert.equal(f.claimed.length, 0);
  });

  it('una lectura fallida no rompe el rescate', async () => {
    const f = fakeDeps({ loadSectorMismatchDiscards: async () => { throw new Error('boom'); } });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok, true);
  });

  it('en vivo: una descartada de otra industria UBITS vuelve con la industria corregida', async () => {
    const f = fakeDeps({
      loadSectorMismatchDiscards: undefined,
      loadDispositions: async () => [{ ...discardedDisposition(), evidence: {} }],
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.reassigned, 1);
    assert.equal(s.ok && s.dispositionsAdmitted, 0);
    const origin = f.admitted[0]?.origin as { columns: Record<string, unknown> };
    assert.equal(origin.columns.industry, SALUD);
  });

  it('en vivo: un candidato en revisión de otra industria UBITS se reasigna (no se descarta)', async () => {
    const f = fakeDeps({
      loadSectorMismatchDiscards: undefined,
      loadReviewCandidates: async () => [{ ...discardedCandidate(), status: 'needs_review', metadata: REVIEW_METADATA }],
    });
    const s = await rescueBatchWithClaude({ batchId: 'b1', triggeredBy: 'u1' }, f.deps);
    assert.equal(s.ok && s.reassigned, 1);
    assert.equal(s.ok && s.candidatesDiscarded, 0);
  });
});

// ─── E. Restricciones de la tabla (Prod 02-10: todas las escrituras fallaban) ──

describe('E. prospect_candidates exige industria + versión de catálogo', () => {
  const decision = decideRescue(clinic(), CTX);

  it('la reasignación borra la subindustria de la industria anterior', () => {
    const p = buildCandidateRescuePatch({ metadata: REVIEW_METADATA, result: clinic(), decision, minEmployees: 200, decidedAt: AT });
    assert.equal(p.subindustry_id, null);
    assert.equal(p.subindustry, null);
  });

  it('con versión conocida se escribe junto al industry_id', () => {
    const cols = attachIndustryCatalogVersion({ industry: SALUD, industry_id: 'salud' }, 'v2');
    assert.deepEqual(cols, { industry: SALUD, industry_id: 'salud', catalog_version_id: 'v2' });
  });

  it('sin versión se quita el industry_id y se conserva el nombre (la fila no se pierde)', () => {
    const cols = attachIndustryCatalogVersion({ industry: SALUD, industry_id: 'salud', employee_count: 1001 }, null);
    assert.deepEqual(cols, { industry: SALUD, employee_count: 1001 });
  });

  it('columnas sin cambio de industria no se tocan', () => {
    const cols = { employee_count: 1001 };
    assert.equal(attachIndustryCatalogVersion(cols, 'v2'), cols);
  });

  it('el origen de Descartadas también borra la subindustria', () => {
    assert.equal(decision.kind, 'reassign');
    if (decision.kind !== 'reassign') return;
    const o = buildDispositionReassignOrigin(clinic(), decision, 200, AT);
    assert.equal(o.columns?.subindustry_id, null);
  });
});
