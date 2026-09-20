/**
 * AGENT1-PRE-E2E-COUNTING-CLOSURE — los dos huecos de conteo, cerrados antes de
 * autorizar una sola corrida real.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * § 1 — ESCRITURA PARCIAL: un `insertedCount` no acredita completitud
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 DEFECTO REPRODUCIDO Y CORREGIDO EN ESTA ENTREGA.
 *
 * `insertCandidates` devuelve `{ insertedCount }` y nada más: dice CUÁNTAS
 * filas entraron, nunca CUÁLES. La cota anterior era
 * `Math.min(completas, insertadas)`, y con una entrega de una candidata COMPLETA
 * y una INCOMPLETA confirmada a medias daba `min(1, 1) = 1`: publicaba una
 * aceptación que, si la fila que entró fue la incompleta, no existía.
 *
 * La cota ahora es `completas − (entregadas − insertadas)`: el peor caso
 * honesto, suponer que las que NO entraron eran precisamente las completas.
 *
 * 🔴 CÓMO SE IDENTIFICA CUÁLES QUEDARON PERSISTIDAS: **no se identifica.** El
 * contrato de la dependencia no lo permite, y por eso la respuesta es una cota
 * conservadora y no una medición. Ampliar ese contrato —que la base devuelva
 * los ids escritos— es un cambio de superficie de escritura que esta entrega no
 * hace; mientras tanto, la aritmética no afirma lo que no puede probar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * § 2 — IDENTIDADES ENTRE PROVEEDORES: quién impide el doble conteo
 * ══════════════════════════════════════════════════════════════════════════
 *
 * La unión de identidades del agregado NO puede reconocer a la misma empresa
 * cuando cada pierna la nombra en su propio espacio (`candidate:<uuid>` de
 * Apollo, identidad de empresa de Lusha). Con filas incompletas que elevan el
 * techo durable, el techo tampoco la contiene.
 *
 * 🔴 Quien lo impide es una GUARDA ANTERIOR: `admitByBatchIdentity`, que compara
 * DOMINIO, LinkedIn e identidad fiscal —ejes comparables entre proveedores— y
 * retira a la empresa ANTES de escribirla. Aquí se demuestra con el recorrido
 * real, no con un techo de una fila: la aritmética sola no basta y se dice.
 *
 * I/O simulado: sin red, sin base, sin proveedor, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  persistLushaPendingReviewBatch,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewDeps,
} from '@/server/prospect-batches/lusha-pending-review';
import { boundAcceptedByUnconfirmedWrites } from '@/server/prospect-batches/lusha-run-acceptance-truth';
import {
  resolveAcceptedForTarget,
  paidAcceptedContributionFromWriterTruth,
} from '@/modules/prospect-batches/accepted-for-target';
import { resolveProviderResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import { loadBatchIdentityRegistry } from '@/server/prospect-batches/batch-identity-registry-store';
import { resolveLushaMacroSearchPlan } from '@/server/prospect-batches/lusha-macro-search-plan';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import { preM126FencedInsert } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '22222222-2222-4222-8222-222222222222',
  requestedTarget: 5,
};

const PLAN = resolveLushaMacroSearchPlan('health_pharma');

function linkedinFor(id: string): string {
  return `https://www.linkedin.com/company/${id}-co`;
}

/** Empresa que supera TODAS las condiciones del contrato canónico. */
function completa(id: string, name: string, domain: string): LushaPreviewCompany {
  return {
    providerCompanyId: id,
    name,
    domain,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Healthcare',
    employeesExact: 700,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: linkedinFor(id),
    score: 100,
    passesGate: true,
    issues: [],
  };
}

/** La MISMA empresa, sin la URL de LinkedIn: sobrevive pero no completa. */
function incompleta(id: string, name: string, domain: string): LushaPreviewCompany {
  return { ...completa(id, name, domain), linkedinUrl: null };
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
      sector: 'Salud & Farmacéuticos',
      industryKey: 'health_pharma',
      macroIndustryKey: 'health_pharma',
      mainIndustriesIds: [11],
      subIndustryId: null,
      sizeBand: { min: 201, max: 5000 },
      page: 0,
      size: 25,
    },
  } as unknown as LushaPreviewResult;
}

type RunOptions = {
  /** Filas que la base CONFIRMA. Por defecto, todas las entregadas. */
  insertedCount?: number;
  /** Siembra del registro de identidad del lote (lo que ya existe en él). */
  seed?: Awaited<ReturnType<typeof loadBatchIdentityRegistry>> | null;
};

async function run(companies: LushaPreviewCompany[], options: RunOptions = {}) {
  const candidateRows: LushaPendingReviewCandidateRow[] = [];
  let searchCalls = 0;

  const deps: PersistLushaPendingReviewDeps = {
    runSearch: async () => {
      searchCalls += 1;
      return searchCalls === 1 ? successResult(companies) : successResult([]);
    },
    reserveBatch: async () => ({
      id: 'batch-canonico',
      adopted: false,
      identityEpoch: 0,
    }),
    insertCandidatesFenced: preM126FencedInsert,
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async (rows: LushaPendingReviewCandidateRow[]) => {
      candidateRows.push(...rows);
      return { insertedCount: options.insertedCount ?? rows.length };
    },
    checkCompanyDuplicate: async (input: unknown) => ({
      status: 'new_candidate',
      confidence: 85,
      input,
      matches: [],
      summary: 'nuevo',
      checkedSources: ['sellup', 'hubspot'],
    }),
    fetchActiveCandidates: async () => [],
  } as unknown as PersistLushaPendingReviewDeps;

  const res = await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, undefined, {
    plan: PLAN!,
    targetGap: 5,
    creditsReserved: 6,
    ...(options.seed === undefined ? {} : { batchIdentitySeed: options.seed }),
  } as never);

  return { res, candidateRows };
}

/**
 * Siembra el registro con filas YA persistidas en el lote —lo que la pierna
 * anterior (Apollo, o esta misma en un replay) dejó—, con su DOMINIO, que es el
 * eje comparable entre proveedores.
 */
async function seedFromPersistedRows(
  rows: Array<{ id: string; name: string; domain: string }>,
) {
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
              name: r.name,
              domain: r.domain,
              website: `https://${r.domain}`,
              country_code: 'CO',
              tax_id: null,
              tax_identifier: null,
              status: 'needs_review',
              metadata: null,
              source_trace: { sourceProvider: 'apollo' },
            })),
            error: null,
          }),
      };
      return node;
    },
  } as unknown as SupabaseClient;
  return loadBatchIdentityRegistry(client, 'batch-canonico');
}

// ═════════════════════════════════════════════════════════════════════════════
// § 1 — ESCRITURA PARCIAL
// ═════════════════════════════════════════════════════════════════════════════

describe('PRE-E2E § 1 · escritura parcial: cuántas entraron no dice cuáles', () => {
  const OK = completa('c-ok', 'Acme Colombia SAS', 'acme.com');
  const BAD = incompleta('c-bad', 'Beta Colombia SAS', 'beta.com');

  it('🔴 una completa y una incompleta, la base confirma UNA ⇒ 0 aceptadas', async () => {
    const { res } = await run([OK, BAD], { insertedCount: 1 });

    assert.equal(res.insertedCandidatesCount, 1, 'la base confirmó una fila');
    assert.equal(
      res.multiBranch?.acceptedForTargetTotal,
      0,
      '🔴 la fila que entró pudo ser la incompleta: no se acredita ninguna',
    );
  });

  it('🔴 la MISMA entrega con las dos confirmadas ⇒ 1 aceptada', async () => {
    const { res } = await run([OK, BAD]);

    assert.equal(res.insertedCandidatesCount, 2, 'entraron las dos');
    assert.equal(
      res.multiBranch?.acceptedForTargetTotal,
      1,
      '🔴 ahora sí se sabe cuáles: la completa está dentro',
    );
  });

  it('sólo la completa, confirmada ⇒ 1; sólo la incompleta ⇒ 0', async () => {
    const soloOk = await run([OK]);
    assert.equal(soloOk.res.multiBranch?.acceptedForTargetTotal, 1);

    const soloBad = await run([BAD]);
    assert.equal(soloBad.res.multiBranch?.acceptedForTargetTotal, 0);
  });

  it('🔴 dos COMPLETAS con una confirmada ⇒ 1: la cota no castiga de más', async () => {
    // Cuando TODAS las entregadas son completas, la que entró es completa
    // necesariamente. La cota lo refleja sin adivinar cuál.
    const { res } = await run(
      [OK, completa('c-ok2', 'Gamma Colombia SAS', 'gamma.com')],
      { insertedCount: 1 },
    );
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1);
  });

  it('la cota, como función: peor caso honesto y nunca por encima de lo insertado', () => {
    // completas − (entregadas − insertadas)
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 1, attempted: 2, inserted: 1 }), 0);
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 2, attempted: 2, inserted: 1 }), 1);
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 1, attempted: 1, inserted: 0 }), 0);
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 3, attempted: 3, inserted: 3 }), 3);
    // Nunca supera las filas confirmadas.
    for (const [c, a, i] of [[5, 5, 2], [4, 6, 1], [9, 9, 0]] as const) {
      assert.ok(boundAcceptedByUnconfirmedWrites({ complete: c, attempted: a, inserted: i }) <= i);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § 2 — IDENTIDADES ENTRE PROVEEDORES
// ═════════════════════════════════════════════════════════════════════════════

describe('PRE-E2E § 2 · la misma empresa en dos piernas cuenta una vez', () => {
  it('🔴 la ARITMÉTICA sola NO la reconoce, y el techo elevado no la contiene', () => {
    // Apollo aceptó a `acme.com` (id de fila) y persistió además 3 incompletas.
    // Lusha la nombra en SU espacio. El lote tiene 5 filas únicas, así que el
    // techo durable vale 5 y no llega a estorbar.
    const demand = resolveProviderResultDemand(
      { requestedTarget: 5, acceptedBeforeProvider: 0, residualGap: 5, providerRequired: true },
      5,
    );
    const doble = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 1,
        persistedCandidates: 4,
        acceptedIdentities: ['candidate:11111111-1111-4111-8111-111111111111'],
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 1,
        persistedCandidates: 1,
        acceptedIdentities: ['lusha:acme.com'],
      }),
      persistedUniqueCeiling: 5,
    });

    assert.equal(
      doble.acceptedForTargetTotal,
      2,
      '🔴 LIMITACIÓN DECLARADA: dos espacios de nombres, dos aceptaciones. ' +
        'La unión no puede saber que son la misma empresa, y el techo de 5 ' +
        'filas no lo impide. Por eso la contención NO vive aquí.',
    );
  });

  it('🔴 la GUARDA anterior sí la reconoce: por DOMINIO, y antes de escribir', async () => {
    // Lo que la pierna anterior dejó en el lote, con su dominio.
    const seed = await seedFromPersistedRows([
      { id: 'apollo-row-1', name: 'Acme Colombia SAS', domain: 'acme.com' },
    ]);
    assert.equal(seed.seededCount, 1, 'la siembra ve la fila de la pierna anterior');
    assert.equal(seed.degraded, false, 'y la ve entera: no es una cobertura degradada');

    // Lusha devuelve la MISMA empresa —otro id de proveedor, mismo dominio— y
    // una empresa nueva.
    const { res, candidateRows } = await run(
      [
        completa('lusha-acme', 'Acme Colombia SAS', 'acme.com'),
        completa('lusha-nueva', 'Delta Colombia SAS', 'delta.com'),
      ],
      { seed },
    );

    assert.equal(
      res.batchIdentityDuplicateSkippedCount,
      1,
      '🔴 la guarda retiró a la repetida ANTES de escribirla',
    );
    assert.equal(res.insertedCandidatesCount, 1, 'sólo la nueva se escribe');
    assert.deepEqual(
      candidateRows.map((row) => row.domain),
      ['delta.com'],
      '🔴 `acme.com` no vuelve a existir como fila: no hay qué contar dos veces',
    );
    assert.equal(
      res.multiBranch?.acceptedForTargetTotal,
      1,
      'la pierna aporta UNA aceptación, la de la empresa nueva',
    );
  });

  it('🔴 REPLAY: repetir la pierna sobre el lote ya sembrado no añade nada', async () => {
    // Reanudación real: la primera ejecución dejó dos filas; la segunda vuelve a
    // recibir las MISMAS empresas del proveedor.
    const primera = await run([
      completa('lusha-a', 'Acme Colombia SAS', 'acme.com'),
      completa('lusha-b', 'Delta Colombia SAS', 'delta.com'),
    ]);
    assert.equal(primera.res.insertedCandidatesCount, 2);
    assert.equal(primera.res.multiBranch?.acceptedForTargetTotal, 2);

    const seed = await seedFromPersistedRows([
      { id: 'row-a', name: 'Acme Colombia SAS', domain: 'acme.com' },
      { id: 'row-b', name: 'Delta Colombia SAS', domain: 'delta.com' },
    ]);
    const segunda = await run(
      [
        completa('lusha-a', 'Acme Colombia SAS', 'acme.com'),
        completa('lusha-b', 'Delta Colombia SAS', 'delta.com'),
      ],
      { seed },
    );

    assert.equal(
      segunda.res.batchIdentityDuplicateSkippedCount,
      2,
      '🔴 las dos ya estaban en el lote',
    );
    assert.equal(segunda.res.insertedCandidatesCount, 0, 'no se escribe ninguna fila nueva');
    assert.equal(
      segunda.res.multiBranch?.acceptedForTargetTotal,
      0,
      '🔴 reanudar no infla: 0 aceptaciones nuevas',
    );
  });

  it('🔴 sin siembra la guarda NO puede actuar: la cobertura es del llamador', async () => {
    // Fail-OPEN declarado: una siembra ausente no puede convertirse en «esta
    // empresa ya existía». Es la razón por la que la contención depende de que
    // el llamador lea el lote, y por la que esto se prueba en vez de suponerse.
    const { res } = await run([completa('lusha-acme', 'Acme Colombia SAS', 'acme.com')], {
      seed: null,
    });
    assert.equal(res.batchIdentityDuplicateSkippedCount, 0);
    assert.equal(res.insertedCandidatesCount, 1);
  });
});
