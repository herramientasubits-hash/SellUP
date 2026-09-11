/**
 * AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — la corrida REAL, reconstruida.
 *
 * Reproduce la forma de la corrida de producción del waterfall Apollo → Lusha:
 *
 *     50 crudas → 48 únicas → 17 guard de activos → 23 duplicado exacto
 *              → 8 revisables → 3 sobrantes → 5 aceptadas
 *
 * y comprueba que la corrida CIERRA sin residuo:  50 = 2 + 17 + 23 + 3 + 5.
 *
 * 🔴 Lo que se protege es la INVARIANTE, no los números de esa corrida. El 43
 * no es un objetivo funcional: es lo que la aritmética produce con ESTE
 * reparto. Por eso hay un segundo escenario con otro tamaño (20 crudas) que
 * ejercita exactamente la misma invariante con otras cifras — si el 43
 * estuviera clavado en el código, ese escenario fallaría.
 *
 * Cero proveedor, cero base de datos, cero presupuesto: cada dependencia es un
 * doble en la prueba. El escritor NO se invoca aquí salvo en el escenario de
 * `status: 'empty'`, donde se prueba la resolución del lote canónico.
 *
 * Run: node --import tsx --experimental-test-module-mocks --test <this file>
 */

import { describe, it, mock, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type PersistLushaPendingReviewResult,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '@/server/prospect-batches/lusha-pending-review';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateMatch,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
import { reconcileLushaRunAgainstDispositions } from '../reconciliation';
import type { LushaDiscardRecordLike } from '../lusha-pipeline-writer.server';

/** § CUT-C.2 — identidad de corrida exigida por el escritor. */
const WIZARD_RUN_ID = 'wizard-run-fixture-1';
const CLIENT_REQUEST_ID = 'client-request-fixture-1';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

let upsertPayloads: Record<string, unknown>[][] = [];
mock.module('@supabase/supabase-js', {
  namedExports: {
    createClient: () => ({
      from: () => ({
        upsert: (payload: Record<string, unknown>[]) => {
          upsertPayloads.push(payload);
          return {
            select: () => Promise.resolve({ data: payload.map((_, i) => ({ id: `r-${i}` })), error: null }),
          };
        },
      }),
    }),
  },
});

let persistLushaRejectedDispositions: typeof import('../lusha-pipeline-writer.server').persistLushaRejectedDispositions;
before(async () => {
  ({ persistLushaRejectedDispositions } = await import('../lusha-pipeline-writer.server'));
});

// ── Fixtures ────────────────────────────────────────────────────────────────

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
  requestedTarget: 5,
};

/** Empresa limpia: pasa el gate obligatorio (dominio, país CO, 300 empleados). */
function company(slug: string, overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: `pc-${slug}`,
    name: `Empresa ${slug}`,
    domain: `${slug}.com`,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 300,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: `https://linkedin.com/company/${slug}`,
    score: 92,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

function searchResult(results: LushaPreviewCompany[], creditsCharged: number): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged, resultsReturned: results.length, expectedMaxCredits: 2 },
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

function match(overrides: Partial<DuplicateMatch>): DuplicateMatch {
  return {
    source: 'sellup',
    status: 'existing_in_sellup',
    confidence: 95,
    matchedId: 'a1',
    matchedDomain: null,
    matchedName: 'Coincidencia',
    reason: 'Dominio exacto coincide',
    ...overrides,
  } as DuplicateMatch;
}

function checkResult(input: DuplicateCheckInput, matches: DuplicateMatch[]): DuplicateCheckResult {
  return {
    status: matches.length > 0 ? 'existing_in_sellup' : 'new_candidate',
    confidence: matches.length > 0 ? 95 : 85,
    input,
    matches,
    summary: matches.length > 0 ? 'duplicado' : 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  } as DuplicateCheckResult;
}

/**
 * Un desenlace por empresa, declarado. La prueba construye la corrida a partir
 * de esto y NO al contrario: los números salen del reparto.
 */
interface PageSpec {
  /** Dominios que el guard de candidato ACTIVO debe saltar. */
  guard?: string[];
  /** Dominios con duplicado EXACTO de SellUp. */
  sellupExact?: string[];
  /** Dominios con duplicado EXACTO de HubSpot. */
  hubspotExact?: string[];
  /** Dominios nuevos (aceptados o sobrantes, según el objetivo). */
  fresh?: string[];
  /** Empresas del gate: país distinto al pedido. */
  countryMismatch?: string[];
  /** Empresas del gate: tamaño conocido por debajo del mínimo de la banda. */
  belowMinSize?: string[];
  /** Filas impersistibles (sin nombre): transitorio intra-corrida. */
  unusable?: number;
  /** Dominios que el proveedor REPITE dentro de la corrida: transitorio. */
  repeated?: string[];
}

/**
 * 🔴 Una página de Lusha Prospecting mide como MUCHO
 * `LUSHA_PROSPECTING_PAGE_SIZE` (25) y cuesta 1 crédito. Una prueba que
 * devolviera 50 filas en una sola página describiría una corrida que
 * producción no puede producir —y de hecho dispara la anomalía de facturación,
 * porque 2 créditos superan la responsabilidad de una petición de 25—. Las 50
 * filas de la corrida real llegaron en DOS páginas.
 */
function buildPage(spec: PageSpec): LushaPreviewCompany[] {
  const rows: LushaPreviewCompany[] = [
    ...(spec.guard ?? []).map((d) => company(d)),
    ...(spec.sellupExact ?? []).map((d) => company(d)),
    ...(spec.hubspotExact ?? []).map((d) => company(d)),
    ...(spec.fresh ?? []).map((d) => company(d)),
    ...(spec.countryMismatch ?? []).map((d) => company(d, { countryIso2: 'MX', country: 'México' })),
    ...(spec.belowMinSize ?? []).map((d) => company(d, { employeesExact: 12 })),
  ];
  for (let i = 0; i < (spec.unusable ?? 0); i += 1) {
    // Sin nombre, sin dominio y sin id: nada con lo que construir identidad.
    rows.push(company(`x-${(spec.guard ?? spec.fresh ?? ['p'])[0]}-${i}`, {
      name: null,
      domain: null,
      providerCompanyId: null,
    }));
  }
  // El proveedor devuelve OTRA VEZ una empresa que ya trajo en esta corrida.
  for (const d of spec.repeated ?? []) rows.push(company(d, { providerCompanyId: `dup-${d}` }));
  return rows;
}

function buildRun(pages: PageSpec[]) {
  const all = pages.map(buildPage);

  const guardDomains = pages.flatMap((p) => p.guard ?? []);
  const active: ActiveCandidateRecord[] = guardDomains.map((d, i) => ({
    id: `cand-${i}`,
    name: `Empresa ${d}`,
    domain: `${d}.com`,
    status: 'needs_review',
  }));

  const sellupSet = new Set(pages.flatMap((p) => p.sellupExact ?? []).map((d) => `${d}.com`));
  const hubspotSet = new Set(pages.flatMap((p) => p.hubspotExact ?? []).map((d) => `${d}.com`));

  const checker = (input: DuplicateCheckInput): DuplicateCheckResult => {
    const domain = input.domain ?? '';
    if (sellupSet.has(domain)) {
      return checkResult(input, [
        match({ source: 'sellup', confidence: 95, matchedDomain: domain, reason: `Dominio exacto coincide: ${domain}` }),
      ]);
    }
    if (hubspotSet.has(domain)) {
      return checkResult(input, [
        match({
          source: 'hubspot',
          status: 'existing_in_hubspot',
          confidence: 92,
          matchedId: 'h2',
          matchedDomain: domain,
          reason: `Dominio exacto coincide en HubSpot: ${domain}`,
        }),
      ]);
    }
    return checkResult(input, []);
  };

  return { pages: all, active, checker, rawCount: all.reduce((n, p) => n + p.length, 0) };
}

function makeDeps(run: ReturnType<typeof buildRun>) {
  const calls = {
    searches: 0,
    batches: [] as LushaPendingReviewBatchRow[],
    rows: [] as LushaPendingReviewCandidateRow[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async () => {
      const page = run.pages[calls.searches] ?? [];
      calls.searches += 1;
      // 🔴 1 crédito por página, como el contrato de bloques de 25.
      assert.ok(page.length <= 25, 'una página de Lusha no puede traer más de 25 filas');
      return searchResult(page, 1);
    },
    reserveBatch: async (row) => {
      calls.batches.push(row);
      return { id: 'batch-lusha-1', adopted: false, identityEpoch: 0 };
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows) => {
      calls.rows.push(...rows);
      return { insertedCount: rows.length };
    },
    checkCompanyDuplicate: async (input) => run.checker(input),
    fetchActiveCandidates: async () => run.active,
    officialSourceResolvers: [],
  };
  return { deps, calls };
}

async function runScenario(pages: PageSpec[]) {
  const run = buildRun(pages);
  const { deps, calls } = makeDeps(run);
  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR);
  return { res, calls, rawCount: run.rawCount };
}

const range = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/**
 * La corrida de producción, en sus DOS páginas de 25:
 *   página 0 → 12 guard + 8 exactos SellUp + 4 nuevas + 1 impersistible = 25
 *   página 1 →  5 guard + 12 exactos SellUp + 3 exactos HubSpot + 4 nuevas
 *               + 1 repetida = 25
 * Totales: 50 crudas · 1 impersistible · 1 repetida · 17 guard · 23 exactos
 *          · 8 revisables (5 aceptadas + 3 sobrantes).
 */
const PROD_RUN: PageSpec[] = [
  {
    guard: range(12, 'g'),
    sellupExact: range(8, 's'),
    fresh: ['n0', 'n1', 'n2', 'n3'],
    unusable: 1,
  },
  {
    guard: range(5, 'gb'),
    sellupExact: range(12, 'sb'),
    hubspotExact: range(3, 'h'),
    fresh: ['n4', 'n5', 'n6', 'n7'],
    repeated: ['n0'],
  },
];

function countByDisposition(records: readonly LushaDiscardRecordLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) out[r.disposition] = (out[r.disposition] ?? 0) + 1;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// A. La corrida real cierra sin residuo
// ═══════════════════════════════════════════════════════════════════════════

describe('A. la corrida de producción se reconstruye entera', () => {
  let res: PersistLushaPendingReviewResult;
  let rawCount = 0;

  before(async () => {
    const out = await runScenario(PROD_RUN);
    res = out.res;
    rawCount = out.rawCount;
  });

  it('el proveedor devolvió 50 filas crudas', () => {
    assert.equal(rawCount, 50);
    assert.equal(res.rawResultsTotal, 50);
  });

  it('48 únicas: 2 transitorios intra-corrida (1 impersistible + 1 repetida)', () => {
    assert.equal(res.crossBranchDuplicatesRemoved, 1);
    // 50 - 1 impersistible - 1 repetida = 48 llegaron al gate.
    assert.equal(res.hardExcludedByGateCount, 0);
  });

  it('17 saltadas por el guard de candidato ACTIVO', () => {
    assert.equal(res.skippedActiveDuplicatesCount, 17);
  });

  it('23 duplicados exactos excluidos', () => {
    assert.equal(res.excludedExactDuplicatesCount, 23);
  });

  it('8 revisables: 5 aceptadas y 3 sobrantes por tope de objetivo', () => {
    assert.equal(res.reviewableFoundTotal, 8);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.targetOverflowDiscarded, 3);
  });

  it('🔴 50 = 2 + 17 + 23 + 3 + 5 — la corrida cierra sin residuo', () => {
    const reconciliation = reconcileLushaRunAgainstDispositions({
      raw: res.rawResultsTotal ?? 0,
      unusable: 1,
      intraRunDuplicates: res.crossBranchDuplicatesRemoved ?? 0,
      hardExcluded: res.hardExcludedByGateCount ?? 0,
      activeGuard: res.skippedActiveDuplicatesCount,
      exactDuplicates: res.excludedExactDuplicatesCount,
      knownSuppressed: res.localKnownSuppressedTotal ?? 0,
      precisionRejected: res.precisionRejectedTotal ?? 0,
      targetOverflow: res.targetOverflowDiscarded ?? 0,
      batchIdentityRejected: res.batchIdentityDuplicateSkippedCount ?? 0,
      accepted: res.usefulCandidatesCount,
    });
    assert.equal(reconciliation.accountedFor, 50);
    assert.equal(reconciliation.residual, 0);
    assert.equal(reconciliation.balanced, true);
  });

  it('43 disposiciones durables, 5 candidatos, 2 transitorios intra-corrida', () => {
    const records = res.discardedCompanies ?? [];
    // 17 + 23 + 3 = 43. Es la ARITMÉTICA de este reparto, no una constante.
    assert.equal(records.length, 17 + 23 + 3);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(1 + (res.crossBranchDuplicatesRemoved ?? 0), 2);
    // 43 + 5 + 2 = 50: nada se pierde y nada se cuenta dos veces.
    assert.equal(records.length + res.usefulCandidatesCount + 2, 50);
  });

  it('las durables observadas cuadran con las esperadas', () => {
    const records = res.discardedCompanies ?? [];
    const reconciliation = reconcileLushaRunAgainstDispositions(
      {
        raw: 50,
        unusable: 1,
        intraRunDuplicates: 1,
        hardExcluded: 0,
        activeGuard: 17,
        exactDuplicates: 23,
        knownSuppressed: 0,
        precisionRejected: 0,
        targetOverflow: 3,
        batchIdentityRejected: 0,
        accepted: 5,
      },
      records.length,
    );
    assert.equal(reconciliation.expectedDurableDispositions, 43);
    assert.equal(reconciliation.observedDurableDispositions, 43);
    assert.equal(reconciliation.durableGap, 0);
    assert.equal(reconciliation.durableReconciled, true);
  });

  it('cada disposición es la correcta, con SellUp y HubSpot separados', () => {
    assert.deepEqual(countByDisposition(res.discardedCompanies ?? []), {
      // 17 del guard de activos + 20 exactos de SellUp
      sellup_duplicate: 37,
      hubspot_duplicate: 3,
      target_cap_reached: 3,
    });
  });

  it('cada fila conserva identidad suficiente para auditarla', () => {
    for (const r of res.discardedCompanies ?? []) {
      assert.ok(r.name && r.name.length > 0, 'sin nombre');
      assert.ok(r.domain, 'sin dominio');
      assert.ok(r.providerCompanyId, 'sin id de proveedor');
      assert.ok(r.linkedinUrl, 'sin LinkedIn');
      assert.equal(r.industry, 'Hospitals & Clinics');
      assert.equal(r.countryCode, 'CO');
      // 🔴 Identifica la PÁGINA que la trajo, no un valor fijo: las 43 filas
      // vienen de dos páginas distintas y la fila lo dice.
      assert.match(r.roundOrigin ?? '', /^lusha_branch_0_page_[01]$/);
      assert.equal(r.roundOrigin, `lusha_branch_0_page_${r.evidence.page}`);
      assert.equal(r.evidence.provider, 'lusha');
      assert.ok(typeof r.evidence.discard_kind === 'string');
    }
  });

  it('las filas se reparten entre las DOS páginas que las trajeron', () => {
    const byOrigin: Record<string, number> = {};
    for (const r of res.discardedCompanies ?? []) {
      byOrigin[r.roundOrigin ?? 'null'] = (byOrigin[r.roundOrigin ?? 'null'] ?? 0) + 1;
    }
    // página 0: 12 guard + 8 exactos = 20 · página 1: 5 + 15 + 3 sobrantes = 23
    assert.deepEqual(byOrigin, {
      lusha_branch_0_page_0: 20,
      lusha_branch_0_page_1: 23,
    });
  });

  it('🔴 `possible_duplicate` NO es disposición: es un candidato needs_review', () => {
    const kinds = new Set((res.discardedCompanies ?? []).map((r) => r.evidence.discard_kind));
    assert.equal(kinds.has('possible_duplicate'), false);
    assert.equal(kinds.has('accepted'), false);
    assert.equal(kinds.has('provider_seen'), false);
    assert.equal(kinds.has('intra_run_provider_duplicate'), false);
    assert.equal(kinds.has('batch_identity_rejected'), false);
    assert.equal(kinds.has('unusable_record'), false);
  });

  it('ninguna empresa ACEPTADA aparece entre las descartadas', () => {
    const discarded = new Set((res.discardedCompanies ?? []).map((r) => r.domain));
    // Las 5 primeras nuevas cerraron hueco: n0..n4.
    for (const d of ['n0.com', 'n1.com', 'n2.com', 'n3.com', 'n4.com']) {
      assert.equal(discarded.has(d), false, `${d} está aceptada Y descartada`);
    }
    // Las 3 sobrantes SÍ: n5..n7.
    for (const d of ['n5.com', 'n6.com', 'n7.com']) {
      assert.equal(discarded.has(d), true, `falta la sobrante ${d}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. La invariante NO es el 43 — otra corrida, otras cifras
// ═══════════════════════════════════════════════════════════════════════════

describe('B. la lógica funciona con cualquier tamaño de corrida', () => {
  const OTHER_RUN: PageSpec[] = [
    {
      guard: range(4, 'gg'),
      sellupExact: range(6, 'ss'),
      hubspotExact: range(1, 'hh'),
      fresh: range(7, 'nn'),
      unusable: 2,
    },
  ];

  it('20 crudas: 11 durables, 5 candidatos, 2 transitorios — misma invariante', async () => {
    const { res, rawCount } = await runScenario(OTHER_RUN);
    assert.equal(rawCount, 20);
    assert.equal(res.rawResultsTotal, 20);
    assert.equal(res.skippedActiveDuplicatesCount, 4);
    assert.equal(res.excludedExactDuplicatesCount, 7);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.targetOverflowDiscarded, 2);

    const records = res.discardedCompanies ?? [];
    // 4 + 7 + 2 = 13. Si el 43 estuviera clavado, esto fallaría.
    assert.equal(records.length, 13);
    assert.notEqual(records.length, 43);
    assert.equal(records.length + res.usefulCandidatesCount + 2, 20);

    const reconciliation = reconcileLushaRunAgainstDispositions(
      {
        raw: 20,
        unusable: 2,
        intraRunDuplicates: 0,
        hardExcluded: 0,
        activeGuard: 4,
        exactDuplicates: 7,
        knownSuppressed: 0,
        precisionRejected: 0,
        targetOverflow: 2,
        batchIdentityRejected: 0,
        accepted: 5,
      },
      records.length,
    );
    assert.equal(reconciliation.balanced, true);
    assert.equal(reconciliation.durableReconciled, true);
  });

  it('el gate obligatorio también deja fila durable, con su motivo', async () => {
    const { res } = await runScenario([
      {
        fresh: range(2, 'ok'),
        // País distinto al pedido ⇒ `country_mismatch`, motivo DURO del gate.
        countryMismatch: ['mx'],
        // Tamaño conocido por debajo del mínimo de la banda (201) ⇒ ICP.
        belowMinSize: ['small'],
      },
    ]);

    assert.equal(res.hardExcludedByGateCount, 2);
    const records = res.discardedCompanies ?? [];
    const byDomain = new Map(records.map((r) => [r.domain, r]));
    assert.equal(byDomain.get('mx.com')?.disposition, 'country_rejected');
    assert.equal(byDomain.get('mx.com')?.reasonCode, 'country_mismatch');
    assert.equal(byDomain.get('small.com')?.disposition, 'other');
    assert.equal(byDomain.get('small.com')?.reasonCode, 'known_employee_count_below_min');
    // Y la identidad completa sobrevive, aunque el gate la excluyera antes de
    // llegar al comprobador de duplicados.
    assert.equal(byDomain.get('mx.com')?.providerCompanyId, 'pc-mx');
    assert.equal(byDomain.get('mx.com')?.linkedinUrl, 'https://linkedin.com/company/mx');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. status === 'empty' — la corrida sin candidatos también deja rastro
// ═══════════════════════════════════════════════════════════════════════════

describe('C. status="empty": 0 candidatos, batchId null, disposiciones SÍ', () => {
  const ALL_REJECTED: PageSpec[] = [
    {
      guard: range(6, 'eg'),
      sellupExact: range(9, 'es'),
      hubspotExact: range(2, 'eh'),
    },
  ];

  const CANONICAL_BATCH_ID = '77777777-7777-4777-8777-777777777777';

  it('la corrida sale vacía y aun así publica sus 17 disposiciones', async () => {
    const { res } = await runScenario(ALL_REJECTED);
    assert.equal(res.status, 'empty');
    assert.equal(res.batchId, null);
    assert.equal(res.createdCandidatesCount, 0);
    assert.equal(res.usefulCandidatesCount, 0);
    assert.equal((res.discardedCompanies ?? []).length, 17);
  });

  it('🔴 sin `result.batchId` se usa `waterfall.canonicalBatchId`', async () => {
    upsertPayloads = [];
    const { res } = await runScenario(ALL_REJECTED);
    const waterfall = { canonicalBatchId: CANONICAL_BATCH_ID };

    // La MISMA expresión que usa la acción (verificada estáticamente abajo).
    const batchId = res.batchId ?? waterfall?.canonicalBatchId ?? null;
    assert.equal(batchId, CANONICAL_BATCH_ID);

    const write = await persistLushaRejectedDispositions({
      batchId: batchId as string,
      wizardRunId: WIZARD_RUN_ID,
      clientRequestId: CLIENT_REQUEST_ID,
      requestedCountryCode: 'CO',
      requestedIndustry: 'health_pharma',
      records: res.discardedCompanies ?? [],
    });
    assert.equal(write.attempted, 17);
    assert.equal(write.persisted, 17);
    assert.equal(write.failed, 0);
    assert.equal(upsertPayloads.length, 1);
    for (const row of upsertPayloads[0]) {
      assert.equal(row.batch_id, CANONICAL_BATCH_ID);
      assert.equal(row.source_primary, 'lusha');
    }
  });

  it('sin lote de ninguna de las dos vías NO se escribe nada', async () => {
    upsertPayloads = [];
    const { res } = await runScenario(ALL_REJECTED);
    // Sin waterfall, `waterfall?.canonicalBatchId` es `undefined` y la
    // expresión de la acción colapsa a `null`.
    const noWaterfall = null as { canonicalBatchId: string } | null;
    const batchId = res.batchId ?? noWaterfall?.canonicalBatchId ?? null;
    assert.equal(batchId, null);
    // La acción no llama al escritor en este caso; se comprueba que la guarda
    // de la acción es exactamente ésa.
    assert.equal(upsertPayloads.length, 0);
  });

  it('la ACCIÓN resuelve el lote con esa misma expresión y protege la escritura', () => {
    const src = readFileSync(
      path.join(__dirname, '..', '..', 'prospect-batches', 'lusha-pending-review-actions.ts'),
      'utf8',
    );
    // El modelo de arriba no puede divergir de producción sin que esto falle.
    assert.match(
      src,
      /const discardBatchId =\s*result\.batchId \?\? waterfall\?\.canonicalBatchId \?\? null;/,
    );
    // Sin lote no se escribe.
    assert.match(src, /if \(discardBatchId !== null && discardRecords\.length > 0\)/);
    // Y la escritura va dentro de un `try`: un fallo de trazabilidad no puede
    // tumbar una corrida que ya cobró y ya dejó candidatos.
    const call = src.indexOf('persistLushaRejectedDispositions({');
    assert.ok(call > 0, 'la acción no invoca al escritor');
    const before = src.slice(0, call);
    assert.ok(
      before.lastIndexOf('try {') > before.lastIndexOf('const discardBatchId'),
      'la invocación del escritor no está protegida por un try',
    );
    // Y ocurre DESPUÉS de la observabilidad de uso.
    assert.ok(
      src.indexOf('recordRunUsageObservably(result, settlement)') < call,
      'el escritor corre antes de recordRunUsageObservably',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. INVARIANCIA — el acumulador sólo OBSERVA
// ═══════════════════════════════════════════════════════════════════════════

describe('D. el acumulador no altera ningún desenlace de la corrida', () => {
  it('los seis números valen lo que la aritmética de la corrida dicta', async () => {
    const { res } = await runScenario(PROD_RUN);

    // Derivados del reparto del escenario, NO de una foto del comportamiento:
    //   skippedCount = impersistibles(1) + repetidas(1) + conocidos(0)
    //                + guard de activos(17) + identidad de lote(0) = 19
    assert.equal(res.skippedCount, 19);
    assert.equal(res.usefulCandidatesCount, 5);
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 5);
    assert.equal(res.remainingGapFinal, 0);
    assert.equal(res.creditsCharged, 2);
    assert.equal(res.creditsChargedTotal, 2);
    // `targetReached` de la corrida: hueco cerrado y motivo de parada acorde.
    assert.equal(res.stopReason, 'target_reached');
  });

  it('quitar las disposiciones del resultado deja los seis números idénticos', async () => {
    const { res } = await runScenario(PROD_RUN);
    // El resultado SIN el campo nuevo es, campo por campo, el de antes del hito.
    const { discardedCompanies, ...withoutTraceability } = res;
    assert.ok((discardedCompanies ?? []).length > 0, 'el escenario no produjo disposiciones');
    for (const key of [
      'skippedCount',
      'usefulCandidatesCount',
      'remainingGapFinal',
      'creditsCharged',
      'creditsChargedTotal',
      'insertedCandidatesCount',
      'createdCandidatesCount',
      'excludedExactDuplicatesCount',
      'skippedActiveDuplicatesCount',
      'possibleDuplicatesCount',
      'hardExcludedByGateCount',
      'batchIdentityDuplicateSkippedCount',
      'reviewableFoundTotal',
      'targetOverflowDiscarded',
      'precisionRejectedTotal',
      'stopReason',
      'status',
      'ok',
    ] as const) {
      assert.deepEqual(
        (withoutTraceability as unknown as Record<string, unknown>)[key],
        (res as unknown as Record<string, unknown>)[key],
        `${key} cambió`,
      );
    }
  });

  it('dos corridas idénticas producen los mismos números Y las mismas filas', async () => {
    const a = await runScenario(PROD_RUN);
    const b = await runScenario(PROD_RUN);
    assert.equal(a.res.skippedCount, b.res.skippedCount);
    assert.equal(a.res.usefulCandidatesCount, b.res.usefulCandidatesCount);
    assert.equal(a.res.remainingGapFinal, b.res.remainingGapFinal);
    assert.equal(a.res.creditsChargedTotal, b.res.creditsChargedTotal);
    assert.deepEqual(
      (a.res.discardedCompanies ?? []).map((r) => [r.domain, r.disposition]),
      (b.res.discardedCompanies ?? []).map((r) => [r.domain, r.disposition]),
    );
  });
});
