/**
 * BR-SOURCE-FUNCTIONAL-CUT-C — candidate → Receita identity resolution.
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS FOR
 * ═══════════════════════════════════════════════════════════════════
 *
 * CUT B2 pinned a publication and enriched every candidate that already had a CNPJ. For Brazil
 * that was, in practice, none of them: Apollo returns a company name. This cut adds the fallback —
 * exact canonical name, inside the run's OWN pinned publication, with a closed result set — and
 * these are its properties:
 *
 *   CASE 1   a candidate WITH a CNPJ is never name-resolved; the exact path is untouched
 *   CASE 2   no CNPJ + exact name + one row  → RESOLVED_UNIQUE, and the exact adapter is what enriches
 *   CASE 3   no CNPJ + zero rows            → NO_MATCH, and no exact lookup happens
 *   CASE 4   two establishments, same name   → AMBIGUOUS, and NO CNPJ is selected
 *   CASE 5   two establishments, city picks one → RESOLVED_UNIQUE
 *   CASE 6   two establishments in the SAME city → AMBIGUOUS
 *   CASE 7   the name exists only in ANOTHER run of the same month → NO_MATCH
 *   CASE 8   the name exists only in ANOTHER period → NO_MATCH
 *   CASE 11  the writer persists `normalized_legal_name`, deterministically
 *   CASE 12  writer value == resolver filter value, for the same input
 *   CASE 13  a blank / punctuation-only name → INVALID_INPUT with ZERO queries
 *   CASE 14  an AMBIGUOUS result leaks no CNPJ, anywhere on its shape
 *   CASE 15  no result, reason or batch summary contains a CNPJ
 *   CASE 16  candidate-city normalization is deterministic and symmetric
 *   CASE 17  non-BR candidates are untouched
 *   CASE 18  the CUT B2 exact-CNPJ path is byte-for-byte unchanged
 *   CASE 19  a name query cannot manufacture a run id — the pin is the only channel
 *   CASE 20  the query window is bounded, and overflow is REPORTED, not truncated
 *
 * CASES 9 and 10 (same-month republication isolation, and the next run pinning B) are decided by
 * PostgreSQL's partial unique indexes, so they live in the companion `-postgres` suite together
 * with a real-schema re-proof of 2, 4, 7, 11 and 12.
 *
 * 🔴 NO PROD. NO apply_migration. NO real Receita. NO providers. NO credits. NO HubSpot. NO flags.
 * NO migration is authored by this cut. Every CNPJ is synthetic and DV-valid by construction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

import {
  resolveBrReceitaCandidateIdentity,
  BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT,
  BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT,
  BR_RECEITA_NAME_RESOLUTION_SELECT_COLUMNS,
  BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN,
  type BrReceitaCandidateIdentityResolution,
} from '../br-receita-cnpj-candidate-identity-resolver';
import {
  normalizeBrCompanyLegalName,
  normalizeBrMunicipalityName,
  BR_RECEITA_NAME_NORMALIZATION_CONTRACT,
  MIN_CANONICAL_NAME_LENGTH,
} from '../br-receita-cnpj-name-normalization';
import {
  pinBrReceitaPublication,
  BrReceitaPinnedPublication,
  type BrReceitaPinnedPublication as Pin,
} from '../br-receita-cnpj-pinned-publication';
import {
  BR_RECEITA_ENRICHMENT_PIN_CONTRACT,
} from '../br-receita-cnpj-enrichment-adapter';
import {
  enrichBrBatchWithValidatedSources,
  BR_AGENT1_RUNTIME_BINDING_CONTRACT,
  BR_CANDIDATE_SELECT_COLUMNS,
} from '../../../enrichment/enrich-br-batch-with-validated-sources';
import {
  BR_RECEITA_PERSISTABLE_COLUMNS,
  buildUpsertBatchStatement,
  BR_RECEITA_SNAPSHOT_RUNS_TABLE,
} from '../br-receita-cnpj-monthly-snapshot-write-gateway';
import {
  BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
  BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
  BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
  type UpsertBatchOperation,
} from '../br-receita-cnpj-monthly-snapshot-write-plan';
import { BR_RECEITA_SNAPSHOT_TABLE } from '../br-receita-cnpj-monthly-snapshot-identity';
import {
  BR_RECEITA_CNPJ_COUNTRY_CODE,
  BR_RECEITA_CNPJ_SOURCE_KEY,
} from '../br-receita-cnpj-types';
import { sampleFullCnpj, RAIZ_TECNOLOGIA, RAIZ_EDUCACAO } from '../br-receita-cnpj-fixtures';
import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
} from '../../../snapshot-read/snapshot-read-contract';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Synthetic material ─────────────────────────────────────────────────────

const PERIOD = '2026-07';
const OTHER_PERIOD = '2026-06';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const RUN_OTHER_PERIOD = '33333333-3333-4333-8333-333333333333';
const BATCH_ID = '44444444-4444-4444-8444-444444444444';

const CNPJ_MATRIZ = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
const CNPJ_FILIAL = sampleFullCnpj(RAIZ_TECNOLOGIA, '0002');
const CNPJ_OTHER = sampleFullCnpj(RAIZ_EDUCACAO, '0001');

const LEGAL_NAME = 'Synthetic Tecnologia Ltda';
const CANONICAL_NAME = 'SYNTHETIC TECNOLOGIA LTDA';

/**
 * A snapshot row as the COMPACT table holds it: typed columns, no jsonb.
 *
 * 🔴 `municipality_name` is a COLUMN now, which is why the resolver's probe projects two columns
 * instead of pulling the whole payload of up to 26 establishments to read one string out of each.
 */
function snapshotRow(options: {
  normalizedTaxId: string;
  period?: string;
  runId?: string;
  canonicalName?: string;
  municipality?: string | null;
}): Record<string, unknown> {
  return {
    source_period: options.period ?? PERIOD,
    snapshot_run_id: options.runId ?? RUN_A,
    normalized_tax_id: options.normalizedTaxId,
    legal_name: LEGAL_NAME,
    normalized_legal_name: options.canonicalName ?? CANONICAL_NAME,
    municipality_name:
      options.municipality === undefined ? 'Synthetic City' : options.municipality,
    municipality_code: '7107',
    uf: 'SP',
    registration_status_code: '02',
    registration_status_label: 'ATIVA',
    cnae_main_code: '6201501',
    cnae_main_label: 'Desenvolvimento de programas',
    cnae_secondary_codes: null,
    company_size_code: '03',
    capital_social_value: '100000.00',
    start_date: '2015-03-10',
    matrix_branch_flag: '1',
  };
}

function publishedRun(runId: string, period: string): Record<string, unknown> {
  return {
    id: runId,
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: period,
    publish_state: 'published',
  };
}

function supersededRun(runId: string, period: string): Record<string, unknown> {
  return { ...publishedRun(runId, period), publish_state: 'superseded' };
}

function candidate(options: {
  id: string;
  name?: string;
  legalName?: string | null;
  city?: string | null;
  taxIdentifier?: string | null;
  countryCode?: string;
}): Record<string, unknown> {
  return {
    id: options.id,
    batch_id: BATCH_ID,
    name: options.name ?? LEGAL_NAME,
    legal_name: options.legalName ?? null,
    country_code: options.countryCode ?? BR_RECEITA_CNPJ_COUNTRY_CODE,
    city: options.city ?? null,
    tax_identifier: options.taxIdentifier ?? null,
    sector_description: null,
    metadata: {},
  };
}

// ─── The fake database ──────────────────────────────────────────────────────

interface RecordedSelect {
  table: string;
  columns?: string;
  filters: Array<{ column: string; value: unknown }>;
  /** `.in(column, values)` — PostgREST's set filter, used by the batch-identity seed read. */
  setFilters: Array<{ column: string; values: readonly unknown[] }>;
  limit: number | null;
}

interface FakeDb {
  client: SnapshotReadClient<SnapshotIdentityRow>;
  supabase: SupabaseClient;
  tables: Record<string, Array<Record<string, unknown>>>;
  selects: RecordedSelect[];
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
  failSnapshotSelect?: { code: string };
  /**
   * Every `.rpc()` this double was asked for.
   *
   * 🔴 CUT D added `rpc` to this double, and the DEFAULT answer is `PGRST202` — which is what the
   * real database says today, because neither migration 126 nor CUT D's own migration is applied.
   * That is not a convenience: `batch-identity-registry-store` documents that a client WITHOUT an
   * `rpc` method is not proof of anything about the schema and must degrade CLOSED, so modelling
   * "the migration is not applied" by omitting the method would model a DIFFERENT state — an
   * unsupported client — and CUT D would fail closed instead of preserving CUT C.
   */
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  /** Override to model a database where the fenced functions DO exist. */
  rpcHandler?: (
    fn: string,
    args: Record<string, unknown>,
  ) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
}

/** What PostgREST answers for a function its schema cache does not have. */
const PGRST202 = {
  code: 'PGRST202',
  message: 'Could not find the function in the schema cache',
} as const;

function fakeDb(tables: Record<string, Array<Record<string, unknown>>>): FakeDb {
  const db: FakeDb = {
    tables,
    selects: [],
    updates: [],
    rpcCalls: [],
    client: null as unknown as SnapshotReadClient<SnapshotIdentityRow>,
    supabase: null as unknown as SupabaseClient,
  };

  db.client = {
    from(table: string) {
      return {
        select(columns?: string) {
          const recorded: RecordedSelect = {
            table,
            columns,
            filters: [],
            setFilters: [],
            limit: null,
          };
          const evaluate = (): Array<Record<string, unknown>> => {
            db.selects.push(recorded);
            const source = db.tables[table] ?? [];
            const matched = source.filter(
              (row) =>
                recorded.filters.every((f) => row[f.column] === f.value) &&
                recorded.setFilters.every((f) => f.values.includes(row[f.column])),
            );
            return recorded.limit === null ? matched : matched.slice(0, recorded.limit);
          };
          const query = {
            eq(column: string, value: unknown) {
              recorded.filters.push({ column, value });
              return query;
            },
            in(column: string, values: readonly unknown[]) {
              recorded.setFilters.push({ column, values });
              return query;
            },
            // Deliberate NO-OP: the pin must compute the greatest period IN CODE.
            order() {
              return query;
            },
            limit(count: number) {
              recorded.limit = count;
              return query;
            },
            async maybeSingle() {
              const rows = evaluate();
              return { data: rows[0] ?? null, error: null };
            },
            then(onfulfilled?: (value: unknown) => unknown) {
              if (db.failSnapshotSelect && table === BR_RECEITA_SNAPSHOT_TABLE) {
                db.selects.push(recorded);
                return Promise.resolve({ data: null, error: db.failSnapshotSelect }).then(
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
          const query = {
            eq() {
              return query;
            },
            then(onfulfilled?: (value: unknown) => unknown) {
              db.updates.push({ table, payload });
              return Promise.resolve({ data: null, error: null }).then(onfulfilled as never);
            },
          };
          return query as never;
        },
      };
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      db.rpcCalls.push({ fn, args });
      if (db.rpcHandler) return db.rpcHandler(fn, args);
      return { data: null, error: PGRST202 };
    },
  } as unknown as SnapshotReadClient<SnapshotIdentityRow>;

  db.supabase = db.client as unknown as SupabaseClient;
  return db;
}

/** Mints a REAL pin by resolving a published publication, exactly as a run does. */
async function mintPin(db: FakeDb): Promise<Pin> {
  const pinned = await pinBrReceitaPublication({ client: db.client });
  assert.equal(pinned.status, 'PINNED', pinned.reason);
  assert.ok(pinned.publication !== null);
  return pinned.publication as Pin;
}

function snapshotSelects(db: FakeDb): RecordedSelect[] {
  return db.selects.filter((s) => s.table === BR_RECEITA_SNAPSHOT_TABLE);
}

/** Every string that appears anywhere in a value, however deeply nested. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (typeof value === 'object' && value !== null) {
    Object.values(value as Record<string, unknown>).forEach((v) => allStrings(v, out));
  }
  return out;
}

function assertCarriesNoCnpj(value: unknown, cnpjs: readonly string[], where: string): void {
  for (const text of allStrings(value)) {
    for (const cnpj of cnpjs) {
      assert.ok(!text.includes(cnpj), `${where} leaked a CNPJ in ${JSON.stringify(text)}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT C — the canonical name normalizer (CASE 12, CASE 13, CASE 16)', () => {
  it('is deterministic, case/accent/whitespace/punctuation-insensitive', () => {
    const expected = 'CONSTRUCOES SAO JOAO LTDA';
    for (const variant of [
      'CONSTRUÇÕES SÃO JOÃO LTDA',
      'construções são joão ltda',
      '  Construções   São   João   Ltda  ',
      'CONSTRUCOES SAO JOAO LTDA',
    ]) {
      const first = normalizeBrCompanyLegalName(variant);
      const second = normalizeBrCompanyLegalName(variant);
      assert.equal(first.status, 'valid');
      assert.equal(first.normalized, expected);
      // Determinism is asserted, not assumed: the same input twice is the same output.
      assert.deepEqual(first, second);
    }
  });

  it('separates on punctuation instead of deleting it', () => {
    // 🔴 The choice that makes "M.DIAS BRANCO" and "M DIAS BRANCO" the same company. Deleting
    // would produce "MDIAS BRANCO", a token that appears in neither source.
    assert.equal(
      normalizeBrCompanyLegalName('M.DIAS BRANCO S.A.').normalized,
      'M DIAS BRANCO S A',
    );
    assert.equal(
      normalizeBrCompanyLegalName('M DIAS BRANCO S A').normalized,
      'M DIAS BRANCO S A',
    );
  });

  it('does NOT strip legal suffixes — LTDA and S/A are different legal persons', () => {
    const ltda = normalizeBrCompanyLegalName('ACME LTDA').normalized;
    const sa = normalizeBrCompanyLegalName('ACME S/A').normalized;
    assert.notEqual(ltda, sa);
    assert.equal(BR_RECEITA_NAME_NORMALIZATION_CONTRACT.stripsLegalSuffixes, false);
  });

  it('CASE 13 — refuses blank, whitespace-only, punctuation-only and non-string names', () => {
    assert.equal(normalizeBrCompanyLegalName('').reason, 'blank_after_normalization');
    assert.equal(normalizeBrCompanyLegalName('    ').reason, 'blank_after_normalization');
    assert.equal(normalizeBrCompanyLegalName('---  ...').reason, 'blank_after_normalization');
    assert.equal(normalizeBrCompanyLegalName(null).reason, 'not_a_string');
    assert.equal(normalizeBrCompanyLegalName(undefined).reason, 'not_a_string');
    assert.equal(normalizeBrCompanyLegalName(12345).reason, 'not_a_string');
    assert.equal(normalizeBrCompanyLegalName('X').reason, 'too_short_to_identify');
    // …but a real two-character company survives: the threshold is not a coverage hole.
    assert.equal(MIN_CANONICAL_NAME_LENGTH, 2);
    assert.equal(normalizeBrCompanyLegalName('3M').normalized, '3M');
  });

  it('CASE 16 — candidate-city normalization is deterministic and symmetric', () => {
    const candidateSide = normalizeBrMunicipalityName('são paulo');
    const receitaSide = normalizeBrMunicipalityName('SÃO PAULO');
    assert.equal(candidateSide.status, 'valid');
    assert.equal(candidateSide.normalized, receitaSide.normalized);
    assert.equal(candidateSide.normalized, 'SAO PAULO');
    // A city that cannot be canonicalized is refused, never treated as a wildcard.
    assert.equal(normalizeBrMunicipalityName('   ').status, 'invalid');
    assert.equal(normalizeBrMunicipalityName(null).status, 'invalid');
  });

  it('records a contract with no fuzzy seam anywhere on it', () => {
    const c = BR_RECEITA_NAME_NORMALIZATION_CONTRACT;
    assert.equal(c.usesFuzzyMatching, false);
    assert.equal(c.usesEditDistance, false);
    assert.equal(c.usesTrigramSimilarity, false);
    assert.equal(c.usesPhoneticKeys, false);
    assert.equal(c.usesTokenScoring, false);
    assert.equal(c.usesSubstringMatch, false);
    assert.equal(c.usesLlm, false);
    assert.equal(c.sharedByWriterAndResolver, true);
    assert.equal(c.usesLocaleDependentCaseFolding, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT C — the WRITER persists the canonical name (CASE 11, CASE 12)', () => {
  const identity = {
    source_key: BR_RECEITA_CNPJ_SOURCE_KEY,
    country_code: BR_RECEITA_CNPJ_COUNTRY_CODE,
    source_period: PERIOD,
    source_year: 2026,
    normalized_tax_id: CNPJ_MATRIZ,
  } as const;

  function upsertFor(legalName: string | null): UpsertBatchOperation {
    return {
      kind: 'upsert_batch',
      table: BR_RECEITA_SNAPSHOT_TABLE,
      batchIndex: 0,
      snapshot_run_id: RUN_A,
      rows: [
        {
          identity,
          snapshot_run_id: RUN_A,
          payload: {
            legal_name: legalName,
            signals: {
              source_type: 'official_registry',
              human_review_required: true,
              matrix_branch_flag: '1',
              company_size_code: '03',
              capital_social_value: '100000.00',
              registration_status_code: '02',
              registration_status_label: null,
              cnae_main_code: '6201501',
              cnae_main_label: 'Desenvolvimento de programas',
              cnae_secondary_codes: [],
              municipality_code: '7107',
              municipality_name: 'Synthetic City',
              uf: 'SP',
              start_date: '2015-03-10',
            },
          },
        },
      ],
      conflictColumns: BR_RECEITA_RUN_SCOPED_CONFLICT_COLUMNS,
      conflictIndexPredicate: BR_RECEITA_RUN_SCOPED_CONFLICT_PREDICATE,
      conflictTargetIsPartial: BR_RECEITA_RUN_SCOPED_CONFLICT_IS_PARTIAL,
      collapsedInBatchCount: 0,
    };
  }

  const canonicalIndex = BR_RECEITA_PERSISTABLE_COLUMNS.indexOf(
    'normalized_legal_name' as never,
  );

  it('CASE 11 — the column is on the allowlist and its bind value is the canonical name', () => {
    assert.ok(canonicalIndex >= 0, 'normalized_legal_name must be persistable');
    const { sql, params } = buildUpsertBatchStatement(upsertFor(LEGAL_NAME));

    assert.ok(sql.includes('normalized_legal_name'));
    assert.equal(params[canonicalIndex], CANONICAL_NAME);
    // Deterministic: the same row twice binds the same value.
    assert.equal(buildUpsertBatchStatement(upsertFor(LEGAL_NAME)).params[canonicalIndex], CANONICAL_NAME);
    // Refreshed on conflict, so a republication of the month cannot leave a stale canonical name.
    assert.match(sql, /DO UPDATE SET[\s\S]*normalized_legal_name\s*=\s*EXCLUDED\.normalized_legal_name/);
  });

  it('CASE 11 — an uncanonicalizable name binds NULL, never a placeholder', () => {
    for (const unusable of [null, '', '   ', '---']) {
      const { params } = buildUpsertBatchStatement(upsertFor(unusable as string | null));
      assert.equal(params[canonicalIndex], null);
    }
  });

  it('CASE 11 — the canonical name is DERIVED, so it cannot disagree with legal_name', () => {
    // 🔴 The payload has nowhere to put a canonical name, so a caller that spread a payload and
    // overrode `legal_name` cannot leave a stale canonical form behind. Proven by construction:
    // changing only `legal_name` changes the bound canonical value.
    const a = buildUpsertBatchStatement(upsertFor('Alpha Comercio Ltda')).params[canonicalIndex];
    const b = buildUpsertBatchStatement(upsertFor('Beta Comercio Ltda')).params[canonicalIndex];
    assert.equal(a, 'ALPHA COMERCIO LTDA');
    assert.equal(b, 'BETA COMERCIO LTDA');
  });

  it('CASE 11 — it is NOT a second identity representation', () => {
    const { params } = buildUpsertBatchStatement(upsertFor(LEGAL_NAME));
    assert.ok(!BR_RECEITA_PERSISTABLE_COLUMNS.includes('tax_id' as never));
    assert.ok(!BR_RECEITA_PERSISTABLE_COLUMNS.includes('record_identity_key' as never));
    // The canonical name carries no tax material.
    assert.ok(!String(params[canonicalIndex]).includes(CNPJ_MATRIZ));
  });

  it('CASE 12 — the value the writer binds IS the value the resolver filters on', async () => {
    const { params } = buildUpsertBatchStatement(upsertFor(LEGAL_NAME));
    const written = params[canonicalIndex];

    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [publishedRun(RUN_A, PERIOD)],
      [BR_RECEITA_SNAPSHOT_TABLE]: [],
    });
    const publication = await mintPin(db);
    await resolveBrReceitaCandidateIdentity({
      client: db.client,
      publication,
      // The DISCOVERED spelling, not the persisted one: different case, different accents,
      // different punctuation, different spacing.
      candidateName: '  synthetic   tecnologia,  ltda.  ',
    });

    const filter = snapshotSelects(db)[0].filters.find(
      (f) => f.column === BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN,
    );
    assert.ok(filter, 'the resolver must filter on the canonical name column');
    assert.equal(filter.value, written);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT C — the RESOLVER, closed result set (CASES 2, 3, 4, 5, 6, 7, 8, 13, 14, 20)', () => {
  async function resolve(options: {
    rows: Array<Record<string, unknown>>;
    runs?: Array<Record<string, unknown>>;
    /** Present-but-`undefined` is a real case here, so presence is tested, not nullishness. */
    name?: unknown;
    city?: unknown;
    failSelect?: { code: string };
  }): Promise<{ db: FakeDb; result: BrReceitaCandidateIdentityResolution }> {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: options.runs ?? [publishedRun(RUN_A, PERIOD)],
      [BR_RECEITA_SNAPSHOT_TABLE]: options.rows,
    });
    const publication = await mintPin(db);
    db.failSnapshotSelect = options.failSelect;
    const result = await resolveBrReceitaCandidateIdentity({
      client: db.client,
      publication,
      candidateName: 'name' in options ? options.name : LEGAL_NAME,
      candidateCity: options.city,
    });
    return { db, result };
  }

  it('CASE 2 — exactly one establishment ⇒ RESOLVED_UNIQUE with that identity', async () => {
    const { db, result } = await resolve({
      rows: [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    });
    assert.equal(result.status, 'RESOLVED_UNIQUE');
    assert.equal(result.reason, 'unique_exact_normalized_legal_name');
    assert.equal(result.resolvedNormalizedTaxId, CNPJ_MATRIZ);
    assert.equal(result.observedCount, 1);
    assert.equal(result.disambiguatedByCity, false);
    assert.equal(result.sourcePeriod, PERIOD);
    assert.equal(result.snapshotRunId, RUN_A);

    // Scoped by every column the dedicated table has, and by NOTHING else that could widen it.
    // `source_key` / `country_code` are gone from the predicate because they are gone from the
    // table; the run id is the partition key, so the probe cannot reach another publication.
    const select = snapshotSelects(db)[0];
    const columns = select.filters.map((f) => f.column).sort();
    assert.deepEqual(columns, ['normalized_legal_name', 'snapshot_run_id', 'source_period']);
    assert.equal(select.columns, BR_RECEITA_NAME_RESOLUTION_SELECT_COLUMNS);
  });

  it('CASE 3 — zero establishments ⇒ NO_MATCH, no identity', async () => {
    const { result } = await resolve({ rows: [] });
    assert.equal(result.status, 'NO_MATCH');
    assert.equal(result.reason, 'no_establishment_with_exact_normalized_legal_name');
    assert.equal(result.resolvedNormalizedTaxId, null);
    assert.equal(result.observedCount, 0);
  });

  it('CASE 4 — two establishments sharing the razão social ⇒ AMBIGUOUS, no CNPJ chosen', async () => {
    const { result } = await resolve({
      rows: [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Other City' }),
      ],
    });
    assert.equal(result.status, 'AMBIGUOUS');
    assert.equal(result.reason, 'multiple_name_matches_and_no_usable_candidate_city');
    assert.equal(result.resolvedNormalizedTaxId, null);
    assert.equal(result.observedCount, 2);
    // 🔴 Not the matriz, not the first row, not the lower CNPJ. Nothing at all.
    assert.equal(BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.prefersMatrizByDefault, false);
    assert.equal(BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.takesFirstRow, false);
  });

  it('CASE 5 — the candidate city reduces two establishments to one ⇒ RESOLVED_UNIQUE', async () => {
    const { result } = await resolve({
      rows: [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: 'São Paulo' }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Rio de Janeiro' }),
      ],
      city: 'rio de janeiro',
    });
    assert.equal(result.status, 'RESOLVED_UNIQUE');
    assert.equal(result.reason, 'unique_after_city_disambiguation');
    assert.equal(result.disambiguatedByCity, true);
    assert.equal(result.resolvedNormalizedTaxId, CNPJ_FILIAL);
  });

  it('CASE 6 — two establishments in the SAME municipality stay AMBIGUOUS', async () => {
    const { result } = await resolve({
      rows: [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: 'São Paulo' }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'SAO PAULO' }),
      ],
      city: 'Sao Paulo',
    });
    assert.equal(result.status, 'AMBIGUOUS');
    assert.equal(result.reason, 'multiple_name_matches_in_same_municipality');
    assert.equal(result.resolvedNormalizedTaxId, null);
    assert.equal(result.observedCount, 2);
  });

  it('a city that matches NOTHING is NO_MATCH, never a fall back to the wider set', async () => {
    const { result } = await resolve({
      rows: [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: 'São Paulo' }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Rio de Janeiro' }),
      ],
      city: 'Curitiba',
    });
    assert.equal(result.status, 'NO_MATCH');
    assert.equal(result.reason, 'insufficient_location_match');
    assert.equal(result.resolvedNormalizedTaxId, null);
    assert.equal(
      BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT
        .fallsBackToUnfilteredSetWhenCityMatchesNothing,
      false,
    );
  });

  it('a row with no usable municipality is dropped, never treated as matching every city', async () => {
    const { result } = await resolve({
      rows: [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: null }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Rio de Janeiro' }),
      ],
      city: 'Rio de Janeiro',
    });
    assert.equal(result.status, 'RESOLVED_UNIQUE');
    assert.equal(result.resolvedNormalizedTaxId, CNPJ_FILIAL);
  });

  it('CASE 7 — a name match in ANOTHER run of the same month is NO_MATCH', async () => {
    const { db, result } = await resolve({
      // The pin resolves RUN_B (the published one); the row lives in RUN_A (superseded).
      runs: [supersededRun(RUN_A, PERIOD), publishedRun(RUN_B, PERIOD)],
      rows: [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, runId: RUN_A })],
    });
    assert.equal(result.status, 'NO_MATCH');
    assert.equal(result.snapshotRunId, RUN_B);
    // The query was scoped to the PINNED run; the other run was never read.
    const runFilter = snapshotSelects(db)[0].filters.find((f) => f.column === 'snapshot_run_id');
    assert.equal(runFilter?.value, RUN_B);
  });

  it('CASE 8 — a name match in ANOTHER period is NO_MATCH', async () => {
    const { result } = await resolve({
      runs: [publishedRun(RUN_A, PERIOD), publishedRun(RUN_OTHER_PERIOD, OTHER_PERIOD)],
      rows: [
        snapshotRow({
          normalizedTaxId: CNPJ_MATRIZ,
          period: OTHER_PERIOD,
          runId: RUN_OTHER_PERIOD,
        }),
      ],
    });
    assert.equal(result.status, 'NO_MATCH');
    assert.equal(result.sourcePeriod, PERIOD);
  });

  it('CASE 13 — an unusable name is INVALID_INPUT with ZERO queries sent', async () => {
    for (const unusable of ['', '   ', '--- ...', null, undefined, 42]) {
      const { db, result } = await resolve({
        rows: [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
        name: unusable,
      });
      // `name` is PRESENT on the options object even when its value is `undefined`, which is
      // exactly the shape a candidate row with no name produces.

      assert.equal(result.status, 'INVALID_INPUT', `for ${JSON.stringify(unusable)}`);
      assert.ok(result.reason.startsWith('candidate_name_'));
      assert.equal(result.resolvedNormalizedTaxId, null);
      assert.equal(result.observedCount, null);
      assert.equal(snapshotSelects(db).length, 0, 'no query may be sent for an unusable name');
    }
  });

  it('CASE 20 — the window is bounded and overflow is REPORTED, not truncated', async () => {
    const overflow = Array.from({ length: BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT + 1 }, (_, i) =>
      snapshotRow({
        normalizedTaxId: sampleFullCnpj(RAIZ_TECNOLOGIA, String(i + 1).padStart(4, '0')),
        municipality: `City ${i}`,
      }),
    );
    const { db, result } = await resolve({ rows: overflow, city: 'City 3' });

    // The query asked for LIMIT + 1: the extra row is how overflow is DETECTED at all.
    assert.equal(snapshotSelects(db)[0].limit, BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT + 1);
    assert.equal(result.status, 'AMBIGUOUS');
    assert.equal(result.reason, 'too_many_name_matches_to_adjudicate');
    assert.equal(result.resolvedNormalizedTaxId, null);
    // 🔴 Overflow is refused BEFORE the city filter runs: a window this resolver could not see
    // the whole of cannot be adjudicated by a filter applied to the part it did see.
    assert.equal(result.observedCount, BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT + 1);
  });

  it('a full window (exactly LIMIT rows) is still adjudicated, not refused', async () => {
    const rows = Array.from({ length: BR_RECEITA_NAME_RESOLUTION_ROW_LIMIT }, (_, i) =>
      snapshotRow({
        normalizedTaxId: sampleFullCnpj(RAIZ_TECNOLOGIA, String(i + 1).padStart(4, '0')),
        municipality: `City ${i}`,
      }),
    );
    const { result } = await resolve({ rows, city: 'City 7' });
    assert.equal(result.status, 'RESOLVED_UNIQUE');
    assert.equal(result.disambiguatedByCity, true);
  });

  it('a query failure is a sanitised ERROR — never a claim about the company', async () => {
    const { result } = await resolve({
      rows: [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
      failSelect: { code: '42501' },
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.reason, 'name_resolution_query_failed');
    assert.equal(result.resolvedNormalizedTaxId, null);
    // 🔴 NOT a NO_MATCH: "we could not ask" and "it is not in Receita" are different statements.
    assert.notEqual(result.status, 'NO_MATCH');
  });

  it('a persisted identity that is not a valid CNPJ fails CLOSED', async () => {
    const { result } = await resolve({
      rows: [snapshotRow({ normalizedTaxId: 'NOT-A-CNPJ' })],
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.reason, 'resolved_row_carries_invalid_persisted_identity');
    assert.equal(result.resolvedNormalizedTaxId, null);
  });

  it('CASE 14 — an AMBIGUOUS result has nowhere to put a CNPJ', async () => {
    const { result } = await resolve({
      rows: [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: 'São Paulo' }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'SAO PAULO' }),
      ],
      city: 'Sao Paulo',
    });
    assert.equal(result.status, 'AMBIGUOUS');
    assertCarriesNoCnpj(result, [CNPJ_MATRIZ, CNPJ_FILIAL], 'AMBIGUOUS resolution');
    // Only the authorized non-identifying evidence survives.
    assert.deepEqual(Object.keys(result).sort(), [
      'disambiguatedByCity',
      'observedCount',
      'reason',
      'resolvedNormalizedTaxId',
      'snapshotRunId',
      'sourcePeriod',
      'status',
    ]);
    assert.equal(result.resolvedNormalizedTaxId, null);
    // No row, no legal name, no municipality, no list.
    assert.ok(!('rows' in result));
    assert.ok(!('candidates' in result));
    assert.equal(BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.returnsAmbiguousIdentityList, false);
    assert.equal(BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.returnsRawRows, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT C — CASE 19: a name query cannot manufacture a run id', () => {
  it('the resolver input has NO run id and NO period field', () => {
    // 🔴 Structural, not a runtime check: the only channel for a run id is the minted pin.
    assert.equal(
      BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.acceptsRunIdAsPlainString,
      false,
    );
    assert.equal(
      BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.acceptsSourcePeriodFromCaller,
      false,
    );
    assert.equal(BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT.requiresMintedPin, true);
  });

  it('an object literal shaped like a pin is refused, with ZERO queries', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [publishedRun(RUN_A, PERIOD)],
      [BR_RECEITA_SNAPSHOT_TABLE]: [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    });
    const forged = { sourcePeriod: PERIOD, snapshotRunId: RUN_B } as unknown as Pin;
    const result = await resolveBrReceitaCandidateIdentity({
      client: db.client,
      publication: forged,
      candidateName: LEGAL_NAME,
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.reason, 'pinned_publication_not_minted_here');
    assert.equal(snapshotSelects(db).length, 0);
  });

  it('a PROTOTYPE-forged pin is refused too — instanceof is not provenance', async () => {
    const db = fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [publishedRun(RUN_A, PERIOD)],
      [BR_RECEITA_SNAPSHOT_TABLE]: [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    });
    // 🔴 `Object.create` installs the real prototype and never enters the constructor, so the
    // mint token cannot speak and `instanceof` says `true`. Only the minted registry refuses it.
    const forged = Object.create(BrReceitaPinnedPublication.prototype) as Pin;
    Object.assign(forged, { sourcePeriod: PERIOD, snapshotRunId: RUN_B });
    assert.ok(forged instanceof BrReceitaPinnedPublication);

    const result = await resolveBrReceitaCandidateIdentity({
      client: db.client,
      publication: forged,
      candidateName: LEGAL_NAME,
    });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.reason, 'pinned_publication_not_minted_here');
    assert.equal(snapshotSelects(db).length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT C — the batch hook (CASES 1, 2, 3, 4, 15, 17, 18)', () => {
  function batchDb(candidates: Array<Record<string, unknown>>, rows: Array<Record<string, unknown>>) {
    return fakeDb({
      [BR_RECEITA_SNAPSHOT_RUNS_TABLE]: [publishedRun(RUN_A, PERIOD)],
      [BR_RECEITA_SNAPSHOT_TABLE]: rows,
      prospect_candidates: candidates,
      prospect_batches: [{ id: BATCH_ID, metadata: {} }],
    });
  }

  it('reads the candidate `city` column — the only new column CUT C needs', () => {
    assert.ok(BR_CANDIDATE_SELECT_COLUMNS.split(', ').includes('city'));
    // 🔴 `region` is NOT read: Apollo's region is not a UF authority (§ 7).
    assert.ok(!BR_CANDIDATE_SELECT_COLUMNS.split(', ').includes('region'));
  });

  it('CASE 1 / CASE 18 — a candidate WITH a CNPJ is never name-resolved', async () => {
    const db = batchDb(
      [candidate({ id: 'c1', taxIdentifier: CNPJ_MATRIZ })],
      [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    );
    let resolverCalls = 0;

    const result = await enrichBrBatchWithValidatedSources(
      db.supabase,
      BATCH_ID,
      { dryRun: true },
      {
        resolveIdentity: async () => {
          resolverCalls += 1;
          throw new Error('unreachable: the resolver must not run for an existing CNPJ');
        },
      },
    );

    assert.equal(resolverCalls, 0);
    assert.equal(result.existingCnpjCount, 1);
    assert.equal(result.identityResolutionAttemptCount, 0);
    assert.equal(result.missingCnpjCount, 0);
    // The CUT B2 exact path is intact: matched, through the exact CNPJ, once.
    assert.equal(result.matchedCount, 1);
    assert.equal(result.candidatesProcessed, 1);
    assert.equal(result.frozenPeriod.sourcePeriod, PERIOD);
    assert.equal(result.frozenPeriod.snapshotRunId, RUN_A);
    assert.equal(result.periodResolutionCount, 1);
    assert.equal(result.adapterConstructionCount, 1);
    // No name filter was ever sent.
    assert.ok(
      !db.selects.some((s) =>
        s.filters.some((f) => f.column === BR_RECEITA_NORMALIZED_LEGAL_NAME_COLUMN),
      ),
    );
  });

  it('a candidate with a MALFORMED CNPJ is not name-resolved either', async () => {
    const db = batchDb(
      [candidate({ id: 'c1', taxIdentifier: '123' })],
      [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    );
    let resolverCalls = 0;

    const result = await enrichBrBatchWithValidatedSources(
      db.supabase,
      BATCH_ID,
      { dryRun: true },
      {
        resolveIdentity: async () => {
          resolverCalls += 1;
          throw new Error('unreachable');
        },
      },
    );

    // 🔴 Overriding source-supplied fiscal data with a name guess is a different, unapproved
    // decision. It stays a visible `skipped / invalid_cnpj_*`.
    assert.equal(resolverCalls, 0);
    assert.equal(result.existingCnpjCount, 1);
    assert.equal(result.missingCnpjCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(
      BR_AGENT1_RUNTIME_BINDING_CONTRACT.overridesCandidateSuppliedTaxIdentifier,
      false,
    );
  });

  it('CASE 2 — no CNPJ + one name match ⇒ resolved, then enriched by the EXACT adapter', async () => {
    const db = batchDb(
      [candidate({ id: 'c1' })],
      [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    );

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {
      dryRun: true,
    });

    assert.equal(result.missingCnpjCount, 1);
    assert.equal(result.identityResolutionAttemptCount, 1);
    assert.equal(result.identityResolvedCount, 1);
    assert.equal(result.missingCnpjUnresolvedCount, 0);
    assert.equal(result.existingCnpjCount, 0);
    // Counted ONCE, as its FINAL outcome.
    assert.equal(result.matchedCount, 1);
    assert.equal(result.skippedCount, 0);
    assert.equal(result.candidatesProcessed, 1);
    assert.deepEqual(result.sourcesApplied, [BR_RECEITA_CNPJ_SOURCE_KEY]);

    // 🔴 The exact reader confirmed it: the snapshot was queried by `normalized_tax_id` after the
    // name resolution, so a name match never becomes a match the exact path did not make.
    const taxFilters = db.selects.filter((s) =>
      s.filters.some((f) => f.column === 'normalized_tax_id' && f.value === CNPJ_MATRIZ),
    );
    assert.equal(taxFilters.length, 1);
  });

  it('CASE 3 — no CNPJ + zero name matches ⇒ no exact lookup at all', async () => {
    const db = batchDb([candidate({ id: 'c1' })], []);

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {
      dryRun: true,
    });

    assert.equal(result.missingCnpjCount, 1);
    assert.equal(result.identityNoMatchCount, 1);
    assert.equal(result.identityResolvedCount, 0);
    assert.equal(result.missingCnpjUnresolvedCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.matchedCount, 0);
    assert.equal(result.candidatesProcessed, 0);
    // No exact-CNPJ probe was ever sent.
    assert.ok(!db.selects.some((s) => s.filters.some((f) => f.column === 'normalized_tax_id')));
  });

  it('CASE 4 — ambiguous ⇒ counted, unenriched, and NO CNPJ anywhere', async () => {
    const db = batchDb(
      [candidate({ id: 'c1' })],
      [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: 'São Paulo' }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Rio de Janeiro' }),
      ],
    );

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {
      dryRun: false,
    });

    assert.equal(result.identityAmbiguousCount, 1);
    assert.equal(result.identityResolvedCount, 0);
    assert.equal(result.missingCnpjUnresolvedCount, 1);
    assert.equal(result.matchedCount, 0);
    assert.ok(!db.selects.some((s) => s.filters.some((f) => f.column === 'normalized_tax_id')));

    // CASE 15 — nothing written and nothing returned carries a CNPJ.
    assertCarriesNoCnpj(result, [CNPJ_MATRIZ, CNPJ_FILIAL], 'batch result');
    assertCarriesNoCnpj(db.updates, [CNPJ_MATRIZ, CNPJ_FILIAL], 'persisted metadata');

    // The provenance that IS written: status, category, count, boolean.
    const candidateUpdate = db.updates.find((u) => u.table === 'prospect_candidates');
    assert.ok(candidateUpdate);
    const summary = (
      (candidateUpdate.payload.metadata as Record<string, unknown>)
        .source_enrichment as Record<string, unknown>
    )._summary as Record<string, unknown>;
    assert.deepEqual(summary.identity_resolution, {
      status: 'AMBIGUOUS',
      reason: 'multiple_name_matches_and_no_usable_candidate_city',
      observed_count: 2,
      disambiguated_by_city: false,
    });
  });

  it('a resolved candidate records HOW it was identified — never WHAT it was identified as', async () => {
    const db = batchDb(
      [candidate({ id: 'c1', city: 'Rio de Janeiro' })],
      [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ, municipality: 'São Paulo' }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Rio de Janeiro' }),
      ],
    );

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});

    assert.equal(result.identityResolvedCount, 1);
    assert.equal(result.matchedCount, 1);
    const update = db.updates.find((u) => u.table === 'prospect_candidates');
    const summary = (
      (update?.payload.metadata as Record<string, unknown>)
        .source_enrichment as Record<string, unknown>
    )._summary as Record<string, unknown>;
    assert.deepEqual(summary.identity_resolution, {
      status: 'RESOLVED_UNIQUE',
      reason: 'unique_after_city_disambiguation',
      observed_count: 1,
      disambiguated_by_city: true,
    });
    assertCarriesNoCnpj(db.updates, [CNPJ_MATRIZ, CNPJ_FILIAL], 'persisted metadata');
  });

  it('a candidate that never needed resolution records identity_resolution: null', async () => {
    const db = batchDb(
      [candidate({ id: 'c1', taxIdentifier: CNPJ_MATRIZ })],
      [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    );
    await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {});
    const update = db.updates.find((u) => u.table === 'prospect_candidates');
    const summary = (
      (update?.payload.metadata as Record<string, unknown>)
        .source_enrichment as Record<string, unknown>
    )._summary as Record<string, unknown>;
    // 🔴 `null` rather than an absent key: "the resolver did not run" and "the resolver found
    // nothing" must stay distinguishable to whoever reads one row.
    assert.equal(summary.identity_resolution, null);
  });

  it('CASE 17 — non-BR candidates are untouched, and no resolution runs for them', async () => {
    const db = batchDb(
      [
        candidate({ id: 'co1', countryCode: 'CO' }),
        candidate({ id: 'br1' }),
      ],
      [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })],
    );

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {
      dryRun: true,
    });

    assert.equal(result.nonBrSkippedCount, 1);
    assert.equal(result.identityResolutionAttemptCount, 1);
    assert.equal(result.identityResolvedCount, 1);
    assert.equal(result.candidatesProcessed, 1);
  });

  it('mixed batches reconcile: missing = resolved + unresolved', async () => {
    const db = batchDb(
      [
        candidate({ id: 'has-cnpj', taxIdentifier: CNPJ_MATRIZ }),
        candidate({ id: 'resolvable', name: 'Synthetic Educacao S.A.' }),
        candidate({ id: 'ambiguous' }),
        candidate({ id: 'blank', name: '   ' }),
        candidate({ id: 'absent', name: 'Nao Existe Ltda' }),
      ],
      [
        snapshotRow({ normalizedTaxId: CNPJ_MATRIZ }),
        snapshotRow({ normalizedTaxId: CNPJ_FILIAL, municipality: 'Other City' }),
        snapshotRow({
          normalizedTaxId: CNPJ_OTHER,
          canonicalName: 'SYNTHETIC EDUCACAO S A',
          municipality: 'São Paulo',
        }),
      ],
    );

    const result = await enrichBrBatchWithValidatedSources(db.supabase, BATCH_ID, {
      dryRun: true,
    });

    assert.equal(result.existingCnpjCount, 1);
    assert.equal(result.missingCnpjCount, 4);
    assert.equal(result.identityResolvedCount, 1); // 'resolvable'
    assert.equal(result.identityAmbiguousCount, 1); // 'ambiguous' — matriz + filial
    assert.equal(result.identityInvalidInputCount, 1); // 'blank'
    assert.equal(result.identityNoMatchCount, 1); // 'absent'
    assert.equal(result.identityErrorCount, 0);
    assert.equal(result.missingCnpjUnresolvedCount, 3);
    assert.equal(
      result.missingCnpjCount,
      result.identityResolvedCount + result.missingCnpjUnresolvedCount,
    );
    // 🔴 The residue is NOT hidden inside skippedCount — both are reported.
    assert.equal(result.matchedCount, 2); // has-cnpj + resolvable
    assert.equal(result.skippedCount, 3);
    assertCarriesNoCnpj(result, [CNPJ_MATRIZ, CNPJ_FILIAL, CNPJ_OTHER], 'batch result');
  });

  it('a resolver failure is an ERROR that never becomes a claim about the company', async () => {
    const db = batchDb([candidate({ id: 'c1' })], [snapshotRow({ normalizedTaxId: CNPJ_MATRIZ })]);

    const result = await enrichBrBatchWithValidatedSources(
      db.supabase,
      BATCH_ID,
      { dryRun: true },
      {
        resolveIdentity: async () => ({
          status: 'ERROR' as const,
          reason: 'name_resolution_query_failed',
          sourcePeriod: PERIOD,
          snapshotRunId: RUN_A,
          observedCount: null,
          disambiguatedByCity: false,
          resolvedNormalizedTaxId: null,
        }),
      },
    );

    assert.equal(result.identityErrorCount, 1);
    assert.equal(result.identityNoMatchCount, 0);
    assert.equal(result.missingCnpjUnresolvedCount, 1);
    assert.equal(result.matchedCount, 0);
  });

  it('fails closed BEFORE any resolution when nothing is published', async () => {
    const db = batchDb([candidate({ id: 'c1' })], []);
    db.tables[BR_RECEITA_SNAPSHOT_RUNS_TABLE] = [];
    let resolverCalls = 0;

    const result = await enrichBrBatchWithValidatedSources(
      db.supabase,
      BATCH_ID,
      {},
      {
        resolveIdentity: async () => {
          resolverCalls += 1;
          throw new Error('unreachable');
        },
      },
    );

    assert.equal(result.aborted, true);
    assert.equal(resolverCalls, 0);
    assert.equal(result.identityResolutionAttemptCount, 0);
    assert.equal(db.updates.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('CUT C — the recorded contracts say what changed and what did not', () => {
  it('the HOOK now resolves by name, and every fail-closed property is recorded', () => {
    const c = BR_AGENT1_RUNTIME_BINDING_CONTRACT;
    // 🔴 Flipped by this cut. Leaving it `false` would be a guard defending the defect.
    assert.equal(c.resolvesIdentityByName, true);
    assert.equal(c.resolvesIdentityByNameOnlyWhenCnpjMissing, true);
    assert.equal(c.overridesCandidateSuppliedTaxIdentifier, false);
    assert.equal(c.resolvesIdentityInsidePinnedPublication, true);
    assert.equal(c.ambiguousNameFailsClosed, true);
    assert.equal(c.noMatchFailsClosed, true);
    assert.equal(c.disambiguatesByCandidateCity, true);
    assert.equal(c.usesUfForDisambiguation, false);
    assert.equal(c.reusesExactCnpjAdapterForResolvedIdentity, true);
    assert.equal(c.duplicatesEnrichmentProjection, false);
    // The CUT B2 guarantees are untouched.
    assert.equal(c.requiresExactCnpj, true);
    assert.equal(c.publicationPinnedOncePerRun, true);
    assert.equal(c.resolvesPublishedRunPerCandidate, false);
    assert.equal(c.samePeriodRepublicationIsolated, true);
    assert.equal(c.authorsMigration, false);
  });

  it('the ADAPTER still refuses to resolve identity by name', () => {
    // 🔴 Deliberately unchanged: the adapter gained no name path. "Identified" and "enriched"
    // stay two separate, separately-provable steps.
    assert.equal(BR_RECEITA_ENRICHMENT_PIN_CONTRACT.resolvesIdentityByName, false);
    assert.equal(BR_RECEITA_ENRICHMENT_PIN_CONTRACT.requiresExactCnpj, true);
  });

  it('the RESOLVER neither enriches nor persists nor migrates', () => {
    const c = BR_RECEITA_CANDIDATE_IDENTITY_RESOLVER_CONTRACT;
    assert.equal(c.enrichesCandidate, false);
    assert.equal(c.persistsAnything, false);
    assert.equal(c.authorsMigration, false);
    assert.equal(c.returnsClosedStatusSet, true);
    assert.equal(c.returnsRowOrNull, false);
    assert.equal(c.returnsIdentityOnlyWhenUnique, true);
    assert.equal(c.throwsOnQueryFailure, false);
    assert.equal(c.forwardsDriverMessages, false);
    assert.equal(c.resolvesLatestPublication, false);
    assert.equal(c.readsAnotherPeriod, false);
    assert.equal(c.readsAnotherRun, false);
    assert.equal(c.detectsWindowOverflowInsteadOfTruncating, true);
    assert.equal(c.usesRowOrder, false);
    assert.equal(c.usesImportedAt, false);
    assert.equal(c.usesLowestOrHighestTaxId, false);
    assert.equal(c.derivesUfFromCity, false);
  });

  it('CASE 15 — neither new module can log, and neither forwards a driver message', () => {
    const strip = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const root = join(here, '..');

    for (const file of [
      'br-receita-cnpj-candidate-identity-resolver.ts',
      'br-receita-cnpj-name-normalization.ts',
    ]) {
      const code = strip(readFileSync(join(root, file), 'utf8'));
      // 🔴 No logger of any kind. The resolver's query filter carries the company's legal name
      // and its rows carry CNPJs; the cheapest guarantee that neither reaches an operator's
      // console is that there is nothing here that could write to one.
      assert.ok(!/console\./.test(code), `${file} must not log`);
      assert.ok(!/process\.stdout|process\.stderr/.test(code), `${file} must not write to stdio`);
    }

    const resolver = strip(
      readFileSync(join(root, 'br-receita-cnpj-candidate-identity-resolver.ts'), 'utf8'),
    );
    // The driver's own text is never read, so it cannot be forwarded.
    assert.ok(!/error\.message|error\.detail|error\.hint/.test(resolver));
    // …and the resolver never re-asks which run is published.
    assert.ok(!/BR_RECEITA_SNAPSHOT_RUNS_TABLE|publish_state/.test(resolver));
  });

  it('the hook never persists the resolved identity UNFENCED, and never in metadata', () => {
    const c = BR_AGENT1_RUNTIME_BINDING_CONTRACT;
    // 🔴 UPDATED BY CUT D, and the update is the point.
    //
    // CUT C wrote `DURABLE_TAX_ID_SAFE_PATH = NOT_FOUND` and pinned these two keys to `false` to
    // record it: Agent 1 evaluated fiscal identity at INSERT time only, migration 126 fenced
    // INSERTs only, and no fenced path existed for adding a `tax_identifier` to an already
    // persisted candidate. CUT D built that path. Leaving the assertions at `false` would turn
    // this test into a ratchet that BLOCKS the correction it was written to describe — the exact
    // failure mode this repository has already been bitten by — so what the test now defends is
    // the property that actually keeps the write safe, not the absence of the write.
    assert.equal(c.persistsResolvedTaxIdentifierOnCandidate, true);
    assert.equal(c.rewritesCandidateIdentityKey, true);
    // 🔴 And these are what make the change safe rather than merely present.
    assert.equal(c.usesBareTaxIdentifierUpdate, false);
    assert.equal(c.promotesResolvedIdentityUnderEpochFence, true);
    assert.equal(c.promotesIdentifierAndIdentityKeyTogether, true);
    assert.equal(c.scopesPromotionByBatch, true);
    assert.equal(c.refusesPromotionOnFiscalConflict, true);
    assert.equal(c.overwritesCandidateSuppliedTaxIdentifier, false);
    assert.equal(c.fallsBackToUnfencedWriteAfterRetries, false);
    assert.equal(c.enrichesWithUnadjudicatedIdentity, false);
    // 🔴 UNCHANGED, and it must stay unchanged: the identifier's only authorized durable home is
    // the `tax_identifier` column. It never enters `metadata.source_enrichment`.
    assert.equal(c.persistsResolvedTaxIdentifierInMetadata, false);
  });
});
