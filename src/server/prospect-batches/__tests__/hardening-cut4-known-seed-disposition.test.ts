/**
 * hardening-cut4-known-seed-disposition.test.ts — la siembra de dominios
 * conocidos deja FILA DURABLE, no sólo un contador.
 *
 * AGENT1-HARDENING-CUT-4.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * Una empresa retirada por `known_domain_seed` cae dentro de
 * `dedupeLushaCompaniesByIdentity`, que corre ANTES de los dos puntos que
 * generan disposiciones durables (el gate obligatorio y el guard de candidato
 * activo). Su única huella era `localKnownSuppressedTotal`: un número. El
 * MOTIVO del descarte —qué empresa, qué dominio, en qué rama— moría con la
 * corrida, aunque la taxonomía durable ya supiera traducirlo
 * (`known_domain_seed` → `sellup_duplicate`, `lusha-mapping.ts`).
 *
 * ── Lo que este corte NO toca ────────────────────────────────────────────────
 *
 * El núcleo del dedupe. Mismo `unique`, mismos contadores, mismo orden de
 * señales, mismo registro encadenado. La empresa ya estaba retirada y sigue
 * estándolo: lo único que se añade es una SALIDA observacional de la misma
 * decisión, y la fila que el escritor construye con ella.
 *
 * Sin red, sin base, sin cliente de Lusha, 0 créditos. Todo inyectado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  persistLushaPendingReviewBatch,
  type LushaMultiBranchExecution,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewDeps,
} from '@/server/prospect-batches/lusha-pending-review';
import { LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES } from '@/server/prospect-batches/lusha-pending-review-limits';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import {
  createLushaRunIdentityRegistry,
  dedupeLushaCompaniesByIdentity,
  seedLushaKnownDomains,
} from '@/server/prospect-batches/lusha-run-identity-registry';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { computeDiscardDispositionSourceKey } from '@/modules/prospect-discards/mapping';
import { LUSHA_DISCARD_REASON_CODE } from '@/modules/prospect-discards/lusha-mapping';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';

import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  requestedTarget: LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
};

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function successResult(results: LushaPreviewCompany[]): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings: [],
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Salud',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      hasSearchText: false,
    },
  };
}

function makeDeps(script: LushaPreviewResult[]) {
  const searchInputs: LushaPreviewInput[] = [];
  const batches: LushaPendingReviewBatchRow[] = [];
  const candidateRows: LushaPendingReviewCandidateRow[] = [];
  const duplicateChecks: DuplicateCheckInput[] = [];

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (input) => {
      searchInputs.push(input);
      return script[searchInputs.length - 1] ?? successResult([]);
    },
    reserveBatch: async (row) => {
      batches.push(row);
      return { id: 'batch-cut4', adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      candidateRows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => {
      duplicateChecks.push(input);
      return {
        status: 'new_candidate',
        confidence: 85,
        input,
        matches: [],
        summary: 'nuevo',
        checkedSources: ['sellup', 'hubspot'],
      } as DuplicateCheckResult;
    },
    fetchActiveCandidates: async () => [],
  };

  return { deps, searchInputs, batches, candidateRows, duplicateChecks };
}

function executionKnowing(knownDomains: readonly string[]): LushaMultiBranchExecution {
  return {
    providerExclusionPlan: planProviderExclusions('lusha', { sellupKnownDomains: knownDomains }),
  };
}

function run(script: LushaPreviewResult[], execution?: LushaMultiBranchExecution) {
  const harness = makeDeps(script);
  return persistLushaPendingReviewBatch(harness.deps, INPUT, ACTOR, undefined, execution).then(
    (res) => ({ res, ...harness }),
  );
}

const KNOWN = company({
  providerCompanyId: 'p-known',
  name: 'Clínica Conocida',
  domain: 'conocida.com',
  linkedinUrl: 'https://linkedin.com/company/conocida',
});
const FRESH = company({ providerCompanyId: 'p-new', name: 'Clínica Nueva', domain: 'nueva.com' });

// ── § 1 · la fila durable existe ─────────────────────────────────────────────

describe('CUT-4 § 1 · una empresa conocida por siembra deja descarte DURABLE', () => {
  it('la corrida emite un registro de descarte para ella', async () => {
    const { res } = await run([successResult([KNOWN, FRESH])], executionKnowing(['conocida.com']));
    const seeded = res.discardedCompanies?.filter(
      (record) => record.reasonCode === LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    );
    assert.equal(seeded?.length, 1, '🔴 antes de este corte no había ninguna fila, sólo un contador');
    assert.equal(seeded?.[0]?.name, 'Clínica Conocida');
  });

  it('la fila preserva provider, disposition, evidencia y origen de rama', async () => {
    const { res } = await run([successResult([KNOWN, FRESH])], executionKnowing(['conocida.com']));
    const record = res.discardedCompanies?.find(
      (r) => r.reasonCode === LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    );
    assert.ok(record);
    assert.equal(record.disposition, 'sellup_duplicate', 'la taxonomía existente, sin códigos nuevos');
    assert.equal(record.domain, 'conocida.com');
    assert.equal(record.reasonDetail, 'conocida.com', 'el dominio que coincidió con la siembra');
    assert.equal(record.evidence.provider, 'lusha');
    assert.equal(record.evidence.discard_kind, 'known_domain_seed');
    assert.equal(record.evidence.known_seed_matched_domain, 'conocida.com');
    assert.equal(record.evidence.suppression_stage, 'run_identity_dedupe');
    assert.match(String(record.roundOrigin), /^lusha_branch_\d+_page_\d+$/);
  });

  it('la clave de idempotencia se puede derivar de la fila (batch_id, source_key)', async () => {
    const { res, batches } = await run(
      [successResult([KNOWN, FRESH])],
      executionKnowing(['conocida.com']),
    );
    assert.ok(batches.length > 0, 'la corrida reservó su lote');
    const record = res.discardedCompanies?.find(
      (r) => r.reasonCode === LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    );
    assert.ok(record);
    const sourceKey = computeDiscardDispositionSourceKey({
      domain: record.domain,
      name: record.name,
    });
    assert.ok(sourceKey && sourceKey.length > 0, '🔴 sin source_key no hay fila idempotente');
    // La MISMA empresa produce la MISMA clave: es lo que hace que la segunda
    // corrida colisione en vez de duplicar.
    assert.equal(
      sourceKey,
      computeDiscardDispositionSourceKey({ domain: 'conocida.com', name: 'Clínica Conocida' }),
    );
  });
});

// ── § 2 · la semántica del dedupe NO se movió ────────────────────────────────

describe('CUT-4 § 2 · el dedupe decide exactamente lo mismo que antes', () => {
  it('la conocida sigue sin persistirse y sin arrastrar trabajo pagado', async () => {
    const { res, candidateRows, duplicateChecks } = await run(
      [successResult([KNOWN, FRESH])],
      executionKnowing(['conocida.com']),
    );
    assert.deepEqual(candidateRows.map((r) => r.name), ['Clínica Nueva']);
    assert.deepEqual(duplicateChecks.map((c) => c.domain), ['nueva.com']);
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 1);
    assert.equal(res.multiBranch?.crossBranchDuplicatesRemoved, 0);
    assert.equal(res.multiBranch?.duplicateReasonCounts.known_domain_seed, 1);
  });

  it('la salida nueva del dedupe no altera `unique`, contadores ni registro', () => {
    const seeded = seedLushaKnownDomains(createLushaRunIdentityRegistry(), ['conocida.com']);
    const result = dedupeLushaCompaniesByIdentity([KNOWN, FRESH], seeded);
    assert.deepEqual(result.unique.map((c) => c.name), ['Clínica Nueva']);
    assert.equal(result.duplicateCount, 1);
    assert.equal(result.knownSeedRejectedCount, 1);
    assert.equal(result.duplicateReasonCounts.known_domain_seed, 1);
    assert.equal(result.unusableCount, 0);
    // La salida nueva es EXACTAMENTE el subconjunto que el contador ya contaba.
    assert.equal(result.knownSeedRejected.length, result.knownSeedRejectedCount);
    assert.equal(result.knownSeedRejected[0]?.company.name, 'Clínica Conocida');
    assert.equal(result.knownSeedRejected[0]?.matchedNormalizedDomain, 'conocida.com');
  });

  it('un duplicado de CORRIDA no se confunde con la siembra', () => {
    const registry = createLushaRunIdentityRegistry();
    const repeated = company({ providerCompanyId: 'p-a', name: 'A', domain: 'a.com' });
    const result = dedupeLushaCompaniesByIdentity([repeated, repeated], registry);
    assert.equal(result.knownSeedRejectedCount, 0);
    assert.deepEqual(result.knownSeedRejected, [], '🔴 el proveedor repitió: eso NO es un conocido');
    assert.equal(result.duplicateReasonCounts.provider_company_id, 1);
  });

  it('sin siembra no hay ninguna fila nueva: el comportamiento es el de antes', async () => {
    const { res } = await run([successResult([KNOWN, FRESH])]);
    const seeded = res.discardedCompanies?.filter(
      (r) => r.reasonCode === LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    );
    assert.deepEqual(seeded, []);
    assert.equal(res.multiBranch?.localKnownSuppressedTotal, 0);
  });
});

// ── § 3 · una empresa sin nombre no puede fabricar fila ──────────────────────

describe('CUT-4 § 3 · lo impersistible sigue siendo impersistible', () => {
  it('una conocida sin nombre no produce fila: `name` es NOT NULL', async () => {
    const nameless = company({
      providerCompanyId: 'p-x',
      name: null as unknown as string,
      domain: 'conocida.com',
    });
    const { res } = await run([successResult([nameless, FRESH])], executionKnowing(['conocida.com']));
    const seeded = res.discardedCompanies?.filter(
      (r) => r.reasonCode === LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
    );
    assert.deepEqual(seeded, [], '🔴 sin nombre no hay nada que auditar, y no se inventa uno');
  });
});
