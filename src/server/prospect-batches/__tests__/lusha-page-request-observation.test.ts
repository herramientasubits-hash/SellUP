/**
 * AGENT1-LUSHA-REQUEST-OBSERVABILITY-1 — qué se le PIDIÓ a Lusha en cada página
 * y qué DEVOLVIÓ.
 *
 * Lo que estas pruebas fijan, dicho como defecto: el 2026-09-24, en CO × Consumo
 * Masivo, las dos ramas de Lusha (Manufactura › Alimentos y Bebidas, y
 * Manufactura › Cuidado Personal) devolvieron 48 de 50 empresas IGUALES, y 46 de
 * 47 se rechazaron por venir sólo con la industria madre. El código envía
 * `subIndustriesIds`; lo que no se sabe es si Lusha lo aplica. El log de uso
 * guardaba los IDs PLANIFICADOS, no lo que se pidió, ni qué industrias volvieron.
 * Sin eso la pregunta no tiene respuesta sin volver a pagar.
 *
 * Esta observación es sólo eso: no cambia qué se pide, cuánto se paga ni qué se
 * acepta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  observeLushaPageRequest,
  toLushaPageRequestMetadata,
  LUSHA_PAGE_REQUEST_TOP_INDUSTRIES,
} from '../lusha-page-request-observation';
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type LushaPendingReviewBatchRow,
  type LushaMultiBranchExecution,
} from '../lusha-pending-review';
import type { LushaPreviewCompany, LushaPreviewInput, LushaPreviewResult } from '../lusha-preview';
import { toLushaRunTelemetryMetadata } from '../lusha-multibranch-execution';
import { preM126FencedInsert } from './support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from './support/lusha-batch-epoch-snapshot';

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: null,
    name: 'Empresa Sintetica',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Manufacturing',
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

function search(
  results: LushaPreviewCompany[],
  summary: Partial<LushaPreviewResult['requestSummary']> = {},
  warnings: string[] = [],
): LushaPreviewResult {
  return {
    ok: true,
    status: results.length === 0 ? 'empty' : 'success',
    results,
    billing: { creditsCharged: 1, resultsReturned: results.length, expectedMaxCredits: 1 },
    warnings,
    requestSummary: {
      country: 'Colombia',
      countryCode: 'CO',
      sector: 'Consumo Masivo',
      industryKey: 'consumer_goods',
      macroIndustryKey: 'consumer_goods',
      mainIndustriesIds: [12],
      subIndustryId: 76,
      sizeBand: { min: 200 },
      hasSearchText: false,
      ...summary,
    },
  };
}

describe('§ 1 — lo que se PIDIÓ sale de la petición real, no del plan', () => {
  it('registra industria principal, subindustria, banda de tamaño y avisos', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 1,
      page: 0,
      search: search([company()], { subIndustryId: 70 }, ['macro_branch_request']),
    });
    assert.equal(obs.branchIndex, 1);
    assert.equal(obs.page, 0);
    assert.deepEqual(obs.requested.mainIndustryIds, [12]);
    assert.equal(obs.requested.subIndustryId, 70);
    assert.deepEqual(obs.requested.sizeBand, { min: 200 });
    assert.deepEqual(obs.requested.warnings, ['macro_branch_request']);
  });

  it('🔴 una subindustria que el constructor descartó se ve como `null` Y con su aviso', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 0,
      page: 0,
      search: search([], { subIndustryId: null }, ['branch_subindustry_not_under_main']),
    });
    assert.equal(obs.requested.subIndustryId, null);
    assert.ok(obs.requested.warnings.includes('branch_subindustry_not_under_main'));
  });
});

describe('§ 2 — lo que DEVOLVIÓ: industrias y tamaño', () => {
  it('distribución de industrias, ordenada por frecuencia, con las ausentes aparte', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 0,
      page: 0,
      search: search([
        company({ industry: 'Manufacturing' }),
        company({ industry: 'Manufacturing' }),
        company({ industry: 'Food & Beverage' }),
        company({ industry: null }),
        company({ industry: '   ' }),
      ]),
    });
    assert.equal(obs.returned.results, 5);
    assert.deepEqual(obs.returned.industries, [
      { industry: 'Manufacturing', count: 2 },
      { industry: 'Food & Beverage', count: 1 },
    ]);
    assert.equal(obs.returned.industryMissing, 2);
    assert.equal(obs.returned.otherIndustriesCount, 0);
  });

  it(`sólo las ${LUSHA_PAGE_REQUEST_TOP_INDUSTRIES} más frecuentes; el resto se cuenta, no se lista`, () => {
    const many = Array.from({ length: LUSHA_PAGE_REQUEST_TOP_INDUSTRIES + 3 }, (_, i) =>
      company({ industry: `Industria ${String(i).padStart(2, '0')}` }),
    );
    const obs = observeLushaPageRequest({ branchIndex: 0, page: 0, search: search(many) });
    assert.equal(obs.returned.industries.length, LUSHA_PAGE_REQUEST_TOP_INDUSTRIES);
    assert.equal(obs.returned.otherIndustriesCount, 3);
  });

  it('🔴 cuántas vienen por debajo del tamaño pedido: dice si Lusha aplica el filtro', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 0,
      page: 0,
      search: search([
        company({ employeesExact: 300 }),
        company({ employeesExact: null, employeesMin: 201, employeesMax: 500 }),
        company({ employeesExact: 150 }),
        company({ employeesExact: null, employeesMin: 51, employeesMax: 199 }),
        company({ employeesExact: null, employeesMin: null, employeesMax: null }),
      ]),
    });
    assert.deepEqual(obs.returned.sizeVsRequestedMin, { atOrAbove: 2, below: 2, unknown: 1 });
  });

  it('sin banda de tamaño pedida no se clasifica nada como «por debajo»', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 0,
      page: 0,
      search: search([company({ employeesExact: 10 })], { sizeBand: null }),
    });
    assert.deepEqual(obs.returned.sizeVsRequestedMin, { atOrAbove: 0, below: 0, unknown: 1 });
  });

  it('las etiquetas largas se recortan: la metadata no crece sin límite', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 0,
      page: 0,
      search: search([company({ industry: 'x'.repeat(500) })]),
    });
    assert.ok(obs.returned.industries[0]!.industry.length <= 80);
  });
});

describe('§ 3 — forma serializable', () => {
  it('snake_case, sin nombres ni dominios de empresas', () => {
    const obs = observeLushaPageRequest({
      branchIndex: 0,
      page: 1,
      search: search([company({ name: 'Acme Secreta', domain: 'acme-secreta.co' })]),
    });
    const meta = toLushaPageRequestMetadata([obs]);
    assert.deepEqual(Object.keys(meta[0]!).sort(), [
      'branch_index',
      'page',
      'requested',
      'returned',
    ]);
    const text = JSON.stringify(meta);
    assert.ok(!text.includes('Acme Secreta') && !text.includes('acme-secreta.co'));
    assert.ok(text.includes('"sub_industry_id":76'));
    assert.ok(text.includes('"size_vs_requested_min"'));
  });
});

// ── § 4 · cableado real en el ejecutor ───────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'consumer_goods',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};
const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  requestedTarget: 5,
};

/**
 * Un `runSearch` que, como el preview real, devuelve en `requestSummary` la rama
 * que se le pidió. Las dos ramas reciben LAS MISMAS empresas: la forma del caso
 * del 2026-09-24.
 */
function echoDeps(): { deps: PersistLushaPendingReviewDeps } {
  const batches: LushaPendingReviewBatchRow[] = [];
  const sameCompanies = Array.from({ length: 3 }, (_, i) =>
    company({ providerCompanyId: `same-${i}`, domain: `same-${i}.example`, name: `Same ${i}` }),
  );
  return {
    deps: {
      runSearch: async (input) => {
        const branch = (
          input as { industryBranch?: { mainIndustryId: number; subIndustryId?: number | null } }
        ).industryBranch;
        return search(sameCompanies, {
          mainIndustriesIds: [branch?.mainIndustryId ?? 0],
          subIndustryId: branch?.subIndustryId ?? null,
        });
      },
      reserveBatch: async (row: LushaPendingReviewBatchRow) => {
        batches.push(row);
        return { id: `batch-${batches.length}`, adopted: false, identityEpoch: 0 };
      },
      insertCandidatesFenced: preM126FencedInsert,
      readBatchIdentityEpoch: preM126BatchEpochSnapshot,
      insertCandidates: async (rows) => ({ insertedCount: rows.length }),
      checkCompanyDuplicate: async (input) => ({
        status: 'new_candidate',
        confidence: 85,
        input,
        matches: [],
        summary: 'nuevo',
        checkedSources: ['sellup', 'hubspot'],
      }),
      fetchActiveCandidates: async () => [],
    },
  };
}

const CONSUMER_GOODS_PLAN: LushaMultiBranchExecution = {
  plan: {
    macroKey: 'consumer_goods',
    branches: [
      { mainIndustryId: 12, subIndustryId: 76, label: 'Food & Beverage' },
      { mainIndustryId: 12, subIndustryId: 70, label: 'Personal Care Products' },
    ],
  },
  targetGap: 5,
  creditsReserved: 4,
};

describe('§ 4 — el ejecutor registra CADA página pedida', () => {
  it('🔴 dos ramas con subindustrias distintas y la misma respuesta: queda a la vista', async () => {
    const { deps } = echoDeps();
    const res = await persistLushaPendingReviewBatch(
      deps,
      INPUT,
      ACTOR,
      undefined,
      CONSUMER_GOODS_PLAN,
    );
    const requests = res.multiBranch?.pageRequests ?? [];
    assert.equal(requests.length, 4, '2 ramas × 2 páginas');
    assert.deepEqual(
      requests.map((r) => [r.branchIndex, r.page, r.requested.subIndustryId]),
      [
        [0, 0, 76],
        [0, 1, 76],
        [1, 0, 70],
        [1, 1, 70],
      ],
    );
  });

  it('la telemetría serializada de la corrida lleva `page_requests`', async () => {
    const { deps } = echoDeps();
    const res = await persistLushaPendingReviewBatch(
      deps,
      INPUT,
      ACTOR,
      undefined,
      CONSUMER_GOODS_PLAN,
    );
    assert.ok(res.multiBranch);
    const meta = toLushaRunTelemetryMetadata(res.multiBranch);
    assert.ok(Array.isArray(meta['page_requests']));
    assert.equal((meta['page_requests'] as unknown[]).length, 4);
  });
});
