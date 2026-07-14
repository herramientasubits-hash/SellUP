// Tests — supabase/migrations/090_activate_provider_industry_raw_label_observation_capture.sql
// (Q3F-5AU.5)
//
// Static offline contract audit for migration 090: reads the migration SQL
// as local text and asserts its exact narrow RPC-only write-activation
// shape. No Supabase, no network, no DB connection, no provider, no AI, no
// RPC invocation.
//
// Statement-level parsing distinguishes the privilege keyword EXECUTE (and
// the DML keywords INSERT/UPDATE/DELETE) inside GRANT/REVOKE clauses from
// executable row-DML or RPC-invocation statements, and further distinguishes
// the INSERT/UPDATE statements that live INSIDE the CREATE FUNCTION body
// (the RPC's own upsert, which is expected and required) from any DML that
// would live OUTSIDE the function body (which is forbidden).

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '090_activate_provider_industry_raw_label_observation_capture.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILENAME);

const rawSql = readFileSync(MIGRATION_PATH, 'utf-8');

function stripSqlComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const STRUCTURAL_SOURCE = stripSqlComments(rawSql);

// ── Reconstructed prose for header-commentary assertions (M37/M38) ──────
// The migration's header commentary is written as `-- `-prefixed lines that
// wrap a single sentence across multiple lines. A plain substring/regex
// check against rawSql would break at each line boundary (the literal
// "\n-- " between wrapped words is not whitespace). This reconstructs
// continuous prose by stripping each line's leading comment marker and
// joining with single spaces, so a wrapped phrase can be matched as one
// contiguous string regardless of where SQL chose to wrap the comment.
const PROSE_TEXT = rawSql
  .split('\n')
  .map((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('--') ? trimmed.replace(/^--\s?/, '') : trimmed;
  })
  .join(' ')
  .replace(/\s+/g, ' ');

const FUNCTION_NAME = 'capture_provider_industry_raw_label_observations';
const FUNCTION_SIG_ARGS = '(text, text, text, jsonb, text, text, uuid, jsonb)';
const FUNCTION_SIG = `public.${FUNCTION_NAME}${FUNCTION_SIG_ARGS}`;
const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const TABLE = 'public.provider_industry_raw_label_observations';

// ── Isolate the CREATE FUNCTION ... $$ ... $$ body so DML checks can
// distinguish "inside the RPC body" (allowed) from "outside" (forbidden).
const FUNCTION_BODY_MATCH = STRUCTURAL_SOURCE.match(
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.capture_provider_industry_raw_label_observations[\s\S]*?\$\$([\s\S]*?)\$\$/i,
);
if (!FUNCTION_BODY_MATCH) {
  throw new Error('Test setup failure: could not isolate capture RPC function body from migration 090');
}
const FUNCTION_BODY = FUNCTION_BODY_MATCH[1];
const SOURCE_OUTSIDE_FUNCTION_BODY = STRUCTURAL_SOURCE.replace(FUNCTION_BODY, '');

function splitSqlStatements(source: string): string[] {
  return source
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

const structuralStatements = splitSqlStatements(STRUCTURAL_SOURCE);
const statementsOutsideFunctionBody = splitSqlStatements(SOURCE_OUTSIDE_FUNCTION_BODY);

function findRevokeStatements(privilege: string, target: string, role: string): string[] {
  return structuralStatements.filter((s) => {
    const upper = s.toUpperCase();
    return (
      upper.startsWith('REVOKE') &&
      upper.includes(privilege.toUpperCase()) &&
      s.includes(target) &&
      new RegExp(`FROM\\s+${role}\\b`, 'i').test(s)
    );
  });
}

function findGrantStatementsForTarget(target: string): string[] {
  return structuralStatements.filter((s) => s.toUpperCase().startsWith('GRANT') && s.includes(target));
}

describe('Migration 090 — capture_provider_industry_raw_label_observations RPC activation', () => {
  describe('M1/M2 — migration slot', () => {
    it('M1: exact migration filename exists and is readable', () => {
      assert.doesNotThrow(() => readFileSync(MIGRATION_PATH, 'utf-8'));
    });

    it('M2: 090 is the only migration occupying slot 090', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^090[_.]/.test(f));
      assert.deepEqual(files, [MIGRATION_FILENAME]);
    });
  });

  describe('M2/M3 — creates/replaces the exact RPC', () => {
    it('M2: CREATE OR REPLACE FUNCTION public.capture_provider_industry_raw_label_observations exists', () => {
      assert.match(
        STRUCTURAL_SOURCE,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.capture_provider_industry_raw_label_observations\s*\(/i,
      );
    });

    it('M3: firma exacta con 8 parámetros en el orden y tipos esperados', () => {
      const signatureMatch = STRUCTURAL_SOURCE.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.capture_provider_industry_raw_label_observations\s*\(([\s\S]*?)\)\s*RETURNS/i,
      );
      assert.ok(signatureMatch, 'expected to find the function parameter list');
      const paramList = signatureMatch![1];

      assert.match(paramList, /p_source_vocabulary_key\s+text/i);
      assert.match(paramList, /p_provider_key\s+text/i);
      assert.match(paramList, /p_operation_key\s+text/i);
      assert.match(paramList, /p_observations\s+jsonb/i);
      assert.match(paramList, /p_country_code\s+text\s+DEFAULT\s+NULL/i);
      assert.match(paramList, /p_requested_industry\s+text\s+DEFAULT\s+NULL/i);
      assert.match(paramList, /p_agent_run_id\s+uuid\s+DEFAULT\s+NULL/i);
      assert.match(paramList, /p_source_context\s+jsonb\s+DEFAULT\s+'\{\}'::jsonb/i);

      const order = [
        'p_source_vocabulary_key',
        'p_provider_key',
        'p_operation_key',
        'p_observations',
        'p_country_code',
        'p_requested_industry',
        'p_agent_run_id',
        'p_source_context',
      ];
      const indices = order.map((name) => paramList.indexOf(name));
      for (let i = 1; i < indices.length; i += 1) {
        assert.ok(indices[i] > indices[i - 1], `expected ${order[i]} to appear after ${order[i - 1]}`);
      }
    });
  });

  describe('M4/M5/M6/M7 — function-level contract', () => {
    it('M4: RETURNS jsonb', () => {
      assert.match(
        STRUCTURAL_SOURCE,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.capture_provider_industry_raw_label_observations[\s\S]*?RETURNS\s+jsonb/i,
      );
    });

    it('M5: LANGUAGE plpgsql', () => {
      assert.match(FUNCTION_BODY_MATCH![0], /LANGUAGE\s+plpgsql/i);
    });

    it('M6: SECURITY DEFINER', () => {
      assert.match(FUNCTION_BODY_MATCH![0], /SECURITY\s+DEFINER/i);
    });

    it('M7: SET search_path = pg_temp', () => {
      assert.match(FUNCTION_BODY_MATCH![0], /SET\s+search_path\s*=\s*pg_temp/i);
    });
  });

  describe('M8/M9/M10/M11/M12/M13 — schema-qualified references, no adjacent-domain references', () => {
    // M9-M13 check the STRUCTURAL (comment-stripped) SQL, not the raw file:
    // this migration's required header commentary (M37/M38) necessarily
    // *names* the adjacent lifecycle tables/concepts it does NOT touch (e.g.
    // "does not touch provider_industry_mapping_snapshots"), so a bare
    // substring check against rawSql would false-positive on that required
    // prose. What M9-M13 actually guard against is these names appearing in
    // executable SQL (DDL/DML/RPC body) — that is what STRUCTURAL_SOURCE
    // (line-comments stripped) represents.
    it('M8: uses schema-qualified references to the observations table', () => {
      assert.ok(FUNCTION_BODY.includes(TABLE));
    });

    it('M9: no reference to provider_industry_mapping_snapshots', () => {
      assert.ok(!STRUCTURAL_SOURCE.includes('provider_industry_mapping_snapshots'));
    });

    it('M10: no reference to provider_industry_concept_entries', () => {
      assert.ok(!STRUCTURAL_SOURCE.includes('provider_industry_concept_entries'));
    });

    it('M11: no reference to provider_industry_mapping_associations', () => {
      assert.ok(!STRUCTURAL_SOURCE.includes('provider_industry_mapping_associations'));
    });

    it('M12: no reference to prospect_candidates', () => {
      assert.ok(!STRUCTURAL_SOURCE.includes('prospect_candidates'));
    });

    it('M13: no reference to candidate_status/review_status/scoring/ranking', () => {
      for (const literal of ['candidate_status', 'review_status', 'scoring', 'ranking']) {
        assert.ok(!STRUCTURAL_SOURCE.toLowerCase().includes(literal), `must not reference "${literal}"`);
      }
    });
  });

  describe('M14 — ON CONFLICT target matches the 089 unique index exactly', () => {
    it('references source_vocabulary_key, operation_key, normalized_lookup_key, COALESCE(country_code, \'\'::text) in order', () => {
      const conflictMatch = FUNCTION_BODY.match(/ON\s+CONFLICT\s*\(([\s\S]*?)\)\s*DO\s+UPDATE/i);
      assert.ok(conflictMatch, 'expected an ON CONFLICT (...) DO UPDATE clause');
      const target = conflictMatch![1].replace(/\s+/g, ' ');

      assert.match(target, /source_vocabulary_key/i);
      assert.match(target, /operation_key/i);
      assert.match(target, /normalized_lookup_key/i);
      assert.match(target, /COALESCE\s*\(\s*country_code\s*,\s*''::text\s*\)/i);

      const order = ['source_vocabulary_key', 'operation_key', 'normalized_lookup_key', 'COALESCE'];
      const indices = order.map((token) => target.toLowerCase().indexOf(token.toLowerCase()));
      for (let i = 1; i < indices.length; i += 1) {
        assert.ok(indices[i] > indices[i - 1], `expected ${order[i]} to appear after ${order[i - 1]} in ON CONFLICT target`);
      }
    });
  });

  describe('M15/M16/M17/M18 — DO UPDATE SET increments/advances the expected columns', () => {
    const doUpdateMatch = FUNCTION_BODY.match(/DO\s+UPDATE\s+SET([\s\S]*?)RETURNING/i);

    it('setup: isolates the DO UPDATE SET clause', () => {
      assert.ok(doUpdateMatch, 'expected a DO UPDATE SET ... RETURNING clause');
    });

    const doUpdateSetClause = doUpdateMatch ? doUpdateMatch[1] : '';

    it('M15: increments observed_count using table.observed_count + 1', () => {
      assert.match(
        doUpdateSetClause,
        /observed_count\s*=\s*public\.provider_industry_raw_label_observations\.observed_count\s*\+\s*1/i,
      );
    });

    it('M16: updates last_observed_at', () => {
      assert.match(doUpdateSetClause, /last_observed_at\s*=\s*now\(\)/i);
    });

    it('M17: updates last_observed_run_id', () => {
      assert.match(doUpdateSetClause, /last_observed_run_id\s*=\s*EXCLUDED\.last_observed_run_id/i);
    });

    it('M18: updates source_context', () => {
      assert.match(doUpdateSetClause, /source_context\s*=\s*EXCLUDED\.source_context/i);
    });
  });

  describe('M19/M20/M21/M22 — DO UPDATE SET never overwrites frozen first-observation columns', () => {
    const doUpdateMatch = FUNCTION_BODY.match(/DO\s+UPDATE\s+SET([\s\S]*?)RETURNING/i);
    const doUpdateSetClause = doUpdateMatch ? doUpdateMatch[1] : '';

    it('M19: does not assign first_observed_at in DO UPDATE SET', () => {
      assert.ok(!/first_observed_at\s*=/i.test(doUpdateSetClause));
    });

    it('M20: does not assign first_observed_run_id in DO UPDATE SET', () => {
      assert.ok(!/first_observed_run_id\s*=/i.test(doUpdateSetClause));
    });

    it('M21: does not assign raw_label in DO UPDATE SET', () => {
      assert.ok(!/\braw_label\s*=/i.test(doUpdateSetClause));
    });

    it('M22: does not assign provider_key in DO UPDATE SET', () => {
      assert.ok(!/\bprovider_key\s*=/i.test(doUpdateSetClause));
    });
  });

  describe('M23 — return shape', () => {
    it('returns success/inserted_count/updated_count/skipped_count/observed_count_delta/error_code', () => {
      for (const field of [
        "'success'",
        "'inserted_count'",
        "'updated_count'",
        "'skipped_count'",
        "'observed_count_delta'",
        "'error_code'",
      ]) {
        assert.ok(FUNCTION_BODY.includes(field), `expected jsonb_build_object to include ${field}`);
      }
    });
  });

  describe('M24/M25/M26 — EXECUTE privilege posture', () => {
    for (const role of ROLES) {
      it(`M24: revokes EXECUTE on ${FUNCTION_SIG} from ${role}`, () => {
        const matches = findRevokeStatements('EXECUTE', FUNCTION_SIG, role);
        assert.ok(matches.length >= 1, `expected a REVOKE EXECUTE on ${FUNCTION_SIG} FROM ${role}`);
      });
    }

    it('M25: grants EXECUTE on the RPC to service_role exactly once', () => {
      const grants = findGrantStatementsForTarget(FUNCTION_SIG).filter(
        (s) => /EXECUTE/i.test(s) && /TO\s+service_role\b/i.test(s),
      );
      assert.equal(grants.length, 1);
    });

    it('M26: no EXECUTE grant to authenticated/anon/PUBLIC', () => {
      for (const role of ['authenticated', 'anon', 'PUBLIC']) {
        const grants = findGrantStatementsForTarget(FUNCTION_SIG).filter((s) =>
          new RegExp(`TO\\s+${role}\\b`, 'i').test(s),
        );
        assert.equal(grants.length, 0, `expected no GRANT ... TO ${role} on the RPC`);
      }
    });
  });

  describe('M27/M28 — no table DML grant to any role', () => {
    it('M27: no GRANT INSERT/UPDATE/DELETE/ALL on the table to service_role', () => {
      const grants = structuralStatements.filter((s) => {
        const upper = s.toUpperCase();
        return (
          upper.startsWith('GRANT') &&
          s.includes(TABLE) &&
          /\b(INSERT|UPDATE|DELETE|ALL)\b/.test(upper) &&
          /TO\s+service_role\b/i.test(s)
        );
      });
      assert.equal(grants.length, 0);
    });

    it('M28: no GRANT INSERT/UPDATE/DELETE/ALL on the table to authenticated/anon/PUBLIC', () => {
      for (const role of ['authenticated', 'anon', 'PUBLIC']) {
        const grants = structuralStatements.filter((s) => {
          const upper = s.toUpperCase();
          return (
            upper.startsWith('GRANT') &&
            s.includes(TABLE) &&
            /\b(INSERT|UPDATE|DELETE|ALL)\b/.test(upper) &&
            new RegExp(`TO\\s+${role}\\b`, 'i').test(s)
          );
        });
        assert.equal(grants.length, 0, `expected no table DML GRANT ... TO ${role}`);
      }
    });

    it('no GRANT/REVOKE statement targets the table at all (089 posture untouched)', () => {
      const tableGrantsOrRevokes = structuralStatements.filter(
        (s) => /^(GRANT|REVOKE)/i.test(s) && s.includes(TABLE),
      );
      assert.equal(tableGrantsOrRevokes.length, 0);
    });
  });

  describe('M29 — no CREATE TABLE', () => {
    it('contains no CREATE TABLE statement', () => {
      assert.ok(!/CREATE\s+TABLE/i.test(STRUCTURAL_SOURCE));
    });
  });

  describe('M30/M31 — INSERT/UPDATE only inside the RPC body', () => {
    it('M30: the only INSERT INTO statement lives inside the function body', () => {
      const insertsOutside = statementsOutsideFunctionBody.filter((s) => /INSERT\s+INTO\s/i.test(s));
      assert.equal(insertsOutside.length, 0, 'no INSERT INTO statement may exist outside the CREATE FUNCTION block');
      assert.match(FUNCTION_BODY, /INSERT\s+INTO\s+public\.provider_industry_raw_label_observations/i);
    });

    it('M31: no bare UPDATE public.<table> ... SET statement outside the RPC body (ON CONFLICT DO UPDATE inside is allowed)', () => {
      const updatesOutside = statementsOutsideFunctionBody.filter((s) => /UPDATE\s+public\.\w+\s+SET\s/i.test(s));
      assert.equal(updatesOutside.length, 0);
    });
  });

  describe('M32/M33/M34 — no DELETE, no policy change, no RLS/ALTER TABLE change', () => {
    it('M32: contains no DELETE FROM statement', () => {
      assert.ok(!/DELETE\s+FROM\s/i.test(STRUCTURAL_SOURCE));
    });

    it('M33: contains no CREATE POLICY / ALTER POLICY / DROP POLICY', () => {
      assert.ok(!/CREATE\s+POLICY/i.test(STRUCTURAL_SOURCE));
      assert.ok(!/ALTER\s+POLICY/i.test(STRUCTURAL_SOURCE));
      assert.ok(!/DROP\s+POLICY/i.test(STRUCTURAL_SOURCE));
    });

    it('M34: contains no ALTER TABLE / ENABLE|DISABLE ROW LEVEL SECURITY', () => {
      assert.ok(!/ALTER\s+TABLE/i.test(STRUCTURAL_SOURCE));
      assert.ok(!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(STRUCTURAL_SOURCE));
      assert.ok(!/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(STRUCTURAL_SOURCE));
    });
  });

  describe('M35 — no provider call / http / net', () => {
    // Checks STRUCTURAL_SOURCE, not rawSql: the required header commentary
    // (M38) legitimately names Apollo/Lusha/Tavily in prose ("does not wire
    // any provider (Apollo/Lusha/Tavily) to call this RPC") to document the
    // boundary — that is exactly the documentation this migration is
    // required to carry. What M35 actually guards against is an executable
    // HTTP/net call or a provider literal inside real SQL, which
    // STRUCTURAL_SOURCE (line-comments stripped) represents.
    it('contains no HTTP/net/provider-call literal', () => {
      const forbidden = ['http://', 'https://', 'net.http', 'pg_net', 'extensions.http'];
      for (const literal of forbidden) {
        assert.ok(!STRUCTURAL_SOURCE.toLowerCase().includes(literal.toLowerCase()), `must not reference "${literal}"`);
      }
      for (const literal of ['apollo', 'lusha', 'tavily']) {
        assert.ok(!STRUCTURAL_SOURCE.toLowerCase().includes(literal), `must not reference provider "${literal}"`);
      }
    });
  });

  describe('M36 — no additional SECURITY DEFINER function', () => {
    it('exactly one SECURITY DEFINER function is created/replaced in this migration', () => {
      const matches = STRUCTURAL_SOURCE.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.\w+/gi) ?? [];
      assert.equal(matches.length, 1);
      assert.match(matches[0], new RegExp(FUNCTION_NAME));
    });
  });

  describe('M37/M38 — required header commentary', () => {
    it('M37: mentions no automatic mapping / no snapshot lifecycle effect', () => {
      assert.match(PROSE_TEXT, /not mappings/i);
      assert.match(PROSE_TEXT, /snapshot lifecycle/i);
      assert.match(PROSE_TEXT, /no automatic promotion to a concept entry/i);
    });

    it('M38: mentions the no-table-DML-grant boundary', () => {
      assert.match(PROSE_TEXT, /MUST NOT receive a direct table DML grant/i);
      assert.match(PROSE_TEXT, /only sanctioned write path/i);
    });
  });

  describe('M39 — migration hash', () => {
    it('reports the SHA-256 of migration 090 (informational, not frozen — this hito authors 090)', () => {
      const actualSha256 = createHash('sha256').update(rawSql, 'utf-8').digest('hex');
      assert.equal(typeof actualSha256, 'string');
      assert.equal(actualSha256.length, 64);
    });
  });

  describe('no secret/credential/UUID literal, no vendor content beyond domain identifiers', () => {
    it('contains no secret/credential patterns', () => {
      const forbidden = [
        /sk-[a-zA-Z0-9]/,
        /service_role.{0,20}key/i,
        /postgres(?:ql)?:\/\/\S+:\S+@/i,
        /BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/i,
        /password\s*[:=]\s*['"][^'"]+['"]/i,
      ];
      for (const pattern of forbidden) {
        assert.equal(pattern.test(rawSql), false, `must not match secret pattern ${pattern}`);
      }
    });

    it('contains no canonical 8-4-4-4-12 UUID literal', () => {
      const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      assert.equal(UUID_PATTERN.test(rawSql), false);
    });

    it('does not forbid the legitimate domain identifiers', () => {
      assert.ok(rawSql.includes('provider_industry_raw_label_observations'));
      assert.ok(rawSql.includes(FUNCTION_NAME));
    });
  });
});
