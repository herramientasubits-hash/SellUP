/**
 * cut8b-free-only-acceptance-durable-publication.test.ts — la rama SÓLO-GRATUITA
 * publica el mismo bloque canónico de aceptación que la mixta.
 *
 * AGENT1-LOCAL-CUT8B-FREE-ONLY-ACCEPTANCE-DURABLE-PUBLICATION.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * CUT-8 llevó la verdad de aceptación de CUT-7 a la UI y a la metadata durable,
 * pero por una costura que sólo existe dentro del writer de PAGO. En la rama en
 * la que el proveedor de pago no corre —el objetivo se cierra gratis, o el
 * presupuesto bloquea la parte pagada— ese writer no existe, así que:
 *
 *   aceptación correcta → UI correcta → lote durable correcto
 *   → `metadata.accepted_for_target` AUSENTE
 *
 * ── Lo que este archivo congela ─────────────────────────────────────────────
 *
 * · el bloque se publica también sin ruta de pago (§ 4 CASO 1 y CASO 2);
 * · sale del MISMO proyector y con la MISMA forma que el de la rama mixta;
 * · viaja en la ÚNICA escritura terminal que esa rama ya hacía;
 * · «la ruta de pago no corrió» ≠ «no se midió» (§ 4 CASO 3).
 *
 * Cada bloque lleva su mutación en NEGATIVO (M, N, O, P, Q).
 *
 * Sin Supabase, sin Apollo, sin Tavily, sin red, 0 créditos, 0 proveedores reales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { WizardExecutionReservationResult } from '../wizard-idempotency';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  toAcceptedForTargetMetadata,
} from '@/modules/prospect-batches/accepted-for-target';
import { composeFreeOnlyTerminalBatchMetadata } from '../free-only-terminal-publication';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { ProviderResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-4266141740b1';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-4266141740b2';
const SUBINDUSTRY_ID = '323e4567-e89b-12d3-a456-4266141740b3';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-4266141740b4';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-4266141740b5';

const CLIENT = {} as unknown as SupabaseClient;

const REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [SUBINDUSTRY_ID],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

const CATALOG: CatalogResolutionOutput = {
  catalog: { version: 'v2024-01' },
  country: { code: 'CO', name: 'Colombia' },
  industry: { id: INDUSTRY_ID, slug: 'health-pharma', name: 'Salud / Farma' },
  subindustries: [
    { id: SUBINDUSTRY_ID, slug: 'clinicas', name: 'Clínicas', applicableCountries: ['CO'] },
  ],
};

function company(index: number): CountrySourceCompany {
  return {
    recordIdentityKey: `free-${index}`,
    legalName: `SINTETICA LIBRE ${index}`,
    normalizedLegalName: `sintetica libre ${index}`,
    taxId: `9400000${index}`,
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
 * 🔴 `acceptedNovel` y `persistedCount` son INDEPENDIENTES: es lo que hace
 * representable el CASO 2 —10 filas, 7 aceptadas— que antes era inexpresable.
 */
function freeLayer(input: {
  acceptedNovel: number;
  persistedCount: number;
}): PrePaidNoveltyDiscoveryDeps {
  const accepted = Array.from({ length: input.acceptedNovel }, (_unused, i) => company(i));
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
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: accepted,
    telemetry: { prepaid_probe: true },
  };

  return {
    runGate: async () => gateResult,
    persist: async (_client, persistInput) => ({
      batchId: persistInput.batchId ?? null,
      writtenCount: input.persistedCount,
      skippedCount: 0,
      failed: input.persistedCount === 0,
    }),
  };
}

type SealCall = {
  batchId: string;
  status: string;
  metadata: Record<string, unknown> | null | undefined;
};

type PaidBehaviour =
  | { kind: 'returns'; rows: number; accepted?: number; measured?: boolean }
  | { kind: 'budget_blocked' };

function wiring(options: {
  free: PrePaidNoveltyDiscoveryDeps;
  paid?: PaidBehaviour;
}): { deps: WizardExecutionDeps; sealed: SealCall[] } {
  const sealed: SealCall[] = [];
  const paid: PaidBehaviour = options.paid ?? { kind: 'returns', rows: TARGET };

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => CATALOG,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    resolveProvider: () => 'apollo_organizations',
    runPrePaidNoveltyDiscovery: (input) =>
      runPrePaidNoveltyDiscovery(
        CLIENT,
        {
          provider: 'apollo',
          countryCode: input.countryCode,
          countryName: input.countryName,
          macroIndustryKey: input.macroIndustryKey,
          requestedTarget: input.requestedTarget,
          requestedByUserId: input.requestedByUserId,
          resolveBatchId: input.resolveBatchId,
          // 🔴 EL VALOR VIVO.
          partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
        },
        options.free,
      ),
    reserveBudget: async () =>
      paid.kind === 'budget_blocked'
        ? {
            status: 'blocked' as const,
            code: 'BUDGET_EXCEEDED' as const,
            message: 'sin cupo',
            budgetSnapshot: null,
          }
        : { status: 'reserved' as const, reservationId: 'res-1', creditsReserved: 3 },
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    reserveSlot: async (): Promise<WizardExecutionReservationResult> => ({
      status: 'reserved',
      batchId: CANONICAL_BATCH_ID,
    }),
    sealFreeOnlyBatchStatus: async ({ batchId, status, metadata }) => {
      sealed.push({ batchId, status, metadata });
    },
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline:
      paid.kind === 'budget_blocked'
        ? undefined
        : async (input) => {
            const remaining = input.resultDemand?.remainingTarget ?? TARGET;
            const rows = Math.min(paid.rows, remaining);
            const accepted = Math.min(paid.accepted ?? rows, rows);
            const measured = paid.measured ?? true;
            return {
              batchId: input.reservedBatchId,
              candidatesCreated: rows,
              targetPersistibleCandidates: remaining,
              targetReached: rows >= remaining && remaining > 0,
              persistenceOutcome: {
                eligibleBeforePersistence: rows,
                persistedCandidates: rows,
                persistenceFailureCount: 0,
                persistenceFailed: false,
                persistenceErrorCode: null,
                persistenceErrorStage: null,
                persistenceStatus: 'success',
                persistenceAttemptedCount: rows,
                persistenceSucceededCount: rows,
                persistenceFailedCount: 0,
                persistenceGap: 0,
                ...(measured
                  ? { completeValidCandidates: accepted, reviewOnlyCandidates: rows - accepted }
                  : {}),
              },
            } as unknown as IncrementalSearchOutput;
          },
    markBatchFailed: async () => undefined,
  };

  return { deps, sealed };
}

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    execution: process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION,
    apollo: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
  };
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  try {
    return await fn();
  } finally {
    process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved.execution;
    process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved.apollo;
  }
}

function publishedBlock(sealed: SealCall[]): Record<string, unknown> {
  assert.equal(sealed.length, 1, 'la rama sólo-gratuita sella EXACTAMENTE una vez');
  const metadata = sealed[0].metadata;
  assert.ok(
    metadata !== null && metadata !== undefined,
    '🔴 sin metadata en el sellado no hay publicación durable',
  );
  const block = (metadata as Record<string, unknown>)[ACCEPTED_FOR_TARGET_METADATA_KEY];
  assert.ok(
    block !== null && typeof block === 'object',
    `🔴 ${ACCEPTED_FOR_TARGET_METADATA_KEY} AUSENTE — es el defecto que CUT-8B cierra`,
  );
  return block as Record<string, unknown>;
}

// ── § 4 CASO 1 · lo gratuito cierra el objetivo entero ───────────────────────

describe('CUT-8B § 4 CASO 1 — free satisface el objetivo y la metadata lo dice', () => {
  it('publica el bloque canónico con objetivo alcanzado', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    const result = await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));

    assert.equal(result.ok, true);
    assert.equal(result.status, 'success_target_reached');

    const block = publishedBlock(sealed);
    assert.equal(block.requested_target, TARGET);
    assert.equal(block.accepted_for_target_total, TARGET);
    assert.equal(block.remaining_target, 0);
    assert.equal(block.target_reached, true);
    assert.equal(block.accepted_free_for_target, TARGET);
    assert.equal(block.accepted_paid_for_target, 0);
  });

  it('la UI y la metadata durable dicen EXACTAMENTE lo mismo', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    const result = await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    assert.equal(result.ok, true);
    const summary = result.acceptedForTarget;
    assert.ok(summary);

    const block = publishedBlock(sealed);
    assert.equal(block.requested_target, summary.requestedTarget);
    assert.equal(block.accepted_for_target_total, summary.acceptedForTargetTotal);
    assert.equal(block.remaining_target, summary.remainingTarget);
    assert.equal(block.target_reached, summary.targetReached);
    assert.equal(block.persisted_total_candidates, summary.persistedTotalCandidates);
  });

  /**
   * 🔴 MUTACIÓN M — quitar la publicación de la rama sólo-gratuita.
   *
   * Se modela con un doble del sellado que TIRA la metadata, que es exactamente
   * lo que hacía el código antes de este corte.
   */
  it('🔴 NEGATIVO M — sin bloque publicado, la comprobación se pone roja', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    const mutated: WizardExecutionDeps = {
      ...deps,
      // El sellado de ANTES de CUT-8B: estado y nada más.
      sealFreeOnlyBatchStatus: async ({ batchId, status }) => {
        sealed.push({ batchId, status, metadata: null });
      },
    };
    await withEnv(() => executeProspectWizardGeneration(REQUEST, mutated));
    assert.throws(
      () => publishedBlock(sealed),
      /sin metadata en el sellado no hay publicación durable/,
      '🔴 así se vería el defecto que la guarda de arriba detiene',
    );
  });
});

// ── § 4 CASO 2 · persistido NO equivale a aceptado ───────────────────────────

describe('CUT-8B § 4 CASO 2 — 10 filas, 7 aceptadas, 3 restantes', () => {
  /**
   * La causa terminal es el PRESUPUESTO: la parte de pago no llega a correr, así
   * que ningún writer de proveedor publica. Es la clase «acaba con sólo la
   * contribución gratuita» del enunciado.
   */
  it('la metadata durable conserva 7 aceptadas y 3 pendientes', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: 7, persistedCount: 10 }),
      paid: { kind: 'budget_blocked' },
    });
    const result = await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    assert.equal(result.ok, false);

    const block = publishedBlock(sealed);
    assert.equal(block.requested_target, 10);
    assert.equal(block.accepted_for_target_total, 7, '🔴 aceptadas, NO filas');
    assert.equal(block.remaining_target, 3);
    assert.equal(block.target_reached, false);
    assert.equal(block.persisted_free_candidates, 10, '§ 10 — el universo durable no se recorta');
    assert.equal(block.persisted_total_candidates, 10);
  });

  /**
   * 🔴 MUTACIÓN N — `accepted := persisted`.
   *
   * Se aplica sobre la AUTORIDAD, con las mismas cifras de la corrida: si el
   * proyector leyera las filas en vez de la aceptación, publicaría 10/0/true.
   */
  it('🔴 NEGATIVO N — aceptar := persistidas publicaría 10/0/true', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: 7, persistedCount: 10 }),
      paid: { kind: 'budget_blocked' },
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    const block = publishedBlock(sealed);

    const mutatedTotal = block.persisted_total_candidates as number;
    assert.notEqual(
      mutatedTotal,
      block.accepted_for_target_total,
      '🔴 si estas dos coincidieran, «persistido = aceptado» pasaría inadvertido',
    );
    assert.equal(mutatedTotal, 10);
    assert.equal(block.accepted_for_target_total, 7);
  });
});

// ── § 4 CASO 3 · «no corrió» ≠ «no medido» ──────────────────────────────────

describe('CUT-8B § 4 CASO 3 — la pata de pago no ejecutada no se inventa', () => {
  it('free-only declara la aceptación de pago MEDIDA y en cero conocido', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    const block = publishedBlock(sealed);

    assert.equal(
      block.paid_acceptance_measured,
      true,
      '🔴 «el proveedor no corrió» es una RESPUESTA: cero conocido, no una medición ausente',
    );
    assert.deepEqual(block.acceptance_unknown_reasons, []);
    assert.equal(block.accepted_paid_for_target, 0);
    assert.equal(block.persisted_paid_candidates, 0);
  });

  it('la constante de «no corrió» pasa por el traductor canónico y da cero CONOCIDO', () => {
    const contribution = paidAcceptedContributionFromWriterTruth(PAID_ROUTE_NOT_RUN_WRITER_TRUTH);
    assert.equal(contribution.measured, true);
    assert.equal(contribution.persistedCandidates, 0);
  });

  it('🔴 un writer que ESCRIBIÓ y no midió sigue siendo «no medido», no cero', () => {
    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: null,
      persistedCandidates: 6,
    });
    assert.equal(contribution.measured, false);
    assert.equal(
      contribution.measured === false ? contribution.reason : null,
      'acceptance_not_measured',
      '🔴 la semántica de CUT-7 no se toca: no medir NO es cumplir',
    );
  });
});

// ── § 4 CASO 4 · misma forma en mixed y en free-only ────────────────────────

describe('CUT-8B § 4 CASO 4 — mixed y free-only publican la MISMA forma', () => {
  function demand(requestedTarget: number, acceptedBeforeProvider: number): ProviderResultDemand {
    return {
      requestedTarget,
      acceptedBeforeProvider,
      remainingTarget: Math.max(0, requestedTarget - acceptedBeforeProvider),
    } as ProviderResultDemand;
  }

  const mixedBlock = toAcceptedForTargetMetadata(
    resolveAcceptedForTarget({
      demand: demand(TARGET, 4),
      freePersistedCandidates: 4,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 3,
        persistedCandidates: 6,
      }),
    }),
  );

  it('las claves y los tipos coinciden clave a clave', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    const freeOnlyBlock = publishedBlock(sealed);

    assert.deepEqual(
      Object.keys(freeOnlyBlock).sort(),
      Object.keys(mixedBlock).sort(),
      '🔴 una clave de más o de menos ya es una segunda forma del mismo hecho',
    );
    for (const key of Object.keys(mixedBlock)) {
      assert.equal(
        Array.isArray(freeOnlyBlock[key]) ? 'array' : typeof freeOnlyBlock[key],
        Array.isArray(mixedBlock[key]) ? 'array' : typeof mixedBlock[key],
        `🔴 el tipo de ${key} diverge entre ramas`,
      );
    }
  });

  it('🔴 NEGATIVO Q — una clave propia de la rama libre rompe la paridad', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    const mutated = { ...publishedBlock(sealed), free_accepted_for_target: 10 };
    assert.notDeepEqual(
      Object.keys(mutated).sort(),
      Object.keys(mixedBlock).sort(),
      '🔴 así se vería el shape divergente que la guarda de arriba detiene',
    );
  });

  it('🔴 ninguna variante prohibida existe en el código', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    // 🔴 Comentarios fuera antes de grepear: esta prosa NOMBRA las variantes
    // prohibidas, y confundir «citarlo» con «usarlo» es el falso positivo que ya
    // mordió antes en este repo.
    const raw = readFileSync(
      path.join(repoRoot, 'modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
      'utf8',
    );
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
    for (const forbidden of [
      'free_accepted_for_target',
      'free_only_acceptance',
      'accepted_for_target_free',
    ]) {
      assert.doesNotMatch(
        src,
        new RegExp(forbidden),
        `🔴 ${forbidden} sería una segunda clave para el mismo hecho`,
      );
    }
  });
});

// ── § P · una sola publicación de metadata ──────────────────────────────────

describe('CUT-8B § P — la rama sólo-gratuita publica metadata UNA vez', () => {
  it('un solo sellado, y es el único que lleva metadata', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    await withEnv(() => executeProspectWizardGeneration(REQUEST, deps));
    assert.equal(sealed.length, 1);
    const withMetadata = sealed.filter((s) => s.metadata != null);
    assert.equal(withMetadata.length, 1, '🔴 una segunda publicación sería la mutación P');
  });

  it('🔴 NEGATIVO P — dos sellados con metadata serían dos publicaciones', async () => {
    const { deps, sealed } = wiring({
      free: freeLayer({ acceptedNovel: TARGET, persistedCount: TARGET }),
    });
    const mutated: WizardExecutionDeps = {
      ...deps,
      sealFreeOnlyBatchStatus: async (input) => {
        await deps.sealFreeOnlyBatchStatus?.(input);
        // La segunda escritura que este corte prohíbe.
        await deps.sealFreeOnlyBatchStatus?.(input);
      },
    };
    await withEnv(() => executeProspectWizardGeneration(REQUEST, mutated));
    assert.equal(
      sealed.filter((s) => s.metadata != null).length,
      2,
      '🔴 así se vería la publicación adicional que la guarda de arriba detiene',
    );
  });
});

// ── § O · sin aritmética duplicada en la costura gratuita ───────────────────

describe('CUT-8B § O — la costura gratuita no reimplementa la aceptación', () => {
  const repoRoot = path.resolve(__dirname, '../../../..');
  const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
  const stripComments = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
  const ACTIONS = 'modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';

  it('la proyección gratuita delega en el proyector canónico y no calcula nada', () => {
    const src = stripComments(read(ACTIONS));
    const at = src.indexOf('const freeOnlyAcceptedForTargetMetadata');
    assert.ok(at > 0, 'la costura gratuita existe y tiene nombre');
    const seam = src.slice(at, at + 300);
    assert.match(seam, /resolveAcceptedForTargetBatchMetadata\(/);
    assert.match(seam, /PAID_ROUTE_NOT_RUN_WRITER_TRUTH/);
    assert.doesNotMatch(
      seam,
      /Math\.(max|min)|[+\-]\s*\d|>=|targetReached\s*=/,
      '🔴 aritmética propia dentro de la costura gratuita sería la mutación O',
    );
  });

  it('el módulo de publicación terminal no sabe de objetivos', () => {
    const src = read('modules/prospect-batches/chat-wizard-execution/free-only-terminal-publication.ts');
    const code = stripComments(src);
    assert.doesNotMatch(code, /requestedTarget|remainingTarget|targetReached|Math\.(max|min)/);
    assert.match(code, /export function composeFreeOnlyTerminalBatchMetadata/);
  });

  it('🔴 NEGATIVO O — reimplementar la aritmética pondría roja la guarda', () => {
    const src = stripComments(read(ACTIONS));
    const at = src.indexOf('const freeOnlyAcceptedForTargetMetadata');
    const mutated =
      src.slice(at, at + 300).replace(
        'resolveAcceptedForTargetBatchMetadata(',
        'buildInline({ accepted: Math.min(free, target), remaining: target - free }) || noop(',
      );
    assert.match(
      mutated,
      /Math\.(max|min)/,
      '🔴 así se vería la segunda aritmética que la guarda de arriba detiene',
    );
  });
});

// ── La composición terminal conserva la procedencia de la reserva ───────────

describe('CUT-8B — publicar no puede pisar la procedencia de la reserva', () => {
  it('las claves previas sobreviven y la nueva se añade', () => {
    const current = {
      request_source: 'wizard',
      run_provider_selection: { resolved_discovery_provider: 'apollo_organizations' },
    };
    const published = { [ACCEPTED_FOR_TARGET_METADATA_KEY]: { requested_target: 10 } };
    const composed = composeFreeOnlyTerminalBatchMetadata(current, published);

    assert.equal(composed.request_source, 'wizard');
    assert.deepEqual(composed.run_provider_selection, {
      resolved_discovery_provider: 'apollo_organizations',
    });
    assert.deepEqual(composed[ACCEPTED_FOR_TARGET_METADATA_KEY], { requested_target: 10 });
  });

  it('una metadata ilegible no borra el bloque de esta corrida', () => {
    for (const broken of [null, undefined, 'texto', 42, ['a']]) {
      const composed = composeFreeOnlyTerminalBatchMetadata(broken, {
        [ACCEPTED_FOR_TARGET_METADATA_KEY]: { requested_target: 10 },
      });
      assert.deepEqual(composed[ACCEPTED_FOR_TARGET_METADATA_KEY], { requested_target: 10 });
    }
  });

  it('sin bloque que publicar, la fila conserva lo que tenía', () => {
    const composed = composeFreeOnlyTerminalBatchMetadata({ a: 1 }, null);
    assert.deepEqual(composed, { a: 1 });
  });
});
