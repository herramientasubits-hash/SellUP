/**
 * AGENT1-LUSHA-GLOBAL-IDENTITY-CLAIMS-1 — la ruta de Lusha respeta la regla de
 * «una empresa, un vendedor» (migración 140).
 *
 * Qué fija:
 *
 *   § 1 · sin la dependencia, todo es exactamente como antes de la 140;
 *   § 2 · la que pierde la carrera deja de contar: sale de `useful`, del total
 *         escrito y de las identidades aceptadas — reconocida por su id de
 *         LUSHA, nunca por el orden de `candidateIds`;
 *   § 3 · si no se puede reconocer cuál era, no se adivina: se descuenta del
 *         total y la aceptación cae a la cota inferior (fallo CERRADO);
 *   § 4 · una degradación (140 ausente, lectura caída) no marca a nadie;
 *   § 5 · la función del almacén relee por id y reclama lo guardado;
 *   § 6 · la acción de producción la inyecta, con el cliente ADMINISTRATIVO.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  persistLushaPendingReviewBatch,
  type LushaPendingReviewCandidateRow,
  type PersistLushaPendingReviewDeps,
} from '@/server/prospect-batches/lusha-pending-review';
import { resolveLushaMacroSearchPlan } from '@/server/prospect-batches/lusha-macro-search-plan';
import type {
  LushaPreviewCompany,
  LushaPreviewInput,
  LushaPreviewResult,
} from '@/server/prospect-batches/lusha-preview';
import { preM126BatchEpochSnapshot } from '@/server/prospect-batches/__tests__/support/lusha-batch-epoch-snapshot';
import {
  claimGlobalIdentitiesForPersistedCandidates,
  CLAIM_COMPANY_IDENTITIES_RPC,
  type PersistedGlobalIdentityClaimOutcome,
} from '@/server/prospect-batches/global-identity-claims-store';

// ─── Arnés (mismo que agent1-pre-e2e-counting-closure) ───────────────────────

const INPUT: LushaPreviewInput = {
  countryCode: 'CO',
  macroIndustryKey: 'health_pharma',
  subIndustryId: null,
  sizeBandKey: '201-5000',
  searchText: null,
};

const ACTOR = {
  internalUserId: 'user-1',
  clientRequestId: '33333333-3333-4333-8333-333333333333',
  requestedTarget: 5,
};

const PLAN = resolveLushaMacroSearchPlan('health_pharma');

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
    linkedinUrl: `https://www.linkedin.com/company/${id}-co`,
    score: 100,
    passesGate: true,
    issues: [],
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

const COMPANIES = [
  completa('L1', 'Clinica Uno', 'clinicauno.com.co'),
  completa('L2', 'Clinica Dos', 'clinicados.com.co'),
  completa('L3', 'Clinica Tres', 'clinicatres.com.co'),
];

type ClaimDep = NonNullable<PersistLushaPendingReviewDeps['claimGlobalIdentities']>;

/**
 * Los ids se devuelven en orden INVERSO al de las filas a propósito: si el
 * código emparejara por posición, las pruebas de § 2 lo detectarían.
 */
async function run(claim?: ClaimDep) {
  const rowsByCandidateId = new Map<string, LushaPendingReviewCandidateRow>();
  const claimCalls: Array<{ batchId: string; candidateIds: ReadonlyArray<string> }> = [];
  let searchCalls = 0;

  const deps = {
    runSearch: async () => {
      searchCalls += 1;
      return searchCalls === 1 ? successResult(COMPANIES) : successResult([]);
    },
    reserveBatch: async () => ({ id: 'batch-canonico', adopted: false, identityEpoch: 0 }),
    insertCandidatesFenced: async ({ rows }: { rows: LushaPendingReviewCandidateRow[] }) => {
      const ids = rows.map((_row, index) => `cand-${index + 1}`).reverse();
      [...rows].reverse().forEach((row, index) => rowsByCandidateId.set(ids[index], row));
      return {
        status: 'inserted' as const,
        candidateIds: ids,
        insertedCount: rows.length,
        previousEpoch: 0,
        nextEpoch: 1,
      };
    },
    readBatchIdentityEpoch: preM126BatchEpochSnapshot,
    insertCandidates: async () => {
      throw new Error('la ruta vallada no debe caer al insert directo');
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
    ...(claim
      ? {
          claimGlobalIdentities: async (args: {
            batchId: string;
            candidateIds: ReadonlyArray<string>;
          }) => {
            claimCalls.push(args);
            return claim(args);
          },
        }
      : {}),
  } as unknown as PersistLushaPendingReviewDeps;

  const res = (await persistLushaPendingReviewBatch(deps, INPUT, ACTOR, undefined, {
    plan: PLAN!,
    targetGap: 5,
    creditsReserved: 6,
  } as never)) as unknown as {
    insertedCandidatesCount: number;
    usefulCandidatesCount: number;
    acceptedCandidateIdentities?: readonly string[];
    multiBranch: { acceptedCountExact: boolean; acceptedForTargetTotal: number | null };
    batchIdentityMetrics: Record<string, unknown>;
  };
  return { res, rowsByCandidateId, claimCalls };
}

/** El id de candidato que la base asignó a la fila de la empresa `lushaId`. */
function candidateIdFor(
  rows: Map<string, LushaPendingReviewCandidateRow>,
  lushaId: string,
): string {
  for (const [id, row] of rows) {
    const trace = row.source_trace as Record<string, unknown> | null;
    if (trace?.['providerCompanyId'] === lushaId) return id;
  }
  throw new Error(`sin fila para ${lushaId}`);
}

// ─── § 1 ─────────────────────────────────────────────────────────────────────

describe('§ 1 — sin la dependencia, igual que antes de la 140', () => {
  it('las 3 cuentan, conteo exacto, sin telemetría global', async () => {
    const { res } = await run();
    assert.equal(res.insertedCandidatesCount, 3);
    assert.equal(res.usefulCandidatesCount, 3);
    assert.equal(res.multiBranch.acceptedCountExact, true);
    assert.equal(res.batchIdentityMetrics['global_identity_claimed_elsewhere'], undefined);
  });
});

// ─── § 2 ─────────────────────────────────────────────────────────────────────

describe('§ 2 — la que ya es de otro vendedor deja de contar', () => {
  it('se reclaman EXACTAMENTE los ids que la valla confirmó, en su lote', async () => {
    const { claimCalls, rowsByCandidateId } = await run(async () => ({
      claimedElsewhere: [],
      degraded: false,
    }));
    assert.equal(claimCalls.length, 1);
    assert.equal(claimCalls[0].batchId, 'batch-canonico');
    assert.deepEqual([...claimCalls[0].candidateIds].sort(), [...rowsByCandidateId.keys()].sort());
  });

  it('🔴 L2 perdió la carrera: sale del total, de `useful` y de las aceptadas', async () => {
    const { res } = await run(async ({ candidateIds }) => ({
      claimedElsewhere: [{ candidateId: candidateIds[1], providerCompanyId: 'L2' }],
      degraded: false,
    }));
    assert.equal(res.insertedCandidatesCount, 2);
    assert.equal(res.usefulCandidatesCount, 2);
    assert.equal(res.multiBranch.acceptedCountExact, true, 'reconocida ⇒ el conteo sigue exacto');
    assert.equal(res.multiBranch.acceptedForTargetTotal, 2);
    assert.equal(res.batchIdentityMetrics['global_identity_claimed_elsewhere'], 1);
    const accepted = res.acceptedCandidateIdentities ?? [];
    assert.equal(accepted.length, 2);
    assert.equal(
      accepted.some((identity) => identity.includes('L2')),
      false,
      'L2 no puede figurar entre las aceptadas',
    );
  });

  it('🔴 el emparejamiento NO depende del orden de `candidateIds`', async () => {
    // Los ids vuelven invertidos (ver `run`): el PRIMERO de `candidateIds` es el
    // de L3, que es la TERCERA de `useful`. Emparejar por posición sacaría a L1.
    let firstReturnedId = '';
    const { res, rowsByCandidateId } = await run(async ({ candidateIds }) => {
      firstReturnedId = candidateIds[0];
      return {
        claimedElsewhere: [{ candidateId: candidateIds[0], providerCompanyId: 'L3' }],
        degraded: false,
      };
    });
    assert.equal(candidateIdFor(rowsByCandidateId, 'L3'), firstReturnedId);
    const accepted = res.acceptedCandidateIdentities ?? [];
    assert.equal(accepted.length, 2);
    assert.equal(accepted.some((identity) => identity.includes('L3')), false);
    assert.ok(accepted.some((identity) => identity.includes('L1')));
  });
});

// ─── § 3 ─────────────────────────────────────────────────────────────────────

describe('§ 3 — si no se sabe cuál era, no se adivina', () => {
  it('sin clave de proveedor ⇒ se descuenta y la aceptación cae a la cota', async () => {
    const { res } = await run(async ({ candidateIds }) => ({
      claimedElsewhere: [{ candidateId: candidateIds[0], providerCompanyId: null }],
      degraded: false,
    }));
    assert.equal(res.insertedCandidatesCount, 2);
    assert.equal(res.multiBranch.acceptedCountExact, false);
    assert.equal(res.acceptedCandidateIdentities, undefined, 'sin saber cuáles, no se declara ninguna');
    assert.ok((res.multiBranch.acceptedForTargetTotal ?? 0) <= 2);
  });

  it('una clave que no está en `useful` ⇒ mismo fallo cerrado', async () => {
    const { res } = await run(async ({ candidateIds }) => ({
      claimedElsewhere: [{ candidateId: candidateIds[0], providerCompanyId: 'NO-EXISTE' }],
      degraded: false,
    }));
    assert.equal(res.insertedCandidatesCount, 2);
    assert.equal(res.multiBranch.acceptedCountExact, false);
  });
});

// ─── § 4 ─────────────────────────────────────────────────────────────────────

describe('§ 4 — una degradación no marca a nadie', () => {
  it('degraded ⇒ las 3 cuentan y queda declarado', async () => {
    const { res } = await run(async () => ({ claimedElsewhere: [], degraded: true }));
    assert.equal(res.insertedCandidatesCount, 3);
    assert.equal(res.multiBranch.acceptedCountExact, true);
    assert.equal(res.batchIdentityMetrics['global_identity_claim_degraded'], true);
    assert.equal(res.batchIdentityMetrics['global_identity_claimed_elsewhere'], 0);
  });
});

// ─── § 5 ─────────────────────────────────────────────────────────────────────

type SelectCapture = { table?: string; batchId?: string; ids?: string[] };

function persistedClient(
  rows: Array<Record<string, unknown>> | null,
  rpcResponse: { data?: unknown; error?: { code?: string } },
  capture: SelectCapture & { rpcArgs?: unknown },
): SupabaseClient {
  return {
    from(table: string) {
      capture.table = table;
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => {
          capture.batchId = value;
          return builder;
        },
        in: (_column: string, values: string[]) => {
          capture.ids = values;
          return Promise.resolve(
            rows === null
              ? { data: null, error: { message: 'boom' } }
              : { data: rows, error: null },
          );
        },
      };
      return builder;
    },
    rpc(name: string, args: unknown) {
      assert.equal(name, CLAIM_COMPANY_IDENTITIES_RPC);
      capture.rpcArgs = args;
      return Promise.resolve({ data: rpcResponse.data ?? null, error: rpcResponse.error ?? null });
    },
  } as unknown as SupabaseClient;
}

const PERSISTED_ROW = {
  id: 'cand-9',
  name: 'Clinica Nueve',
  domain: 'clinicanueve.com.co',
  website: null,
  country_code: 'CO',
  tax_id: null,
  tax_identifier: null,
  status: 'needs_review',
  metadata: {},
  source_trace: { sourceProvider: 'lusha', providerCompanyId: 'L9' },
};

describe('§ 5 — el almacén relee por id y reclama lo guardado', () => {
  it('lee SÓLO esos ids de ESE lote y envía los reclamos derivados de la fila', async () => {
    const capture: SelectCapture & { rpcArgs?: unknown } = {};
    const out = await claimGlobalIdentitiesForPersistedCandidates(
      persistedClient([PERSISTED_ROW], { data: { claimed_candidate_ids: ['cand-9'], claimed_elsewhere_candidate_ids: [] } }, capture),
      'batch-9',
      ['cand-9'],
    );
    assert.equal(capture.table, 'prospect_candidates');
    assert.equal(capture.batchId, 'batch-9');
    assert.deepEqual(capture.ids, ['cand-9']);
    assert.deepEqual(capture.rpcArgs, {
      p_candidates: [
        {
          candidateId: 'cand-9',
          batchId: 'batch-9',
          claims: [
            { type: 'domain', key: 'clinicanueve.com.co' },
            { type: 'provider_entity', key: 'lusha:L9' },
          ],
        },
      ],
    });
    assert.deepEqual(out, { claimedElsewhere: [], degraded: false });
  });

  it('devuelve la perdedora CON su id de Lusha crudo', async () => {
    const out: PersistedGlobalIdentityClaimOutcome = await claimGlobalIdentitiesForPersistedCandidates(
      persistedClient([PERSISTED_ROW], { data: { claimed_candidate_ids: [], claimed_elsewhere_candidate_ids: ['cand-9'] } }, {}),
      'batch-9',
      ['cand-9'],
    );
    assert.deepEqual(out, {
      claimedElsewhere: [{ candidateId: 'cand-9', providerCompanyId: 'L9' }],
      degraded: false,
    });
  });

  it('lectura caída ⇒ degradado, sin llamar a la RPC', async () => {
    const capture: SelectCapture & { rpcArgs?: unknown } = {};
    const out = await claimGlobalIdentitiesForPersistedCandidates(
      persistedClient(null, {}, capture),
      'batch-9',
      ['cand-9'],
    );
    assert.deepEqual(out, { claimedElsewhere: [], degraded: true });
    assert.equal(capture.rpcArgs, undefined);
  });

  it('migración 140 ausente ⇒ degradado, nadie marcado', async () => {
    const out = await claimGlobalIdentitiesForPersistedCandidates(
      persistedClient([PERSISTED_ROW], { error: { code: 'PGRST202' } }, {}),
      'batch-9',
      ['cand-9'],
    );
    assert.deepEqual(out, { claimedElsewhere: [], degraded: true });
  });

  it('sin ids ⇒ ni lee ni reclama', async () => {
    const capture: SelectCapture & { rpcArgs?: unknown } = {};
    const out = await claimGlobalIdentitiesForPersistedCandidates(
      persistedClient([], {}, capture),
      'batch-9',
      [],
    );
    assert.deepEqual(out, { claimedElsewhere: [], degraded: false });
    assert.equal(capture.table, undefined);
  });
});

// ─── § 6 ─────────────────────────────────────────────────────────────────────

describe('§ 6 — producción la inyecta, con el cliente administrativo', () => {
  const root = path.resolve(__dirname, '../../../..');
  const actions = readFileSync(
    path.join(root, 'src/modules/prospect-batches/lusha-pending-review-actions.ts'),
    'utf8',
  )
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it('🔴 la acción pasa `claimGlobalIdentities` con `createSupabaseAdminClient()`', () => {
    assert.match(
      actions,
      /claimGlobalIdentities:\s*\(args\)\s*=>\s*claimGlobalIdentitiesForPersistedCandidates\(\s*createSupabaseAdminClient\(\),/,
    );
  });

  it('no usa el cliente de SESIÓN para reclamar (chocaría con RLS en silencio)', () => {
    assert.doesNotMatch(actions, /claimGlobalIdentitiesForPersistedCandidates\(\s*supabase\b/);
  });
});
