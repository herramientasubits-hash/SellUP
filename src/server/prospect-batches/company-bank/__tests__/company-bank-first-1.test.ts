/**
 * AGENT1-COMPANY-BANK-FIRST-1 — el banco es la PRIMERA fuente de la búsqueda.
 *
 * Decisión de la dueña (2026-10-02): «el banco debe funcionar antes que todo».
 *
 *   § 1 · lo que se guarda: el candidato completo, acotado, y su lectura;
 *   § 2 · el depósito de Apollo guarda candidato + evidencia (y sólo evidencia si no cabe);
 *   § 3 · el tope es por vendedor: lo que el lote ya tiene se descuenta;
 *   § 4 · sacar del banco antes que todo (sin proveedor, sin sellar el lote);
 *   § 5 · la capa gratuita corre DESPUÉS del banco y sólo por el hueco;
 *   § 6 · el cableado del asistente.
 *
 *   LIVE_PROVIDER_CALLS = 0 · CREDITS = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  BANK_CANDIDATE_MAX_BYTES,
  PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
  projectCandidateForBank,
  readBankPipelineCandidate,
} from '../pipeline-candidate-bank-payload';
import { APOLLO_BANK_PAYLOAD_KIND, planApolloBankDeposit, readApolloBankEvidence } from '../apollo-company-bank-bridge';
import {
  COMPANY_BANK_FIRST_METADATA_KEY,
  createBankFirstDrawer,
  withoutStaleOfficialIdentity,
  type BankFirstDeps,
  type BankFirstWriteInput,
} from '../prepaid-bank-draw.server';
import type { ApolloCompanyBankPort } from '../apollo-company-bank-port.server';
import type { CompanyBankDrawnCompany, CompanyBankSettleItem } from '../company-bank-types';
import { resolveEffectiveDeliveryCap } from '@/modules/prospect-batches/delivery-cap';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import { toCandidateEvidenceSnapshot } from '@/server/agents/prospecting-toolkit/apollo-two-round/checkpoint';
import type {
  CandidateWriterOutput,
  DeliveryCappedCompany,
  ProspectingPipelineCandidate,
  WebSearchResult,
} from '@/server/agents/prospecting-toolkit/types';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function candidate(name: string, domain: string, extra: Record<string, unknown> = {}): ProspectingPipelineCandidate {
  return {
    name,
    website: `https://${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Industria',
    sourceUrl: `https://${domain}`,
    sourceTitle: name,
    sourceSnippet: 'manufactura',
    websiteVerification: null,
    duplicateCheck: null,
    scoring: { qualityLabel: 'needs_review' },
    employeeCount: 300,
    companyLinkedInUrl: `https://www.linkedin.com/company/${name.toLowerCase()}`,
    apolloOrganizationId: `org-${name}`,
    ...extra,
  } as unknown as ProspectingPipelineCandidate;
}

function apolloResult(name: string, domain: string): WebSearchResult {
  return {
    title: name,
    url: `https://${domain}`,
    snippet: 'manufactura',
    source: 'apollo_organizations',
    rank: 1,
    provider: 'apollo_organizations',
    metadata: { apollo_organization_id: `org-${name}`, domain, country_code: 'CO' },
  } as WebSearchResult;
}

// ─── § 1 ──────────────────────────────────────────────────────────────────────

describe('§ 1 — el candidato completo en el banco', () => {
  it('se guarda sin trazas pesadas y se vuelve a leer igual', () => {
    const projected = projectCandidateForBank(
      candidate('Alfa', 'alfa.co', { searchTrace: { big: 'x'.repeat(5000) }, llmEvaluation: { a: 1 } }),
    );
    assert.ok(projected);
    assert.equal('searchTrace' in projected, false);
    assert.equal('llmEvaluation' in projected, false);
    const read = readBankPipelineCandidate({ kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, candidate: projected });
    assert.equal(read?.name, 'Alfa');
    assert.equal(read?.domain, 'alfa.co');
    assert.equal(read?.employeeCount, 300);
  });

  it('demasiado grande ⇒ suelta lo prescindible; si aun así no cabe ⇒ null', () => {
    const big = projectCandidateForBank(candidate('Beta', 'beta.co', { sourceSnippet: 'y'.repeat(BANK_CANDIDATE_MAX_BYTES) }));
    assert.ok(big);
    assert.equal('sourceSnippet' in big, false, 'el texto largo se suelta');
    assert.equal(
      projectCandidateForBank(candidate('Gamma', 'gamma.co', { industry: 'z'.repeat(BANK_CANDIDATE_MAX_BYTES) })),
      null,
    );
  });

  it('lo que viene de la base no se cree: sin nombre, dominio o país ⇒ null', () => {
    const ok = projectCandidateForBank(candidate('Delta', 'delta.co'))!;
    for (const broken of [{ ...ok, name: '' }, { ...ok, domain: null }, { ...ok, countryCode: 7 }]) {
      assert.equal(readBankPipelineCandidate({ kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, candidate: broken }), null);
    }
    assert.equal(readBankPipelineCandidate({ kind: 'otro', candidate: ok }), null);
    assert.equal(readBankPipelineCandidate(null), null);
  });

  it('🔴 una precisión evaluada para OTRAS subindustrias no viaja (no puede contar sola)', () => {
    const ok = projectCandidateForBank(
      candidate('Eps', 'eps.co', { providerEnrichmentCapture: { precision: { status: 'confirmed' }, keep: 1 } }),
    )!;
    const narrowed = readBankPipelineCandidate({
      kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
      candidate: ok,
      requestedSubindustries: ['Autopartes'],
    });
    assert.deepEqual(narrowed?.providerEnrichmentCapture, { precision: null, keep: 1 });
    const macro = readBankPipelineCandidate({ kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND, candidate: ok, requestedSubindustries: [] });
    assert.deepEqual(macro?.providerEnrichmentCapture, { precision: { status: 'confirmed' }, keep: 1 });
  });
});

// ─── § 2 ──────────────────────────────────────────────────────────────────────

function capped(name: string, domain: string, bankCandidate: Record<string, unknown> | null): DeliveryCappedCompany {
  return {
    name,
    domain,
    linkedinUrl: null,
    countryCode: 'CO',
    providerOrganizationId: `org-${name}`,
    countsTowardTarget: false,
    claims: [{ type: 'domain', key: domain }],
    bankCandidate,
  };
}

describe('§ 2 — el depósito de Apollo guarda candidato + evidencia', () => {
  const evidence = toCandidateEvidenceSnapshot(apolloResult('Alfa', 'alfa.co'));

  it('con candidato ⇒ `pipeline_candidate_v1` (y la ronda 1 de Apollo sigue leyendo su evidencia)', () => {
    const [item] = planApolloBankDeposit({
      countryCode: 'CO',
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      sourceBatchId: 'b',
      requestedSubindustries: [],
      capped: [capped('Alfa', 'alfa.co', projectCandidateForBank(candidate('Alfa', 'alfa.co')))],
      evidenceFor: () => evidence,
    }).items;
    const payload = item.payload as Record<string, unknown>;
    assert.equal(payload.kind, PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND);
    assert.deepEqual(payload.requestedSubindustries, []);
    assert.equal(readBankPipelineCandidate(payload)?.name, 'Alfa');
    assert.deepEqual(readApolloBankEvidence({ sourceProvider: 'apollo', payload }), evidence);
  });

  it('sin candidato ⇒ sólo evidencia, como antes', () => {
    const [item] = planApolloBankDeposit({
      countryCode: 'CO',
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      sourceBatchId: 'b',
      capped: [capped('Alfa', 'alfa.co', null)],
      evidenceFor: () => evidence,
    }).items;
    assert.equal((item.payload as Record<string, unknown>).kind, APOLLO_BANK_PAYLOAD_KIND);
  });
});

// ─── § 3 ──────────────────────────────────────────────────────────────────────

describe('§ 3 — el tope es por vendedor y por búsqueda', () => {
  it('descuenta lo que el lote ya tiene', () => {
    assert.equal(resolveEffectiveDeliveryCap({ cap: 10, alreadyDelivered: 0 }), 10);
    assert.equal(resolveEffectiveDeliveryCap({ cap: 10, alreadyDelivered: 4 }), 6);
    assert.equal(resolveEffectiveDeliveryCap({ cap: 10, alreadyDelivered: 12 }), 0);
    assert.equal(resolveEffectiveDeliveryCap({ cap: null, alreadyDelivered: 8 }), null);
  });

  it('🔴 AGENT1-DELIVERY-CAP-HARD-1: el tope es duro — ninguna pierna pasa de 10, ni para cerrar su meta', () => {
    // Antes un «piso» (MEASURES-TARGET-1) dejaba escribir lo que faltaba para la meta
    // aunque el lote estuviera lleno: en Prod hubo búsquedas con 27 en revisión.
    // Regla de la dueña (07-10): mínimo 5 y máximo 10; el resto va al banco.
    assert.equal(resolveEffectiveDeliveryCap({ cap: 10, alreadyDelivered: 16 }), 0);
    assert.equal(resolveEffectiveDeliveryCap({ cap: 10, alreadyDelivered: 8 }), 2);
    const writer = readFileSync(path.join(REPO_ROOT, 'src/server/agents/prospecting-toolkit/candidate-writer.ts'), 'utf8');
    assert.doesNotMatch(writer, /deliveryCapFloor/);
    const runner = readFileSync(
      path.join(REPO_ROOT, 'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts'),
      'utf8',
    );
    assert.doesNotMatch(runner, /deliveryCapFloor:/);
  });

  it('🔴 MEASURES-TARGET-1: las filas del banco se escriben por la ruta de Apollo (se miden)', async () => {
    const { buildBankPipelineOutput } = await import('../prepaid-bank-draw.server');
    const out = buildBankPipelineOutput({
      industryName: 'Salud & Farmacéuticos',
      countryCode: 'CL',
      countryName: 'Chile',
      requestedTarget: 5,
      candidates: [],
    });
    assert.equal(out.metadata?.provider, 'apollo_organizations');
    assert.equal(out.metadata?.search_mode, 'company_bank_first');
    // AGENT1-DELIVERY-CAP-HARD-1 — lo que guardó una búsqueda web vuelve como web.
    const web = buildBankPipelineOutput({
      industryName: 'Salud & Farmacéuticos',
      countryCode: 'CL',
      countryName: 'Chile',
      requestedTarget: 5,
      candidates: [],
      provider: 'tavily',
    });
    assert.equal(web.metadata?.provider, 'tavily');
    assert.equal(web.input.webSearchProvider, 'tavily');
  });

  it('el escritor lee el lote ANTES de recortar', () => {
    const writer = readFileSync(
      path.join(REPO_ROOT, 'src/server/agents/prospecting-toolkit/candidate-writer.ts'),
      'utf8',
    );
    const seedAt = writer.indexOf('const batchIdentitySeed = await loadBatchIdentityRegistry(admin, batchId);');
    const capAt = writer.indexOf('const deliveryCap = resolveEffectiveDeliveryCap(');
    const sliceAt = writer.indexOf('capOrdered.slice(0, deliveryCap)');
    assert.ok(seedAt > 0 && capAt > seedAt && sliceAt > capAt);
  });
});

// ─── § 4 ──────────────────────────────────────────────────────────────────────

type Recorder = {
  draws: Array<Record<string, unknown>>;
  settles: Array<{ drawId: string; outcomes: CompanyBankSettleItem[] }>;
  writes: BankFirstWriteInput[];
  batchResolutions: number;
};

function bankRow(id: string, payload: Record<string, unknown>, tier: 'ready' | 'to_complete' = 'to_complete'): CompanyBankDrawnCompany {
  return {
    id,
    tier,
    sourceProvider: 'apollo',
    claims: [],
    payload,
    missingFields: tier === 'ready' ? [] : ['target_conditions'],
    sourceBatchId: null,
    bankedAt: '2026-10-02T00:00:00.000Z',
  };
}

function pipelinePayload(name: string, domain: string): Record<string, unknown> {
  return {
    kind: PIPELINE_CANDIDATE_BANK_PAYLOAD_KIND,
    evidence: toCandidateEvidenceSnapshot(apolloResult(name, domain)),
    candidate: projectCandidateForBank(candidate(name, domain)),
    requestedSubindustries: [],
  };
}

function drawerHarness(opts: {
  rows?: CompanyBankDrawnCompany[];
  drawUnavailable?: boolean;
  writer?: Partial<CandidateWriterOutput>;
  writeThrows?: boolean;
  persistedByDomain?: Record<string, string>;
  noPort?: boolean;
  acceptedAfterClaude?: number | null;
  review?: 'ok' | 'fails' | 'absent';
  refresh?: BankFirstDeps['refreshOfficialIdentity'];
}) {
  const rec: Recorder = { draws: [], settles: [], writes: [], batchResolutions: 0 };
  const port: ApolloCompanyBankPort = {
    store: {
      async deposit() {
        return { status: 'ok', deposited: 0, skippedClaimed: 0, skippedInBank: 0, skippedInvalid: 0 };
      },
      async draw(input) {
        rec.draws.push({ ...input });
        if (opts.drawUnavailable) return { status: 'unavailable', reason: 'no table' };
        return { status: 'ok', drawId: input.drawId ?? 'd', companies: opts.rows ?? [] };
      },
      async settle(drawId, outcomes) {
        rec.settles.push({ drawId, outcomes: [...outcomes] });
        return { status: 'ok', assigned: 0, invalidated: 0, released: 0, ignored: 0 };
      },
    },
    async readPersistedCandidateIdsByDomain() {
      return new Map(Object.entries(opts.persistedByDomain ?? {}));
    },
    async countAcceptedByDomain() {
      return opts.acceptedAfterClaude ?? null;
    },
  };
  const reviews: Array<{ batchId: string; triggeredBy: string; windowMs: number }> = [];
  const deps: BankFirstDeps = {
    port: opts.noPort ? null : port,
    industryName: 'Industria / Manufactura / Químicos / Automotor',
    checkDuplicate: async (input) =>
      ({ status: 'new_candidate', confidence: 0, input, matches: [], summary: 'fresco', checkedSources: ['sellup', 'hubspot'] }) as never,
    write: async (input) => {
      rec.writes.push(input);
      if (opts.writeThrows) throw new Error('boom');
      return {
        dryRun: false,
        batchId: input.batchId,
        candidatesCreated: input.candidates.length,
        candidatesSkipped: 0,
        createdCandidateIds: [],
        skipped: [],
        status: 'success',
        errors: [],
        persistence: { completeValidCandidates: 0 },
        ...opts.writer,
      } as unknown as CandidateWriterOutput;
    },
    resolveCap: () => 10,
    newDrawId: () => 'draw-1',
    ...(opts.refresh ? { refreshOfficialIdentity: opts.refresh } : {}),
    ...(opts.review === 'absent'
      ? {}
      : {
          reviewInline: async (input: { batchId: string; triggeredBy: string; windowMs: number }) => {
            reviews.push(input);
            return opts.review !== 'fails';
          },
        }),
  };
  const input = {
    countryCode: 'CO',
    countryName: 'Colombia',
    macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
    requestedTarget: 5,
    requestedByUserId: 'u-1',
    resolveBatchId: async () => {
      rec.batchResolutions++;
      return 'batch-1';
    },
  };
  return { rec, reviews, drawer: createBankFirstDrawer(deps), input };
}

describe('§ 4 — sacar del banco antes que todo', () => {
  it('🔴 escribe en el lote de la búsqueda, cuenta sólo lo que el escritor midió y cierra la extracción', async () => {
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'), 'ready'), bankRow('r2', pipelinePayload('Beta', 'beta.co'))],
      writer: {
        candidatesCreated: 2,
        persistence: { completeValidCandidates: 1 } as never,
        deliveryCappedCompanies: [],
      },
      persistedByDomain: { 'alfa.co': 'c-1', 'beta.co': 'c-2' },
    });
    const out = await h.drawer(h.input);
    assert.deepEqual(h.rec.draws[0], {
      countryCode: 'CO',
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      limit: 10,
      tiers: ['ready', 'to_complete'],
      reserveSeconds: 900,
      drawId: 'draw-1',
    });
    assert.equal(h.rec.writes.length, 1);
    assert.equal(h.rec.writes[0].batchId, 'batch-1');
    assert.deepEqual(h.rec.writes[0].candidates.map((c) => c.name), ['Alfa', 'Beta']);
    assert.equal(h.rec.writes[0].candidates[0].duplicateCheck?.summary, 'fresco', 'SellUp/HubSpot se vuelven a mirar');
    assert.ok(COMPANY_BANK_FIRST_METADATA_KEY in h.rec.writes[0].metadata);
    assert.equal(out.batchId, 'batch-1');
    assert.equal(out.persistedCount, 2);
    assert.equal(out.acceptedCount, 1);
    assert.deepEqual(h.rec.settles[0].outcomes, [
      { id: 'r1', outcome: 'assigned', batchId: 'batch-1', candidateId: 'c-1' },
      { id: 'r2', outcome: 'assigned', batchId: 'batch-1', candidateId: 'c-2' },
    ]);
  });

  it('🔴 sólo evidencia de Apollo ⇒ vuelve al banco para la ronda 1; el lote NO se materializa', async () => {
    const h = drawerHarness({
      rows: [
        bankRow('e1', { kind: APOLLO_BANK_PAYLOAD_KIND, evidence: toCandidateEvidenceSnapshot(apolloResult('Solo', 'solo.co')) }),
        bankRow('x1', { kind: 'basura' }),
      ],
    });
    const out = await h.drawer(h.input);
    assert.equal(h.rec.batchResolutions, 0, 'sin nada que escribir no nace lote');
    assert.equal(h.rec.writes.length, 0);
    assert.equal(out.persistedCount, 0);
    assert.deepEqual(h.rec.settles[0].outcomes, [
      { id: 'e1', outcome: 'released' },
      { id: 'x1', outcome: 'invalidated', reason: 'unreadable_payload' },
    ]);
  });

  it('lo que el tope vuelve a dejar fuera regresa al banco; lo rechazado sale', async () => {
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co')), bankRow('r2', pipelinePayload('Beta', 'beta.co')), bankRow('r3', pipelinePayload('Gamma', 'gamma.co'))],
      writer: { candidatesCreated: 1, deliveryCappedCompanies: [capped('Beta', 'beta.co', null)] },
      persistedByDomain: { 'alfa.co': 'c-1' },
    });
    await h.drawer(h.input);
    assert.deepEqual(h.rec.settles[0].outcomes, [
      { id: 'r1', outcome: 'assigned', batchId: 'batch-1', candidateId: 'c-1' },
      { id: 'r2', outcome: 'released' },
      { id: 'r3', outcome: 'invalidated', reason: 'not_admitted_on_redraw' },
    ]);
  });

  it('🔴 CLAUDE-INLINE-1: Claude revisa lo del banco ANTES de decidir pagar y se vuelve a contar', async () => {
    // Medido 05-10 (Chile × Salud, 0f60a313): 3 del banco contaron 2 min después,
    // ya con Apollo + Tavily + Claude pagados.
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co')), bankRow('r2', pipelinePayload('Beta', 'beta.co'))],
      writer: { candidatesCreated: 2, persistence: { completeValidCandidates: 0 } as never },
      persistedByDomain: { 'alfa.co': 'c-1', 'beta.co': 'c-2' },
      acceptedAfterClaude: 2,
      review: 'ok',
    });
    const out = await h.drawer(h.input);
    assert.deepEqual(h.reviews, [{ batchId: 'batch-1', triggeredBy: 'u-1', windowMs: 60_000 }]);
    assert.equal(out.acceptedCount, 2, 'lo que Claude confirmó cuenta para la meta de ESTA búsqueda');
    assert.equal(out.telemetry.claude_reviewed, true);
    assert.equal(out.telemetry.accepted_after_claude, 2);
  });

  it('CLAUDE-INLINE-1: nunca cuenta más de lo que el banco escribió', async () => {
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'))],
      writer: { candidatesCreated: 1, persistence: { completeValidCandidates: 0 } as never },
      acceptedAfterClaude: 7,
      review: 'ok',
    });
    assert.equal((await h.drawer(h.input)).acceptedCount, 1);
  });

  it('CLAUDE-INLINE-1: si ya cierra la meta, no se paga a Claude', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((n) => bankRow(n, pipelinePayload(n.toUpperCase() + 'x', `${n}.co`), 'ready'));
    const h = drawerHarness({ rows, writer: { candidatesCreated: 5, persistence: { completeValidCandidates: 5 } as never }, review: 'ok' });
    const out = await h.drawer(h.input);
    assert.equal(h.reviews.length, 0);
    assert.equal(out.acceptedCount, 5);
  });

  it('CLAUDE-INLINE-1: Claude falla o está apagado ⇒ se queda la medición del escritor', async () => {
    for (const review of ['fails', 'absent'] as const) {
      const h = drawerHarness({
        rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'))],
        writer: { candidatesCreated: 1, persistence: { completeValidCandidates: 0 } as never },
        acceptedAfterClaude: 1,
        review,
      });
      const out = await h.drawer(h.input);
      assert.equal(out.acceptedCount, 0, review);
      assert.equal(out.telemetry.claude_reviewed, false, review);
    }
  });

  it('CLAUDE-INLINE-1: en Producción la revisión obedece a la bandera del rescate de Claude', () => {
    const drawer = readFileSync(
      path.join(REPO_ROOT, 'src/server/prospect-batches/company-bank/prepaid-bank-draw.server.ts'),
      'utf8',
    );
    assert.match(drawer, /reviewInline: options\.reviewInline === false \? undefined : async[\s\S]{0,120}if \(!isAgent1ClaudeRescueEnabled\(\)\) return false;/);
    // Con Tavily-primero la revisión es la suya (una sola pasada sobre el lote).
    const wizard = readFileSync(
      path.join(REPO_ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      'utf8',
    );
    assert.match(wizard, /reviewInline: !isAgent1TavilyFirstEffective\(\)/);
    assert.match(drawer, /rescueBatchWithClaude\(\s*\{ batchId, triggeredBy, deadlineMs: windowMs \}/);
  });

  it('banco apagado, caído o sin macro ⇒ no aporta y no lanza', async () => {
    for (const opts of [{ noPort: true }, { drawUnavailable: true }]) {
      const h = drawerHarness(opts);
      const out = await h.drawer(h.input);
      assert.equal(out.persistedCount, 0);
      assert.equal(h.rec.writes.length, 0);
    }
    const h = drawerHarness({ rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'))] });
    const out = await h.drawer({ ...h.input, macroIndustryKey: null });
    assert.equal(out.persistedCount, 0);
    assert.equal(h.rec.draws.length, 0);
  });

  it('un escritor que lanza no rompe la búsqueda', async () => {
    const h = drawerHarness({ rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'))], writeThrows: true });
    const out = await h.drawer(h.input);
    assert.equal(out.persistedCount, 0);
    assert.equal(out.telemetry.status, 'error');
  });
});

// ─── § 5 ──────────────────────────────────────────────────────────────────────

const TARGET = 5;

function freeCompany(i: number): CountrySourceCompany {
  return {
    recordIdentityKey: `siis:${i}`,
    legalName: `EMPRESA ${i}`,
    normalizedLegalName: `empresa ${i}`,
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'CO',
    city: 'Bogotá',
    region: null,
    domain: `e${i}.com.co`,
    declaredIndustry: 'Manufactura',
    industryCode: '1011',
    coarseSector: null,
  } as unknown as CountrySourceCompany;
}

function freeHarness(companies: CountrySourceCompany[]) {
  const gateTargets: number[] = [];
  const persisted: Array<{ count: number; batchId: string | null | undefined }> = [];
  const deps: PrePaidNoveltyDiscoveryDeps = {
    runGate: async (gateInput) => {
      gateTargets.push(gateInput.requestedTarget);
      return {
        context: buildPrePaidNoveltyContext({
          requestedTarget: gateInput.requestedTarget,
          countryCode: 'CO',
          macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
          freeSource: {
            sourceKey: 'co_siis',
            attempted: true,
            rawReturned: companies.length,
            macroConfirmed: companies.length,
            ambiguous: 0,
            rejected: 0,
            sellupKnown: 0,
            hubspotKnown: 0,
            acceptedNovel: companies.length,
            failed: false,
            failureCode: null,
          },
        }),
        exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
        providerExclusionPlan: planProviderExclusions('apollo', {}),
        providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
        providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
        acceptedCompanies: companies,
        telemetry: {},
      } as unknown as PrePaidNoveltyGateResult;
    },
    persist: async (_client, input) => {
      persisted.push({ count: input.companies.length, batchId: input.batchId });
      return { batchId: input.batchId ?? 'b-free', writtenCount: input.companies.length, skippedCount: 0, failed: false };
    },
    recordUnverified: async (rows) => ({ attempted: rows.length, persisted: rows.length, failed: 0, errors: [] }),
  };
  return { gateTargets, persisted, deps };
}

async function runWith(
  deps: PrePaidNoveltyDiscoveryDeps,
  bank: { persisted: number; accepted: number } | null,
  withCanonical = true,
  rescue: ((batchId: string) => Promise<Record<string, unknown> | null>) | null = null,
) {
  let bankCalls = 0;
  const bankTargets: number[] = [];
  const order: string[] = [];
  const out = await runPrePaidNoveltyDiscovery(
    {} as unknown as SupabaseClient,
    {
      provider: 'apollo',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      requestedTarget: TARGET,
      requestedByUserId: 'u-1',
      partialGapSupported: true,
      ...(withCanonical ? { resolveBatchId: async () => 'b-canon' } : {}),
      ...(rescue
        ? {
            rescueUnverifiedFreeLayer: async (batchId: string) => {
              order.push('rescue');
              return rescue(batchId);
            },
          }
        : {}),
      ...(bank
        ? {
            drawCompanyBank: async (drawInput: { requestedTarget: number }) => {
              bankCalls++;
              order.push('bank');
              bankTargets.push(drawInput.requestedTarget);
              return {
                batchId: bank.persisted > 0 ? 'b-canon' : null,
                persistedCount: bank.persisted,
                acceptedCount: bank.accepted,
                telemetry: { status: 'ok' },
              };
            },
          }
        : {}),
    } as Parameters<typeof runPrePaidNoveltyDiscovery>[1],
    deps,
  );
  return { out, bankCalls, bankTargets, order };
}

/** Empresa del registro SIN web (va a Descartadas y la busca el rescate). */
function freeCompanyWithoutWeb(i: number): CountrySourceCompany {
  return { ...freeCompany(i), recordIdentityKey: `tax:90000000${i}`, taxId: `90000000${i}`, domain: null } as CountrySourceCompany;
}

describe('§ 5 — AGENT1-FREE-LAYER-FIRST-1: primero la capa gratuita oficial, después el banco (dueña 07-10)', () => {
  it('🔴 la capa gratuita cierra la meta ⇒ el banco NO se consulta y ningún proveedor hace falta', async () => {
    const h = freeHarness([1, 2, 3, 4, 5].map(freeCompany));
    const { out, bankCalls } = await runWith(h.deps, { persisted: 6, accepted: 5 });
    assert.equal(bankCalls, 0);
    assert.deepEqual(h.gateTargets, [TARGET], 'la capa busca el objetivo entero');
    assert.equal(out.providerRequired, false);
    assert.equal(out.acceptedBeforeProvider, TARGET);
  });

  it('🔴 aporte parcial ⇒ el banco busca SÓLO el hueco, en el mismo lote, y los aportes se suman', async () => {
    const h = freeHarness([1, 2].map(freeCompany));
    const { out, bankTargets, order } = await runWith({ ...h.deps, maxDeliveredCandidates: 10 }, { persisted: 4, accepted: 2 });
    assert.deepEqual(h.gateTargets, [TARGET]);
    assert.deepEqual(order, ['bank']);
    assert.deepEqual(bankTargets, [TARGET - 2], 'hueco = 5 − 2 aceptadas de la capa');
    assert.equal(out.persistedCount, 2 + 4);
    assert.equal(out.acceptedBeforeProvider, 4);
    assert.equal(out.residualGap, 1);
    assert.equal(out.providerRequired, true);
    assert.equal(out.batchId, 'b-canon');
  });

  it('🔴 Prod 7f36b6f9: la capa manda sin web a Descartadas ⇒ el rescate corre ANTES del banco, en el lote canónico', async () => {
    const h = freeHarness([1, 2, 3].map(freeCompanyWithoutWeb));
    const rescued: string[] = [];
    const { out, order } = await runWith(
      { ...h.deps, maxDeliveredCandidates: 10 },
      { persisted: 2, accepted: 0 },
      true,
      async (batchId) => (rescued.push(batchId), { ran: true, admitted: 2, kept: 1 }),
    );
    assert.deepEqual(order, ['rescue', 'bank']);
    assert.deepEqual(rescued, ['b-canon']);
    assert.deepEqual(out.telemetry['free_layer_rescue_first'], { ran: true, admitted: 2, kept: 1 });
    assert.equal(out.telemetry['unverified_sent_to_discards'], 3);
  });

  it('sin sin web en Descartadas el rescate no corre; un rescate que falla no rompe nada', async () => {
    const h = freeHarness([freeCompany(1)]);
    const { order } = await runWith(h.deps, { persisted: 0, accepted: 0 }, true, async () => ({ ran: true }));
    assert.deepEqual(order, ['bank']);
    const h2 = freeHarness([freeCompanyWithoutWeb(1)]);
    const { out } = await runWith(h2.deps, null, true, async () => {
      throw new Error('caído');
    });
    assert.deepEqual(out.telemetry['free_layer_rescue_first'], { ran: false, reason: 'failed' });
  });

  it('las «por completar» del banco se entregan pero no cierran el hueco', async () => {
    const h = freeHarness([]);
    const { out, bankTargets } = await runWith(h.deps, { persisted: 7, accepted: 0 });
    assert.deepEqual(bankTargets, [TARGET], 'sin aporte de la capa, el banco busca el objetivo entero');
    assert.equal(out.persistedCount, 7);
    assert.equal(out.acceptedBeforeProvider, 0);
    assert.equal(out.providerRequired, true);
    assert.equal(out.batchId, 'b-canon');
  });

  it('🔴 sin lote canónico (ruta Lusha) el banco NO se consulta', async () => {
    const h = freeHarness([freeCompany(1)]);
    const { bankCalls } = await runWith(h.deps, { persisted: 6, accepted: 5 }, false);
    assert.equal(bankCalls, 0);
    assert.deepEqual(h.gateTargets, [TARGET]);
  });
});

// ─── § 6 ──────────────────────────────────────────────────────────────────────

describe('§ 6 — el cableado', () => {
  it('el asistente inyecta el banco en la capa gratuita, con la industria de la búsqueda', () => {
    const wizard = readFileSync(
      path.join(REPO_ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      'utf8',
    );
    assert.match(wizard, /drawCompanyBank:\s*resolveProductionBankFirstDrawer\(input\.industryName \?\? '', \{/);
    assert.match(wizard, /industryName:\s*catalogResolution\.industry\.name/);
  });

  it('el escritor del banco no sella el lote y marca las filas como de Apollo', () => {
    const drawer = readFileSync(
      path.join(REPO_ROOT, 'src/server/prospect-batches/company-bank/prepaid-bank-draw.server.ts'),
      'utf8',
    );
    assert.match(drawer, /holdBatchStatus:\s*true/);
    assert.match(drawer, /candidateProvenance:\s*'apollo'/);
    assert.match(drawer, /existingBatchId:\s*writeInput\.batchId/);
  });
});

describe('§ 6 — SOURCES-CL-BANK-OFFICIAL-IDENTITY-1: el número fiscal se vuelve a buscar al salir del banco', () => {
  const identity = (strong: boolean, taxId: string | null) =>
    ({
      officialSourceMetadata: { status: strong ? 'matched' : 'not_found' } as never,
      typedColumns: { tax_identifier: taxId } as never,
      strongIdentityAvailable: strong,
    }) as NonNullable<ProspectingPipelineCandidate['officialSourceIdentity']>;

  it('sin identidad fuerte ⇒ se vuelve a buscar y se escribe la nueva', async () => {
    const seen: string[] = [];
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Municipalidad de Cerro Navia', 'cerronavia.cl'))],
      persistedByDomain: { 'cerronavia.cl': 'c-1' },
      review: 'absent',
      refresh: async (candidates, context) => {
        seen.push(...candidates.map((c) => `${c.name}|${context.countryCode}|${c.officialSourceIdentity ? 'vieja' : 'limpia'}`));
        return candidates.map((c) => ({ ...c, officialSourceIdentity: identity(true, '69254200-2') }));
      },
    });
    await h.drawer(h.input);
    assert.deepEqual(seen, ['Municipalidad de Cerro Navia|CO|limpia']);
    assert.equal(h.rec.writes[0].candidates[0].officialSourceIdentity?.strongIdentityAvailable, true);
  });

  it('con identidad fuerte guardada ⇒ no se vuelve a buscar', () => {
    const strong = { ...candidate('Alfa', 'alfa.co'), officialSourceIdentity: identity(true, '900123456') };
    assert.equal(withoutStaleOfficialIdentity(strong), null);
    const weak = { ...candidate('Beta', 'beta.co'), officialSourceIdentity: identity(false, null) };
    assert.equal(withoutStaleOfficialIdentity(weak)?.officialSourceIdentity, undefined);
    assert.ok(withoutStaleOfficialIdentity(candidate('Gama', 'gama.co')));
  });

  it('si la búsqueda falla o no trae nada, se escribe lo que venía del banco', async () => {
    for (const refresh of [
      async () => {
        throw new Error('caído');
      },
      async (candidates: ProspectingPipelineCandidate[]) => candidates,
    ] as Array<NonNullable<BankFirstDeps['refreshOfficialIdentity']>>) {
      const h = drawerHarness({
        rows: [bankRow('r1', pipelinePayload('Delta', 'delta.co'))],
        persistedByDomain: { 'delta.co': 'c-1' },
        review: 'absent',
        refresh,
      });
      await h.drawer(h.input);
      assert.equal(h.rec.writes.length, 1);
      assert.equal(h.rec.writes[0].candidates[0].name, 'Delta');
    }
  });

  it('en Producción el banco usa el mismo paso de identidad oficial que Tavily y Claude', () => {
    const code = readFileSync(path.join(REPO_ROOT, 'src/server/prospect-batches/company-bank/prepaid-bank-draw.server.ts'), 'utf8');
    assert.match(code, /refreshOfficialIdentity: \(candidates, context\) =>\s*buildTavilyOfficialIdentityEnricher\(/);
  });
});


// ─── AGENT1-DELIVERY-CAP-HARD-1 ─────────────────────────────────────────────

describe('AGENT1-DELIVERY-CAP-HARD-1 — lo que guardó una búsqueda web vuelve como web', () => {
  it('Apollo y web salen en dos escrituras, Apollo primero, cada una con su origen; los totales se suman', async () => {
    const webRow: CompanyBankDrawnCompany = { ...bankRow('r2', pipelinePayload('Beta', 'beta.co')), sourceProvider: 'tavily' };
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'), 'ready'), webRow, bankRow('r3', pipelinePayload('Gama', 'gama.co'))],
      persistedByDomain: { 'alfa.co': 'c-1', 'beta.co': 'c-2', 'gama.co': 'c-3' },
      review: 'absent',
    });
    const out = await h.drawer(h.input);
    assert.equal(h.rec.writes.length, 2);
    assert.equal(h.rec.writes[0].candidateProvenance, 'apollo');
    assert.deepEqual(h.rec.writes[0].candidates.map((c) => c.domain), ['alfa.co', 'gama.co']);
    assert.equal(h.rec.writes[1].candidateProvenance, null);
    assert.deepEqual(h.rec.writes[1].candidates.map((c) => c.domain), ['beta.co']);
    assert.equal(out.persistedCount, 3);
    assert.equal(h.rec.batchResolutions, 1);
  });

  it('sólo Apollo ⇒ una sola escritura, como siempre', async () => {
    const h = drawerHarness({
      rows: [bankRow('r1', pipelinePayload('Alfa', 'alfa.co'), 'ready')],
      persistedByDomain: { 'alfa.co': 'c-1' },
      review: 'absent',
    });
    await h.drawer(h.input);
    assert.equal(h.rec.writes.length, 1);
    assert.equal(h.rec.writes[0].candidateProvenance, 'apollo');
  });

  it('la escritura de producción pide el proveedor de su origen', () => {
    const code = readFileSync(path.join(REPO_ROOT, 'src/server/prospect-batches/company-bank/prepaid-bank-draw.server.ts'), 'utf8');
    assert.match(code, /candidateProvenance: writeInput\.candidateProvenance/);
    assert.match(code, /provider: writeInput\.candidateProvenance === 'apollo' \? 'apollo_organizations' : 'tavily'/);
  });
});
