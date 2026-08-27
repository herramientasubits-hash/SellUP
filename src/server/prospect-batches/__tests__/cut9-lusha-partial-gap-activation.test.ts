/**
 * AGENT1-LOCAL-CUT9-LUSHA-PARTIAL-GAP-ACTIVATION — la suite DUEÑA del valor vivo.
 *
 * ── Qué activa este corte, y qué NO ─────────────────────────────────────────
 *
 * `LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED` pasa a `true`. Con eso una corrida
 * mixta deja de ser todo-o-nada:
 *
 *   free accepted = F   ⇒   la contribución SOBREVIVE y se persiste
 *   remaining     = T - F (leído, no recalculado)
 *   Lusha recibe SÓLO ese hueco como `targetGap`
 *   las dos mitades escriben en el MISMO lote canónico
 *
 * Y añade las dos piezas sin las cuales la activación sería una mentira:
 *
 *   · la ACEPTACIÓN de pago se conecta a `resolveAcceptedForTarget`, con la
 *     autoridad RECONCILIADA (`multiBranch.acceptedForTargetTotal`) y nunca con
 *     `usefulCandidatesCount`, que es lo que la corrida intentó escribir;
 *   · el registro de identidad de LOTE se SIEMBRA con las filas que lo gratuito
 *     dejó, así que una misma empresa no puede cerrar hueco dos veces.
 *
 * ── 🔴 Reparto de responsabilidad con las suites vecinas ────────────────────
 *
 * Las suites de contención (`lusha-partial-gap-containment`) y de CUT9A siguen
 * defendiendo la ESTRUCTURA —un dueño único por constante, un solo sitio de
 * llamada, un solo lote por ejecución, el orden que hace verdad el «0 reservas»—.
 * Lo que ya NO fijan es el VALOR: eso vive AQUÍ, y por eso apagarlo pone ESTA
 * suite en rojo por comportamiento y no sólo por grep.
 *
 * Sin Supabase real, sin Lusha, sin red, 0 créditos, 0 reservas, 0 migraciones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
} from '../lusha-pending-review-limits';
import {
  persistLushaPendingReviewBatch,
  type PersistLushaPendingReviewDeps,
  type PersistLushaPendingReviewResult,
  type LushaPendingReviewBatchRow,
  type LushaPendingReviewCandidateRow,
} from '../lusha-pending-review';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '../country-source-discovery/run-prepaid-novelty-discovery.server';
import type { PrePaidNoveltyGateResult } from '../country-source-discovery/run-prepaid-novelty-gate';
import type { CountrySourceCompany } from '../country-source-discovery/country-source-types';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_UNAVAILABLE } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import {
  createCanonicalLushaBatchResolver,
  reserveOrReturnLushaCanonicalBatch,
  type LushaCanonicalBatchDbClient,
  type LushaCanonicalBatchReservation,
} from '../lusha-canonical-batch';
import { loadBatchIdentityRegistry } from '../batch-identity-registry-store';
import {
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  type AcceptedForTargetResult,
} from '@/modules/prospect-batches/accepted-for-target';
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '../lusha-preview';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import type { ActiveCandidateRecord } from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import type { OfficialSourceResolver } from '@/server/agents/prospect-intake';
import {
  preM126FencedInsert,
  preM126Rpc,
} from './support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from './support/lusha-batch-epoch-snapshot';

const ROOT = process.cwd();
const ACTION_PATH = 'src/modules/prospect-batches/lusha-pending-review-actions.ts';
const CORE_PATH = 'src/server/prospect-batches/lusha-pending-review.ts';
const LIMITS_PATH = 'src/server/prospect-batches/lusha-pending-review-limits.ts';
const RUNNER_PATH =
  'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts';

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

/** Cuerpo EJECUTABLE: sin comentarios. Las cabeceras NOMBRAN lo prohibido. */
const body = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** El objetivo REAL del producto en esta superficie. No se inventa otro. */
const TARGET = LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES;
const USER = 'user-1';
const CLIENT_REQUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT = {} as unknown as SupabaseClient;

// ═══════════════════════════════════════════════════════════════════════════
// § 1 — EL VALOR VIVO  ·  NEGATIVE_A
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-9 § 1 · la activación de hueco parcial de Lusha está ENCENDIDA', () => {
  it('🔴 NEGATIVE_A · `LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED` es `true`', () => {
    assert.equal(
      LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      true,
      '🔴 apagarlo devuelve el todo-o-nada: el aporte parcial gratuito se descarta ' +
        'y Lusha vuelve a pagar por el objetivo COMPLETO',
    );
  });

  it('🔴 NEGATIVE_B · el valor vive en UNA declaración literal, y el llamador la CONSUME', () => {
    const declarations = read(LIMITS_PATH).match(
      /export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = (?:true|false);/g,
    );
    assert.equal(declarations?.length, 1, 'el valor vivo dejó de tener un único dueño');

    const action = body(ACTION_PATH);
    assert.ok(
      action.includes('partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,'),
      'el llamador dejó de leer la constante',
    );
    assert.equal(
      (action.match(/partialGapSupported:/g) ?? []).length,
      1,
      'una segunda copia sería una segunda autoridad',
    );
    for (const forbidden of ['partialGapSupported: true', 'partialGapSupported: !']) {
      assert.ok(!action.includes(forbidden), `literal escrito a mano: ${forbidden}`);
    }
  });

  it('🔴 el runner compartido sigue OBEDECIENDO el parámetro, sin mirar constantes', () => {
    const runner = body(RUNNER_PATH);
    assert.ok(!runner.includes('LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED'));
    assert.ok(!runner.includes('WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED'));
    assert.ok(runner.includes('input.partialGapSupported'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § 2/§ 10 — CASOS 1-4 sobre el RUNNER REAL, con la constante VIVA
// ═══════════════════════════════════════════════════════════════════════════

function freeCompany(key: string): CountrySourceCompany {
  return {
    recordIdentityKey: key,
    legalName: `SINTETICA ${key}`,
    normalizedLegalName: `sintetica ${key}`,
    taxId: `9000${key}`,
    taxIdentifierType: 'NIT',
    countryCode: 'CO',
    city: null,
    region: null,
    domain: null,
    declaredIndustry: 'Fabricación de productos farmacéuticos',
    industryCode: '2100',
    coarseSector: 'MANUFACTURA',
  };
}

/**
 * La capa gratuita real, con la puerta y la persistencia inyectadas.
 *
 * `acceptedNovel` = lo que la puerta admitió · `written` = lo que la ingesta
 * canónica guardó de verdad. Que sean dos números distintos es lo que permite
 * cubrir el CASO 4.
 */
function freeLayer(input: {
  acceptedNovel: number;
  written: number;
  batchId?: string | null;
}): { deps: PrePaidNoveltyDiscoveryDeps; persistCalls: () => Array<string | null> } {
  const persistCalls: Array<string | null> = [];
  const accepted = Array.from({ length: input.acceptedNovel }, (_, i) => freeCompany(`c${i}`));
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: input.acceptedNovel,
      macroConfirmed: input.acceptedNovel,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: input.acceptedNovel,
      failed: false,
      failureCode: null,
    },
  });
  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('lusha', {}),
    providerSeen: PROVIDER_SEEN_LOAD_UNAVAILABLE,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: {},
  };
  return {
    deps: {
      runGate: async () => gateResult,
      persist: async (_client, persistInput) => {
        persistCalls.push(persistInput.batchId ?? null);
        return {
          batchId: input.batchId === undefined ? 'batch-canonico' : input.batchId,
          writtenCount: input.written,
          skippedCount: input.acceptedNovel - input.written,
          failed: false,
        };
      },
    },
    persistCalls: () => persistCalls,
  };
}

/**
 * 🔴 La constante VIVA, no un literal. Es lo que convierte apagarla en una
 * mutación detectable por COMPORTAMIENTO (NEGATIVE_A) y no sólo por grep.
 */
function runFreeLayer(deps: PrePaidNoveltyDiscoveryDeps, batchId = 'batch-canonico') {
  return runPrePaidNoveltyDiscovery(
    CLIENT,
    {
      provider: 'lusha',
      countryCode: 'CO',
      countryName: 'Colombia',
      macroIndustryKey: 'health_pharma',
      requestedTarget: TARGET,
      requestedByUserId: USER,
      partialGapSupported: LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED,
      resolveBatchId: async () => batchId,
    },
    deps,
  );
}

describe('CUT-9 §§ 2, 10 · el hueco que la ruta de pago recibe es el RESTANTE', () => {
  it('🔴 CASO 1 · F = 0 ⇒ hueco COMPLETO y el proveedor corre', async () => {
    const free = freeLayer({ acceptedNovel: 0, written: 0 });

    const outcome = await runFreeLayer(free.deps);

    assert.equal(outcome.providerRequired, true);
    assert.equal(outcome.residualGap, TARGET, 'el hueco es el objetivo entero');
    assert.equal(outcome.acceptedBeforeProvider, 0);
    assert.equal(outcome.persistedCount, 0);
    assert.equal(free.persistCalls().length, 0, 'sin empresas no se escribe nada');
  });

  it('🔴 CASO 2 · NEGATIVE_B · 0 < F < T ⇒ el aporte SOBREVIVE y el hueco se RECORTA', async () => {
    const free = freeLayer({ acceptedNovel: 2, written: 2 });

    const outcome = await runFreeLayer(free.deps);

    // 1. La contribución sobrevive: se persiste, en el lote CANÓNICO.
    assert.deepEqual(free.persistCalls(), ['batch-canonico'], '🔴 lote único, no uno propio');
    assert.equal(outcome.batchId, 'batch-canonico');
    assert.equal(outcome.persistedCount, 2);
    assert.equal(outcome.acceptedBeforeProvider, 2);

    // 2. Y la ruta de pago recibe SÓLO lo que falta.
    assert.equal(outcome.providerRequired, true);
    assert.equal(
      outcome.residualGap,
      TARGET - 2,
      '🔴 NEGATIVE_B: el hueco volvió al objetivo COMPLETO con aporte gratuito vivo',
    );
  });

  it('🔴 CASO 3 · F = T ⇒ el proveedor NO corre', async () => {
    const free = freeLayer({ acceptedNovel: TARGET, written: TARGET });

    const outcome = await runFreeLayer(free.deps);

    assert.equal(outcome.providerRequired, false, '🔴 es lo que corta estimación y reserva');
    assert.equal(outcome.residualGap, 0);
    assert.equal(outcome.persistedCount, TARGET);
    assert.equal(outcome.batchId, 'batch-canonico');
  });

  it('🔴 CASO 4 · persistido < aceptado ⇒ el hueco se REABRE, no se cierra por filas', async () => {
    // La puerta admitió el objetivo entero; la ingesta canónica guardó menos.
    const free = freeLayer({ acceptedNovel: TARGET, written: 3 });

    const outcome = await runFreeLayer(free.deps);

    assert.equal(outcome.persistedCount, 3, 'lo escrito es lo escrito');
    assert.equal(outcome.acceptedBeforeProvider, 3, '🔴 sólo lo GUARDADO cierra hueco');
    assert.equal(outcome.residualGap, TARGET - 3);
    assert.equal(
      outcome.providerRequired,
      true,
      '🔴 unas filas no pueden declarar el objetivo alcanzado',
    );
  });

  it('🔴 NEGATIVE_L · el hueco NO se convierte en la reserva económica', () => {
    const action = body(ACTION_PATH);
    // La reserva sale del PLAN del proveedor, no del hueco ni del restante.
    assert.match(action, /const requiredCredits = estimateLushaRunCredits\(searchPlan\);/);
    for (const forbidden of [
      /estimateLushaRunCredits\([^)]*residualGap/,
      /estimateLushaRunCredits\([^)]*remainingTarget/,
      /requiredCredits\s*=\s*[^;]*remainingTarget/,
      /requiredCredits\s*=\s*[^;]*residualGap/,
    ]) {
      assert.equal(forbidden.test(action), false, `la reserva pasó a depender del hueco: ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 2, 3 — NADA de aritmética nueva del hueco
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-9 §§ 2, 3 · el hueco y la aceptación se LEEN, no se recalculan', () => {
  it('🔴 la acción no escribe ninguna resta del objetivo a mano', () => {
    const action = body(ACTION_PATH);
    for (const forbidden of [
      /requestedTarget\s*-\s*/,
      /-\s*prePaid\.persistedCount/,
      /-\s*freeRows/,
      /TARGET\s*-\s*/,
    ]) {
      assert.equal(
        forbidden.test(action),
        false,
        `🔴 aritmética del hueco escrita a mano: ${forbidden}`,
      );
    }
    // Y sí consume las dos autoridades existentes.
    assert.match(action, /resolveProviderResultDemand\(prePaid, requestedTarget\)/);
    assert.match(action, /targetGap: prePaid\.residualGap,/);
  });

  it('🔴 NEGATIVE_O · hay UNA sola entrada a la aritmética de aceptación', () => {
    const action = body(ACTION_PATH);
    assert.equal(
      (action.match(/resolveAcceptedForTarget\(/g) ?? []).length,
      1,
      '🔴 una segunda llamada es una segunda aritmética que puede divergir',
    );
    assert.equal(
      (action.match(/resolveRunAcceptance\b/g) ?? []).length >= 4,
      true,
      'el helper único tiene que ser el que se reutiliza',
    );
    // Y ninguna reimplementación del veredicto fuera de la autoridad.
    for (const forbidden of [
      /acceptedFree\s*\+\s*acceptedPaid/,
      /targetReached\s*=\s*/,
      />=\s*requestedTarget/,
    ]) {
      assert.equal(forbidden.test(action), false, `veredicto reimplementado: ${forbidden}`);
    }
  });

  it('🔴 NEGATIVE_G · `target_count` sigue siendo la AUTORIDAD DE PETICIÓN', () => {
    const canonical = body('src/server/prospect-batches/lusha-canonical-batch.ts');
    assert.match(canonical, /target_count: identity\.requestedTarget,/);
    for (const forbidden of [
      /target_count:\s*persistedCount/,
      /target_count:\s*targetGap/,
      /target_count:\s*usefulCandidatesCount/,
      /target_count:\s*residualGap/,
    ]) {
      assert.equal(forbidden.test(canonical), false, `target_count redefinido: ${forbidden}`);
    }
    const action = body(ACTION_PATH);
    assert.match(action, /requestedTarget = LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES/);
    assert.equal(/requestedTarget:\s*prePaid\./.test(action), false);
  });

  it('🔴 NEGATIVE_M · el enrutado y la activación de proveedor NO cambian', () => {
    const action = body(ACTION_PATH);
    assert.match(action, /guardLushaPreviewEnabled/);
    assert.match(action, /buildLushaRoutingCriteria\(/);
    assert.match(action, /buildProviderRoutingMetadata\(/);
    assert.match(action, /assertLushaRoutingPlanSafe\(routingPlan\)/);
    // 🔴 La salida gratuita sigue decidiéndose con `providerRequired`: CUT-9 no
    // mueve la decisión de si el proveedor corre.
    assert.match(action, /if \(!prePaid\.providerRequired\) \{/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 6, 7 — DEDUPE CRUZADO en el núcleo REAL
// ═══════════════════════════════════════════════════════════════════════════

function noDuplicateResult(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 85,
    input,
    matches: [],
    summary: 'nuevo',
    checkedSources: ['sellup', 'hubspot'],
  };
}

function lushaCompany(overrides: Partial<LushaPreviewCompany>): LushaPreviewCompany {
  return {
    name: 'Clinica Uno',
    domain: null,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Hospitals & Clinics',
    employeesExact: 320,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 92,
    passesGate: true,
    issues: [],
    providerCompanyId: 'pc-default',
    ...overrides,
  };
}

function lushaSuccess(results: LushaPreviewCompany[]): LushaPreviewResult {
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

const LUSHA_INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const LUSHA_ACTOR = {
  internalUserId: USER,
  clientRequestId: CLIENT_REQUEST,
  requestedTarget: TARGET,
};

/**
 * Resolvedor oficial por NOMBRE: cada empresa recibe SU identidad fiscal.
 *
 * 🔴 Hace falta que sean distintas para que el dedupe cruzado sea una prueba y no
 * un colapso: con un único NIT para todas, cualquier admisión dejaría una fila y el
 * caso pasaría por las razones equivocadas.
 */
function taxByName(map: Record<string, string>): OfficialSourceResolver {
  return {
    countryCode: 'CO',
    sourceKey: 'co_siis',
    canResolve: () => true,
    resolve: (input) => {
      const name =
        input.candidate.canonicalName ??
        input.candidate.commercialName ??
        input.candidate.legalName ??
        '';
      const taxIdentifier = map[name];
      if (!taxIdentifier) {
        return {
          status: 'not_found',
          countryCode: 'CO',
          sourceKey: 'co_siis',
          confidence: 0,
          warnings: [],
          issues: [],
        };
      }
      return {
        status: 'matched',
        countryCode: 'CO',
        sourceKey: 'co_siis',
        confidence: 1,
        matchMethod: 'tax_id',
        taxIdentifier,
        taxIdentifierType: 'NIT',
        legalName: `${name} S.A.S.`,
        legalStatus: 'ACTIVA',
        warnings: [],
        issues: [],
      };
    },
  };
}

/**
 * La SIEMBRA cruzada, producida por la autoridad REAL
 * (`loadBatchIdentityRegistry` sobre la ruta anterior a B4, que es la que
 * Producción ejecuta hoy porque la M126 se entrega SIN aplicar).
 */
async function seedFromFreeRows(rows: Array<{ id: string; taxIdentifier: string }>) {
  const client = {
    rpc: preM126Rpc,
    from() {
      const node: Record<string, unknown> = {
        select: () => node,
        eq: () => node,
        in: () =>
          Promise.resolve({
            data: rows.map((r) => ({
              id: r.id,
              name: `LIBRE ${r.id}`,
              domain: null,
              website: null,
              country_code: 'CO',
              tax_id: r.taxIdentifier,
              tax_identifier: r.taxIdentifier,
              status: 'needs_review',
              metadata: null,
              source_trace: { sourceProvider: 'public_source' },
            })),
            error: null,
          }),
      };
      return node;
    },
  } as unknown as SupabaseClient;
  return loadBatchIdentityRegistry(client, 'batch-canonico');
}

function makePaidDeps(input: {
  search: LushaPreviewResult;
  resolvers?: OfficialSourceResolver[];
  /** Filas que la base CONFIRMA. Por defecto, todas las enviadas. */
  insertedCount?: number;
}) {
  const calls = {
    batches: [] as LushaPendingReviewBatchRow[],
    candidateBatches: [] as LushaPendingReviewCandidateRow[][],
    order: [] as string[],
  };
  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async (searchInput) =>
      (searchInput.page ?? 0) > 0 ? lushaSuccess([]) : input.search,
    reserveBatch: async (row: LushaPendingReviewBatchRow) => {
      calls.batches.push(row);
      calls.order.push('reserveBatch');
      // Lote ADOPTADO: la mitad gratuita ya lo materializó en esta ejecución.
      return {
        id: 'batch-canonico',
        adopted: true,
        identityEpoch: 7,
      } satisfies LushaCanonicalBatchReservation;
    },
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: async (batchId: string) => {
      calls.order.push(`readBatchIdentityEpoch:${batchId}`);
      return preM126BatchEpochSnapshot();
    },
    insertCandidates: async (rows) => {
      calls.candidateBatches.push(rows);
      calls.order.push('insertCandidates');
      return { insertedCount: input.insertedCount ?? rows.length };
    },
    checkCompanyDuplicate: async (dupInput) => noDuplicateResult(dupInput),
    fetchActiveCandidates: async () => [] as ActiveCandidateRecord[],
    officialSourceResolvers: input.resolvers ?? [],
  };
  return { deps, calls };
}

describe('CUT-9 §§ 6, 7 · una empresa cuenta hacia el objetivo UNA sola vez', () => {
  it('🔴 CASO 5 · lo de pago es DISJUNTO de lo gratuito ⇒ el objetivo se cierra', async () => {
    const seed = await seedFromFreeRows([
      { id: 'free-a', taxIdentifier: '900000001' },
      { id: 'free-b', taxIdentifier: '900000002' },
    ]);
    assert.equal(seed.seededCount, 2, 'la siembra tiene que ver las filas gratuitas');
    assert.equal(seed.degraded, false);

    const { deps, calls } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
        lushaCompany({ providerCompanyId: 'pc-d', name: 'Clinica D', domain: 'd.com' }),
        lushaCompany({ providerCompanyId: 'pc-e', name: 'Clinica E', domain: 'e.com' }),
      ]),
      resolvers: [
        taxByName({
          'Clinica C': '900000003',
          'Clinica D': '900000004',
          'Clinica E': '900000005',
        }),
      ],
    });

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: TARGET - 2, batchIdentitySeed: seed },
    );

    assert.equal(result.status, 'success');
    assert.equal(result.batchIdentityDuplicateSkippedCount, 0, 'nada colisionaba');
    assert.equal(result.insertedCandidatesCount, 3);
    assert.equal(result.multiBranch?.acceptedForTargetTotal, 3);
    assert.equal(calls.candidateBatches[0].length, 3);

    // Y la aceptación de la corrida ENTERA la resuelve la autoridad canónica.
    const acceptance = runAcceptance({ freePersisted: 2, result });
    assert.equal(acceptance.acceptedFreeForTarget, 2);
    assert.equal(acceptance.acceptedPaidForTarget, 3);
    assert.equal(acceptance.acceptedForTargetTotal, TARGET);
    assert.equal(acceptance.remainingTarget, 0);
    assert.equal(acceptance.targetReached, true);
  });

  it('🔴 CASO 6 · NEGATIVE_D · lo de pago REPITE lo gratuito ⇒ cuenta UNA vez', async () => {
    const seed = await seedFromFreeRows([
      { id: 'free-a', taxIdentifier: '900000001' },
      { id: 'free-b', taxIdentifier: '900000002' },
    ]);

    const { deps, calls } = makePaidDeps({
      search: lushaSuccess([
        // Las dos primeras son las MISMAS empresas que lo gratuito ya cerró: otro
        // id de proveedor, otro dominio, MISMA identidad fiscal.
        lushaCompany({ providerCompanyId: 'pc-a2', name: 'Clinica A', domain: 'a2.com' }),
        lushaCompany({ providerCompanyId: 'pc-b2', name: 'Clinica B', domain: 'b2.com' }),
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
      ]),
      resolvers: [
        taxByName({
          'Clinica A': '900000001',
          'Clinica B': '900000002',
          'Clinica C': '900000003',
        }),
      ],
    });

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: TARGET - 2, batchIdentitySeed: seed },
    );

    // 1. Las dos repetidas NO llegan al INSERT, y no son errores.
    assert.equal(result.batchIdentityDuplicateSkippedCount, 2);
    assert.equal(result.batchIdentityMetrics?.errors, 0);
    assert.equal(calls.candidateBatches[0].length, 1, '🔴 sólo la NUEVA se persiste');
    assert.equal(result.insertedCandidatesCount, 1);

    // 2. Y el hueco se REABRE: `target_reached` con hueco abierto es imposible.
    assert.equal(result.multiBranch?.acceptedForTargetTotal, 1);
    assert.equal(result.remainingGapFinal, 2);
    assert.notEqual(result.stopReason, 'target_reached');

    // 3. La aritmética canónica: 2 + 1 = 3, NUNCA 2 + 3 = 5.
    const acceptance = runAcceptance({ freePersisted: 2, result });
    assert.equal(acceptance.acceptedFreeForTarget, 2);
    assert.equal(acceptance.acceptedPaidForTarget, 1);
    assert.equal(acceptance.acceptedForTargetTotal, 3);
    assert.equal(acceptance.remainingTarget, 2);
    assert.equal(
      acceptance.targetReached,
      false,
      '🔴 NEGATIVE_D: una empresa contó dos veces y el objetivo se declaró cumplido',
    );

    // 4. Y la telemetría dice que la siembra EXISTIÓ: «0 duplicados» y «no se
    //    sembró nada» tienen que ser distinguibles.
    assert.equal(result.batchIdentityMetrics?.batch_identity_seed_available, true);
    assert.equal(result.batchIdentityMetrics?.batch_identity_seeded_rows, 2);
    assert.equal(result.batchIdentityMetrics?.batch_identity_seed_degraded, false);
  });

  it('🔴 NEGATIVE_D (contraste) · SIN siembra, la MISMA corrida contaría dos veces', async () => {
    // El caso que demuestra que la siembra es lo que hace el trabajo: mismos datos,
    // registro vacío —el comportamiento anterior a CUT-9— y las dos repetidas
    // pasan. Es la mutación de § 21-D aplicada al parámetro.
    const { deps } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-a2', name: 'Clinica A', domain: 'a2.com' }),
        lushaCompany({ providerCompanyId: 'pc-b2', name: 'Clinica B', domain: 'b2.com' }),
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
      ]),
      resolvers: [
        taxByName({
          'Clinica A': '900000001',
          'Clinica B': '900000002',
          'Clinica C': '900000003',
        }),
      ],
    });

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: TARGET - 2, batchIdentitySeed: null },
    );

    assert.equal(result.batchIdentityDuplicateSkippedCount, 0, 'sin siembra nada se retira');
    assert.equal(result.insertedCandidatesCount, 3);
    const acceptance = runAcceptance({ freePersisted: 2, result });
    assert.equal(
      acceptance.acceptedForTargetTotal,
      TARGET,
      '🔴 y así 2 + 3 cerraban el objetivo con 3 empresas distintas: el defecto',
    );
    // Y la telemetría lo dice: no había siembra.
    assert.equal(result.batchIdentityMetrics?.batch_identity_seed_available, false);
  });

  it('🔴 § 7 · el dedupe cruzado ocurre ANTES de convertir el aporte en aceptación', () => {
    const core = body(CORE_PATH);
    const admission = core.indexOf('const batchIdentityAdmission = admitByBatchIdentity(');
    const reserve = core.indexOf('const reservation = await deps.reserveBatch(');
    const insert = core.indexOf('const fenced = await deps.insertCandidatesFenced({');
    const reconcile = core.indexOf('const persistedForTarget = Math.min(insertedCount, useful.length)');
    assert.ok(admission > 0 && reserve > 0 && insert > 0 && reconcile > 0);
    assert.ok(admission < reserve, 'la admisión corre antes de materializar el lote');
    assert.ok(reserve < insert);
    assert.ok(insert < reconcile, 'la aceptación se reconcilia con las filas REALES');
  });

  it('🔴 § 7 · no se acuña ningún emparejamiento DÉBIL', () => {
    const core = body(CORE_PATH);
    const action = body(ACTION_PATH);
    for (const forbidden of [
      'displayName',
      'includes(candidate.name',
      "order('created_at'",
      'latestRow',
      'latest_batch',
    ]) {
      assert.ok(!core.includes(forbidden), `matching débil en el núcleo: ${forbidden}`);
      assert.ok(!action.includes(forbidden), `matching débil en la acción: ${forbidden}`);
    }
    // Y la siembra sale de la autoridad EXISTENTE, no de una consulta ad-hoc.
    assert.match(action, /loadBatchIdentityRegistry\(supabase, prePaid\.batchId\)/);
    // 🔴 NEGATIVE_D (cableado) — la siembra CARGADA es la que viaja al núcleo.
    // Sin esta guarda, sustituirla por `null` en el sitio de la llamada devolvía el
    // doble conteo sin que ninguna prueba de comportamiento lo notara: las suites
    // inyectan la siembra directamente en el núcleo.
    assert.match(
      action,
      /const batchIdentitySeed =\s*\n\s*prePaid\.batchId !== null\s*\n\s*\? await loadBatchIdentityRegistry\(supabase, prePaid\.batchId\)\.catch\(\(\) => null\)\s*\n\s*: null;/,
      '🔴 la siembra dejó de resolverse desde el lote de la capa gratuita',
    );
    assert.match(
      action,
      /^\s*batchIdentitySeed,$/m,
      '🔴 la siembra cargada dejó de viajar al núcleo',
    );
    for (const forbidden of [
      /batchIdentitySeed: null/,
      /batchIdentitySeed: undefined/,
      /batchIdentitySeed: createBatchIdentityRegistry/,
    ]) {
      assert.equal(
        forbidden.test(action),
        false,
        `🔴 NEGATIVE_D: la siembra se apagó en el sitio de la llamada (${forbidden})`,
      );
    }
    assert.equal(
      /from\('prospect_candidates'\)[\s\S]{0,200}batch_id/.test(action),
      false,
      '🔴 apareció una consulta ad-hoc de siembra en la acción',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 3, 4 — PERSISTIDO ≠ ACEPTADO  ·  CASOS 7, 8
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔴 La MISMA composición que la acción cablea: demanda ← `prePaid`, aporte de
 * pago ← `multiBranch.acceptedForTargetTotal`, y `resolveAcceptedForTarget` como
 * única aritmética. Los guardas estáticos de § 3/§ 4 fijan que la acción no se
 * separe de esta forma.
 */
function runAcceptance(input: {
  freePersisted: number;
  result: PersistLushaPendingReviewResult;
  requestedTarget?: number;
}): AcceptedForTargetResult {
  const requestedTarget = input.requestedTarget ?? TARGET;
  const demand =
    input.freePersisted > 0
      ? resolveProviderResultDemand(
          {
            requestedTarget,
            acceptedBeforeProvider: input.freePersisted,
            residualGap: requestedTarget - input.freePersisted,
            providerRequired: requestedTarget - input.freePersisted > 0,
          },
          requestedTarget,
        )
      : fullTargetResultDemand(requestedTarget);
  return resolveAcceptedForTarget({
    demand,
    freePersistedCandidates: input.freePersisted,
    paid: paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: input.result.multiBranch?.acceptedForTargetTotal ?? null,
      persistedCandidates: input.result.insertedCandidatesCount,
    }),
  });
}

describe('CUT-9 §§ 3, 4 · lo persistido no es lo aceptado', () => {
  it('🔴 CASO 7 · NEGATIVE_C · la base confirmó MENOS filas que las enviadas', async () => {
    const seed = await seedFromFreeRows([{ id: 'free-a', taxIdentifier: '900000001' }]);
    const { deps } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
        lushaCompany({ providerCompanyId: 'pc-d', name: 'Clinica D', domain: 'd.com' }),
        lushaCompany({ providerCompanyId: 'pc-e', name: 'Clinica E', domain: 'e.com' }),
      ]),
      resolvers: [
        taxByName({
          'Clinica C': '900000003',
          'Clinica D': '900000004',
          'Clinica E': '900000005',
        }),
      ],
      insertedCount: 2,
    });

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: TARGET - 1, batchIdentitySeed: seed },
    );

    // La corrida INTENTÓ 3; la base confirmó 2. Sólo lo segundo cuenta.
    assert.equal(result.usefulCandidatesCount, 3, 'lo intentado se sigue diciendo');
    assert.equal(result.insertedCandidatesCount, 2);
    assert.equal(
      result.multiBranch?.acceptedForTargetTotal,
      2,
      '🔴 NEGATIVE_C: la aceptación volvió a ser lo intentado, no lo escrito',
    );

    const acceptance = runAcceptance({ freePersisted: 1, result });
    assert.equal(acceptance.acceptedPaidForTarget, 2);
    assert.equal(acceptance.acceptedForTargetTotal, 3);
    assert.equal(acceptance.persistedTotalCandidates, 3, 'el durable se REPORTA, no se recorta');
    assert.equal(acceptance.targetReached, false);
  });

  it('🔴 CASO 8 · NEGATIVE_I · sin medición, el aporte de pago es CERO, jamás sus filas', () => {
    const unmeasured = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: null,
      persistedCandidates: 4,
    });
    assert.equal(unmeasured.measured, false);

    const acceptance = resolveAcceptedForTarget({
      demand: resolveProviderResultDemand(
        {
          requestedTarget: TARGET,
          acceptedBeforeProvider: 1,
          residualGap: TARGET - 1,
          providerRequired: true,
        },
        TARGET,
      ),
      freePersistedCandidates: 1,
      paid: unmeasured,
    });

    assert.equal(acceptance.acceptedPaidForTarget, 0, '🔴 no medir no es cumplir');
    assert.notEqual(acceptance.acceptedPaidForTarget, 4, '🔴 NEGATIVE_I: colapsó a las filas');
    assert.equal(acceptance.paidAcceptanceMeasured, false);
    assert.deepEqual(acceptance.acceptanceUnknownReasons, ['acceptance_not_measured']);
    // Y el durable NO se pierde: § 13.
    assert.equal(acceptance.persistedPaidCandidates, 4);
    assert.equal(acceptance.persistedTotalCandidates, 5);
  });

  it('🔴 NEGATIVE_E · la aceptación de pago NUNCA excede el hueco restante', () => {
    // El proveedor produjo de más (página ya pagada). La autoridad no puede
    // sobrellenar el objetivo por mucho que haya rendido.
    const acceptance = resolveAcceptedForTarget({
      demand: resolveProviderResultDemand(
        {
          requestedTarget: TARGET,
          acceptedBeforeProvider: 3,
          residualGap: TARGET - 3,
          providerRequired: true,
        },
        TARGET,
      ),
      freePersistedCandidates: 3,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 9,
        persistedCandidates: 9,
      }),
    });

    assert.equal(acceptance.acceptedPaidForTarget, TARGET - 3);
    assert.equal(acceptance.acceptedForTargetTotal, TARGET);
    assert.equal(acceptance.remainingTarget, 0);
    assert.ok(
      acceptance.acceptedForTargetTotal <= acceptance.requestedTarget,
      '🔴 NEGATIVE_E: se aceptó por encima del objetivo pedido',
    );
    // Y el universo durable sigue diciendo la verdad, sin recortarse.
    assert.equal(acceptance.persistedPaidCandidates, 9);
    assert.equal(acceptance.persistedTotalCandidates, 12);
  });

  it('🔴 NEGATIVE_H · un total de FILAS no puede cerrar el objetivo', () => {
    // 12 filas durables, 10 aceptadas: `targetReached` mira lo aceptado y nada más.
    const acceptance = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: TARGET - 1,
        persistedCandidates: TARGET + 7,
      }),
    });
    assert.equal(acceptance.persistedTotalCandidates, TARGET + 7);
    assert.ok(acceptance.persistedTotalCandidates > acceptance.requestedTarget);
    assert.equal(acceptance.acceptedForTargetTotal, TARGET - 1);
    assert.equal(
      acceptance.targetReached,
      false,
      '🔴 NEGATIVE_H: las filas declararon alcanzado un objetivo que nadie alcanzó',
    );
  });

  it('🔴 el ejemplo del acta, con objetivo 10 · disjunto ⇒ 10; con 2 repetidas ⇒ 8', () => {
    const demand = resolveProviderResultDemand(
      {
        requestedTarget: 10,
        acceptedBeforeProvider: 4,
        residualGap: 6,
        providerRequired: true,
      },
      10,
    );

    const disjoint = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 4,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 6,
        persistedCandidates: 6,
      }),
    });
    assert.equal(disjoint.acceptedForTargetTotal, 10);
    assert.equal(disjoint.remainingTarget, 0);
    assert.equal(disjoint.targetReached, true);

    // Las 2 repetidas ya las retiró la admisión de identidad de lote, así que la
    // autoridad recibe 4 —no 6— y el resultado es honesto.
    const withDuplicates = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 4,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 4,
        persistedCandidates: 4,
      }),
    });
    assert.equal(withDuplicates.acceptedForTargetTotal, 8);
    assert.equal(withDuplicates.remainingTarget, 2);
    assert.equal(withDuplicates.targetReached, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 4, 15, 16 — la aceptación VIAJA, y la metadata durable NO se falsifica
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-9 §§ 4, 15, 16 · el resultado dice la verdad y no abre writers nuevos', () => {
  it('🔴 la acción adjunta `acceptedForTarget` en las TRES salidas', () => {
    const action = body(ACTION_PATH);
    assert.equal(
      (action.match(/acceptedForTarget: resolveRunAcceptance\(/g) ?? []).length,
      2,
      'la salida gratuita y la de fallo declaran la aceptación por el helper único',
    );
    assert.match(action, /return \{ \.\.\.result, acceptedForTarget: acceptance \};/);
    // 🔴 Y el aporte de pago sale de la autoridad RECONCILIADA, no de lo intentado.
    assert.match(
      action,
      /completeValidCandidates: result\.multiBranch\?\.acceptedForTargetTotal \?\? null,/,
    );
    assert.equal(
      /completeValidCandidates: result\.usefulCandidatesCount/.test(action),
      false,
      '🔴 la aceptación volvió a `usefulCandidatesCount`: eso es lo INTENTADO',
    );
    assert.equal(
      /completeValidCandidates: result\.insertedCandidatesCount/.test(action),
      false,
      '🔴 NEGATIVE_C: la aceptación se sustituyó por las filas',
    );
  });

  it('🔴 § 15 · esta superficie NO abre un writer de metadata sin vallado', () => {
    const action = body(ACTION_PATH);
    // ── REANCLADO por AGENT1-LOCAL-CUT9B ────────────────────────────────────
    //
    // Esta guarda prohibía `toAcceptedForTargetMetadata` y la clave canónica en la
    // acción, y era correcto MIENTRAS no existiera una forma segura de publicar:
    // el resolutor canónico no actualiza la metadata de un lote adoptado, así que
    // la única salida a mano era un `SELECT metadata` → `UPDATE metadata` SIN
    // valla. La guarda decía, con todas sus letras, «si un día lo hiciera, esta
    // guarda hay que revisarla».
    //
    // CUT9B construyó esa forma segura: la publicación pasa por
    // `publishFencedBatchMetadata` con un CAS sobre `identity_epoch`, y el régimen
    // lo decide la evidencia del esquema, no un literal. Así que lo que esta
    // guarda fija deja de ser «no se publica» y pasa a ser «no se publica A
    // CIEGAS», que es la propiedad que de verdad defendía.
    assert.ok(
      action.includes('toAcceptedForTargetMetadata') &&
        action.includes('ACCEPTED_FOR_TARGET_METADATA_KEY'),
      '🔴 la publicación durable desapareció de la acción: CUT9B se revirtió',
    );
    assert.ok(
      action.includes('publishFencedBatchMetadata(') &&
        action.includes('decideBatchMetadataFencePlan('),
      '🔴 la publicación durable dejó de pasar por la costura vallada',
    );
    // 🔴 Lo PROHIBIDO sigue prohibido, y con la misma letra: la acción no abre una
    // escritura propia sobre `prospect_batches`.
    assert.equal(
      /from\('prospect_batches'\)[\s\S]{0,200}\.update\(/.test(action),
      false,
      '🔴 apareció una escritura de metadata de lote en la acción',
    );
    // Y el resolutor canónico sigue sin actualizar nada al adoptar: la publicación
    // de CUT9B no vive ahí, y que siga sin `.update(` es lo que impide que la
    // adopción se convierta en una segunda escritura de metadata.
    const canonical = body('src/server/prospect-batches/lusha-canonical-batch.ts');
    assert.equal(/\.update\(/.test(canonical), false);
  });

  it('🔴 § 16 · el panel pinta lo ACEPTADO y el durable, nunca el objetivo pedido como producido', () => {
    const ui = body(
      'src/components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx',
    );
    assert.match(ui, /const acceptance = result\.acceptedForTarget \?\? null;/);
    assert.match(ui, /acceptance\.acceptedForTargetTotal/);
    assert.match(ui, /acceptance\.persistedTotalCandidates/);
    assert.match(ui, /acceptance\.paidAcceptanceMeasured/);
    // 🔴 `requestedTarget` sólo aparece como DENOMINADOR de lo aceptado, jamás solo.
    assert.match(ui, /\$\{acceptance\.acceptedForTargetTotal\} de \$\{acceptance\.requestedTarget\}/);
    assert.equal(
      /value=\{String\(acceptance\.requestedTarget\)\}/.test(ui),
      false,
      '🔴 el objetivo PEDIDO se pintó como si fuera lo producido',
    );
  });

  it('🔴 § 13 · el universo durable no se recorta para que el aceptado cuadre', () => {
    const core = body(CORE_PATH);
    const action = body(ACTION_PATH);
    for (const forbidden of ['.delete(', 'DELETE FROM', 'truncate']) {
      assert.ok(!core.includes(forbidden), `el núcleo borra filas: ${forbidden}`);
      assert.ok(!action.includes(forbidden), `la acción borra filas: ${forbidden}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 8, 9, 18, 19 — lote único, época fresca, verdad post-persistencia
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-9 §§ 8, 9, 18, 19 · lo que CUT9A cerró sigue cerrado', () => {
  it('🔴 NEGATIVE_F · una ejecución ⇒ UN lote; la mitad de pago ADOPTA', async () => {
    // 🔴 Con el RESERVE-OR-RETURN real (`reserveOrReturnLushaCanonicalBatch`), no
    // con una reimplementación: lo que se prueba es que la activación del hueco
    // parcial no reabre el lote sombra que CUT9A cerró.
    const inserts: Array<Record<string, unknown>> = [];
    let lookups = 0;
    const db: LushaCanonicalBatchDbClient = {
      from() {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push(row);
            return {
              select: () => ({
                single: async () =>
                  inserts.length === 1
                    ? { data: { id: 'batch-canonico' }, error: null }
                    : { data: null, error: { code: '23505', message: 'dup' } },
              }),
            };
          },
          select() {
            return {
              eq: () => ({
                eq: () => ({
                  single: async () => {
                    lookups += 1;
                    return {
                      data: { id: 'batch-canonico', identity_epoch: 4 },
                      error: null,
                    };
                  },
                }),
              }),
            };
          },
        };
      },
    };

    const resolver = createCanonicalLushaBatchResolver(
      (row) => reserveOrReturnLushaCanonicalBatch(row, db),
      {
        createdByUserId: USER,
        clientRequestId: CLIENT_REQUEST,
        requestedTarget: TARGET,
        defaults: {
          name: 'defecto',
          country: 'Colombia',
          country_code: 'CO',
          industry: 'health_pharma',
          search_depth: 'standard',
          status: 'ready_for_review',
          source: 'agent_1',
          metadata: {},
        },
      },
    );

    // La mitad GRATUITA materializa, la de PAGO pregunta a la MISMA instancia.
    const free = await resolver.resolve();
    const paid = await resolver.resolve({
      name: 'contribución de pago',
      country: 'Colombia',
      country_code: 'CO',
      industry: 'health_pharma',
      search_depth: 'standard',
      status: 'ready_for_review',
      source: 'agent_1',
      metadata: { provider: 'lusha' },
    });

    assert.equal(free.id, paid.id, '🔴 NEGATIVE_F: apareció un lote sombra');
    assert.equal(inserts.length, 1, '🔴 una ejecución no puede dejar dos lotes');
    assert.equal(lookups, 0, 'no hubo carrera: la memoización evitó el segundo INSERT');
    assert.equal(inserts[0].target_count, TARGET, '§ 14 — la petición la estampa el dueño');

    // Y la mitad de pago NO puede redefinir la identidad ni la petición.
    assert.equal(inserts[0].client_request_id, CLIENT_REQUEST);
    assert.equal(inserts[0].created_by, USER);
  });

  it('🔴 CASO 9 · NEGATIVE_J · la época se RELEE; la siembra no la sustituye', async () => {
    const seed = await seedFromFreeRows([{ id: 'free-a', taxIdentifier: '900000001' }]);
    const { deps, calls } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
      ]),
      resolvers: [taxByName({ 'Clinica C': '900000003' })],
    });

    await persistLushaPendingReviewBatch(deps, LUSHA_INPUT, LUSHA_ACTOR, undefined, {
      targetGap: TARGET - 1,
      batchIdentitySeed: seed,
    });

    // El lote se ADOPTÓ con época 7, y aun así la escritura NO usa ese número:
    // relee. Es la corrección de CUT9A-FIX, que la siembra no puede deshacer.
    assert.deepEqual(calls.order, [
      'reserveBatch',
      'readBatchIdentityEpoch:batch-canonico',
      'insertCandidates',
    ]);

    const core = body(CORE_PATH);
    assert.match(core, /const epochEvidence = await deps\.readBatchIdentityEpoch\(batchId\)/);
    assert.match(core, /expectedEpoch: epochEvidence\.epoch \?\? LUSHA_FRESH_BATCH_IDENTITY_EPOCH/);
    assert.equal(
      /expectedEpoch:\s*reservation\./.test(core),
      false,
      '🔴 NEGATIVE_J: la época volvió a salir de la reserva memoizada',
    );
    assert.equal(
      /expectedEpoch:\s*0[,\s]/.test(core),
      false,
      '🔴 NEGATIVE_J: apareció el literal 0 como época declarada',
    );
  });

  it('🔴 CASO 10 · NEGATIVE_K · una carrera REAL sigue fallando CERRADO', async () => {
    const seed = await seedFromFreeRows([{ id: 'free-a', taxIdentifier: '900000001' }]);
    const { deps } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
      ]),
      resolvers: [taxByName({ 'Clinica C': '900000003' })],
    });

    // La foto dice época 3; entre la relectura y el INSERT otro escritor avanzó.
    const racing: PersistLushaPendingReviewDeps = {
      ...deps,
      readBatchIdentityEpoch: async () => ({
        epoch: 3,
        fenceCapabilityAbsent: false,
        degraded: false,
      }),
      insertCandidatesFenced: async () => ({ status: 'stale' as const, currentEpoch: 9 }),
    };

    await assert.rejects(
      () =>
        persistLushaPendingReviewBatch(racing, LUSHA_INPUT, LUSHA_ACTOR, undefined, {
          targetGap: TARGET - 1,
          batchIdentitySeed: seed,
        }),
      /fence_stale/,
      '🔴 NEGATIVE_K: una carrera real dejó de fallar cerrado',
    );
  });

  it('🔴 una lectura AVERIADA de la época sigue fallando CERRADO, no a época 0', async () => {
    const { deps } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-c', name: 'Clinica C', domain: 'c.com' }),
      ]),
    });
    const broken: PersistLushaPendingReviewDeps = {
      ...deps,
      readBatchIdentityEpoch: async () => ({
        epoch: null,
        fenceCapabilityAbsent: false,
        degraded: true,
      }),
    };

    await assert.rejects(
      () => persistLushaPendingReviewBatch(broken, LUSHA_INPUT, LUSHA_ACTOR),
      /fence_snapshot_unavailable/,
    );
  });

  it('🔴 NEGATIVE_N · con filas escritas, la capa gratuita NUNCA reporta 0 ni lote nulo', async () => {
    const free = freeLayer({ acceptedNovel: 2, written: 2 });

    const outcome = await runFreeLayer(free.deps);

    assert.equal(outcome.persistedCount, 2, '🔴 NEGATIVE_N: se falsearon a 0 filas reales');
    assert.equal(outcome.batchId, 'batch-canonico', '🔴 NEGATIVE_N: un lote real se anuló');

    const runner = body(RUNNER_PATH);
    assert.match(runner, /persistence\.writtenCount > 0/);
    assert.equal(
      /batchId: null,\s*persistedCount: 0,\s*\}\;/.test(runner),
      false,
      'volvió el retorno que miente sobre lo escrito',
    );
  });

  it('🔴 la siembra degrada ABIERTO: un fallo de lectura no suprime candidatos', async () => {
    const brokenClient = {
      rpc: preM126Rpc,
      from() {
        const node: Record<string, unknown> = {
          select: () => node,
          eq: () => node,
          in: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        };
        return node;
      },
    } as unknown as SupabaseClient;

    const seed = await loadBatchIdentityRegistry(brokenClient, 'batch-canonico');
    assert.equal(seed.degraded, true, 'la degradación tiene que quedar dicha');
    assert.equal(seed.seededCount, 0);

    const { deps } = makePaidDeps({
      search: lushaSuccess([
        lushaCompany({ providerCompanyId: 'pc-a2', name: 'Clinica A', domain: 'a2.com' }),
      ]),
      resolvers: [taxByName({ 'Clinica A': '900000001' })],
    });

    const result = await persistLushaPendingReviewBatch(
      deps,
      LUSHA_INPUT,
      LUSHA_ACTOR,
      undefined,
      { targetGap: TARGET - 1, batchIdentitySeed: seed },
    );

    assert.equal(result.insertedCandidatesCount, 1, '🔴 una consulta caída no borra candidatos');
    assert.equal(result.batchIdentityMetrics?.batch_identity_seed_degraded, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §§ 11, 24 — alcance: presupuesto, migraciones y fronteras
// ═══════════════════════════════════════════════════════════════════════════

describe('CUT-9 §§ 11, 24 · alcance', () => {
  it('🔴 la política de presupuesto no se toca', () => {
    const action = body(ACTION_PATH);
    assert.match(action, /guardLushaRunBudget\(/);
    assert.match(action, /reserveLushaRunCredits\(\{ userId: internalUserId, clientRequestId, requiredCredits \}\)/);
    assert.match(action, /decideLushaCreditsToConfirm\(\{/);
    assert.match(action, /shouldReleaseLushaReservation\(\{/);
  });

  it('🔴 CUT-9 no añade migraciones, columnas ni DDL', () => {
    for (const rel of [ACTION_PATH, CORE_PATH, LIMITS_PATH, RUNNER_PATH]) {
      const src = read(rel);
      assert.equal(
        /alter table|ALTER TABLE|create or replace function|CREATE TABLE/i.test(src),
        false,
        `${rel} introdujo DDL`,
      );
    }
  });

  it('🔴 CUT-9 no toca HubSpot, ni crea cuentas, ni enriquece de pago', () => {
    const action = body(ACTION_PATH);
    for (const forbidden of ['hubspot_sync', 'createAccount', 'phone_reveal', 'revealPhone']) {
      assert.ok(!action.includes(forbidden), `fuera de alcance: ${forbidden}`);
    }
  });

  it('🔴 la aceptación no acuña una segunda clave ni un segundo veredicto', () => {
    const action = body(ACTION_PATH);
    const core = body(CORE_PATH);
    for (const forbidden of [
      'lusha_accepted_for_target',
      'lusha_target_truth',
      'pending_review_acceptance',
      'freeAcceptedForTarget',
    ]) {
      assert.ok(!action.includes(forbidden), `segunda autoridad en la acción: ${forbidden}`);
      assert.ok(!core.includes(forbidden), `segunda autoridad en el núcleo: ${forbidden}`);
    }
    // El núcleo NO calcula aceptación: sólo declara el campo por el que viaja.
    assert.equal(
      /resolveAcceptedForTarget\(/.test(core),
      false,
      '🔴 el núcleo empezó a resolver la aceptación por su cuenta',
    );
  });

  it('🔴 la aceptación libre entra por la MISMA puerta que la mixta', () => {
    const action = body(ACTION_PATH);
    assert.match(action, /PAID_ROUTE_NOT_RUN_WRITER_TRUTH/);
    // 🔴 Y significa cero CONOCIDO, no ausencia de medición: sin filas de pago la
    // aceptación de pago es cero MEDIDO. Es la regla de CUT-8B, comprobada aquí
    // sobre la constante REAL para que un cambio en su forma se note.
    const freeOnly = paidAcceptedContributionFromWriterTruth(PAID_ROUTE_NOT_RUN_WRITER_TRUTH);
    assert.equal(freeOnly.measured, true);
    assert.equal(freeOnly.measured === true && freeOnly.acceptedForTarget, 0);
    assert.equal(freeOnly.persistedCandidates, 0);
    // Y esa constante es la de CUT-8B, no una copia local.
    assert.match(
      read(ACTION_PATH),
      /PAID_ROUTE_NOT_RUN_WRITER_TRUTH,[\s\S]{0,400}from '@\/modules\/prospect-batches\/accepted-for-target'/,
    );
  });
});
