/**
 * BR-SOURCE-FUNCTIONAL-CUT-D — fenced promotion of a resolved Receita identity.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR
 * ═══════════════════════════════════════════════════════════════════
 *
 * CUT C resolves a Brazilian candidate that arrived without a CNPJ to exactly one establishment,
 * uses that CNPJ for the lookup, and DROPS it — because there was no safe place to put it. This
 * cut builds the place, and these are its properties:
 *
 *   CASE 1   RESOLVED_UNIQUE → PROMOTED, and `tax_identifier` is DURABLE on the row
 *   CASE 2   the promotion moves `identity_key` WITH the identifier, coherently
 *   CASE 3   `identity_epoch` advances by exactly 1 on a promotion and NOT on a no-op
 *   CASE 4   two candidates of one batch resolving the SAME CNPJ: the second is refused
 *   CASE 5   two writers with the SAME expected epoch: only one can win
 *   CASE 6   a stale epoch mutates NOTHING
 *   CASE 7   a candidate that is not in this batch mutates NOTHING
 *   CASE 8   an unusable identity mutates NOTHING, and never reaches the database
 *   CASE 9   replaying the same CNPJ is idempotent — and does not move the epoch
 *   CASE 10  CUT C AMBIGUOUS  → the promotion is never called
 *   CASE 11  CUT C NO_MATCH   → the promotion is never called
 *   CASE 12  a candidate that already carries a CNPJ is never promoted over
 *   CASE 13  a refused promotion NEVER becomes an exact Receita lookup
 *   CASE 14  no CNPJ in a result, a reason, a metadata block or an error
 *
 * CASE 15 (two REAL concurrent promotions against PostgreSQL, and the SQL itself) lives in the
 * companion `-postgres` suite, together with a real-schema re-proof of 1, 2, 3, 4, 6, 7, 8 and 9.
 *
 * 🔴 NO PROD. NO apply_migration. NO real Receita. NO providers. NO credits. NO HubSpot. NO flags.
 * Every CNPJ is synthetic and DV-valid by construction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  runFencedIdentityPromotion,
  FENCED_IDENTITY_PROMOTION_CONTRACT,
} from '@/server/prospect-batches/run-fenced-identity-promotion';
import {
  PROMOTE_FISCAL_IDENTITY_RPC,
  PROMOTION_CAPABILITY_UNPROVEN_CODES,
  isMissingPromotionCapabilityError,
  observedPromotionCapability,
  parseFencedIdentityPromotionPayload,
  promoteCandidateFiscalIdentityFenced,
} from '@/server/prospect-batches/candidate-fiscal-identity-promotion';
import {
  advancePromotionCapabilityState,
  INITIAL_PROMOTION_CAPABILITY_STATE,
  promotionAbsenceIsCredible,
  PROMOTION_CAPABILITY_STATE_CONTRACT,
} from '@/server/prospect-batches/promotion-capability-state';
import { BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES } from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import { BATCH_IDENTITY_SNAPSHOT_RPC } from '@/server/prospect-batches/batch-identity-fence';
import { loadBatchIdentityRegistry } from '@/server/prospect-batches/batch-identity-registry-store';
import { buildProspectCandidateIdentityKey } from '@/server/agents/prospecting-toolkit/prospect-candidate-identity-key';

import {
  enrichBrBatchWithValidatedSources,
  BR_AGENT1_RUNTIME_BINDING_CONTRACT,
} from '../../../enrichment/enrich-br-batch-with-validated-sources';
import { BR_RECEITA_SNAPSHOT_TABLE } from '../br-receita-cnpj-monthly-snapshot-identity';
import { BR_RECEITA_SNAPSHOT_RUNS_TABLE } from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from '../br-receita-cnpj-types';
import { sampleFullCnpj, RAIZ_TECNOLOGIA, RAIZ_EDUCACAO } from '../br-receita-cnpj-fixtures';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../../snapshot-read/snapshot-read-contract';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

// ─── Synthetic material ─────────────────────────────────────────────────────

const PERIOD = '2026-07';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BATCH_ID = '55555555-5555-4555-8555-555555555555';

const CNPJ_TEC = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
const CNPJ_TEC_FILIAL = sampleFullCnpj(RAIZ_TECNOLOGIA, '0002');
const CNPJ_EDU = sampleFullCnpj(RAIZ_EDUCACAO, '0001');
/**
 * The SAME establishment, with the alphanumeric raiz intact.
 *
 * 🔴 `RAIZ_EDUCACAO` is a post-July-2026 alphanumeric raiz, so `digits()` mangles it into 11
 * characters. That is harmless for a distractor row, and fatal for a row a test actually resolves.
 */
const CNPJ_EDU_FULL = CNPJ_EDU.replace(/[^0-9A-Z]/gi, '');
const ALL_CNPJS = [CNPJ_TEC, CNPJ_TEC_FILIAL, CNPJ_EDU] as const;

const TEC_NAME = 'Synthetic Tecnologia Ltda';
const TEC_CANONICAL = 'SYNTHETIC TECNOLOGIA LTDA';
const EDU_NAME = 'Synthetic Educacao SA';
const EDU_CANONICAL = 'SYNTHETIC EDUCACAO SA';

function snapshotRow(options: {
  normalizedTaxId: string;
  canonicalName: string;
  legalName: string;
  municipality?: string | null;
}): Record<string, unknown> {
  return {
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: PERIOD,
    snapshot_run_id: RUN_A,
    normalized_tax_id: options.normalizedTaxId,
    legal_name: options.legalName,
    normalized_legal_name: options.canonicalName,
    raw_data: {
      source_period: PERIOD,
      municipality_name: options.municipality === undefined ? 'Synthetic City' : options.municipality,
      municipality_code: '7107',
      uf: 'SP',
      registration_status_code: '02',
      registration_status_label: 'ATIVA',
      cnae_main_code: '6201501',
      cnae_main_label: 'Desenvolvimento de programas',
      cnae_secondary_codes: [],
      company_size_code: '03',
      capital_social_value: '100000.00',
      start_date: '2015-03-10',
      matrix_branch_flag: '1',
      human_review_required: false,
      source_type: 'official_registry',
    },
  };
}

function candidateRow(options: {
  id: string;
  name?: string;
  legalName?: string | null;
  city?: string | null;
  taxIdentifier?: string | null;
  taxId?: string | null;
  identityKey?: string | null;
  status?: string;
  batchId?: string;
  countryCode?: string;
  domain?: string | null;
}): Record<string, unknown> {
  return {
    id: options.id,
    batch_id: options.batchId ?? BATCH_ID,
    name: options.name ?? TEC_NAME,
    legal_name: options.legalName ?? null,
    country_code: options.countryCode ?? BR_RECEITA_CNPJ_COUNTRY_CODE,
    city: options.city ?? null,
    domain: options.domain ?? null,
    website: null,
    tax_id: options.taxId ?? null,
    tax_identifier: options.taxIdentifier ?? null,
    identity_key: options.identityKey ?? null,
    status: options.status ?? 'generated',
    sector_description: null,
    metadata: {} as Record<string, unknown>,
    source_trace: {} as Record<string, unknown>,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The double — a PostgREST-shaped client whose `rpc` really implements both
// fenced functions over its own tables.
//
// 🔴 It implements them by MIRRORING the SQL, and that is a liability the suite
// owns explicitly: a mirror can drift. That is exactly why the companion
// `-postgres` suite re-proves CASES 1, 2, 3, 4, 6, 7, 8 and 9 against the real
// migration applied to a real PostgreSQL. What lives here is the DECISION layer —
// which outcome the runner reaches, what the orchestrator does with it, and what
// never leaks — which a double is the right tool for.
// ═══════════════════════════════════════════════════════════════════════════

interface FakeDb {
  client: SnapshotReadClient<SnapshotIdentityRow>;
  supabase: SupabaseClient;
  tables: Record<string, Array<Record<string, unknown>>>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  /** When true, both fenced functions answer PGRST202 — NEITHER migration is applied. */
  fenceUnapplied: boolean;
  /**
   * 🔴 THE PRODUCTION TOPOLOGY. Migration 126 is applied — the snapshot read answers, the epoch
   * is real — and ONLY migration 133 is missing, so just the promotion answers PGRST202.
   *
   * This is not a hypothetical: it is the state production was actually in when this release was
   * reviewed, and it is the state of every deployment between merging this cut and applying 133.
   * `fenceUnapplied` cannot model it, because blinding the snapshot read too makes the epoch
   * `null` and the runner never reaches the promotion at all.
   *
   * Mutable on purpose: a run that observes the promotion ALIVE and then loses it is the other
   * half of the invariant, and a test flips this to `true` mid-run to produce it.
   */
  promotionUnapplied: boolean;
  /** Runs before every promotion RPC. The seam a competing writer is injected through. */
  beforePromote?: (args: Record<string, unknown>) => void;
}

const PGRST202 = {
  code: 'PGRST202',
  message: 'Could not find the function in the schema cache',
} as const;

function batchRow(id = BATCH_ID, epoch = 0): Record<string, unknown> {
  return { id, metadata: {}, identity_epoch: epoch };
}

function fakeDb(options: {
  candidates?: Array<Record<string, unknown>>;
  snapshots?: Array<Record<string, unknown>>;
  batches?: Array<Record<string, unknown>>;
  fenceUnapplied?: boolean;
  promotionUnapplied?: boolean;
} = {}): FakeDb {
  const db: FakeDb = {
    tables: {
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        {
          id: RUN_A,
          source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
          country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
          source_period: PERIOD,
          publish_state: 'published',
        },
      ],
      [BR_RECEITA_SNAPSHOT_TABLE]: options.snapshots ?? [
        snapshotRow({ normalizedTaxId: digits(CNPJ_TEC), canonicalName: TEC_CANONICAL, legalName: TEC_NAME }),
        snapshotRow({ normalizedTaxId: digits(CNPJ_EDU), canonicalName: EDU_CANONICAL, legalName: EDU_NAME }),
      ],
      prospect_batches: options.batches ?? [batchRow()],
      prospect_candidates: options.candidates ?? [],
    },
    updates: [],
    rpcCalls: [],
    fenceUnapplied: options.fenceUnapplied ?? false,
    promotionUnapplied: options.promotionUnapplied ?? false,
    client: null as unknown as SnapshotReadClient<SnapshotIdentityRow>,
    supabase: null as unknown as SupabaseClient,
  };

  const readSnapshotRpc = (args: Record<string, unknown>) => {
    const batch = db.tables.prospect_batches.find((b) => b.id === args.p_batch_id);
    if (!batch) return { data: null, error: null };
    const blocking = (args.p_blocking_statuses as string[]) ?? [];
    const rows = db.tables.prospect_candidates
      .filter((c) => c.batch_id === batch.id && blocking.includes(c.status as string))
      .map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        website: c.website,
        country_code: c.country_code,
        tax_id: c.tax_id,
        tax_identifier: c.tax_identifier,
        status: c.status,
        metadata: c.metadata,
        source_trace: c.source_trace,
      }));
    // PostgREST serializes `bigint` as a STRING — modelled, because reading it only as a
    // number is a real defect this repository already had to fix twice.
    return { data: { batch_id: batch.id, identity_epoch: String(batch.identity_epoch), rows }, error: null };
  };

  const promoteRpc = (args: Record<string, unknown>) => {
    db.beforePromote?.(args);
    const taxIdentifier = args.p_tax_identifier as string | null;
    const identityKey = args.p_identity_key as string | null;
    if (
      !args.p_batch_id ||
      !args.p_candidate_id ||
      args.p_expected_epoch === null ||
      args.p_expected_epoch === undefined ||
      !taxIdentifier ||
      taxIdentifier.trim() === '' ||
      !identityKey ||
      identityKey.trim() === ''
    ) {
      return { data: { status: 'invalid_input' }, error: null };
    }

    const batch = db.tables.prospect_batches.find((b) => b.id === args.p_batch_id);
    if (!batch) return { data: { status: 'batch_not_found' }, error: null };

    const currentEpoch = Number(batch.identity_epoch);
    if (currentEpoch !== Number(args.p_expected_epoch)) {
      return { data: { status: 'stale', current_epoch: String(currentEpoch) }, error: null };
    }

    const candidate = db.tables.prospect_candidates.find(
      (c) => c.id === args.p_candidate_id && c.batch_id === args.p_batch_id,
    );
    if (!candidate) return { data: { status: 'candidate_not_found' }, error: null };

    const existing = candidate.tax_identifier as string | null;
    if (existing !== null && existing !== undefined && String(existing).trim() !== '') {
      if (existing === taxIdentifier) {
        return {
          data: { status: 'already_same_identity', current_epoch: String(currentEpoch) },
          error: null,
        };
      }
      return {
        data: { status: 'fiscal_identity_conflict', conflict: 'candidate_holds_other_identity' },
        error: null,
      };
    }

    const blocking = (args.p_blocking_statuses as string[]) ?? [];
    const peerHolds = db.tables.prospect_candidates.some(
      (c) =>
        c.batch_id === args.p_batch_id &&
        c.id !== args.p_candidate_id &&
        blocking.includes(c.status as string) &&
        (c.tax_identifier === taxIdentifier || c.tax_id === taxIdentifier),
    );
    if (peerHolds) {
      return {
        data: { status: 'fiscal_identity_conflict', conflict: 'batch_peer_holds_identity' },
        error: null,
      };
    }

    candidate.tax_identifier = taxIdentifier;
    candidate.identity_key = identityKey;
    batch.identity_epoch = currentEpoch + 1;
    return {
      data: {
        status: 'promoted',
        previous_epoch: String(currentEpoch),
        next_epoch: String(currentEpoch + 1),
      },
      error: null,
    };
  };

  db.client = {
    from(table: string) {
      return {
        select(columns?: string) {
          void columns;
          const eqFilters: Array<{ column: string; value: unknown }> = [];
          const inFilters: Array<{ column: string; values: readonly unknown[] }> = [];
          let limit: number | null = null;
          const evaluate = () => {
            const source = db.tables[table] ?? [];
            const matched = source.filter(
              (row) =>
                eqFilters.every((f) => row[f.column] === f.value) &&
                inFilters.every((f) => f.values.includes(row[f.column])),
            );
            return limit === null ? matched : matched.slice(0, limit);
          };
          const query = {
            eq(column: string, value: unknown) {
              eqFilters.push({ column, value });
              return query;
            },
            in(column: string, values: readonly unknown[]) {
              inFilters.push({ column, values });
              return query;
            },
            order() {
              return query;
            },
            limit(count: number) {
              limit = count;
              return query;
            },
            async maybeSingle() {
              return { data: evaluate()[0] ?? null, error: null };
            },
            then(onfulfilled?: (value: unknown) => unknown) {
              return Promise.resolve({ data: evaluate(), error: null }).then(onfulfilled as never);
            },
          };
          return query as never;
        },
        update(payload: Record<string, unknown>) {
          const filters: Array<{ column: string; value: unknown }> = [];
          const query = {
            eq(column: string, value: unknown) {
              filters.push({ column, value });
              return query;
            },
            then(onfulfilled?: (value: unknown) => unknown) {
              db.updates.push({ table, payload });
              for (const row of db.tables[table] ?? []) {
                if (filters.every((f) => row[f.column] === f.value)) Object.assign(row, payload);
              }
              return Promise.resolve({ data: null, error: null }).then(onfulfilled as never);
            },
          };
          return query as never;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      db.rpcCalls.push({ fn, args });
      if (db.fenceUnapplied) return { data: null, error: PGRST202 };
      if (fn === BATCH_IDENTITY_SNAPSHOT_RPC) return readSnapshotRpc(args);
      if (fn === PROMOTE_FISCAL_IDENTITY_RPC) {
        // 🔴 Read at CALL time, not at construction: `promotionUnapplied` is how a run that saw
        // the promotion alive then loses it is produced.
        if (db.promotionUnapplied) return { data: null, error: PGRST202 };
        return promoteRpc(args);
      }
      return { data: null, error: PGRST202 };
    },
  } as unknown as SnapshotReadClient<SnapshotIdentityRow>;

  db.supabase = db.client as unknown as SupabaseClient;
  return db;
}

function digits(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

function candidateById(db: FakeDb, id: string): Record<string, unknown> {
  const row = db.tables.prospect_candidates.find((c) => c.id === id);
  assert.ok(row, `no candidate ${id}`);
  return row;
}

function epochOf(db: FakeDb, batchId = BATCH_ID): number {
  const batch = db.tables.prospect_batches.find((b) => b.id === batchId);
  assert.ok(batch);
  return Number(batch.identity_epoch);
}

function promotionCalls(db: FakeDb): Array<Record<string, unknown>> {
  return db.rpcCalls.filter((c) => c.fn === PROMOTE_FISCAL_IDENTITY_RPC).map((c) => c.args);
}

/** Every string anywhere in a value, however deeply nested. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (typeof value === 'object' && value !== null) {
    Object.values(value as Record<string, unknown>).forEach((v) => allStrings(v, out));
  }
  return out;
}

function assertCarriesNoCnpj(value: unknown, where: string): void {
  for (const text of allStrings(value)) {
    for (const cnpj of ALL_CNPJS) {
      assert.ok(!text.includes(cnpj), `${where} leaked a formatted CNPJ: ${text}`);
      assert.ok(!text.includes(digits(cnpj)), `${where} leaked a bare CNPJ: ${text}`);
    }
  }
}

async function snapshotOf(db: FakeDb, batchId = BATCH_ID) {
  return loadBatchIdentityRegistry(db.supabase, batchId);
}

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT D · CASE 1/2/3 — a promotion is durable, coherent and epoch-advancing', () => {
  it('CASE 1 — RESOLVED_UNIQUE becomes a durable `tax_identifier`', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });
    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });

    assert.equal(out.status, 'PROMOTED');
    assert.equal(out.mutated, true);
    assert.equal(out.adjudicated, true);
    assert.equal(candidateById(db, 'c1').tax_identifier, digits(CNPJ_TEC));
  });

  it('CASE 2 — `identity_key` moves WITH the identifier, from the canonical authority', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1', identityKey: 'name:synthetic-tecnologia' })] });
    await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });

    const expected = buildProspectCandidateIdentityKey({
      name: TEC_NAME,
      taxIdentifier: digits(CNPJ_TEC),
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
    });
    // 🔴 Not merely "changed": it is exactly what `buildProspectCandidateIdentityKey` produces, so
    // the persisted key cannot drift from the authority that every other writer uses.
    assert.equal(candidateById(db, 'c1').identity_key, expected);
    assert.ok(String(expected).startsWith('tax:'));
    // …and it did not stay describing the pre-resolution candidate.
    assert.notEqual(candidateById(db, 'c1').identity_key, 'name:synthetic-tecnologia');
  });

  it('CASE 3 — the epoch advances by EXACTLY 1 on a promotion', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });
    assert.equal(epochOf(db), 0);
    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });
    assert.equal(out.status, 'PROMOTED');
    assert.equal(epochOf(db), 1);
    assert.equal(out.telemetry.identityEpochInitial, 0);
    assert.equal(out.telemetry.identityEpochFinal, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT D · CASE 4/5/6 — the batch, and the race', () => {
  it('CASE 4 — a second candidate resolving the SAME CNPJ is refused, not merged', async () => {
    const db = fakeDb({
      candidates: [candidateRow({ id: 'c1' }), candidateRow({ id: 'c2', name: 'Other Display Name' })],
    });

    const first = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });
    assert.equal(first.status, 'PROMOTED');

    // 🔴 The photograph is THREADED, exactly as the run does it — so the second candidate decides
    // against a state that already contains the first one's identity.
    const second = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c2',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: 'Other Display Name',
      snapshot: first.snapshot,
    });

    assert.equal(second.status, 'FISCAL_IDENTITY_CONFLICT');
    assert.equal(second.mutated, false);
    assert.equal(second.adjudicated, false);
    assert.equal(candidateById(db, 'c2').tax_identifier, null);
    assert.equal(epochOf(db), 1, 'a refused promotion moved the epoch');
  });

  it('CASE 4b — the run-level memory refuses it even while the migration is UNAPPLIED', async () => {
    // With CUT D inert nothing is persisted, so no peer can hold the identity. Without the run's
    // own memory both candidates would silently claim the same company.
    const db = fakeDb({
      candidates: [candidateRow({ id: 'c1' }), candidateRow({ id: 'c2' })],
      fenceUnapplied: true,
    });
    const keys = new Set<string>();
    const first = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
      promotedFiscalKeys: keys,
    });
    assert.equal(first.status, 'CAPABILITY_ABSENT');
    assert.equal(first.adjudicated, true, 'CUT C must survive the unapplied window');
    keys.add(`${BR_RECEITA_CNPJ_COUNTRY_CODE}:${digits(CNPJ_TEC)}`);

    const second = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c2',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: first.snapshot,
      promotedFiscalKeys: keys,
    });
    assert.equal(second.status, 'FISCAL_IDENTITY_CONFLICT');
    assert.equal(second.reason, 'run_already_promoted_this_fiscal_identity');
  });

  it('CASE 5 — two writers with the SAME expected epoch: only one wins', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' }), candidateRow({ id: 'c2' })] });
    const shared = await snapshotOf(db);

    // A competing writer commits between this writer's decision and its call — modelled at the
    // only seam where that can happen, immediately before the RPC.
    let injected = false;
    db.beforePromote = () => {
      if (injected) return;
      injected = true;
      const batch = db.tables.prospect_batches[0];
      const other = candidateById(db, 'c2');
      other.tax_identifier = digits(CNPJ_EDU);
      batch.identity_epoch = Number(batch.identity_epoch) + 1;
    };

    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: shared,
    });

    // The loser is told `stale`, RELOADS, RE-EVALUATES and — because the winner took a DIFFERENT
    // identity — legitimately succeeds on the retry. Serialization must not turn every second
    // writer into a conflict.
    assert.equal(out.status, 'PROMOTED');
    assert.equal(out.telemetry.identityEpochStaleRetries, 1);
    assert.equal(candidateById(db, 'c1').tax_identifier, digits(CNPJ_TEC));
    assert.equal(epochOf(db), 2);
  });

  it('CASE 5b — when the winner took the SAME identity, the retry becomes a CONFLICT', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' }), candidateRow({ id: 'c2' })] });
    const shared = await snapshotOf(db);

    let injected = false;
    db.beforePromote = () => {
      if (injected) return;
      injected = true;
      const batch = db.tables.prospect_batches[0];
      candidateById(db, 'c2').tax_identifier = digits(CNPJ_TEC);
      batch.identity_epoch = Number(batch.identity_epoch) + 1;
    };

    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: shared,
    });

    assert.equal(out.status, 'FISCAL_IDENTITY_CONFLICT');
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
  });

  it('CASE 6 — an exhausted stale race mutates NOTHING and never falls back', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });
    const snapshot = await snapshotOf(db);
    let calls = 0;

    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot,
      promote: async () => {
        calls += 1;
        return { status: 'stale', currentEpoch: calls + 1 };
      },
    });

    assert.equal(out.status, 'STALE_IDENTITY_EPOCH');
    assert.equal(out.mutated, false);
    assert.equal(out.adjudicated, false);
    assert.equal(out.telemetry.identityEpochRetryExhausted, true);
    assert.equal(candidateById(db, 'c1').tax_identifier, null, 'a lost race wrote anyway');
    assert.equal(candidateById(db, 'c1').identity_key, null);
    assert.equal(epochOf(db), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT D · CASE 7/8/9/12 — the refusals that write nothing', () => {
  it('CASE 7 — a candidate of ANOTHER batch is not found, and nothing is written', async () => {
    const db = fakeDb({
      candidates: [candidateRow({ id: 'foreign', batchId: OTHER_BATCH_ID })],
      batches: [batchRow(BATCH_ID, 0), batchRow(OTHER_BATCH_ID, 0)],
    });

    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'foreign',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });

    // 🔴 The IDOR guard: one batch's fence cannot reach another batch's row.
    assert.equal(out.status, 'CANDIDATE_NOT_FOUND');
    assert.equal(candidateById(db, 'foreign').tax_identifier, null);
    assert.equal(epochOf(db, OTHER_BATCH_ID), 0);
    assert.equal(epochOf(db, BATCH_ID), 0);
  });

  it('CASE 8 — an unusable identity never reaches the database at all', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });
    const snapshot = await snapshotOf(db);

    for (const [taxIdentifier, countryCode] of [
      ['', BR_RECEITA_CNPJ_COUNTRY_CODE],
      ['   ', BR_RECEITA_CNPJ_COUNTRY_CODE],
      ['12', BR_RECEITA_CNPJ_COUNTRY_CODE],
      // 🔴 No country ⇒ no fiscal identity at all (CUT-3B1 § 8). A bare number is not global.
      [digits(CNPJ_TEC), null],
    ] as Array<[string, string | null]>) {
      const before = promotionCalls(db).length;
      const out = await runFencedIdentityPromotion({
        client: db.supabase,
        batchId: BATCH_ID,
        candidateId: 'c1',
        countryCode,
        taxIdentifier,
        candidateName: TEC_NAME,
        snapshot,
      });
      assert.equal(out.status, 'INVALID_IDENTITY', `${taxIdentifier} / ${countryCode}`);
      assert.equal(out.mutated, false);
      assert.equal(
        promotionCalls(db).length,
        before,
        'an unusable identity became a database round trip',
      );
    }
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
    assert.equal(epochOf(db), 0);
  });

  it('CASE 9 — replaying the same CNPJ is idempotent and does NOT move the epoch', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });

    const first = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });
    assert.equal(first.status, 'PROMOTED');
    const keyAfterFirst = candidateById(db, 'c1').identity_key;
    assert.equal(epochOf(db), 1);

    // A fresh photograph, as a rerun of the same batch would take.
    const replay = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });

    assert.equal(replay.status, 'ALREADY_SAME_IDENTITY');
    assert.equal(replay.mutated, false);
    assert.equal(replay.adjudicated, true, 'a replay must still be usable downstream');
    assert.equal(epochOf(db), 1, 'a no-op advanced the identity epoch');
    assert.equal(candidateById(db, 'c1').identity_key, keyAfterFirst);
  });

  it('CASE 12 — a candidate that already carries a DIFFERENT CNPJ is never promoted over', async () => {
    const db = fakeDb({
      candidates: [candidateRow({ id: 'c1', taxIdentifier: digits(CNPJ_EDU) })],
    });

    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });

    assert.equal(out.status, 'FISCAL_IDENTITY_CONFLICT');
    assert.equal(out.adjudicated, false);
    // 🔴 Source-supplied fiscal data survives untouched.
    assert.equal(candidateById(db, 'c1').tax_identifier, digits(CNPJ_EDU));
    assert.equal(epochOf(db), 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT D · CASE 10/11/13 — the orchestrator only promotes what CUT C resolved', () => {
  function resolution(status: string, taxId: string | null) {
    return async () => ({
      status,
      reason: 'synthetic',
      sourcePeriod: PERIOD,
      snapshotRunId: RUN_A,
      observedCount: taxId === null ? 2 : 1,
      disambiguatedByCity: false,
      resolvedNormalizedTaxId: taxId,
    });
  }

  it('CASE 10 — AMBIGUOUS never calls the promotion', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });
    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {}, {
      resolveIdentity: resolution('AMBIGUOUS', null) as never,
    });
    assert.equal(result.identityAmbiguousCount, 1);
    assert.equal(result.identityPromotion.attempted, 0);
    assert.deepEqual(promotionCalls(db), []);
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
  });

  it('CASE 11 — NO_MATCH never calls the promotion', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1' })] });
    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {}, {
      resolveIdentity: resolution('NO_MATCH', null) as never,
    });
    assert.equal(result.identityNoMatchCount, 1);
    assert.equal(result.identityPromotion.attempted, 0);
    assert.deepEqual(promotionCalls(db), []);
  });

  it('CASE 13 — a refused promotion NEVER becomes an exact Receita lookup', async () => {
    // c2 already holds the identity c1 would resolve to, so c1's promotion is a conflict.
    const db = fakeDb({
      candidates: [
        candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME }),
        candidateRow({ id: 'c2', name: 'Peer', taxIdentifier: digits(CNPJ_TEC) }),
      ],
    });

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    assert.equal(result.identityResolvedCount, 1, 'CUT C still resolves it');
    assert.equal(result.identityPromotion.attempted, 1);
    assert.equal(result.identityPromotion.conflict, 1);
    assert.equal(result.identityPromotion.adjudicated, 0);
    assert.equal(result.missingCnpjWithoutAdjudicatedIdentityCount, 1);

    // 🔴 The candidate was NOT enriched from an identity nobody adjudicated.
    const meta = candidateById(db, 'c1').metadata as Record<string, unknown>;
    const summary = (meta.source_enrichment as Record<string, unknown>)._summary as Record<
      string,
      unknown
    >;
    assert.notEqual(summary.status, 'completed');
    const promotionMeta = summary.identity_promotion as Record<string, unknown>;
    assert.equal(promotionMeta.status, 'FISCAL_IDENTITY_CONFLICT');
    assert.equal(promotionMeta.adjudicated, false);
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
  });

  it('an adjudicated promotion DOES reach the exact adapter, and the row keeps the identity', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME })] });

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    assert.equal(result.identityResolvedCount, 1);
    assert.equal(result.identityPromotion.promoted, 1);
    assert.equal(result.identityPromotion.adjudicated, 1);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.missingCnpjWithoutAdjudicatedIdentityCount, 0);
    assert.equal(candidateById(db, 'c1').tax_identifier, digits(CNPJ_TEC));
    assert.ok(String(candidateById(db, 'c1').identity_key).startsWith('tax:'));
  });

  it('with the migration UNAPPLIED the CUT C behaviour survives, and is counted', async () => {
    const db = fakeDb({
      candidates: [candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME })],
      fenceUnapplied: true,
    });

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    assert.equal(result.identityPromotion.capabilityAbsent, 1);
    assert.equal(result.identityPromotion.adjudicated, 1);
    assert.equal(result.identityPromotion.promoted, 0);
    assert.equal(result.matchedCount, 1, 'CUT C enrichment was regressed by an inert CUT D');
    assert.equal(candidateById(db, 'c1').tax_identifier, null, 'an inert cut wrote anyway');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 THE PRODUCTION DEPLOYMENT WINDOW — migration 126 applied, 133 NOT.
  //
  // The case above blinds BOTH functions, which is the state of a database with
  // NEITHER migration. That is not the state this release deploys into. Production
  // has 126 — `identity_epoch` and `read_batch_identity_snapshot` are live — and
  // only 133 is missing, so the snapshot read SUCCEEDS with a real epoch and only
  // the promotion answers `PGRST202 / 42883`.
  //
  // Read as "the fence was observed alive and then vanished", that answer left the
  // candidate UNADJUDICATED and the exact-CNPJ second pass never ran: CUT C's
  // shipped enrichment regressed for every deployment between merge and apply.
  // These two cases pin BOTH halves of the correction.
  // ═══════════════════════════════════════════════════════════════════════

  it('PROD TOPOLOGY — 126 applied and 133 absent keeps CUT C, and never writes unfenced', async () => {
    const db = fakeDb({
      candidates: [candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME })],
      promotionUnapplied: true,
    });

    // 🔴 The premise, asserted rather than assumed: the M126 snapshot RPC is NOT blinded here.
    assert.equal(db.fenceUnapplied, false, 'this case must NOT make the M126 RPC absent');
    const snapshot = await loadBatchIdentityRegistry(db.supabase, BATCH_ID);
    assert.equal(snapshot.epoch, 0, 'migration 126 is applied: the epoch is real');
    assert.equal(snapshot.fenceCapabilityAbsent, false);
    assert.equal(snapshot.degraded, false);

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    assert.equal(result.identityResolvedCount, 1, 'CUT C still resolves it');
    assert.equal(result.identityPromotion.attempted, 1);
    assert.equal(result.identityPromotion.capabilityAbsent, 1);
    assert.equal(result.identityPromotion.error, 0, 'an unapplied 133 is not an operational error');
    assert.equal(result.identityPromotion.adjudicated, 1);
    assert.equal(result.identityPromotion.promoted, 0);

    // 🔴 The consequence the review is actually about: the second pass RAN.
    assert.equal(result.matchedCount, 1, 'the exact-CNPJ second pass did not run');
    assert.equal(result.missingCnpjWithoutAdjudicatedIdentityCount, 0);

    // …and nothing was persisted, fenced or otherwise.
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
    assert.equal(epochOf(db), 0, 'an inert cut advanced the epoch');
    assert.deepEqual(db.updates.filter((u) => 'tax_identifier' in u.payload), []);

    const meta = candidateById(db, 'c1').metadata as Record<string, unknown>;
    const summary = (meta.source_enrichment as Record<string, unknown>)._summary as Record<
      string,
      unknown
    >;
    const promotionMeta = summary.identity_promotion as Record<string, unknown>;
    assert.equal(promotionMeta.status, 'CAPABILITY_ABSENT');
    assert.equal(promotionMeta.adjudicated, true);
    assert.equal(promotionMeta.mutated, false);
    assert.equal(promotionMeta.reason, 'promotion_migration_not_applied');
  });

  it('PROD TOPOLOGY — a capability OBSERVED in this run cannot then be absent', async () => {
    // c1 promotes for real, which is the only thing that proves 133 exists. Only THEN does the
    // function disappear, and c2 must fail CLOSED — not inherit c1's proof as an excuse to call
    // the absence honest, and not retry the exact adapter from an identity nobody adjudicated.
    const db = fakeDb({
      candidates: [
        candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME }),
        candidateRow({ id: 'c2', name: EDU_NAME, legalName: EDU_NAME }),
      ],
      // 🔴 The EDU row of the default fixture carries `digits(CNPJ_EDU)`, which strips the letters
      // out of an ALPHANUMERIC raiz and leaves 11 characters. It is fine as a distractor nobody
      // resolves, but this case DOES resolve it, so the row has to carry the real 14-character
      // identifier — the resolver re-validates what it reads and would fail closed otherwise.
      snapshots: [
        snapshotRow({ normalizedTaxId: digits(CNPJ_TEC), canonicalName: TEC_CANONICAL, legalName: TEC_NAME }),
        snapshotRow({ normalizedTaxId: CNPJ_EDU_FULL, canonicalName: EDU_CANONICAL, legalName: EDU_NAME }),
      ],
    });
    // The seam fires INSIDE the promotion call, past the "does the function exist?" dispatch — so
    // c1's own promotion still executes and succeeds, and every call after it finds 133 gone.
    db.beforePromote = (args) => {
      if (args.p_candidate_id === 'c1') db.promotionUnapplied = true;
    };

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    assert.equal(result.identityResolvedCount, 2, 'CUT C resolved both');
    assert.equal(result.identityPromotion.attempted, 2);
    assert.equal(result.identityPromotion.promoted, 1, 'c1 proved the capability alive');
    assert.equal(
      result.identityPromotion.capabilityAbsent,
      0,
      'an observed capability was allowed to un-exist',
    );
    assert.equal(result.identityPromotion.error, 1, 'c2 did not fail closed');
    assert.equal(result.identityPromotion.adjudicated, 1);
    assert.equal(result.missingCnpjWithoutAdjudicatedIdentityCount, 1);

    // c1 kept its durable identity; c2 got neither an identity nor an exact lookup.
    assert.equal(candidateById(db, 'c1').tax_identifier, digits(CNPJ_TEC));
    assert.equal(candidateById(db, 'c2').tax_identifier, null);
    assert.equal(result.matchedCount, 1, 'only the adjudicated candidate reaches the adapter');
    assert.equal(epochOf(db), 1, 'exactly ONE promotion advanced the epoch');

    const meta = candidateById(db, 'c2').metadata as Record<string, unknown>;
    const summary = (meta.source_enrichment as Record<string, unknown>)._summary as Record<
      string,
      unknown
    >;
    const promotionMeta = summary.identity_promotion as Record<string, unknown>;
    assert.equal(promotionMeta.status, 'ERROR');
    assert.equal(promotionMeta.reason, 'promotion_capability_lost');
    assert.equal(promotionMeta.adjudicated, false);
  });

  it('a dry run evaluates every refusal and writes nothing', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME })] });

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, { dryRun: true });

    assert.equal(result.identityPromotion.skippedDryRun, 1);
    assert.equal(result.identityPromotion.adjudicated, 1);
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
    assert.equal(epochOf(db), 0);
    assert.deepEqual(promotionCalls(db), []);
  });

  it('a degraded photograph fails CLOSED — it is not proof the migration is missing', async () => {
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME })] });

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {}, {
      // A read that fell over: no epoch, and NO schema proof.
      loadIdentitySnapshot: async () => ({
        registry: { batchId: BATCH_ID, entries: [] },
        seededCount: 0,
        degraded: true,
        epoch: null,
        fenceCapabilityAbsent: false,
      }),
    });

    assert.equal(result.identityPromotion.error, 1);
    assert.equal(result.identityPromotion.adjudicated, 0);
    assert.equal(result.matchedCount, 0, 'an unfenceable identity was enriched anyway');
    assert.equal(candidateById(db, 'c1').tax_identifier, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT D · CASE 14 — no CNPJ escapes', () => {
  it('no promotion outcome, batch summary or persisted metadata carries a CNPJ', async () => {
    const db = fakeDb({
      candidates: [
        candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME }),
        candidateRow({ id: 'c2', name: TEC_NAME, legalName: TEC_NAME }),
        candidateRow({ id: 'c3', name: 'Nothing Matches This', legalName: 'Nothing Matches This' }),
      ],
    });

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    // Two candidates share the razão social, so CUT C answers AMBIGUOUS for both and the
    // promotion never runs — plus one that resolves to nothing.
    assertCarriesNoCnpj(result, 'the batch result');
    assertCarriesNoCnpj(result.identityPromotion, 'the promotion breakdown');

    for (const id of ['c1', 'c2', 'c3']) {
      assertCarriesNoCnpj(candidateById(db, id).metadata, `${id} metadata`);
    }
  });

  it('a conflict never reports the identifier it collided with', async () => {
    const db = fakeDb({
      candidates: [
        candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME }),
        candidateRow({ id: 'c2', name: 'Peer', taxIdentifier: digits(CNPJ_TEC) }),
      ],
    });

    const out = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: await snapshotOf(db),
    });

    assert.equal(out.status, 'FISCAL_IDENTITY_CONFLICT');
    // 🔴 The reason is a CATEGORY. The whole point of refusing is that the caller does not learn
    // which identity it collided with.
    assertCarriesNoCnpj({ status: out.status, reason: out.reason, telemetry: out.telemetry }, 'the outcome');
  });

  it('neither new module can log, and neither forwards a driver message', () => {
    const root = join(repoRoot, 'src', 'server', 'prospect-batches');
    const strip = (code: string) =>
      code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    for (const file of [
      'candidate-fiscal-identity-promotion.ts',
      'run-fenced-identity-promotion.ts',
      // The release correction's own module. Silent for the same reason as the other two.
      'promotion-capability-state.ts',
    ]) {
      const code = strip(readFileSync(join(root, file), 'utf8'));
      assert.ok(!/console\./.test(code), `${file} must not log`);
      assert.ok(!/process\.stdout|process\.stderr/.test(code), `${file} must not write to stdio`);
      // A driver body can quote the arguments this call sends, and one of them is a CNPJ.
      assert.ok(
        !/error\.message|error\.detail|error\.hint|err\.message/.test(code),
        `${file} must not read a driver message`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT D — the transport, and the recorded contracts', () => {
  it('PGRST202 and 42883 are the only proofs that the function is absent', () => {
    assert.equal(isMissingPromotionCapabilityError({ code: 'PGRST202' }), true);
    assert.equal(isMissingPromotionCapabilityError({ code: '42883' }), true);
    assert.equal(isMissingPromotionCapabilityError({ code: '42501' }), false);
    assert.equal(isMissingPromotionCapabilityError({ code: '23505' }), false);
    assert.equal(isMissingPromotionCapabilityError(null), false);
    assert.equal(
      isMissingPromotionCapabilityError({
        message: `Could not find the function public.${PROMOTE_FISCAL_IDENTITY_RPC} in the schema cache`,
      }),
      true,
    );
    // 🔴 A message about SOMETHING ELSE is not proof about this function.
    assert.equal(
      isMissingPromotionCapabilityError({ message: 'relation "prospect_candidates" does not exist' }),
      false,
    );
  });

  it('a client without `rpc` is a real failure, never `capability_absent`', async () => {
    const out = await promoteCandidateFiscalIdentityFenced({} as unknown as SupabaseClient, {
      batchId: BATCH_ID,
      candidateId: 'c1',
      expectedEpoch: 0,
      taxIdentifier: digits(CNPJ_TEC),
      identityKey: `tax:br:${digits(CNPJ_TEC)}`,
      blockingStatuses: BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
    });
    // 🔴 The SHAPE of a client says nothing about the schema — the exact confusion CUT-3B4's
    // correction had to undo, and it must not be reintroduced through this door.
    assert.equal(out.status, 'promotion_failed');
  });

  it('a `bigint` serialized as a STRING is read, not dropped', () => {
    assert.deepEqual(
      parseFencedIdentityPromotionPayload({
        status: 'promoted',
        previous_epoch: '41',
        next_epoch: '42',
      }),
      { status: 'promoted', previousEpoch: 41, nextEpoch: 42 },
    );
    assert.deepEqual(parseFencedIdentityPromotionPayload({ status: 'stale', current_epoch: '7' }), {
      status: 'stale',
      currentEpoch: 7,
    });
  });

  it('an unreadable payload is a failure, never a silent success', () => {
    for (const payload of [null, 'text', [], { status: 'who_knows' }, { status: 'promoted' }]) {
      assert.equal(parseFencedIdentityPromotionPayload(payload).status, 'promotion_failed');
    }
  });

  it('an unknown conflict category is preserved as unknown, not guessed', () => {
    assert.deepEqual(
      parseFencedIdentityPromotionPayload({ status: 'fiscal_identity_conflict', conflict: 'novel' }),
      { status: 'fiscal_identity_conflict', conflict: 'unknown_conflict' },
    );
  });

  it('the promotion contract says what changed and what did not', () => {
    const c = FENCED_IDENTITY_PROMOTION_CONTRACT;
    assert.equal(c.usesBareTaxIdentifierUpdate, false);
    assert.equal(c.writesThroughFencedRpc, true);
    assert.equal(c.epochFenced, true);
    assert.equal(c.advancesEpochOnPromotion, true);
    assert.equal(c.advancesEpochOnNoOp, false);
    assert.equal(c.requiresIdentityKey, true);
    assert.equal(c.scopesCandidateLookupByBatch, true);
    assert.equal(c.implementsSecondIdentityEvaluator, false);
    assert.equal(c.onlyTierOneBlocksPromotion, true);
    assert.equal(c.overwritesCandidateSuppliedTaxIdentifier, false);
    assert.equal(c.reEvaluatesAfterStale, true);
    assert.equal(c.fallsBackToUnfencedWriteAfterRetries, false);
    assert.equal(c.degradedSnapshotAuthorizesWrite, false);
    assert.equal(c.observedCapabilityCanDegrade, false);
    assert.equal(c.promotionCapabilityIsRunScoped, true);
    assert.equal(c.infersPromotionCapabilityFromFenceCapability, false);
    assert.equal(c.unobservedPromotionAbsencePreservesCutC, true);
    assert.equal(c.returnsFiscalIdentifier, false);
    assert.equal(c.identityAuthority, 'batch-identity-registry.evaluateCandidateIdentity');
  });

  it('the hook contract records the CUT D change honestly', () => {
    const c = BR_AGENT1_RUNTIME_BINDING_CONTRACT;
    assert.equal(c.persistsResolvedTaxIdentifierOnCandidate, true);
    assert.equal(c.rewritesCandidateIdentityKey, true);
    assert.equal(c.usesBareTaxIdentifierUpdate, false);
    assert.equal(c.promotesResolvedIdentityUnderEpochFence, true);
    assert.equal(c.enrichesWithUnadjudicatedIdentity, false);
    assert.equal(c.persistsResolvedTaxIdentifierInMetadata, false);
    // 🔴 CUT C is UNCHANGED: this cut is persistence, not matching.
    assert.equal(c.resolvesIdentityByName, true);
    assert.equal(c.resolvesIdentityByNameOnlyWhenCnpjMissing, true);
    assert.equal(c.ambiguousNameFailsClosed, true);
    assert.equal(c.noMatchFailsClosed, true);
    assert.equal(c.usesUfForDisambiguation, false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 🔴 The run-scoped capability state — the CORRECTION's own unit surface.
  //
  // Migration 126 and migration 133 are separate deployables. Everything below
  // exists so no future reader re-derives "the epoch is non-null, therefore the
  // promotion exists", which is the inference that regressed CUT C.
  // ═══════════════════════════════════════════════════════════════════════

  it('the capability state is MONOTONE: PRESENT absorbs everything', () => {
    assert.equal(INITIAL_PROMOTION_CAPABILITY_STATE, 'UNKNOWN');
    // UNKNOWN can still go either way…
    assert.equal(advancePromotionCapabilityState('UNKNOWN', 'ABSENT'), 'ABSENT');
    assert.equal(advancePromotionCapabilityState('UNKNOWN', 'PRESENT'), 'PRESENT');
    assert.equal(advancePromotionCapabilityState('UNKNOWN', 'UNPROVEN'), 'UNKNOWN');
    // …ABSENT is not terminal: applying the migration mid-run is allowed to be seen.
    assert.equal(advancePromotionCapabilityState('ABSENT', 'PRESENT'), 'PRESENT');
    assert.equal(advancePromotionCapabilityState('ABSENT', 'ABSENT'), 'ABSENT');
    assert.equal(advancePromotionCapabilityState('ABSENT', 'UNPROVEN'), 'ABSENT');
    // 🔴 …and PRESENT is. No observation, in any order, walks it back.
    for (const observation of ['ABSENT', 'PRESENT', 'UNPROVEN'] as const) {
      assert.equal(advancePromotionCapabilityState('PRESENT', observation), 'PRESENT');
    }
  });

  it('an absence is credible ONLY until the promotion has answered', () => {
    assert.equal(promotionAbsenceIsCredible('UNKNOWN'), true);
    assert.equal(promotionAbsenceIsCredible('ABSENT'), true);
    assert.equal(promotionAbsenceIsCredible('PRESENT'), false);
  });

  it('only a result that CAME BACK from the function proves the function exists', () => {
    // Absence: the one proof, and nothing else reaches it.
    assert.equal(observedPromotionCapability({ status: 'capability_absent' }), 'ABSENT');

    // Presence: any answer the function itself produced, refusals included.
    for (const result of [
      { status: 'promoted', previousEpoch: 0, nextEpoch: 1 },
      { status: 'already_same_identity', currentEpoch: 3 },
      { status: 'fiscal_identity_conflict', conflict: 'batch_peer_holds_identity' },
      { status: 'stale', currentEpoch: 9 },
      { status: 'candidate_not_found' },
      { status: 'batch_not_found' },
      { status: 'invalid_input' },
      // A payload that came back unreadable still came BACK.
      { status: 'promotion_failed', code: 'promotion_unreadable_payload' },
      // A different SQLSTATE is the function's own execution failing, not its absence.
      { status: 'promotion_failed', code: '40001' },
    ] as const) {
      assert.equal(observedPromotionCapability(result), 'PRESENT', JSON.stringify(result));
    }

    // 🔴 UNPROVEN — never reached the function, so it proves NEITHER thing. Calling any of these
    // PRESENT would let a network blip permanently claim the migration is applied.
    for (const code of PROMOTION_CAPABILITY_UNPROVEN_CODES) {
      assert.equal(
        observedPromotionCapability({ status: 'promotion_failed', code }),
        'UNPROVEN',
        code,
      );
    }
  });

  it('a 126 absence that the run ALREADY contradicted fails closed too', async () => {
    // 133 depends on 126, so a run in which the promotion answered has proven BOTH applied. A
    // photograph arriving afterwards and claiming 126 absent is a deployment inconsistency, and an
    // `adjudicated` CAPABILITY_ABSENT built on it would be an absence the run had disproved.
    const db = fakeDb({ candidates: [candidateRow({ id: 'c1', name: TEC_NAME, legalName: TEC_NAME })] });
    const snapshot = await loadBatchIdentityRegistry(db.supabase, BATCH_ID);
    const blinded = { ...snapshot, epoch: null, fenceCapabilityAbsent: true, degraded: false };

    const proven = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: blinded,
      // The run already saw the promotion answer.
      promotionCapability: 'PRESENT',
    });
    assert.equal(proven.status, 'ERROR');
    assert.equal(proven.reason, 'identity_fence_capability_lost');
    assert.equal(proven.adjudicated, false);
    assert.equal(candidateById(db, 'c1').tax_identifier, null);

    // …and with nothing observed yet, the SAME photograph is still an honest unapplied 126.
    const unobserved = await runFencedIdentityPromotion({
      client: db.supabase,
      batchId: BATCH_ID,
      candidateId: 'c1',
      countryCode: BR_RECEITA_CNPJ_COUNTRY_CODE,
      taxIdentifier: digits(CNPJ_TEC),
      candidateName: TEC_NAME,
      snapshot: blinded,
    });
    assert.equal(unobserved.status, 'CAPABILITY_ABSENT');
    assert.equal(unobserved.reason, 'identity_fence_migration_not_applied');
    assert.equal(unobserved.adjudicated, true);
  });

  it('the capability state contract never conflates the two migrations', () => {
    const c = PROMOTION_CAPABILITY_STATE_CONTRACT;
    assert.deepEqual([...c.states], ['UNKNOWN', 'ABSENT', 'PRESENT']);
    assert.equal(c.initial, 'UNKNOWN');
    assert.equal(c.inferredFromFenceCapability, false);
    assert.equal(c.inferredFromSnapshotEpoch, false);
    assert.equal(c.provenOnlyByPromotionResponse, true);
    assert.equal(c.monotone, true);
    assert.equal(c.presentCanDegradeToAbsent, false);
    assert.equal(c.scope, 'run');
    assert.equal(c.isFlagControlled, false);
  });

  it('the CUT C resolver was not touched by this cut', () => {
    const resolver = readFileSync(
      join(here, '..', 'br-receita-cnpj-candidate-identity-resolver.ts'),
      'utf8',
    );
    // 🔴 CUT D is about persistence. If it had to change the matcher to make the write work, the
    // write would be paying for itself with a looser match — which is the one thing this cut may
    // not do.
    assert.ok(!/promote|tax_identifier\s*[:=]|identity_key/i.test(resolver));
    assert.ok(resolver.includes('persistsAnything: false'));
  });

  // ══════════════════════════════════════════════════════════════════════════
  // BR-PRODUCTION-RELEASE — trinquete INVERTIDO, no borrado
  // ══════════════════════════════════════════════════════════════════════════
  //
  // OLD_ASSERTION: «la migración local está DELIBERADAMENTE SIN NUMERAR». Era cierta mientras
  // este corte vivía en local sin PR: el espacio de nombres estaba disputado y un número
  // reclamado desde una rama sin PR habría colisionado o forzado un renombrado.
  //
  // WHY_OBSOLETE: el hito que ese comentario anticipaba —«numbering happens when this work
  // returns to GitHub»— es ESTE. Un trinquete que siguiera exigiendo `LOCAL_` bloquearía
  // exactamente la operación que describía como pendiente.
  //
  // NEW_INVARIANT, ESTRICTAMENTE MÁS FUERTE: la migración ocupa un slot NUMERADO concreto
  // (133), y todo lo que el trinquete original defendía —sin índice, sin constraint, sin
  // columna, sin backfill, sin redefinir las dos funciones de la 126, SECURITY INVOKER con
  // `search_path` fijado, `anon`/PUBLIC fuera— se sigue afirmando IGUAL, sobre el mismo
  // fichero. Se añade además que el nombre ya NO es `LOCAL_`, para que un retroceso a un
  // fichero sin numerar rompa esta guarda en vez de pasar inadvertido.
  it('the migration occupies numbered slot 133 and touches no other numbered slot', () => {
    const MIGRATION_FILE = '133_br_candidate_identity_promotion.sql';
    const migrationsDir = join(repoRoot, 'supabase', 'migrations');
    const present = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

    assert.ok(
      present.includes(MIGRATION_FILE),
      `${MIGRATION_FILE} debe existir en la secuencia desplegable`,
    );
    // 🔴 Ya no queda ningún fichero fuera de la secuencia numerada: ni éste, ni ninguno.
    assert.deepEqual(
      present.filter((f) => !/^\d{3}_/.test(f)),
      [],
      'ningún fichero de migración puede quedar fuera de la secuencia numerada',
    );
    // …y en particular el nombre local con el que nació ya no está.
    assert.equal(present.includes('LOCAL_br_candidate_identity_promotion.sql'), false);
    // 🔴 133 es SU número, y es único: este corte no se cuela por debajo de nadie.
    //
    // Antes esto exigía que la 133 fuera la ÚLTIMA del repositorio, y esa formulación era un
    // PROXY que caduca en cuanto cualquier otro hito ocupa un número más alto — cosa que este
    // corte no puede ni impedir ni provocar. AGENT1-LUSHA-CUT-L3 lo hizo con la 134 (la valla
    // durable de una petición de Lusha Prospecting, Agente 1). Lo que de verdad se defiende
    // —que CUT D ocupe exactamente un hueco numerado, el 133, y que nada por encima sea
    // autoría suya— se afirma ahora de forma directa, y queda MÁS fuerte que el proxy.
    const numbered = present.filter((f) => /^\d{3}_/.test(f)).sort();
    assert.deepEqual(numbered.filter((f) => f.startsWith('133')), [MIGRATION_FILE]);
    for (const above of numbered.filter((f) => Number.parseInt(f.slice(0, 3), 10) > 133)) {
      assert.equal(
        readFileSync(join(migrationsDir, above), 'utf8').includes('BR-SOURCE'),
        false,
        `${above} no puede ser autoría de BR-SOURCE CUT D`,
      );
    }
    // Control NEGATIVO del filtro, sobre un nombre SINTÉTICO.
    assert.equal(/^\d{3}_/.test('LOCAL_example_unnumbered.sql'), false);
    assert.equal(/^\d{3}_/.test(MIGRATION_FILE), true);

    const sql = readFileSync(join(migrationsDir, MIGRATION_FILE), 'utf8');
    assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION public.${PROMOTE_FISCAL_IDENTITY_RPC}`));
    // 🔴 It creates NO index and NO unique constraint — the same refusal migration 126 records,
    // for the same reasons.
    assert.doesNotMatch(sql, /CREATE\s+(UNIQUE\s+)?INDEX/i);
    assert.doesNotMatch(sql, /ADD\s+CONSTRAINT/i);
    // …and it does not redefine the two functions of migration 126.
    assert.doesNotMatch(sql, /FUNCTION\s+public\.insert_fenced_prospect_candidates/i);
    assert.doesNotMatch(sql, /FUNCTION\s+public\.read_batch_identity_snapshot/i);
    // …nor add a column, nor backfill.
    assert.doesNotMatch(sql, /ADD\s+COLUMN/i);
    assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
    // 🔴 SECURITY INVOKER with `public` in the path, for the reason CUT-3B5 proved.
    assert.ok(sql.includes('SECURITY INVOKER'));
    assert.ok(sql.includes('SET search_path = pg_catalog, public, pg_temp'));
    assert.ok(!/SECURITY\s+DEFINER/i.test(sql));
    // …and `anon` / PUBLIC stay out.
    assert.ok(sql.includes('FROM PUBLIC'));
    assert.ok(sql.includes('FROM anon'));
  });
});
