/**
 * BR-SOURCE-FUNCTIONAL-CUT-B2 — pin exact publication for the whole Agent 1 run.
 *
 * CUT B1 froze the MONTH and closed the cross-month race. This suite proves the SAME-MONTH race is
 * closed too — the one CUT B1 could not reach, because a month is not a publication:
 *
 *   1. a run pins a PUBLICATION (period + run id), once, before it reads a single candidate;
 *   2. a republication OF THE SAME MONTH mid-run does NOT move a run that already pinned;
 *   3. the pinned run may become `superseded` and the run that pinned it still reads it;
 *   4. the NEXT run pins again and gets the new publication;
 *   5. nothing published, an ambiguous publication or a malformed run id ⇒ fail closed;
 *   6. a pin cannot be manufactured by an arbitrary caller;
 *   7. every matched candidate of one run carries the SAME `snapshot_run_id`;
 *   8. the batch's durable provenance carries the period AND the run id (owner decision § 7);
 *   9. no CNPJ reaches a pin, a provenance shape, a log or an error;
 *  10. a candidate with no CNPJ is still `skipped / missing_cnpj` — name resolution is NOT started.
 *
 * Everything is synthetic and in-memory. No Supabase, no network, no provider, no real Receita
 * dataset, no migration. Every CNPJ is DV-valid by construction via `sampleFullCnpj`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  pinBrReceitaPublication,
  isBrReceitaPinnedPublication,
  pickGreatestCanonicalPeriod,
  BrReceitaPinnedPublication,
  BrReceitaPinnedPublicationQueryError,
  BrReceitaPinnedPublicationForgeryError,
  BR_RECEITA_PINNED_PUBLICATION_SELECT_COLUMNS,
  BR_RECEITA_PINNED_PUBLICATION_PROBE_LIMIT,
  BR_RECEITA_PINNED_PUBLICATION_CONTRACT,
} from '../br-receita-cnpj-pinned-publication';
import {
  readBrReceitaPinnedSnapshot,
  BR_RECEITA_PINNED_READER_CONTRACT,
} from '../br-receita-cnpj-pinned-snapshot-reader';
import {
  createBrReceitaCnpjPinnedEnrichmentAdapter,
  enrichBrReceitaCnpjCandidate,
  BR_RECEITA_ENRICHMENT_PIN_CONTRACT,
} from '../br-receita-cnpj-enrichment-adapter';
import {
  enrichBrBatchWithValidatedSources,
  BR_AGENT1_RUNTIME_BINDING_CONTRACT,
  BR_RUN_SOURCE_CONTEXT_KEY,
} from '../../../enrichment/enrich-br-batch-with-validated-sources';
import { BR_RECEITA_CNPJ_SOURCE_KEY } from '../br-receita-cnpj-types';
import { sampleFullCnpj, RAIZ_TECNOLOGIA } from '../br-receita-cnpj-fixtures';
import { BR_RECEITA_SNAPSHOT_TABLE } from '../br-receita-cnpj-monthly-snapshot-identity';
import { BR_RECEITA_SNAPSHOT_RUNS_TABLE } from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../../snapshot-read/snapshot-read-contract';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

// ─── Synthetic identities. DV-valid, and NEVER real. ────────────────────────

const CNPJ_1 = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
const CNPJ_2 = sampleFullCnpj(RAIZ_TECNOLOGIA, '0002');
const CNPJ_3 = sampleFullCnpj(RAIZ_TECNOLOGIA, '0003');

/** 2026-08, publication A — the one a run pins first. */
const RUN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** 2026-08 as well, publication B — the REPUBLICATION that must not move a started run. */
const RUN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** 2026-09, a different month. */
const RUN_SEP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const digitsOf = (value: string) => value.replace(/\D/g, '');

function rawData(period: string, marker: string): Record<string, unknown> {
  return {
    source_type: 'official_registry',
    human_review_required: true,
    parser_version: 'br-receita-cnpj/1',
    source_period: period,
    source_row_index: 0,
    source_file_name: 'ESTABELECIMENTOS0.SAMPLE.csv',
    matrix_branch_flag: '1',
    company_size_code: '03',
    capital_social_value: '100000.00',
    registration_status_code: '02',
    registration_status_label: 'ATIVA',
    cnae_main_code: '6201500',
    // 🔴 The label is the OBSERVABLE that distinguishes publication A from publication B of the
    // SAME month. Without a per-publication marker, "candidate 2 read A" and "candidate 2 read B"
    // are indistinguishable and the suite would pass either way.
    cnae_main_label: `Desenvolvimento de software (${marker})`,
    cnae_secondary_codes: ['6202300'],
    municipality_code: '7107',
    municipality_name: 'SAO PAULO',
    uf: 'SP',
    start_date: '2015-03-01',
  };
}

function runRow(period: string, id: string, publishState = 'published') {
  return {
    id,
    publish_state: publishState,
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: 'BR',
    source_period: period,
  };
}

function snapshotRow(period: string, runId: string, cnpj: string, marker: string) {
  return {
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: 'BR',
    source_period: period,
    source_year: Number.parseInt(period.slice(0, 4), 10),
    snapshot_run_id: runId,
    normalized_tax_id: digitsOf(cnpj),
    legal_name: `Synthetic Tecnologia ${marker}`,
    raw_data: rawData(period, marker),
  };
}

// ─── A mutable, PostgREST-shaped in-memory double ───────────────────────────
//
// Mutable on purpose: the mandatory case republishes the SAME month while a run is already walking
// its candidates, which a frozen snapshot of the tables could not express. Every select is
// recorded — table, projected columns, filters — so the suite asserts what was READ rather than
// only what came back.

interface RecordedSelect {
  table: string;
  columns: string | undefined;
  filters: Array<{ column: string; value: unknown }>;
}

interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<{ column: string; value: unknown }>;
}

interface FakeDb {
  client: SnapshotReadClient<SnapshotIdentityRow>;
  tables: Record<string, Array<Record<string, unknown>>>;
  selects: RecordedSelect[];
  updates: RecordedUpdate[];
  /** Runs before each select is evaluated — the seam the republication is injected through. */
  beforeSelect?: (recorded: RecordedSelect) => void;
  failWith?: { code: string };
}

function fakeDb(tables: Record<string, Array<Record<string, unknown>>>): FakeDb {
  const db: FakeDb = {
    tables,
    selects: [],
    updates: [],
    client: null as unknown as SnapshotReadClient<SnapshotIdentityRow>,
  };

  db.client = {
    from(table: string) {
      return {
        select(columns?: string) {
          const recorded: RecordedSelect = { table, columns, filters: [] };
          let limit: number | null = null;
          const evaluate = (): Array<Record<string, unknown>> => {
            db.beforeSelect?.(recorded);
            db.selects.push(recorded);
            const source = db.tables[table] ?? [];
            const matched = source.filter((row) =>
              recorded.filters.every((f) => row[f.column] === f.value),
            );
            return limit === null ? matched : matched.slice(0, limit);
          };
          const query = {
            eq(column: string, value: unknown) {
              recorded.filters.push({ column, value });
              return query;
            },
            // 🔴 A deliberate NO-OP. The pin must compute the greatest period IN CODE; leaning on
            // the database's sort would make CASE 1 pass here for the wrong reason.
            order() {
              return query;
            },
            limit(count: number) {
              limit = count;
              return query;
            },
            async maybeSingle() {
              if (db.failWith) return { data: null, error: db.failWith };
              const rows = evaluate();
              return { data: rows[0] ?? null, error: null };
            },
            then(onfulfilled?: (value: unknown) => unknown) {
              if (db.failWith) {
                return Promise.resolve({ data: null, error: db.failWith }).then(
                  onfulfilled as never,
                );
              }
              return Promise.resolve({ data: evaluate(), error: null }).then(
                onfulfilled as never,
              );
            },
          };
          return query as never;
        },
        update(payload: Record<string, unknown>) {
          const recorded: RecordedUpdate = { table, payload, filters: [] };
          const query = {
            eq(column: string, value: unknown) {
              recorded.filters.push({ column, value });
              return query;
            },
            then(onfulfilled?: (value: unknown) => unknown) {
              db.updates.push(recorded);
              const source = db.tables[table] ?? [];
              for (const row of source) {
                if (recorded.filters.every((f) => row[f.column] === f.value)) {
                  Object.assign(row, payload);
                }
              }
              return Promise.resolve({ data: null, error: null }).then(onfulfilled as never);
            },
          };
          return query as never;
        },
      };
    },
  } as unknown as SnapshotReadClient<SnapshotIdentityRow>;

  return db;
}

const asSupabase = (db: FakeDb) => db.client as unknown as Parameters<
  typeof enrichBrBatchWithValidatedSources
>[0];

function candidateRow(id: string, name: string, taxId: string | null, countryCode = 'BR') {
  return {
    id,
    batch_id: 'batch-1',
    name,
    legal_name: name,
    country_code: countryCode,
    tax_identifier: taxId,
    sector_description: 'Tecnología',
    metadata: {} as Record<string, unknown>,
  };
}

/**
 * The world the mandatory case needs: 2026-08 published as run A, and run B's rows ALREADY
 * physically present but not yet published.
 *
 * 🔴 B's snapshot rows exist from the start on purpose. If they were inserted at republication
 * time, "candidate 2 read A" could be explained by B's rows simply not existing yet — a green test
 * that proves nothing. Here B is fully readable throughout; the ONLY thing that changes mid-run is
 * which publication is `published`, which is exactly the defect's trigger.
 */
function republicationWorld(candidates?: Array<Record<string, unknown>>) {
  return fakeDb({
    [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
      runRow('2026-08', RUN_A, 'published'),
      runRow('2026-08', RUN_B, 'preparing'),
    ],
    [BR_RECEITA_SNAPSHOT_TABLE]: [
      snapshotRow('2026-08', RUN_A, CNPJ_1, 'A'),
      snapshotRow('2026-08', RUN_A, CNPJ_2, 'A'),
      snapshotRow('2026-08', RUN_A, CNPJ_3, 'A'),
      snapshotRow('2026-08', RUN_B, CNPJ_1, 'B'),
      snapshotRow('2026-08', RUN_B, CNPJ_2, 'B'),
      snapshotRow('2026-08', RUN_B, CNPJ_3, 'B'),
    ],
    prospect_batches: [{ id: 'batch-1', metadata: { agent_key: 'prospect_generation' } }],
    prospect_candidates:
      candidates ?? [
        candidateRow('c1', 'Alpha BR', CNPJ_1),
        candidateRow('c2', 'Beta BR', CNPJ_2),
        candidateRow('c3', 'Gamma BR', CNPJ_3),
      ],
  });
}

/** Flips A → superseded and B → published, in place. The mid-run republication. */
function republishSameMonth(db: FakeDb) {
  const runs = db.tables[BR_RECEITA_SNAPSHOT_RUNS_TABLE] ?? [];
  for (const row of runs) {
    if (row.id === RUN_A) row.publish_state = 'superseded';
    if (row.id === RUN_B) row.publish_state = 'published';
  }
}

/** The publication marker every matched candidate reported, deduplicated. */
function markersFrom(db: FakeDb): string[] {
  const updates = db.updates.filter((u) => u.table === 'prospect_candidates');
  const markers = updates.map((u) => {
    const meta = u.payload['metadata'] as Record<string, unknown>;
    const se = meta['source_enrichment'] as Record<string, unknown>;
    const entry = se[BR_RECEITA_CNPJ_SOURCE_KEY] as Record<string, unknown> | undefined;
    const signals = entry?.['signals'] as Record<string, unknown> | undefined;
    return String(signals?.['cnae_main_label'] ?? 'none');
  });
  return [...new Set(markers)];
}

/** Every `snapshot_run_id` that reached a persisted candidate shape, deduplicated. */
function runIdsFrom(db: FakeDb): string[] {
  const updates = db.updates.filter((u) => u.table === 'prospect_candidates');
  const ids = updates.map((u) => {
    const meta = u.payload['metadata'] as Record<string, unknown>;
    const se = meta['source_enrichment'] as Record<string, unknown>;
    const entry = se[BR_RECEITA_CNPJ_SOURCE_KEY] as Record<string, unknown> | undefined;
    const metadata = entry?.['metadata'] as Record<string, unknown> | undefined;
    return String(metadata?.['snapshot_run_id'] ?? 'none');
  });
  return [...new Set(ids)];
}

// ════════════════════════════════════════════════════════════════════════════
// THE MANDATORY CASE — same-period republication is isolated
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · MANDATORY — same-period republication does not move a started run', () => {
  it('every candidate reads publication A even after B replaces it mid-run', async () => {
    const db = republicationWorld();

    // Republish A→B the moment the FIRST candidate's snapshot lookup happens, so candidate 1 sees
    // A and candidates 2..N run entirely in the republished world.
    let snapshotReads = 0;
    let republishedAfter: number | null = null;
    db.beforeSelect = (recorded) => {
      if (recorded.table !== BR_RECEITA_SNAPSHOT_TABLE) return;
      snapshotReads++;
      if (snapshotReads === 1) {
        republishSameMonth(db);
        republishedAfter = snapshotReads;
      }
    };

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(republishedAfter, 1, 'the republication really happened mid-run');
    assert.ok(snapshotReads >= 3, 'all three candidates were genuinely looked up');

    // The pin never moved.
    assert.equal(result.frozenPeriod.sourcePeriod, '2026-08');
    assert.equal(result.frozenPeriod.snapshotRunId, RUN_A);
    assert.equal(result.periodResolutionCount, 1);
    assert.equal(result.adapterConstructionCount, 1);
    assert.equal(result.matchedCount, 3);

    // 🔴 The assertion the whole cut exists for: three candidates, ONE publication, and it is A.
    assert.deepEqual(runIdsFrom(db), [RUN_A]);
    assert.deepEqual(markersFrom(db), ['Desenvolvimento de software (A)']);

    // And every snapshot read was scoped by A's run id — not one of them slipped to B.
    const scopedRunIds = db.selects
      .filter((s) => s.table === BR_RECEITA_SNAPSHOT_TABLE)
      .map((s) => s.filters.find((f) => f.column === 'snapshot_run_id')?.value);
    assert.ok(scopedRunIds.length >= 3);
    assert.deepEqual([...new Set(scopedRunIds)], [RUN_A]);
  });

  it('the same run, WITHOUT the pin, would have drifted to B — the defect is real', async () => {
    // A control, not a redundancy: it proves the mandatory case above is testing something. The
    // unpinned reader is the CUT B1 path — month-bound, run resolved per call — and it drifts.
    const db = republicationWorld();
    const adapter = createBrReceitaCnpjPinnedEnrichmentAdapter(
      (await pinBrReceitaPublication({ client: db.client })).publication as BrReceitaPinnedPublication,
      { getClient: () => db.client },
    );

    const first = await adapter.enrichCandidate({
      name: 'Alpha BR',
      taxId: CNPJ_1,
      candidateTaxId: CNPJ_1,
      countryCode: 'BR',
      sector: null,
      stage: 'post_discovery_enrichment',
    } as never);
    assert.equal(first.status, 'matched');
    assert.equal(first.metadata?.['snapshot_run_id'], RUN_A);

    republishSameMonth(db);

    // The UNPINNED, month-only adapter — CUT B1's binding — now answers from B.
    const unpinnedDrift = await enrichBrReceitaCnpjCandidate(
      {
        name: 'Beta BR',
        taxId: CNPJ_2,
        candidateTaxId: CNPJ_2,
        countryCode: 'BR',
        sector: null,
        stage: 'post_discovery_enrichment',
      } as never,
      { sourcePeriod: '2026-08', getClient: () => db.client },
    );
    assert.equal(unpinnedDrift.status, 'matched');
    assert.equal(
      unpinnedDrift.metadata?.['snapshot_run_id'],
      RUN_B,
      'the month-only path really does drift to the republication — this is the defect',
    );

    // The PINNED adapter, same moment, same month: still A.
    const pinnedAfter = await adapter.enrichCandidate({
      name: 'Beta BR',
      taxId: CNPJ_2,
      candidateTaxId: CNPJ_2,
      countryCode: 'BR',
      sector: null,
      stage: 'post_discovery_enrichment',
    } as never);
    assert.equal(pinnedAfter.status, 'matched');
    assert.equal(pinnedAfter.metadata?.['snapshot_run_id'], RUN_A);
  });

  it('CASE 4 — the NEXT run pins B and reads B', async () => {
    const db = republicationWorld();
    const firstRun = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');
    assert.equal(firstRun.frozenPeriod.snapshotRunId, RUN_A);

    republishSameMonth(db);
    // Reset the recorded candidate updates so the second run's reads are unambiguous.
    db.updates.length = 0;

    const secondRun = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');
    assert.equal(secondRun.frozenPeriod.sourcePeriod, '2026-08');
    assert.equal(secondRun.frozenPeriod.snapshotRunId, RUN_B);
    assert.equal(secondRun.matchedCount, 3);
    assert.deepEqual(runIdsFrom(db), [RUN_B]);
    assert.deepEqual(markersFrom(db), ['Desenvolvimento de software (B)']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 1 / 2 — the pin picks the latest publication, and a new MONTH mid-run does not move it
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 1 & 2 — pinning the latest publication', () => {
  it('CASE 1 — pins 2026-08/A when 2026-07 and 2026-08 are published', async () => {
    const db = fakeDb({
      // Reversed insertion order; the double never sorts, so a DB-order dependency fails here.
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-08', RUN_A),
        runRow('2026-07', RUN_SEP),
      ],
    });
    const result = await pinBrReceitaPublication({ client: db.client });

    assert.equal(result.status, 'PINNED');
    assert.equal(result.reason, 'pinned_current_publication');
    assert.equal(result.publication?.sourcePeriod, '2026-08');
    assert.equal(result.publication?.snapshotRunId, RUN_A);
  });

  it('projects only id, source_period and publish_state, bounded, published-only', async () => {
    const db = fakeDb({ [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [runRow('2026-08', RUN_A)] });
    await pinBrReceitaPublication({ client: db.client });

    const select = db.selects.at(-1);
    assert.ok(select);
    assert.equal(select.table, BR_RECEITA_SNAPSHOT_RUNS_TABLE);
    assert.equal(select.columns, BR_RECEITA_PINNED_PUBLICATION_SELECT_COLUMNS);
    assert.equal(select.columns, 'id, source_period, publish_state');
    assert.ok(
      select.filters.some((f) => f.column === 'publish_state' && f.value === 'published'),
      'the pin must require publish_state=published',
    );
    // 🔴 Neither of these may ever appear: they order IMPORTS, not publications.
    assert.ok(!select.filters.some((f) => f.column === 'imported_at'));
    assert.ok(!select.filters.some((f) => f.column === 'created_at'));
    assert.ok(BR_RECEITA_PINNED_PUBLICATION_PROBE_LIMIT > 0);
  });

  it('pins period and run id from ONE query — no second round trip to name the run', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [runRow('2026-07', RUN_SEP), runRow('2026-08', RUN_A)],
    });
    const result = await pinBrReceitaPublication({ client: db.client });

    assert.equal(result.status, 'PINNED');
    // 🔴 A second query is a window a republication can slip through. There must be exactly one.
    assert.equal(
      db.selects.filter((s) => s.table === BR_RECEITA_SNAPSHOT_RUNS_TABLE).length,
      1,
    );
  });

  it('ignores runs that are not published', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-07', RUN_SEP, 'published'),
        runRow('2026-09', RUN_B, 'preparing'),
        runRow('2026-08', RUN_A, 'superseded'),
      ],
    });
    const result = await pinBrReceitaPublication({ client: db.client });
    assert.equal(result.publication?.sourcePeriod, '2026-07');
    assert.equal(result.publication?.snapshotRunId, RUN_SEP);
  });

  it('CASE 2 — a NEW month published mid-run does not move the pinned run', async () => {
    const db = republicationWorld();

    let published = false;
    db.beforeSelect = (recorded) => {
      if (recorded.table === 'prospect_candidates' && !published) {
        published = true;
        db.tables[BR_RECEITA_SNAPSHOT_RUNS_TABLE]?.push(runRow('2026-09', RUN_SEP));
        db.tables[BR_RECEITA_SNAPSHOT_TABLE]?.push(
          snapshotRow('2026-09', RUN_SEP, CNPJ_1, 'SEP'),
          snapshotRow('2026-09', RUN_SEP, CNPJ_2, 'SEP'),
          snapshotRow('2026-09', RUN_SEP, CNPJ_3, 'SEP'),
        );
      }
    };

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(published, true, 'the new month really was published mid-run');
    assert.equal(result.frozenPeriod.sourcePeriod, '2026-08');
    assert.equal(result.frozenPeriod.snapshotRunId, RUN_A);
    assert.deepEqual(runIdsFrom(db), [RUN_A]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 5 / 6 — fail closed
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 5 & 6 — fail closed, never demoted', () => {
  it('CASE 5 — nothing published ⇒ no candidate is read and nothing is written', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [runRow('2026-08', RUN_A, 'preparing')],
      prospect_batches: [{ id: 'batch-1', metadata: {} }],
      prospect_candidates: [candidateRow('c1', 'Alpha BR', CNPJ_1)],
    });

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.aborted, true);
    assert.equal(result.frozenPeriod.status, 'NO_PUBLISHED_PUBLICATION');
    assert.equal(result.frozenPeriod.sourcePeriod, null);
    assert.equal(result.frozenPeriod.snapshotRunId, null);
    assert.equal(result.adapterConstructionCount, 0);
    assert.equal(result.updatedCount, 0);
    assert.equal(db.updates.length, 0, 'not one write');
    assert.ok(!db.selects.some((s) => s.table === 'prospect_candidates'), 'not one candidate read');
    assert.ok(!db.selects.some((s) => s.table === BR_RECEITA_SNAPSHOT_TABLE));
    assert.ok(result.errors.some((e) => e.startsWith('br_no_published_period')));
  });

  it('CASE 6 — a malformed run id fails closed and is NOT demoted to the month below', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-07', RUN_SEP, 'published'),
        // 2026-08 is the newest publication and its id is not a canonical UUID.
        { ...runRow('2026-08', RUN_A), id: 'not-a-uuid' },
      ],
    });
    const result = await pinBrReceitaPublication({ client: db.client });

    assert.equal(result.status, 'MALFORMED_PUBLICATION_RUN_ID');
    assert.equal(result.publication, null);
    // 🔴 NOT 2026-07. "The newest publication is unusable" and "an older publication is what this
    // run wanted" are different statements.
    assert.ok(!result.reason.includes('2026-07'));
  });

  it('two publications for one month are reported, never arbitrarily picked', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-08', RUN_A, 'published'),
        runRow('2026-08', RUN_B, 'published'),
      ],
    });
    const result = await pinBrReceitaPublication({ client: db.client });

    assert.equal(result.status, 'AMBIGUOUS_PUBLISHED_PUBLICATION');
    assert.equal(result.publication, null);
    assert.equal(result.observedCount, 2);
  });

  it('drops a non-canonical period instead of repairing it', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-07', RUN_SEP),
        { ...runRow('2026-08', RUN_A), source_period: '2026-8' },
      ],
    });
    const result = await pinBrReceitaPublication({ client: db.client });
    assert.equal(result.publication?.sourcePeriod, '2026-07');
  });

  it('a transport failure is a code-only throw, never a domain answer', async () => {
    const db = fakeDb({ [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [runRow('2026-08', RUN_A)] });
    db.failWith = { code: '42501' };
    await assert.rejects(
      () => pinBrReceitaPublication({ client: db.client }),
      (err: unknown) => {
        assert.ok(err instanceof BrReceitaPinnedPublicationQueryError);
        assert.equal(err.code, '42501');
        return true;
      },
    );
  });

  it('a null payload with no error is a transport state, not "nothing is published"', async () => {
    const client = {
      from: () => ({
        select: () => {
          const q = {
            eq: () => q,
            order: () => q,
            limit: () => q,
            then: (onfulfilled?: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(onfulfilled as never),
          };
          return q;
        },
      }),
    } as unknown as SnapshotReadClient<SnapshotIdentityRow>;

    await assert.rejects(
      () => pinBrReceitaPublication({ client }),
      (err: unknown) => err instanceof BrReceitaPinnedPublicationQueryError,
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 7 — a pinned run that became superseded remains readable
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 7 — the pin survives its run being superseded', () => {
  it('the pinned reader still answers after the pinned run is superseded', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);
    assert.equal(pin.snapshotRunId, RUN_A);

    republishSameMonth(db);

    const after = await readBrReceitaPinnedSnapshot({
      client: db.client,
      publication: pin,
      cnpj: CNPJ_1,
    });

    assert.equal(after.status, 'FOUND');
    assert.equal(after.snapshotRunId, RUN_A);
    assert.equal(after.snapshot?.raw_data.cnae_main_label, 'Desenvolvimento de software (A)');

    // 🔴 And it did NOT re-ask which run is published: the runs table was never touched.
    const runsTableReads = db.selects.filter(
      (s) => s.table === BR_RECEITA_SNAPSHOT_RUNS_TABLE,
    ).length;
    assert.equal(runsTableReads, 1, 'exactly the one read the PIN made — none from the reader');
    assert.equal(BR_RECEITA_PINNED_READER_CONTRACT.reChecksPublishStateAtReadTime, false);
    assert.equal(BR_RECEITA_PINNED_READER_CONTRACT.resolvesPublishedRunItself, false);
  });

  it('the pinned reader scopes by all five physical key columns', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);
    await readBrReceitaPinnedSnapshot({ client: db.client, publication: pin, cnpj: CNPJ_1 });

    const read = db.selects.filter((s) => s.table === BR_RECEITA_SNAPSHOT_TABLE).at(-1);
    assert.ok(read);
    const columns = read.filters.map((f) => f.column).sort();
    assert.deepEqual(columns, [
      'country_code',
      'normalized_tax_id',
      'snapshot_run_id',
      'source_key',
      'source_period',
    ]);
    // 🔴 The projection must not fetch the identity back.
    assert.ok(!String(read.columns).includes('normalized_tax_id'));
  });

  it('a cardinality violation inside one publication is reported, never collapsed', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);
    // A second row for the same establishment inside the SAME publication. Index 4b forbids it.
    db.tables[BR_RECEITA_SNAPSHOT_TABLE]?.push(snapshotRow('2026-08', RUN_A, CNPJ_1, 'A-dup'));

    const result = await readBrReceitaPinnedSnapshot({
      client: db.client,
      publication: pin,
      cnpj: CNPJ_1,
    });
    assert.equal(result.status, 'CARDINALITY_VIOLATION');
    assert.equal(result.observedCount, 2);
    assert.equal(result.snapshot, null);
  });

  it('an establishment absent from the pinned publication is NOT_IN_PINNED_PUBLICATION', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);
    const absent = sampleFullCnpj(RAIZ_TECNOLOGIA, '0009');

    const result = await readBrReceitaPinnedSnapshot({
      client: db.client,
      publication: pin,
      cnpj: absent,
    });
    assert.equal(result.status, 'NOT_IN_PINNED_PUBLICATION');
    assert.equal(result.snapshot, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 8 — a pin cannot be manufactured
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 8 — the lease is unforgeable', () => {
  it('an arbitrary caller cannot construct one, even by casting past `private`', () => {
    // `new BrReceitaPinnedPublication(...)` does not compile — the constructor is private. But
    // `private` is ERASED at runtime, so a caller willing to cast could otherwise mint a real,
    // `instanceof`-passing instance around any run id it liked. The mint token is what stops it.
    assert.throws(
      () =>
        new (BrReceitaPinnedPublication as unknown as new (
          ...args: unknown[]
        ) => BrReceitaPinnedPublication)('2026-08', RUN_B),
      (err: unknown) => {
        assert.ok(err instanceof BrReceitaPinnedPublicationForgeryError);
        // 🔴 And the refusal names no identity.
        for (const digits of [digitsOf(CNPJ_1), digitsOf(CNPJ_2)]) {
          assert.ok(!(err as Error).message.includes(digits));
        }
        return true;
      },
    );

    // Guessing a token does not help either: it is a module-private symbol.
    assert.throws(
      () =>
        new (BrReceitaPinnedPublication as unknown as new (
          ...args: unknown[]
        ) => BrReceitaPinnedPublication)(
          Symbol('br-receita-pinned-publication-mint'),
          '2026-08',
          RUN_B,
        ),
      BrReceitaPinnedPublicationForgeryError,
    );
  });

  it('an object literal shaped like a pin is refused at runtime, with NO query sent', async () => {
    const db = republicationWorld();
    const forged = { sourcePeriod: '2026-08', snapshotRunId: RUN_B };

    assert.equal(isBrReceitaPinnedPublication(forged), false);

    const before = db.selects.length;
    const result = await readBrReceitaPinnedSnapshot({
      client: db.client,
      publication: forged as unknown as BrReceitaPinnedPublication,
      cnpj: CNPJ_1,
    });

    assert.equal(result.status, 'INVALID_PINNED_PUBLICATION');
    assert.equal(result.reason, 'pinned_publication_not_minted_here');
    assert.equal(result.snapshot, null);
    // 🔴 Fail closed BEFORE the round trip: a forged pin never scopes a query by its run id.
    assert.equal(db.selects.length, before, 'no query was sent for a forged pin');
  });

  it('a minted pin passes the same guard, and is immutable', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);
    assert.equal(isBrReceitaPinnedPublication(pin), true);
    assert.equal(Object.isFrozen(pin), true);
  });

  it('the adapter turns a rejected pin into an ERROR, never into "not in Receita"', async () => {
    const db = republicationWorld();
    const output = await enrichBrReceitaCnpjCandidate(
      {
        name: 'Alpha BR',
        taxId: CNPJ_1,
        candidateTaxId: CNPJ_1,
        countryCode: 'BR',
        sector: null,
        stage: 'post_discovery_enrichment',
      } as never,
      {
        publication: { sourcePeriod: '2026-08', snapshotRunId: RUN_B } as unknown as BrReceitaPinnedPublication,
        getClient: () => db.client,
      },
    );
    assert.equal(output.status, 'error');
    assert.ok(output.reason?.startsWith('br_pinned_publication_rejected:'));
  });

  it('a period that disagrees with the pin fails closed', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);

    const output = await enrichBrReceitaCnpjCandidate(
      {
        name: 'Alpha BR',
        taxId: CNPJ_1,
        candidateTaxId: CNPJ_1,
        countryCode: 'BR',
        sector: null,
        stage: 'post_discovery_enrichment',
      } as never,
      { publication: pin, sourcePeriod: '2026-07', getClient: () => db.client },
    );
    assert.equal(output.status, 'skipped');
    assert.equal(output.reason, 'br_snapshot_period_pin_mismatch');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 9 / 10 — provenance
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 9 & 10 — provenance carries the pinned publication', () => {
  it('CASE 9 — every matched candidate carries the SAME snapshot_run_id', async () => {
    const db = republicationWorld();
    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.matchedCount, 3);
    const ids = runIdsFrom(db);
    assert.equal(ids.length, 1, 'one publication across every candidate');
    assert.deepEqual(ids, [RUN_A]);
  });

  it('CASE 10 — the batch source_context carries the period AND the run id', async () => {
    const db = republicationWorld();
    await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    const batchUpdate = db.updates.find((u) => u.table === 'prospect_batches');
    assert.ok(batchUpdate);
    const meta = batchUpdate.payload['metadata'] as Record<string, unknown>;
    // Pre-existing keys survive the merge.
    assert.equal(meta['agent_key'], 'prospect_generation');

    const context = meta[BR_RUN_SOURCE_CONTEXT_KEY] as Record<string, unknown>;
    assert.deepEqual(context[BR_RECEITA_CNPJ_SOURCE_KEY], {
      source_period: '2026-08',
      snapshot_run_id: RUN_A,
    });
    assert.equal(
      BR_AGENT1_RUNTIME_BINDING_CONTRACT.runProvenanceHome,
      'prospect_batches.metadata.source_context',
    );
    assert.equal(
      BR_AGENT1_RUNTIME_BINDING_CONTRACT.persistsSnapshotRunIdAsBatchProvenance,
      true,
    );
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.usesSnapshotRunIdAsTelemetryLabel, false);
  });

  it('a dry run computes the pin and writes nothing', async () => {
    const db = republicationWorld();
    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1', {
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.frozenPeriod.snapshotRunId, RUN_A);
    assert.equal(result.runProvenancePersisted, false);
    assert.equal(result.updatedCount, 0);
    assert.equal(db.updates.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 11 — no CNPJ escapes
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 11 — no CNPJ in a pin, a provenance shape, a log or an error', () => {
  it('the pin carries a period and a run id and nothing else', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);

    // Own enumerable keys only — the nominal brand is the sole extra field and it is a boolean.
    const serialized = JSON.stringify(pin);
    for (const digits of [digitsOf(CNPJ_1), digitsOf(CNPJ_2), digitsOf(CNPJ_3)]) {
      assert.ok(!serialized.includes(digits), 'no CNPJ in the pin');
    }
    assert.ok(!serialized.includes('Synthetic'), 'no legal name in the pin');
    assert.ok(!serialized.includes('raw_data'));
    assert.equal(pin.sourcePeriod, '2026-08');
    assert.equal(pin.snapshotRunId, RUN_A);
  });

  it('the batch provenance contains no CNPJ and no legal name', async () => {
    const db = republicationWorld();
    await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    const batchUpdate = db.updates.find((u) => u.table === 'prospect_batches');
    assert.ok(batchUpdate);
    const meta = batchUpdate.payload['metadata'] as Record<string, unknown>;
    const context = JSON.stringify(meta[BR_RUN_SOURCE_CONTEXT_KEY]);
    for (const digits of [digitsOf(CNPJ_1), digitsOf(CNPJ_2), digitsOf(CNPJ_3)]) {
      assert.ok(!context.includes(digits));
    }
    assert.ok(!context.includes('Synthetic'));
  });

  it('a refusal reason never echoes the rejected identity', async () => {
    const db = republicationWorld();
    const pin = (await pinBrReceitaPublication({ client: db.client })).publication;
    assert.ok(pin);

    for (const bad of ['123', '11111111111111', 'not-a-cnpj', null, undefined]) {
      const result = await readBrReceitaPinnedSnapshot({
        client: db.client,
        publication: pin,
        cnpj: bad,
      });
      assert.equal(result.status, 'INVALID_IDENTITY');
      assert.ok(result.reason.startsWith('cnpj_'));
      if (typeof bad === 'string' && bad.length > 2) {
        assert.ok(!result.reason.includes(bad), 'the rejected value is never in the reason');
      }
      assert.equal(result.snapshot, null);
    }
  });

  it('the pin query error message carries a code and no identity', () => {
    const err = new BrReceitaPinnedPublicationQueryError('42501');
    assert.ok(err.message.includes('42501'));
    for (const digits of [digitsOf(CNPJ_1), digitsOf(CNPJ_2)]) {
      assert.ok(!err.message.includes(digits));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 12 — missing CNPJ stays missing_cnpj; identity resolution is NOT started
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · CASE 12 — missing CNPJ is still fail-closed', () => {
  it('a candidate with no CNPJ is skipped / missing_cnpj and counted', async () => {
    const db = republicationWorld([
      candidateRow('c1', 'Alpha BR', CNPJ_1),
      candidateRow('c2', 'Sin CNPJ BR', null),
      candidateRow('c3', 'Vacio BR', '   '),
    ]);

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.matchedCount, 1);
    assert.equal(result.missingCnpjCount, 2);
    assert.equal(result.skippedCount, 2);
    // 🔴 The pin exists and is fine — the refusal is about the CANDIDATE, not the publication.
    assert.equal(result.frozenPeriod.snapshotRunId, RUN_A);
  });

  it('name-based identity resolution is not started anywhere in the pinned path', () => {
    const files = [
      'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-pinned-publication.ts',
      'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-pinned-snapshot-reader.ts',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(join(repoRoot, rel), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['legal_name', 'trade_name', 'fuzzy', 'ilike', 'similarity']) {
        // `legal_name` is legitimately PROJECTED by the reader; what must not exist is a FILTER on
        // it, which is what identity-by-name would need.
        assert.ok(
          !code.includes(`.eq('${forbidden}'`),
          `${rel} must not filter by ${forbidden}`,
        );
        assert.ok(!code.includes(`.${forbidden}(`), `${rel} must not use ${forbidden}()`);
      }
    }
    assert.equal(BR_RECEITA_ENRICHMENT_PIN_CONTRACT.resolvesIdentityByName, false);
    assert.equal(BR_RECEITA_ENRICHMENT_PIN_CONTRACT.requiresExactCnpj, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Structure — the pin is not reachable from the candidate loop, and no migration was authored
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B2 · structure', () => {
  it('the hook pins exactly once, before candidates are read and before the loop', () => {
    const src = fs.readFileSync(
      join(repoRoot, 'src/server/source-catalog/enrichment/enrich-br-batch-with-validated-sources.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const pinAt = code.indexOf('await pinPublication(');
    const candidatesAt = code.indexOf("from('prospect_candidates')");
    const loopAt = code.indexOf('for (const r of enrichResult.results)');
    assert.ok(pinAt > 0 && candidatesAt > 0 && loopAt > 0);
    assert.ok(pinAt < candidatesAt, 'the publication is pinned BEFORE candidates are read');
    assert.ok(pinAt < loopAt, 'the publication is pinned BEFORE the candidate loop');
    assert.equal(
      code.split('await pinPublication(').length - 1,
      1,
      'exactly one call site for the pin',
    );
  });

  it('the pinned reader never queries the runs table', () => {
    const src = fs.readFileSync(
      join(
        repoRoot,
        'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-pinned-snapshot-reader.ts',
      ),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(
      !code.includes('BR_RECEITA_SNAPSHOT_RUNS_TABLE'),
      'the pinned reader must not touch source_snapshot_runs — that is the defect',
    );
    assert.ok(!code.includes('resolveBrReceitaPublishedRun'));
  });

  it('records the pin policy as data', () => {
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.pinnedOncePerRun, true);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.pinsPeriodAndRunTogether, true);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.resolvedFromASingleQuery, true);
    assert.equal(
      BR_RECEITA_PINNED_PUBLICATION_CONTRACT.survivesPinnedRunBecomingSuperseded,
      true,
    );
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.reChecksPublishStatePerCandidate, false);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.ordersByImportedAt, false);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.ordersByCreatedAt, false);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.derivesPeriodFromClock, false);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.fallsBackToUnpublishedRun, false);
    assert.equal(
      BR_RECEITA_PINNED_PUBLICATION_CONTRACT.fallsBackToPreviousPeriodOnMalformedWinner,
      false,
    );
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.forgeableByArbitraryCaller, false);
    assert.equal(BR_RECEITA_PINNED_PUBLICATION_CONTRACT.involvesTaxIdentity, false);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.samePeriodRepublicationIsolated, true);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.resolvesPublishedRunPerCandidate, false);
  });

  it('the period-selection policy has ONE implementation, shared with the period resolver', () => {
    // The pure selector is exported from the pin module and imported by the CUT B1 resolver, so
    // the two can never disagree about which month is current.
    assert.equal(pickGreatestCanonicalPeriod([{ source_period: '2026-07' }]), '2026-07');
    assert.equal(
      pickGreatestCanonicalPeriod([
        { source_period: '2026-07' },
        { source_period: '2026-12' },
        { source_period: '2025-12' },
      ]),
      '2026-12',
    );
    assert.equal(pickGreatestCanonicalPeriod([{ source_period: '2026-8' }]), null);
    assert.equal(pickGreatestCanonicalPeriod([]), null);

    const resolverSrc = fs.readFileSync(
      join(
        repoRoot,
        'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-published-period-resolver.ts',
      ),
      'utf8',
    );
    assert.ok(resolverSrc.includes('pickGreatestCanonicalPeriod'));
  });

  it('authors no migration and touches none of 125–128', () => {
    const dir = join(repoRoot, 'supabase', 'migrations');
    const migrations = fs.readdirSync(dir);
    assert.ok(!migrations.some((f) => /cut[-_]?b2|pinned[-_]?publication/i.test(f)));
    assert.ok(!migrations.some((f) => /^(129|130)_/.test(f)));
  });
});
