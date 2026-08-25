/**
 * BR-SOURCE-FUNCTIONAL-CUT-B1 — frozen period, metadata provenance, Agent 1 runtime binding.
 *
 * CUT B made Brazil REACHABLE. This suite proves it is REACHED, and reached correctly:
 *
 *   1. the run picks ONE published month, once, before it reads a single candidate;
 *   2. a month published mid-run does NOT move a run that already started;
 *   3. nothing published ⇒ nothing read and nothing written;
 *   4. the adapter's `metadata` block — `source_period`, `snapshot_run_id` — now survives the
 *      generic enrichment builder that used to drop it, WITHOUT being smuggled into `signals`;
 *   5. a candidate with no CNPJ is still `skipped / missing_cnpj`; identity resolution by name
 *      is deliberately NOT started here;
 *   6. no CNPJ reaches an output, a persisted shape, a log or an error;
 *   7. CO / MX / CL / EC are byte-for-byte unaffected.
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
  resolveBrReceitaLatestPublishedPeriod,
  BR_RECEITA_PUBLISHED_PERIOD_SELECT_COLUMNS,
  BR_RECEITA_PUBLISHED_PERIOD_PROBE_LIMIT,
  BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT,
  BrReceitaPublishedPeriodQueryError,
} from '../br-receita-cnpj-published-period-resolver';
import {
  createBrReceitaCnpjEnrichmentAdapter,
  brReceitaCnpjEnrichmentAdapter,
} from '../br-receita-cnpj-enrichment-adapter';
// CUT B2 superseded the hook's run-level decision: it pins a PUBLICATION (period + run id) rather
// than resolving a period. The properties this suite asserts are unchanged — resolved once, before
// the candidate loop, frozen for the whole run — so only the seam's name moves.
import { pinBrReceitaPublication } from '../br-receita-cnpj-pinned-publication';
import {
  enrichBrBatchWithValidatedSources,
  BR_AGENT1_RUNTIME_BINDING_CONTRACT,
  BR_RUN_SOURCE_CONTEXT_KEY,
} from '../../../enrichment/enrich-br-batch-with-validated-sources';
import { enrichCandidatesWithValidatedSources } from '../../../enrichment/enrich-candidates-with-validated-sources';
import { BR_RECEITA_CNPJ_SOURCE_KEY } from '../br-receita-cnpj-types';
import { sampleFullCnpj, RAIZ_TECNOLOGIA } from '../br-receita-cnpj-fixtures';
import { BR_RECEITA_SNAPSHOT_TABLE } from '../br-receita-cnpj-monthly-snapshot-identity';
import { BR_RECEITA_SNAPSHOT_RUNS_TABLE } from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../../snapshot-read/snapshot-read-contract';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
} from '../../../enrichment/types';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → br-receita-cnpj → connectors → source-catalog → server → src → repo root
const repoRoot = join(here, '..', '..', '..', '..', '..', '..');

// ─── Synthetic identities. DV-valid, and NEVER real. ────────────────────────

const CNPJ_A = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
const CNPJ_B = sampleFullCnpj(RAIZ_TECNOLOGIA, '0002');
const CNPJ_C = sampleFullCnpj(RAIZ_TECNOLOGIA, '0003');

const RUN_JUL = '11111111-1111-4111-8111-111111111111';
const RUN_AUG = '22222222-2222-4222-8222-222222222222';
const RUN_SEP = '33333333-3333-4333-8333-333333333333';

const digitsOf = (value: string) => value.replace(/\D/g, '');

function rawData(period: string): Record<string, unknown> {
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
    cnae_main_label: 'Desenvolvimento de programas de computador sob encomenda',
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

function snapshotRow(period: string, runId: string, cnpj: string, legalName: string) {
  return {
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: 'BR',
    source_period: period,
    source_year: Number.parseInt(period.slice(0, 4), 10),
    snapshot_run_id: runId,
    normalized_tax_id: digitsOf(cnpj),
    legal_name: legalName,
    raw_data: rawData(period),
  };
}

// ─── A mutable, PostgREST-shaped in-memory double ───────────────────────────
//
// Mutable on purpose: CASE 2 publishes a NEW month while a run is already walking its candidates,
// which a frozen snapshot of the tables could not express. It records every select — the table,
// the projected columns and the filters — so the suite can assert what was READ, not only what
// came back, and so "no candidate lookup happened" is provable rather than inferred.

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
  /** Runs before each select is evaluated — the seam CASE 2 publishes a new month through. */
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
            // 🔴 A deliberate NO-OP. The resolver must compute the greatest period IN CODE; if it
            // leaned on the database's sort, CASE 1 would fail here — which is the point.
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

/** The `SupabaseClient` face of the same double. Structural, never a real client. */
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

/** A two-month, two-candidate world: everything most cases need. */
function world(options: { periods?: string[]; candidates?: Array<Record<string, unknown>> } = {}) {
  const periods = options.periods ?? ['2026-07', '2026-08'];
  const runIdOf: Record<string, string> = {
    '2026-07': RUN_JUL,
    '2026-08': RUN_AUG,
    '2026-09': RUN_SEP,
  };
  const runs = periods.map((p) => runRow(p, runIdOf[p] ?? `run-${p}`));
  const snapshots = periods.flatMap((p) => [
    snapshotRow(p, runIdOf[p] ?? `run-${p}`, CNPJ_A, `Synthetic Tecnologia ${p}`),
    snapshotRow(p, runIdOf[p] ?? `run-${p}`, CNPJ_B, `Synthetic Educacao ${p}`),
  ]);
  return fakeDb({
    [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: runs,
    [BR_RECEITA_SNAPSHOT_TABLE]: snapshots,
    prospect_batches: [{ id: 'batch-1', metadata: { agent_key: 'prospect_generation' } }],
    prospect_candidates:
      (options.candidates as Array<Record<string, unknown>>) ?? [
        candidateRow('c1', 'Alpha BR', CNPJ_A),
        candidateRow('c2', 'Beta BR', CNPJ_B),
      ],
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CASE 1 — the run picks the LATEST published month
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 1 — frozen period resolution', () => {
  it('resolves 2026-08 when 2026-07 and 2026-08 are both published', async () => {
    const db = world({ periods: ['2026-07', '2026-08'] });
    const result = await resolveBrReceitaLatestPublishedPeriod({ client: db.client });

    assert.equal(result.status, 'FOUND');
    assert.equal(result.sourcePeriod, '2026-08');
    assert.equal(result.reason, 'latest_published_period');
  });

  it('picks the greatest period IN CODE — the fake never sorts, so a DB-order dependency fails', async () => {
    // Deliberately reversed insertion order. `order()` is a no-op in the double.
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-08', RUN_AUG),
        runRow('2026-07', RUN_JUL),
      ],
    });
    const result = await resolveBrReceitaLatestPublishedPeriod({ client: db.client });
    assert.equal(result.sourcePeriod, '2026-08');
  });

  it('never returns a run row to the caller — only the month', async () => {
    const db = world();
    const result = await resolveBrReceitaLatestPublishedPeriod({ client: db.client });
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'sourcePeriod', 'status']);
  });

  it('projects ONLY source_period, bounded, and filters on publish_state=published', async () => {
    const db = world();
    await resolveBrReceitaLatestPublishedPeriod({ client: db.client });

    const select = db.selects.at(-1);
    assert.ok(select);
    assert.equal(select.table, BR_RECEITA_SNAPSHOT_RUNS_TABLE);
    assert.equal(select.columns, BR_RECEITA_PUBLISHED_PERIOD_SELECT_COLUMNS);
    assert.equal(select.columns, 'source_period');
    assert.ok(
      select.filters.some((f) => f.column === 'publish_state' && f.value === 'published'),
      'the resolver must require publish_state=published',
    );
    assert.ok(BR_RECEITA_PUBLISHED_PERIOD_PROBE_LIMIT > 0);
  });

  it('ignores runs that are not published', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-07', RUN_JUL, 'published'),
        runRow('2026-09', RUN_SEP, 'preparing'),
        runRow('2026-08', RUN_AUG, 'superseded'),
      ],
    });
    const result = await resolveBrReceitaLatestPublishedPeriod({ client: db.client });
    assert.equal(result.sourcePeriod, '2026-07');
  });

  it('drops a non-canonical period instead of repairing it', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [
        runRow('2026-07', RUN_JUL),
        { ...runRow('2026-08', RUN_AUG), source_period: '2026-8' },
      ],
    });
    const result = await resolveBrReceitaLatestPublishedPeriod({ client: db.client });
    assert.equal(result.sourcePeriod, '2026-07');
  });

  it('surfaces a transport failure as a code-only error, never a domain answer', async () => {
    const db = world();
    db.failWith = { code: '42501' };
    await assert.rejects(
      () => resolveBrReceitaLatestPublishedPeriod({ client: db.client }),
      (err: unknown) => {
        assert.ok(err instanceof BrReceitaPublishedPeriodQueryError);
        assert.equal(err.code, '42501');
        return true;
      },
    );
  });

  it('records the freeze policy as data', () => {
    assert.equal(BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT.resolvedOncePerRun, true);
    assert.equal(BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT.frozenForWholeRun, true);
    assert.equal(BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT.ordersByImportedAt, false);
    assert.equal(BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT.derivesPeriodFromClock, false);
    assert.equal(BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT.returnsRunRowsToCaller, false);
    assert.equal(BR_RECEITA_PUBLISHED_PERIOD_RESOLVER_CONTRACT.involvesTaxIdentity, false);
  });

  it('the resolver module names no clock and no imported_at ordering', () => {
    const src = fs.readFileSync(
      join(repoRoot, 'src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-published-period-resolver.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/new Date\(|Date\.now\(/.test(code), 'no clock may choose a period');
    assert.ok(!/imported_at|created_at/.test(code), 'publications are not ordered by import time');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 2 + CASE 4 + CASE 11 — one resolution, one adapter, one month, N candidates
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 2/4/11 — the period is frozen for the whole run', () => {
  it('a month published mid-run does NOT move the run', async () => {
    const db = world({ periods: ['2026-07', '2026-08'] });

    // The instant the run starts reading CANDIDATES, 2026-09 goes live.
    let published = false;
    db.beforeSelect = (recorded) => {
      if (recorded.table === 'prospect_candidates' && !published) {
        published = true;
        db.tables[BR_RECEITA_SNAPSHOT_RUNS_TABLE]?.push(runRow('2026-09', RUN_SEP));
        db.tables[BR_RECEITA_SNAPSHOT_TABLE]?.push(
          snapshotRow('2026-09', RUN_SEP, CNPJ_A, 'Synthetic Tecnologia 2026-09'),
          snapshotRow('2026-09', RUN_SEP, CNPJ_B, 'Synthetic Educacao 2026-09'),
        );
      }
    };

    const periodsSeenByAdapter: string[] = [];
    const result = await enrichBrBatchWithValidatedSources(
      asSupabase(db),
      'batch-1',
      {},
      {
        createAdapter: (config) => {
          periodsSeenByAdapter.push(String(config.sourcePeriod));
          return createBrReceitaCnpjEnrichmentAdapter(config);
        },
      },
    );

    assert.equal(published, true, 'the new month really was published mid-run');
    assert.equal(result.frozenPeriod.sourcePeriod, '2026-08');
    assert.equal(result.periodResolutionCount, 1);
    assert.equal(result.adapterConstructionCount, 1);
    assert.deepEqual(periodsSeenByAdapter, ['2026-08']);

    // And the SNAPSHOT reads all carried 2026-08 — not one of them slipped to 2026-09.
    const snapshotPeriods = db.selects
      .filter((s) => s.table === BR_RECEITA_SNAPSHOT_TABLE)
      .map((s) => s.filters.find((f) => f.column === 'source_period')?.value);
    assert.ok(snapshotPeriods.length >= 2);
    assert.deepEqual([...new Set(snapshotPeriods)], ['2026-08']);
  });

  it('resolves the period exactly ONCE for N candidates (never per candidate)', async () => {
    const db = world({
      candidates: [
        candidateRow('c1', 'Alpha BR', CNPJ_A),
        candidateRow('c2', 'Beta BR', CNPJ_B),
        candidateRow('c3', 'Gamma BR', CNPJ_C),
      ],
    });

    let resolutions = 0;
    const result = await enrichBrBatchWithValidatedSources(
      asSupabase(db),
      'batch-1',
      {},
      {
        pinPublication: async (args) => {
          resolutions++;
          return pinBrReceitaPublication(args);
        },
      },
    );

    assert.equal(resolutions, 1, 'one resolution for the whole run');
    assert.equal(result.periodResolutionCount, 1);
    // Three candidates were genuinely walked.
    assert.equal(result.matchedCount + result.noMatchCount + result.skippedCount, 3);
  });

  it('the adapter receives the SAME sourcePeriod for every candidate', async () => {
    const db = world({
      candidates: [
        candidateRow('c1', 'Alpha BR', CNPJ_A),
        candidateRow('c2', 'Beta BR', CNPJ_B),
        candidateRow('c3', 'Gamma BR', CNPJ_C),
      ],
    });

    const boundPeriods: Array<string | undefined> = [];
    const seenByCandidate: string[] = [];

    await enrichBrBatchWithValidatedSources(
      asSupabase(db),
      'batch-1',
      {},
      {
        createAdapter: (config) => {
          boundPeriods.push(config.sourcePeriod);
          const real = createBrReceitaCnpjEnrichmentAdapter(config);
          return {
            ...real,
            enrichCandidate: async (input: SourceEnrichmentInput) => {
              seenByCandidate.push(String(config.sourcePeriod));
              return real.enrichCandidate(input);
            },
          } satisfies SourceEnrichmentAdapter;
        },
      },
    );

    assert.equal(boundPeriods.length, 1, 'exactly one adapter constructed');
    assert.equal(seenByCandidate.length, 3);
    assert.deepEqual([...new Set(seenByCandidate)], ['2026-08']);
  });

  it('the hook never resolves the period from inside the candidate loop', () => {
    const src = fs.readFileSync(
      join(repoRoot, 'src/server/source-catalog/enrichment/enrich-br-batch-with-validated-sources.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const resolveAt = code.indexOf('await pinPublication(');
    const candidatesAt = code.indexOf("from('prospect_candidates')");
    // BR-SOURCE-FUNCTIONAL-CUT-C renamed the first-pass result; the property is unchanged.
    const loopAt = code.indexOf('for (const r of firstPass.results)');
    // CUT C's identity resolution is also per-candidate, so it is held to the same rule.
    const resolveIdentityAt = code.indexOf('await resolveIdentity(');
    assert.ok(resolveAt > 0 && candidatesAt > 0 && loopAt > 0 && resolveIdentityAt > 0);
    assert.ok(resolveAt < candidatesAt, 'the period is chosen BEFORE candidates are read');
    assert.ok(resolveAt < loopAt, 'the period is chosen BEFORE the candidate loop');
    assert.ok(
      resolveAt < resolveIdentityAt,
      'the period is chosen BEFORE any candidate identity is resolved',
    );
    assert.equal(
      code.split('await pinPublication(').length - 1,
      1,
      'exactly one call site for the resolver',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 3 — nothing published ⇒ nothing read, nothing written
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 3 — fail closed when no period is published', () => {
  it('aborts without reading a single candidate', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [runRow('2026-08', RUN_AUG, 'preparing')],
      prospect_batches: [{ id: 'batch-1', metadata: {} }],
      prospect_candidates: [candidateRow('c1', 'Alpha BR', CNPJ_A)],
    });

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.aborted, true);
    assert.equal(result.frozenPeriod.status, 'NO_PUBLISHED_PUBLICATION');
    assert.equal(result.frozenPeriod.sourcePeriod, null);
    assert.equal(result.adapterConstructionCount, 0);
    assert.equal(result.candidatesProcessed, 0);
    assert.equal(result.updatedCount, 0);

    assert.equal(
      db.selects.filter((s) => s.table === 'prospect_candidates').length,
      0,
      'no candidate lookup may happen without a published period',
    );
    assert.equal(db.updates.length, 0, 'nothing is written');
    assert.ok(result.errors.some((e) => e.startsWith('br_no_published_period')));
  });

  it('records fail-closed as a contract property', () => {
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.failsClosedWithoutPublishedPeriod, true);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.readsCandidatesBeforeResolvingPeriod, false);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.periodResolvedInsideCandidateLoop, false);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.authorsMigration, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 5/6/7 — metadata survives the generic builder and the persisted shape
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 5/6/7 — metadata provenance propagation', () => {
  it('the generic builder preserves output.metadata (it used to drop it)', async () => {
    const db = world();
    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: '2026-08',
      getClient: () => db.client,
    });

    const enriched = await enrichCandidatesWithValidatedSources({
      candidates: [{ name: 'Alpha BR', taxId: CNPJ_A, countryCode: 'BR' }],
      countryCode: 'BR',
      stage: 'post_discovery_enrichment',
      adapterOverrides: { [BR_RECEITA_CNPJ_SOURCE_KEY]: adapter },
    });

    const block = enriched.results[0]?.enrichmentMetadata[BR_RECEITA_CNPJ_SOURCE_KEY] as Record<
      string,
      unknown
    >;
    assert.ok(block, 'the BR source produced a persistable block');
    assert.equal(block['status'], 'matched');

    const meta = block['metadata'] as Record<string, unknown>;
    assert.ok(meta, 'metadata survived the builder');
    assert.equal(meta['source_period'], '2026-08');
    assert.equal(meta['snapshot_run_id'], RUN_AUG);
    assert.equal(meta['human_review_required'], true);
    assert.equal(meta['source_type'], 'official_registry');
    assert.equal(typeof meta['legal_name'], 'string');
  });

  it('provenance is NOT smuggled into signals', async () => {
    const db = world();
    const adapter = createBrReceitaCnpjEnrichmentAdapter({
      sourcePeriod: '2026-08',
      getClient: () => db.client,
    });
    const output = await adapter.enrichCandidate({
      candidateName: 'Alpha BR',
      candidateTaxId: CNPJ_A,
      countryCode: 'BR',
      capability: 'enrichment_after_discovery',
    });

    const signalKeys = Object.keys(output.signals ?? {});
    for (const forbidden of ['source_period', 'snapshot_run_id', 'legal_name', 'source_type']) {
      assert.ok(
        !signalKeys.includes(forbidden),
        `${forbidden} is provenance and must not live in signals`,
      );
    }
  });

  it('source_period and snapshot_run_id survive into the persisted candidate shape', async () => {
    const db = world();
    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.frozenPeriod.sourcePeriod, '2026-08');
    assert.equal(result.matchedCount, 2);

    const candidateUpdates = db.updates.filter((u) => u.table === 'prospect_candidates');
    assert.equal(candidateUpdates.length, 2);

    for (const update of candidateUpdates) {
      const meta = update.payload['metadata'] as Record<string, unknown>;
      const se = meta['source_enrichment'] as Record<string, unknown>;
      const block = se[BR_RECEITA_CNPJ_SOURCE_KEY] as Record<string, unknown>;
      const provenance = block['metadata'] as Record<string, unknown>;

      assert.equal(provenance['source_period'], '2026-08'); // CASE 6
      assert.equal(provenance['snapshot_run_id'], RUN_AUG); // CASE 7

      const summary = se['_summary'] as Record<string, unknown>;
      assert.equal(summary['source_period'], '2026-08');
      assert.equal(summary['country_code'], 'BR');
    }
  });

  it('the frozen month is recorded as batch-level execution provenance, reusing metadata', async () => {
    const db = world();
    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.runProvenancePersisted, true);
    const batchUpdate = db.updates.find((u) => u.table === 'prospect_batches');
    assert.ok(batchUpdate, 'the run provenance was written');

    const meta = batchUpdate.payload['metadata'] as Record<string, unknown>;
    // Pre-existing keys survive the merge.
    assert.equal(meta['agent_key'], 'prospect_generation');
    const context = meta[BR_RUN_SOURCE_CONTEXT_KEY] as Record<string, unknown>;
    // 🔴 CUT B2, owner decision § 7: the batch's provenance now carries the pinned PUBLICATION —
    // month AND run id — because a republished month has two publications and the month alone can
    // no longer say which one this batch read. The run id is a version identifier, never identity.
    assert.deepEqual(context[BR_RECEITA_CNPJ_SOURCE_KEY], {
      source_period: '2026-08',
      snapshot_run_id: RUN_AUG,
    });
    assert.equal(
      BR_AGENT1_RUNTIME_BINDING_CONTRACT.runProvenanceHome,
      'prospect_batches.metadata.source_context',
    );
  });

  it('authors no migration for its provenance home', () => {
    const migrations = fs.readdirSync(join(repoRoot, 'supabase', 'migrations'));
    assert.ok(!migrations.some((f) => /cut[-_]?b1|frozen[-_]?period/i.test(f)));
    assert.ok(!migrations.some((f) => /^(129|130)_/.test(f)));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 8 — the CNPJ never comes back out
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 8 — no CNPJ in output, provenance, log or error', () => {
  it('no synthetic CNPJ appears anywhere in the run result or the persisted payloads', async () => {
    const db = world({
      candidates: [
        candidateRow('c1', 'Alpha BR', CNPJ_A),
        candidateRow('c2', 'Beta BR', CNPJ_B),
        candidateRow('c3', 'Gamma BR', CNPJ_C), // absent from the published run
      ],
    });

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    const haystacks = [
      JSON.stringify(result),
      JSON.stringify(db.updates.map((u) => u.payload)),
    ];

    for (const cnpj of [CNPJ_A, CNPJ_B, CNPJ_C]) {
      for (const haystack of haystacks) {
        assert.ok(!haystack.includes(cnpj), 'a full CNPJ leaked');
        assert.ok(!haystack.includes(digitsOf(cnpj)), 'a normalized CNPJ leaked');
      }
    }
  });

  it('a driver failure is reported by class, never by message', async () => {
    const db = world();
    db.failWith = { code: '42501' };
    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.aborted, true);
    assert.deepEqual(result.errors, ['br_period_resolution_failed:BrReceitaPinnedPublicationQueryError']);
    for (const err of result.errors) {
      assert.ok(!err.includes(CNPJ_A));
      assert.ok(!/select|filter|detail|Key \(/i.test(err));
    }
  });

  it('the hook logs the month and nothing identity-bearing', () => {
    const src = fs.readFileSync(join(repoRoot, 'src/server/agents/prospect-generation.ts'), 'utf8');
    const start = src.indexOf("if (countryCode === 'BR')");
    assert.ok(start > 0, 'the BR hook call site exists');
    // Bound the window to the BR branch itself — its own catch is the last thing inside it.
    const end = src.indexOf("BR Receita enrichment failed", start);
    assert.ok(end > start, 'the BR branch closes with its own non-blocking catch');
    // 🔴 Comments are STRIPPED first. The block NAMES the fields it refuses to log, and a raw
    // grep would confuse "naming it" with "logging it" — the guard has to read the code.
    const block = src
      .slice(start, end + 120)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(block.includes('frozenSourcePeriod'), 'the month is logged — it is log-safe');
    // Identity-BEARING expressions only. `missingCnpj` is a COUNT of candidates that had none —
    // a number, not an identifier — so a bare "cnpj" token would be the wrong thing to forbid.
    for (const forbidden of [
      'legal_name',
      'tax_identifier',
      'normalized_tax_id',
      'candidatetaxid',
      'raw_data',
      'snapshot_run_id',
    ]) {
      assert.ok(!block.toLowerCase().includes(forbidden), `${forbidden} must not be logged`);
    }
    // Prove the guard in the negative: it really does catch a forbidden field in CODE.
    assert.ok(
      `${block}\n          legalName: candidate.legal_name,`.toLowerCase().includes('legal_name'),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 9 — a candidate with no CNPJ stays fail-closed
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 9 — exact CNPJ is still required', () => {
  it('a candidate without a CNPJ is skipped/missing_cnpj and counted, never name-matched', async () => {
    const db = world({
      candidates: [
        candidateRow('c1', 'Alpha BR', CNPJ_A),
        candidateRow('c2', 'Synthetic Tecnologia 2026-08', null), // name IS in the snapshot
      ],
    });

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.matchedCount, 1);
    assert.equal(result.missingCnpjCount, 1, 'measured separately for the NEXT cut');
    assert.equal(result.skippedCount, 1);

    const skipped = db.updates
      .filter((u) => u.table === 'prospect_candidates')
      .map((u) => {
        const se = (u.payload['metadata'] as Record<string, unknown>)[
          'source_enrichment'
        ] as Record<string, unknown>;
        return se[BR_RECEITA_CNPJ_SOURCE_KEY] as Record<string, unknown>;
      })
      .find((b) => b['status'] === 'skipped');

    assert.ok(skipped);
    assert.equal(skipped['reason'], 'missing_cnpj');
    assert.equal(skipped['matched_by'], null);
    assert.equal(skipped['confidence'], 0);
  });

  it('the Receita LOOKUP is still exact-CNPJ only — CUT C only changed where the CNPJ comes from', () => {
    // 🔴 This assertion USED to read `resolvesIdentityByName === false`, and updating it is the
    // point rather than an inconvenience: BR-SOURCE-FUNCTIONAL-CUT-C adds exactly the name
    // resolution B1 deferred, so a guard still pinning `false` would be defending the defect it
    // was written to describe. What must NOT change is the property underneath it — the snapshot
    // is read by establishment identity, and a name never becomes a match the exact reader did
    // not make. That is `requiresExactCnpj`, and it is still true.
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.requiresExactCnpj, true);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.resolvesIdentityByName, true);
    assert.equal(
      BR_AGENT1_RUNTIME_BINDING_CONTRACT.resolvesIdentityByNameOnlyWhenCnpjMissing,
      true,
    );
    assert.equal(
      BR_AGENT1_RUNTIME_BINDING_CONTRACT.reusesExactCnpjAdapterForResolvedIdentity,
      true,
    );
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.duplicatesEnrichmentProjection, false);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.ambiguousNameFailsClosed, true);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.noMatchFailsClosed, true);

    const src = fs.readFileSync(
      join(repoRoot, 'src/server/source-catalog/enrichment/enrich-br-batch-with-validated-sources.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // The resolution is GATED on the adapter's own `missing_cnpj`, in the source, so a future
    // edit that let it run for a candidate the exact path served would fail here.
    assert.ok(
      /reason !== 'missing_cnpj'\) continue;/.test(code),
      'identity resolution must be gated on the adapter reporting missing_cnpj',
    );
    // …and the enrichment still goes out as a tax id, never as a name match.
    assert.ok(
      !/matchedBy:\s*'(exact_name|normalized_name)'/.test(code),
      'the hook must never emit a name-based match',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 10 — every other validated source is unchanged
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 10 — non-BR validated sources unchanged', () => {
  /** A stub that emits NO metadata — i.e. every source that is not Brazil. */
  function stubAdapter(sourceKey: string, calls: SourceEnrichmentInput[]): SourceEnrichmentAdapter {
    return {
      sourceKey,
      supportedCapabilities: ['enrichment_after_discovery'],
      async enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> {
        calls.push(input);
        return {
          sourceKey,
          status: 'matched',
          matchedBy: 'tax_id',
          confidence: 1,
          sourceYear: 2025,
          priorityBoost: 0,
          signals: { some_signal: 'x' },
        };
      },
    };
  }

  it('a source that emits no metadata gets `{}` — the same default signals/financials already had', async () => {
    const calls: SourceEnrichmentInput[] = [];
    const enriched = await enrichCandidatesWithValidatedSources({
      candidates: [{ name: 'Alpha CO', taxId: '900123456', countryCode: 'CO' }],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
      adapterOverrides: { co_siis: stubAdapter('co_siis', calls) },
    });

    const block = enriched.results[0]?.enrichmentMetadata['co_siis'] as Record<string, unknown>;
    assert.ok(block);
    assert.deepEqual(block['metadata'], {});
    assert.deepEqual(block['signals'], { some_signal: 'x' });
    assert.deepEqual(block['financials'], {});
    assert.equal(block['status'], 'matched');
    assert.equal(block['source_year'], 2025);
    assert.equal(block['priority_boost'], 0);
    assert.equal(block['reason'], null);
  });

  it('the persistable block shape is identical apart from the new metadata key', async () => {
    const calls: SourceEnrichmentInput[] = [];
    const enriched = await enrichCandidatesWithValidatedSources({
      candidates: [{ name: 'Alpha CO', taxId: '900123456', countryCode: 'CO' }],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
      adapterOverrides: { co_siis: stubAdapter('co_siis', calls) },
    });

    const block = enriched.results[0]?.enrichmentMetadata['co_siis'] as Record<string, unknown>;
    assert.deepEqual(Object.keys(block).sort(), [
      'confidence',
      'financials',
      'matched_by',
      'metadata',
      'priority_boost',
      'reason',
      'signals',
      'source_year',
      'status',
    ]);
  });

  it('an override can substitute an applicable source but NEVER add one', async () => {
    const calls: SourceEnrichmentInput[] = [];
    // `br_receita_cnpj_dados_abertos` is a BR source; offering it on a CO run must be inert.
    const enriched = await enrichCandidatesWithValidatedSources({
      candidates: [{ name: 'Alpha CO', taxId: '900123456', countryCode: 'CO' }],
      countryCode: 'CO',
      stage: 'post_discovery_enrichment',
      adapterOverrides: {
        [BR_RECEITA_CNPJ_SOURCE_KEY]: stubAdapter(BR_RECEITA_CNPJ_SOURCE_KEY, calls),
      },
    });

    assert.equal(calls.length, 0, 'an override may not make a non-applicable source run');
    assert.ok(
      !Object.keys(enriched.results[0]?.enrichmentMetadata ?? {}).includes(
        BR_RECEITA_CNPJ_SOURCE_KEY,
      ),
    );
  });

  it('BR without an override still fail-closes on the unbound registry adapter', async () => {
    const output = await brReceitaCnpjEnrichmentAdapter.enrichCandidate({
      candidateName: 'Alpha BR',
      candidateTaxId: CNPJ_A,
      countryCode: 'BR',
      capability: 'enrichment_after_discovery',
    });
    assert.equal(output.status, 'skipped');
    assert.equal(output.reason, 'br_snapshot_period_not_configured');
  });

  it('a non-BR candidate inside a BR batch is left completely untouched', async () => {
    const db = world({
      candidates: [
        candidateRow('c1', 'Alpha BR', CNPJ_A),
        candidateRow('c9', 'Alpha CO', '900123456', 'CO'),
      ],
    });

    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1');

    assert.equal(result.nonBrSkippedCount, 1);
    const touchedIds = db.updates
      .filter((u) => u.table === 'prospect_candidates')
      .flatMap((u) => u.filters.filter((f) => f.column === 'id').map((f) => f.value));
    assert.deepEqual(touchedIds, ['c1']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CASE 12 — the real Agent 1 call path reaches the bound adapter
// ════════════════════════════════════════════════════════════════════════════

describe('CUT B1 · CASE 12 — Agent 1 runtime reachability', () => {
  it('prospect-generation invokes the BR hook under countryCode === "BR"', () => {
    const src = fs.readFileSync(join(repoRoot, 'src/server/agents/prospect-generation.ts'), 'utf8');
    assert.ok(
      src.includes("import { enrichBrBatchWithValidatedSources } from '@/server/source-catalog/enrichment/enrich-br-batch-with-validated-sources'"),
      'the hook is imported by the real Agent 1 module',
    );
    const guard = src.indexOf("if (countryCode === 'BR')");
    assert.ok(guard > 0, 'a BR branch exists');
    const call = src.indexOf('enrichBrBatchWithValidatedSources(admin, batch.id)');
    assert.ok(call > guard, 'the call is inside the BR branch');
    // The BR branch must never be entered for another country.
    assert.equal(src.split("if (countryCode === 'BR')").length - 1, 1);
  });

  it('registering the source was never enough on its own — the binding is what reaches it', () => {
    // The registry entry is unbound BY DESIGN; CASE 10 proves it answers `skipped`. The reachable
    // path is therefore the hook, and the hook is the only place a period is bound.
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.adapterBoundOncePerRun, true);
    assert.equal(BR_AGENT1_RUNTIME_BINDING_CONTRACT.appliesToSourceKey, BR_RECEITA_CNPJ_SOURCE_KEY);
  });

  it('a synthetic BR batch reaches the bound adapter end-to-end and enriches', async () => {
    const db = world();
    let reachedAdapter = 0;

    const result = await enrichBrBatchWithValidatedSources(
      asSupabase(db),
      'batch-1',
      {},
      {
        createAdapter: (config) => {
          const real = createBrReceitaCnpjEnrichmentAdapter(config);
          return {
            ...real,
            enrichCandidate: async (input: SourceEnrichmentInput) => {
              reachedAdapter++;
              return real.enrichCandidate(input);
            },
          } satisfies SourceEnrichmentAdapter;
        },
      },
    );

    assert.equal(reachedAdapter, 2, 'both BR candidates reached the bound adapter');
    assert.equal(result.matchedCount, 2);
    assert.deepEqual(result.sourcesApplied, [BR_RECEITA_CNPJ_SOURCE_KEY]);
    assert.equal(result.frozenPeriod.sourcePeriod, '2026-08');
  });

  it('dry-run computes everything and writes nothing', async () => {
    const db = world();
    const result = await enrichBrBatchWithValidatedSources(asSupabase(db), 'batch-1', {
      dryRun: true,
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.matchedCount, 2);
    assert.equal(result.updatedCount, 0);
    assert.equal(result.runProvenancePersisted, false);
    assert.equal(db.updates.length, 0);
  });

  it('no provider, credit, HubSpot, flag or migration surface is touched by the hook', () => {
    const src = fs.readFileSync(
      join(repoRoot, 'src/server/source-catalog/enrichment/enrich-br-batch-with-validated-sources.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'apollo',
      'lusha',
      'hubspot',
      'credit',
      'process.env',
      'fetch(',
      '.rpc(',
      '.insert(',
      '.delete(',
    ]) {
      assert.ok(!code.toLowerCase().includes(forbidden.toLowerCase()), `${forbidden} must not appear`);
    }
  });
});
