// Tests — supabase/migrations/089_provider_industry_raw_label_observations_schema.sql
// (Q3F-5AU.3)
//
// Static offline contract audit for migration 089: reads the migration SQL
// as local text and asserts its exact narrow inert/read-only schema-install
// shape. No Supabase, no network, no DB connection, no provider, no AI.
//
// Statement-level parsing distinguishes the privilege keywords INSERT /
// UPDATE / DELETE inside GRANT/REVOKE clauses from executable row-DML
// statements: a real DML statement is `insert into ...`, `update <table>
// set ...`, or `delete from ...` — none of which this migration contains.
// A naive global token ban would incorrectly flag the GRANT/REVOKE
// privilege clauses this migration is made of, so no such ban is used here.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '089_provider_industry_raw_label_observations_schema.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILENAME);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

const sqlWithoutLineComments = sql
  .split('\n')
  .map((line) => {
    const idx = line.indexOf('--');
    return idx >= 0 ? line.slice(0, idx) : line;
  })
  .join('\n');

const statements = sqlWithoutLineComments
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter((s) => s.length > 0);

const TABLE = 'public.provider_industry_raw_label_observations';
const VOCAB_TABLE = 'public.provider_industry_source_vocabularies';
const AGENT_RUNS_TABLE = 'public.agent_runs';
const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];

const EXPECTED_COLUMNS = [
  'id',
  'source_vocabulary_key',
  'provider_key',
  'operation_key',
  'raw_label',
  'normalized_lookup_key',
  'country_code',
  'requested_industry',
  'observed_count',
  'first_observed_at',
  'last_observed_at',
  'first_observed_run_id',
  'last_observed_run_id',
  'source_context',
  'created_at',
  'updated_at',
];

const FORBIDDEN_FK_TABLES = [
  'provider_industry_mapping_snapshots',
  'prospect_batches',
  'prospect_candidates',
  'provider_usage_logs',
];

function findRevokeStatements(target: string, role: string): string[] {
  return statements.filter((s) => {
    const upper = s.toUpperCase();
    return upper.startsWith('REVOKE ALL') && s.includes(target) && new RegExp(`FROM\\s+${role}\\b`, 'i').test(s);
  });
}

function findGrantStatements(privilege: string, target: string, role: string): string[] {
  return statements.filter((s) => {
    const upper = s.toUpperCase();
    return (
      upper.startsWith('GRANT') &&
      upper.includes(privilege.toUpperCase()) &&
      s.includes(target) &&
      new RegExp(`TO\\s+${role}\\b`, 'i').test(s)
    );
  });
}

const createTableStatement = statements.find(
  (s) => /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.provider_industry_raw_label_observations/i.test(s),
);

describe('Migration 089 — provider_industry_raw_label_observations schema', () => {
  describe('T1 — migration slot', () => {
    it('T1: exact migration filename exists', () => {
      assert.doesNotThrow(() => readFileSync(MIGRATION_PATH, 'utf-8'));
    });

    it('089 is the only migration occupying slot 089', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^089[_.]/.test(f));
      assert.deepEqual(files, [MIGRATION_FILENAME]);
    });
  });

  describe('T2 — creates the table', () => {
    it('T2: contains CREATE TABLE IF NOT EXISTS for the target table', () => {
      assert.ok(createTableStatement, 'Expected a CREATE TABLE IF NOT EXISTS statement for the target table');
    });
  });

  describe('T3 — all expected columns present', () => {
    it('T3: every expected column name appears in the CREATE TABLE statement', () => {
      const stmt = createTableStatement!;
      for (const column of EXPECTED_COLUMNS) {
        assert.ok(new RegExp(`\\b${column}\\b`).test(stmt), `Expected column ${column} in CREATE TABLE statement`);
      }
    });
  });

  describe('T4 — FK to provider_industry_source_vocabularies', () => {
    it('T4: source_vocabulary_key references the vocabulary table with ON DELETE RESTRICT', () => {
      assert.match(
        sqlWithoutLineComments,
        new RegExp(
          `source_vocabulary_key\\s+text\\s+NOT\\s+NULL\\s*\\n?\\s*REFERENCES\\s+${VOCAB_TABLE.replace('.', '\\.')}\\(source_vocabulary_key\\)\\s+ON\\s+DELETE\\s+RESTRICT`,
          'i',
        ),
      );
    });
  });

  describe('T5 — optional FKs to agent_runs', () => {
    it('T5: first_observed_run_id and last_observed_run_id reference agent_runs ON DELETE SET NULL', () => {
      const refs = [...sqlWithoutLineComments.matchAll(new RegExp(`REFERENCES\\s+${AGENT_RUNS_TABLE.replace('.', '\\.')}\\(id\\)\\s+ON\\s+DELETE\\s+SET\\s+NULL`, 'gi'))];
      assert.equal(refs.length, 2);
      assert.match(sqlWithoutLineComments, /first_observed_run_id\s+uuid\s+NULL/i);
      assert.match(sqlWithoutLineComments, /last_observed_run_id\s+uuid\s+NULL/i);
    });
  });

  describe('T6 through T9 — forbidden foreign keys', () => {
    // Checks for an actual REFERENCES clause targeting the forbidden table,
    // not any textual mention — the migration's own documentation legitimately
    // names these tables (e.g. inside COMMENT ON TABLE ... IS '...') to state
    // that no relationship to them exists, which must not itself fail the test.
    for (const forbidden of FORBIDDEN_FK_TABLES) {
      it(`does not declare a FOREIGN KEY / REFERENCES to ${forbidden}`, () => {
        assert.ok(
          !new RegExp(`REFERENCES\\s+public\\.${forbidden}\\b`, 'i').test(sqlWithoutLineComments),
          `Migration must not declare a FK to ${forbidden}`,
        );
      });
    }
  });

  describe('T10 — value constraints', () => {
    it('raw_label non-empty constraint exists', () => {
      assert.match(sqlWithoutLineComments, /CHECK\s*\(\s*trim\(raw_label\)\s*<>\s*''\s*\)/i);
    });

    it('normalized_lookup_key non-empty constraint exists', () => {
      assert.match(sqlWithoutLineComments, /CHECK\s*\(\s*trim\(normalized_lookup_key\)\s*<>\s*''\s*\)/i);
    });

    it('observed_count positive constraint exists', () => {
      assert.match(sqlWithoutLineComments, /CHECK\s*\(\s*observed_count\s*>\s*0\s*\)/i);
    });
  });

  describe('T11 — unique observation identity index', () => {
    it('T11: idx_pirlo_observation_identity is UNIQUE and uses COALESCE(country_code, \'\')', () => {
      const stmt = statements.find((s) => /idx_pirlo_observation_identity/i.test(s));
      assert.ok(stmt, 'Expected idx_pirlo_observation_identity index statement');
      assert.match(stmt!, /^CREATE\s+UNIQUE\s+INDEX/i);
      assert.match(stmt!, /source_vocabulary_key/i);
      assert.match(stmt!, /operation_key/i);
      assert.match(stmt!, /normalized_lookup_key/i);
      assert.match(stmt!, /COALESCE\(\s*country_code\s*,\s*''\s*\)/i);
    });

    it('does not create a separate index solely on normalized_lookup_key', () => {
      const soloIndexes = statements.filter(
        (s) =>
          /^CREATE\s+(UNIQUE\s+)?INDEX/i.test(s) &&
          /\(\s*normalized_lookup_key\s*\)/i.test(s),
      );
      assert.equal(soloIndexes.length, 0);
    });
  });

  describe('T12 — top_labels, country, last_observed_run indexes', () => {
    it('idx_pirlo_top_labels on (source_vocabulary_key, observed_count DESC)', () => {
      const stmt = statements.find((s) => /idx_pirlo_top_labels/i.test(s));
      assert.ok(stmt);
      assert.match(stmt!, /source_vocabulary_key\s*,\s*observed_count\s+DESC/i);
    });

    it('idx_pirlo_country on (source_vocabulary_key, country_code) WHERE country_code IS NOT NULL', () => {
      const stmt = statements.find((s) => /idx_pirlo_country\b/i.test(s));
      assert.ok(stmt);
      assert.match(stmt!, /source_vocabulary_key\s*,\s*country_code/i);
      assert.match(stmt!, /WHERE\s+country_code\s+IS\s+NOT\s+NULL/i);
    });

    it('idx_pirlo_last_observed_run on (last_observed_run_id) WHERE last_observed_run_id IS NOT NULL', () => {
      const stmt = statements.find((s) => /idx_pirlo_last_observed_run/i.test(s));
      assert.ok(stmt);
      assert.match(stmt!, /\(\s*last_observed_run_id\s*\)/i);
      assert.match(stmt!, /WHERE\s+last_observed_run_id\s+IS\s+NOT\s+NULL/i);
    });
  });

  describe('T13 — RLS enabled', () => {
    it('ENABLE ROW LEVEL SECURITY on the target table', () => {
      assert.ok(
        statements.some(
          (s) => /^ALTER\s+TABLE/i.test(s) && s.includes(TABLE) && /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(s),
        ),
      );
    });
  });

  describe('T14 — SELECT policy for authenticated using has_active_access', () => {
    it('creates the expected policy', () => {
      const stmt = statements.find(
        (s) =>
          /^CREATE\s+POLICY/i.test(s) &&
          s.includes('active_users_can_read_provider_industry_raw_label_observations'),
      );
      assert.ok(stmt, 'Expected the active_users_can_read policy');
      assert.match(stmt!, /FOR\s+SELECT/i);
      assert.match(stmt!, /TO\s+authenticated/i);
      assert.match(stmt!, /public\.has_active_access\(auth\.uid\(\)\)/i);
    });
  });

  describe('T15 — REVOKE ALL from every role', () => {
    for (const role of ROLES) {
      it(`revokes ALL from ${role}`, () => {
        assert.equal(findRevokeStatements(TABLE, role).length, 1);
      });
    }
  });

  describe('T16/T17 — only SELECT granted to authenticated and service_role', () => {
    it('T16: grants SELECT to authenticated', () => {
      assert.equal(findGrantStatements('SELECT', TABLE, 'authenticated').length, 1);
    });

    it('T16: grants SELECT to service_role', () => {
      assert.equal(findGrantStatements('SELECT', TABLE, 'service_role').length, 1);
    });

    it('T17: no INSERT/UPDATE/DELETE/ALL grant to service_role', () => {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'ALL']) {
        assert.equal(findGrantStatements(privilege, TABLE, 'service_role').length, 0, `Unexpected GRANT ${privilege} to service_role`);
      }
    });

    it('no INSERT/UPDATE/DELETE/ALL grant to authenticated, anon, or PUBLIC', () => {
      for (const role of ['authenticated', 'anon', 'PUBLIC']) {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'ALL']) {
          assert.equal(findGrantStatements(privilege, TABLE, role).length, 0, `Unexpected GRANT ${privilege} to ${role}`);
        }
      }
    });
  });

  describe('T18/T19 — no RPC, no SECURITY DEFINER', () => {
    it('T18: no CREATE FUNCTION / RPC created', () => {
      assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sqlWithoutLineComments));
    });

    it('T19: no SECURITY DEFINER', () => {
      assert.ok(!/SECURITY\s+DEFINER/i.test(sqlWithoutLineComments));
    });
  });

  describe('T20 through T23 — no DML, no seed', () => {
    it('T20: no INSERT INTO', () => {
      assert.ok(!/INSERT\s+INTO/i.test(sqlWithoutLineComments));
    });

    it('T21: no UPDATE public. row statement', () => {
      assert.ok(!/UPDATE\s+public\.\w+\s+SET\s/i.test(sqlWithoutLineComments));
    });

    it('T22: no DELETE FROM', () => {
      assert.ok(!/DELETE\s+FROM\s/i.test(sqlWithoutLineComments));
    });

    it('T23: no seed data (no VALUES clause)', () => {
      assert.ok(!/\bVALUES\s*\(/i.test(sqlWithoutLineComments));
    });
  });

  describe('T24 — Apollo not framed as the only source', () => {
    it('T24: does not frame Apollo as the exclusive/mandatory/only source for this table', () => {
      // The migration legitimately uses "apollo" once as an illustrative
      // example of a provider_key value (a documentation mention), which is
      // not the same as framing Apollo as the required/only source — so this
      // checks for the framing language, not the bare word.
      const exclusivityFraming = [
        /apollo[^.]{0,80}(only source|exclusiv|mandatory|required source)/i,
        /(only source|exclusiv|mandatory|required source)[^.]{0,80}apollo/i,
      ];
      for (const pattern of exclusivityFraming) {
        assert.ok(!pattern.test(sql), `Migration must not frame Apollo as required/exclusive (matched ${pattern})`);
      }
    });
  });

  describe('T25/T26/T27 — required distinguishing comments', () => {
    it('T25: distinguishes provider_key from source_vocabulary_key', () => {
      assert.ok(/provider_key/i.test(sql));
      assert.ok(/source_vocabulary_key/i.test(sql));
      assert.ok(/distinct identit/i.test(sql));
    });

    it('T26: states no PII / no full provider payload in source_context', () => {
      assert.ok(/PII/i.test(sql));
      assert.ok(/full (raw )?provider (response )?payload/i.test(sql));
    });

    it('T27: states this is not a mapping / not part of the snapshot lifecycle', () => {
      assert.ok(/not a mapping/i.test(sql));
      assert.ok(/provider_industry_mapping_snapshots draft\/publish\/archive lifecycle/i.test(sql));
    });
  });

  describe('T28/T29/T30 — no out-of-scope wiring', () => {
    it('T28: does not touch Apollo organization provider code (no file/import references)', () => {
      assert.ok(!/apollo-organization/i.test(sql));
      assert.ok(!/from\s+['"].*apollo/i.test(sql));
    });

    it('T29: does not create captureProviderIndustryRawLabelObservations', () => {
      // The migration's header legitimately names this function inside a
      // "does NOT create..." comment to document the out-of-scope boundary.
      // The actual violation to guard against is a CREATE FUNCTION for it —
      // checked against comment-stripped SQL, not the raw commentary mention.
      assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+.*captureProviderIndustryRawLabelObservations/i.test(sqlWithoutLineComments));
      assert.ok(!/captureProviderIndustryRawLabelObservations/i.test(sqlWithoutLineComments));
    });

    it('T30: does not modify candidate writer / scoring / ranking / review status', () => {
      const forbiddenTerms = ['candidate_writer', 'candidate-writer', 'scoring', 'ranking', 'review_status', 'pending_review'];
      for (const term of forbiddenTerms) {
        assert.ok(!sql.toLowerCase().includes(term.toLowerCase()), `Migration must not reference ${term}`);
      }
    });
  });
});
