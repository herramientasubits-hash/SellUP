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
  toAcceptedForTargetMetadata,
} from '@/modules/prospect-batches/accepted-for-target';
import { resolveProviderResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
import { loadBatchIdentityRegistry } from '@/server/prospect-batches/batch-identity-registry-store';
import {
  resolveLushaBatchIdentitySeed,
  toLushaBatchIdentitySeedMetadata,
} from '@/modules/prospect-batches/lusha-batch-identity-seed';
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
  /** `true` ⇒ la escritura VALLADA responde `inserted` con sus ids. */
  fenced?: boolean;
  /** Siembra del registro de identidad del lote (lo que ya existe en él). */
  seed?: Awaited<ReturnType<typeof loadBatchIdentityRegistry>> | null;
  /** Dominios que la guarda de candidata ACTIVA ve en `prospect_candidates`. */
  activeDomains?: readonly string[];
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
    insertCandidatesFenced: options.fenced
      ? async ({ rows }: { rows: LushaPendingReviewCandidateRow[] }) => {
          candidateRows.push(...rows);
          return {
            status: 'inserted' as const,
            candidateIds: rows.map((_row, index) => `cand-${index + 1}`),
            insertedCount: rows.length,
            previousEpoch: 0,
            nextEpoch: 1,
          };
        }
      : preM126FencedInsert,
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
    fetchActiveCandidates: async () =>
      (options.activeDomains ?? []).map((domain) => ({
        id: `activa-${domain}`,
        name: domain,
        domain,
        normalizedDomain: domain,
        status: 'needs_review',
        countryCode: 'CO',
      })),
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
 * El cliente que la ACCIÓN usaría: devuelve las filas que el lote ya contiene.
 * `fail: true` reproduce la lectura caída.
 */
function batchReaderFor(
  rows: Array<{ id: string; name: string; domain: string }>,
  options: { fail?: boolean } = {},
): SupabaseClient {
  return {
    rpc: preM126Rpc,
    from() {
      const node: Record<string, unknown> = {
        select: () => node,
        eq: () => node,
        in: () =>
          options.fail
            ? Promise.reject(new Error('read_batch_identity_snapshot indisponible'))
            : Promise.resolve({
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
}

/**
 * 🔴 La siembra, POR EL CÓDIGO DEL LLAMADOR. `resolveLushaBatchIdentitySeed` es
 * la misma función que la acción invoca; aquí sólo se le inyecta la lectura.
 */
async function seedComoElLlamador(
  rows: Array<{ id: string; name: string; domain: string }>,
  options: { fail?: boolean } = {},
) {
  const client = batchReaderFor(rows, options);
  return resolveLushaBatchIdentitySeed({
    prePaidBatchId: null,
    waterfallCanonicalBatchId: 'batch-canonico',
    loadRegistry: (batchId) => loadBatchIdentityRegistry(client, batchId),
  });
}

/** Siembra directa, sólo para los casos que no ejercitan al llamador. */
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

  /**
   * 🔴 LOS CUATRO DESENLACES DEL **MISMO** CONJUNTO MIXTO.
   *
   * Se entregan SIEMPRE las dos —una completa y una incompleta— y sólo cambia
   * cuántas confirma la base. Sustituir «sólo quedó la completa» por una entrega
   * que únicamente contenía una completa sería otro caso: ahí no hay nada que
   * adivinar, y justamente lo que se prueba es qué se afirma cuando SÍ lo hay.
   */

  it('🔴 no quedó NINGUNA ⇒ 0 aceptadas, y el conteo es EXACTO', async () => {
    const { res } = await run([OK, BAD], { insertedCount: 0 });
    assert.equal(res.insertedCandidatesCount, 0);
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 0);
    assert.equal(
      res.multiBranch?.acceptedCountExact,
      false,
      'la ruta sin valla con 0 de 2 no sabe cuáles: sigue siendo una cota',
    );
  });

  it('🔴 quedó SÓLO la incompleta (o sólo la completa): 1 fila, 0 aceptadas', async () => {
    // La base confirma UNA y no dice cuál. Los dos desenlaces posibles son
    // «quedó la completa» (1 aceptada real) y «quedó la incompleta» (0), y desde
    // fuera son indistinguibles. La cota publica el peor caso: 0.
    const { res } = await run([OK, BAD], { insertedCount: 1 });
    assert.equal(res.insertedCandidatesCount, 1);
    assert.equal(
      res.multiBranch?.acceptedForTargetTotal,
      0,
      '🔴 no se acredita una completitud que nadie probó',
    );
    assert.equal(
      res.multiBranch?.acceptedCountExact,
      false,
      '🔴 y se DECLARA cota inferior, no conteo',
    );
  });

  it('🔴 quedaron AMBAS ⇒ 1 aceptada, y ahora sí es un CONTEO exacto', async () => {
    const { res } = await run([OK, BAD]);
    assert.equal(res.insertedCandidatesCount, 2);
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1);
    assert.equal(
      res.multiBranch?.acceptedCountExact,
      true,
      '🔴 con escritura total se sabe cuáles: deja de ser cota',
    );
  });

  it('dos COMPLETAS con una confirmada ⇒ 1: la cota no castiga de más', async () => {
    // Cuando TODAS las entregadas son completas, la que entró es completa
    // necesariamente. La cota lo refleja sin adivinar cuál.
    const { res } = await run(
      [OK, completa('c-ok2', 'Gamma Colombia SAS', 'gamma.com')],
      { insertedCount: 1 },
    );
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1);
    assert.equal(res.multiBranch?.acceptedCountExact, false, 'sigue siendo una cota');
  });

  it('🔴 la ruta VALLADA sí sabe cuáles: todo-o-nada con ids devueltos', async () => {
    // `insert_fenced_prospect_candidates` inserta el bloque entero en una
    // transacción y devuelve `candidateIds`. Un `inserted` es una escritura
    // TOTAL por contrato, así que el conteo es exacto sin cota que aplicar.
    const { res } = await run([OK, BAD], { fenced: true });
    assert.equal(res.insertedCandidatesCount, 2);
    assert.equal(res.multiBranch?.acceptedForTargetTotal, 1);
    assert.equal(res.multiBranch?.acceptedCountExact, true);
  });

  it('la cota, como función: peor caso honesto, acotada entre 0 y las completas', () => {
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 1, attempted: 2, inserted: 1 }), 0);
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 2, attempted: 2, inserted: 1 }), 1);
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 1, attempted: 1, inserted: 0 }), 0);
    assert.equal(boundAcceptedByUnconfirmedWrites({ complete: 3, attempted: 3, inserted: 3 }), 3);
    for (const [c, a, i] of [[5, 5, 2], [4, 6, 1], [9, 9, 0], [2, 7, 7]] as const) {
      const bound = boundAcceptedByUnconfirmedWrites({ complete: c, attempted: a, inserted: i });
      assert.ok(bound >= 0, 'nunca negativa');
      assert.ok(bound <= c, '🔴 nunca por encima de las completas');
      assert.ok(bound <= i, 'ni por encima de las filas confirmadas');
    }
  });

  it('🔴 el agregado NO publica `paid_acceptance_measured: true` sobre una cota', () => {
    const demand = resolveProviderResultDemand(
      { requestedTarget: 5, acceptedBeforeProvider: 0, residualGap: 5, providerRequired: true },
      5,
    );
    const conCota = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 2,
        persistedCandidates: 3,
        exact: false,
      }),
      persistedUniqueCeiling: 3,
    });
    assert.equal(conCota.acceptedForTargetTotal, 2, 'la cota SÍ se publica: es información');
    assert.equal(conCota.acceptedCountExact, false);
    assert.equal(
      conCota.paidAcceptanceMeasured,
      false,
      '🔴 medido no es lo mismo que exacto, y la bandera no puede mentir',
    );
    assert.equal(
      toAcceptedForTargetMetadata(conCota).accepted_count_kind,
      'lower_bound',
      'y la metadata lo nombra',
    );

    const exacto = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 2,
        persistedCandidates: 3,
      }),
      persistedUniqueCeiling: 3,
    });
    assert.equal(exacto.acceptedCountExact, true);
    assert.equal(exacto.paidAcceptanceMeasured, true);
    assert.equal(toAcceptedForTargetMetadata(exacto).accepted_count_kind, 'exact');
  });

  it('🔴 una COTA que alcanza el objetivo sigue probando `targetReached`', () => {
    // Una cota inferior nunca sobreestima, así que si llega al objetivo, el
    // objetivo se alcanzó. Degradarla a «no medido» perdería esa certeza.
    const demand = resolveProviderResultDemand(
      { requestedTarget: 5, acceptedBeforeProvider: 0, residualGap: 5, providerRequired: true },
      5,
    );
    const resolved = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 6,
        persistedCandidates: 8,
        exact: false,
      }),
      persistedUniqueCeiling: 8,
    });
    assert.equal(resolved.acceptedCountExact, false);
    assert.equal(resolved.targetReached, true, '🔴 la cota basta para afirmarlo');
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

  it('🔴 LLAMADOR REAL: Apollo dejó la empresa, la ruta lee el lote y siembra', async () => {
    // La siembra la resuelve `resolveLushaBatchIdentitySeed`, la MISMA función
    // que invoca la acción; el test sólo le inyecta la lectura.
    const identitySeed = await seedComoElLlamador([
      { id: 'apollo-row-1', name: 'Acme Colombia SAS', domain: 'acme.com' },
    ]);
    assert.equal(identitySeed.guardArmed, true, 'la guarda quedó armada');
    assert.equal(identitySeed.seed?.seededCount, 1);
    assert.equal(
      toLushaBatchIdentitySeedMetadata(identitySeed).cross_provider_dedupe_protected,
      true,
    );

    // Lusha devuelve la MISMA empresa con otro identificador, más una nueva y
    // dos INCOMPLETAS que elevan el techo durable.
    const { res, candidateRows } = await run(
      [
        completa('lusha-acme', 'Acme Colombia SAS', 'acme.com'),
        completa('lusha-nueva', 'Delta Colombia SAS', 'delta.com'),
        incompleta('lusha-i1', 'Eps Uno SAS', 'eps1.com'),
        incompleta('lusha-i2', 'Eps Dos SAS', 'eps2.com'),
      ],
      { seed: identitySeed.seed },
    );

    assert.equal(res.batchIdentityDuplicateSkippedCount, 1, 'la repetida se retira');
    assert.equal(res.insertedCandidatesCount, 3, 'entran la nueva y las dos incompletas');
    assert.ok(
      !candidateRows.some((row) => row.domain === 'acme.com'),
      '🔴 `acme.com` no vuelve a existir como fila',
    );

    // 🔴 EL AGREGADO FINAL: Apollo aportó a Acme, Lusha aporta sólo a Delta.
    // El techo durable es 4 (1 de Apollo + 3 de Lusha), así que NO contiene
    // nada: la contención es la guarda, y el total queda en 2 —una por empresa—
    // en vez de 3.
    const demand = resolveProviderResultDemand(
      { requestedTarget: 5, acceptedBeforeProvider: 0, residualGap: 5, providerRequired: true },
      5,
    );
    const agregado = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 1,
        persistedCandidates: 1,
        acceptedIdentities: ['candidate:11111111-1111-4111-8111-111111111111'],
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: res.multiBranch?.acceptedForTargetTotal ?? 0,
        persistedCandidates: res.insertedCandidatesCount,
        acceptedIdentities: res.acceptedCandidateIdentities ?? undefined,
        ...(res.multiBranch?.acceptedCountExact === false ? { exact: false } : {}),
      }),
      persistedUniqueCeiling: 4,
    });
    assert.equal(
      agregado.acceptedForTargetTotal,
      2,
      '🔴 UNA aceptación por empresa: Acme no se cuenta dos veces',
    );
    assert.equal(agregado.acceptedCountExact, true);
  });

  it('🔴 REPLAY por el llamador: conserva el total y añade CERO', async () => {
    // Primera ejecución: dos empresas nuevas.
    const primera = await run([
      completa('lusha-a', 'Acme Colombia SAS', 'acme.com'),
      completa('lusha-b', 'Delta Colombia SAS', 'delta.com'),
    ]);
    assert.equal(primera.res.multiBranch?.acceptedForTargetTotal, 2);

    // El llamador relee el lote —ahora con las dos filas— y repite la pierna.
    const identitySeed = await seedComoElLlamador([
      { id: 'row-a', name: 'Acme Colombia SAS', domain: 'acme.com' },
      { id: 'row-b', name: 'Delta Colombia SAS', domain: 'delta.com' },
    ]);
    const segunda = await run(
      [
        completa('lusha-a', 'Acme Colombia SAS', 'acme.com'),
        completa('lusha-b', 'Delta Colombia SAS', 'delta.com'),
      ],
      { seed: identitySeed.seed },
    );
    assert.equal(segunda.res.insertedCandidatesCount, 0, 'no escribe filas nuevas');
    assert.equal(segunda.res.multiBranch?.acceptedForTargetTotal, 0, 'aporta cero');

    // 🔴 El total de la corrida NO se reinicia: sigue siendo 2, porque las dos
    // identidades de la primera pasada siguen en el agregado.
    const demand = resolveProviderResultDemand(
      { requestedTarget: 5, acceptedBeforeProvider: 0, residualGap: 5, providerRequired: true },
      5,
    );
    const tras = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 0,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 2,
        persistedCandidates: 2,
        acceptedIdentities: primera.res.acceptedCandidateIdentities ?? undefined,
      }),
      paidWaterfall: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 0,
        persistedCandidates: 0,
      }),
      persistedUniqueCeiling: 2,
    });
    assert.equal(tras.acceptedForTargetTotal, 2, '🔴 el replay añade 0, no reinicia a 0');
  });

  it('🔴 si la LECTURA del lote falla, la guarda NO actúa y se declara', async () => {
    const identitySeed = await seedComoElLlamador(
      [{ id: 'apollo-row-1', name: 'Acme Colombia SAS', domain: 'acme.com' }],
      { fail: true },
    );
    // 🔴 La lectura NO lanza: `loadBatchIdentityRegistry` traduce el fallo a una
    // foto DEGRADADA, que es la forma correcta —una consulta caída no puede
    // convertirse en «esta empresa ya existía»—. El camino de excepción también
    // existe y lo cubre `resolveLushaBatchIdentitySeed`, pero el real es éste.
    assert.equal(identitySeed.loadFailed, false, 'la lectura degrada, no lanza');
    assert.equal(identitySeed.seed?.degraded, true, '🔴 y lo declara degradada');
    assert.equal(identitySeed.seed?.seededCount, 0, 'sin cobertura: cero filas vistas');
    assert.equal(
      toLushaBatchIdentitySeedMetadata(identitySeed).cross_provider_dedupe_protected,
      false,
      '🔴 y la fila lo DICE: en este camino la deduplicación NO está protegida',
    );

    // La empresa repetida SÍ vuelve a entrar por esta vía. No es una inflación
    // del conteo que la aritmética pueda arreglar: es cobertura ausente, y la
    // segunda protección —la guarda de candidata ACTIVA— vive en otra lectura.
    const { res } = await run([completa('lusha-acme', 'Acme Colombia SAS', 'acme.com')], {
      seed: identitySeed.seed,
    });
    assert.equal(res.batchIdentityDuplicateSkippedCount, 0);
    assert.equal(res.insertedCandidatesCount, 1);
  });

  it('🔴 y en ese camino queda la SEGUNDA protección, que es otra lectura', async () => {
    // Con la foto de identidad degradada, quien puede ver a `acme.com` es la
    // guarda de candidata ACTIVA, que lee `prospect_candidates` por dominio. Es
    // una lectura DISTINTA, así que un fallo no las apaga a las dos a la vez.
    //
    // 🔴 No es equivalente: esta guarda mira candidatas activas de CUALQUIER
    // lote, no la identidad de ESTE lote. Cubre la repetición entre proveedores
    // porque la fila de Apollo está `needs_review`, y dejaría de cubrirla si esa
    // fila se aprobara o se descartara.
    const degradado = await seedComoElLlamador(
      [{ id: 'apollo-row-1', name: 'Acme Colombia SAS', domain: 'acme.com' }],
      { fail: true },
    );
    const { res } = await run([completa('lusha-acme', 'Acme Colombia SAS', 'acme.com')], {
      seed: degradado.seed,
      activeDomains: ['acme.com'],
    });

    assert.equal(res.batchIdentityDuplicateSkippedCount, 0, 'la guarda de lote no actuó');
    assert.equal(
      res.insertedCandidatesCount,
      0,
      '🔴 pero la guarda de candidata ACTIVA sí: la fila no se duplica',
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
