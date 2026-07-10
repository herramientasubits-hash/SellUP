// Tests — supabase/migrations/083_activate_provider_industry_mapping_draft_and_publish.sql
// (Q3F-5AN.2)
//
// Static offline contract audit for migration 083: reads the migration SQL
// as local text and asserts its exact narrow S2 (DRAFT + publication)
// privilege-activation shape. No Supabase, no network, no DB connection, no
// provider, no AI.
//
// Statement-level parsing distinguishes the privilege keywords INSERT /
// UPDATE / DELETE inside GRANT/REVOKE clauses from executable row-DML
// statements: a real DML statement is `insert into ...`, `update <table>
// set ...`, or `delete from ...` — none of which this migration contains.
// A naive global token ban (e.g. "no line may contain the word UPDATE")
// would incorrectly flag the GRANT/REVOKE privilege clauses this migration
// is made of, so no such ban is used here.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '083_activate_provider_industry_mapping_draft_and_publish.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILENAME);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

// Statements, comment-stripped, for structural GRANT/REVOKE assertions.
// `sql` (with comments) is still used for documentation/forbidden-content
// checks where comment text itself carries no privilege meaning.
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

const TABLES = [
  'public.provider_industry_source_vocabularies',
  'public.provider_industry_mapping_snapshots',
  'public.provider_industry_concept_entries',
  'public.provider_industry_mapping_associations',
];

const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];

const PUBLISH_SIG = 'public.publish_provider_industry_mapping_snapshot(UUID, UUID, BIGINT)';
const ARCHIVE_SIG = 'public.archive_provider_industry_mapping_snapshot(UUID, UUID)';
const DELETE_DRAFT_SIG = 'public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID)';

// Canonical byte identity (Q3F-5AR.2 / DD-31): the semantic GRANT/REVOKE
// assertions above prove migration 083's *behavior* (M83-9 through M83-26),
// but none of them prove the file itself is byte-for-byte the frozen
// migration the delete-DRAFT boundary was audited against — a semantically
// equivalent rewrite (reordered GRANTs, added comments, whitespace changes)
// would still pass every statement-level check above while silently no
// longer being the reviewed artifact. This hash is the frozen SHA-256
// captured when migration 083 was last audited as unchanged.
const FROZEN_MIGRATION_083_SHA256 =
  'd17187e7f27411c5c7be98ed8831a60aa07675c8376747cdd487978788f1a7e2';
const LIFECYCLE_RPCS = [PUBLISH_SIG, ARCHIVE_SIG, DELETE_DRAFT_SIG];

function findRevokeStatements(privilege: string, target: string, role: string): string[] {
  return statements.filter((s) => {
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
  return statements.filter((s) => s.toUpperCase().startsWith('GRANT') && s.includes(target));
}

function findGrantStatementsForRole(role: string): string[] {
  return statements.filter(
    (s) => s.toUpperCase().startsWith('GRANT') && new RegExp(`TO\\s+${role}\\b`, 'i').test(s),
  );
}

describe('Migration 083 — provider industry mapping S2 activation', () => {
  describe('M83-1/M83-2 — migration slot', () => {
    it('M83-1: exact migration filename exists', () => {
      assert.doesNotThrow(() => readFileSync(MIGRATION_PATH, 'utf-8'));
    });

    it('M83-2: 083 is the only migration occupying slot 083', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^083[_.]/.test(f));
      assert.deepEqual(files, [MIGRATION_FILENAME]);
    });
  });

  describe('M83-3 — table DML baseline REVOKE', () => {
    for (const table of TABLES) {
      for (const role of ROLES) {
        it(`revokes INSERT, UPDATE, DELETE on ${table} from ${role}`, () => {
          const matches = findRevokeStatements('INSERT, UPDATE, DELETE', table, role);
          assert.ok(matches.length >= 1, `Expected a REVOKE INSERT, UPDATE, DELETE on ${table} FROM ${role}`);
        });
      }
    }
  });

  describe('M83-4/M83-5 — snapshots grant is exactly INSERT + UPDATE (no DELETE)', () => {
    const snapshotsGrants = findGrantStatementsForTarget('public.provider_industry_mapping_snapshots').filter(
      (s) => /TO\s+service_role\b/i.test(s),
    );

    it('M83-4: grants INSERT, UPDATE to service_role', () => {
      assert.equal(snapshotsGrants.length, 1);
      const upper = snapshotsGrants[0]!.toUpperCase();
      assert.ok(upper.includes('INSERT'));
      assert.ok(upper.includes('UPDATE'));
    });

    it('M83-5: does not grant DELETE', () => {
      const upper = snapshotsGrants[0]!.toUpperCase();
      assert.ok(!upper.includes('DELETE'));
    });
  });

  describe('M83-6 — concept entries grant is exactly INSERT + UPDATE + DELETE', () => {
    it('grants INSERT, UPDATE, DELETE to service_role', () => {
      const grants = findGrantStatementsForTarget('public.provider_industry_concept_entries').filter((s) =>
        /TO\s+service_role\b/i.test(s),
      );
      assert.equal(grants.length, 1);
      const upper = grants[0]!.toUpperCase();
      assert.ok(upper.includes('INSERT'));
      assert.ok(upper.includes('UPDATE'));
      assert.ok(upper.includes('DELETE'));
    });
  });

  describe('M83-7 — associations grant is exactly INSERT + UPDATE + DELETE', () => {
    it('grants INSERT, UPDATE, DELETE to service_role', () => {
      const grants = findGrantStatementsForTarget('public.provider_industry_mapping_associations').filter((s) =>
        /TO\s+service_role\b/i.test(s),
      );
      assert.equal(grants.length, 1);
      const upper = grants[0]!.toUpperCase();
      assert.ok(upper.includes('INSERT'));
      assert.ok(upper.includes('UPDATE'));
      assert.ok(upper.includes('DELETE'));
    });
  });

  describe('M83-8 — source vocabularies receive no service_role DML grant', () => {
    it('has no GRANT statement targeting source vocabularies', () => {
      const grants = findGrantStatementsForTarget('public.provider_industry_source_vocabularies');
      assert.equal(grants.length, 0);
    });
  });

  describe('M83-9 — lifecycle RPC EXECUTE baseline REVOKE', () => {
    for (const rpc of LIFECYCLE_RPCS) {
      for (const role of ROLES) {
        it(`revokes EXECUTE on ${rpc} from ${role}`, () => {
          const matches = findRevokeStatements('EXECUTE', rpc, role);
          assert.ok(matches.length >= 1, `Expected a REVOKE EXECUTE on ${rpc} FROM ${role}`);
        });
      }
    }
  });

  describe('M83-10/M83-11/M83-12 — exact publication RPC EXECUTE grant', () => {
    const allExecuteGrants = statements.filter(
      (s) => s.toUpperCase().startsWith('GRANT') && /EXECUTE/i.test(s) && /ON\s+FUNCTION/i.test(s),
    );

    it('M83-10: publish RPC receives service_role EXECUTE', () => {
      const matches = allExecuteGrants.filter(
        (s) => s.includes(PUBLISH_SIG) && /TO\s+service_role\b/i.test(s),
      );
      assert.equal(matches.length, 1);
    });

    it('M83-11: archive RPC receives no EXECUTE grant', () => {
      const matches = allExecuteGrants.filter((s) => s.includes(ARCHIVE_SIG));
      assert.equal(matches.length, 0);
    });

    it('M83-12: delete-draft RPC receives no EXECUTE grant', () => {
      const matches = allExecuteGrants.filter((s) => s.includes(DELETE_DRAFT_SIG));
      assert.equal(matches.length, 0);
    });

    it('M83-26: no EXECUTE grant exists on any lifecycle RPC other than publish', () => {
      assert.equal(allExecuteGrants.length, 1);
      assert.ok(allExecuteGrants[0]!.includes(PUBLISH_SIG));
    });
  });

  describe('M83-13/M83-14/M83-15 — no table DML grant to non-service_role roles', () => {
    it('M83-13: authenticated receives no table DML grant', () => {
      const grants = findGrantStatementsForRole('authenticated').filter((s) => /ON\s+TABLE/i.test(s));
      assert.equal(grants.length, 0);
    });

    it('M83-14: anon receives no table DML grant', () => {
      const grants = findGrantStatementsForRole('anon').filter((s) => /ON\s+TABLE/i.test(s));
      assert.equal(grants.length, 0);
    });

    it('M83-15: PUBLIC receives no table DML grant', () => {
      const grants = findGrantStatementsForRole('PUBLIC').filter((s) => /ON\s+TABLE/i.test(s));
      assert.equal(grants.length, 0);
    });
  });

  describe('M83-16/M83-17/M83-18 — no lifecycle EXECUTE grant to non-service_role roles', () => {
    it('M83-16: authenticated receives no lifecycle EXECUTE grant', () => {
      const grants = findGrantStatementsForRole('authenticated').filter((s) => /EXECUTE/i.test(s));
      assert.equal(grants.length, 0);
    });

    it('M83-17: anon receives no lifecycle EXECUTE grant', () => {
      const grants = findGrantStatementsForRole('anon').filter((s) => /EXECUTE/i.test(s));
      assert.equal(grants.length, 0);
    });

    it('M83-18: PUBLIC receives no lifecycle EXECUTE grant', () => {
      const grants = findGrantStatementsForRole('PUBLIC').filter((s) => /EXECUTE/i.test(s));
      assert.equal(grants.length, 0);
    });
  });

  describe('M83-19/M83-20 — no overbroad grant forms', () => {
    it('M83-19: no GRANT ALL / ALL PRIVILEGES', () => {
      assert.ok(!/GRANT\s+ALL\b/i.test(sqlWithoutLineComments));
      assert.ok(!/ALL\s+PRIVILEGES/i.test(sqlWithoutLineComments));
    });

    it('M83-20: no schema-wide ALL TABLES / ALL FUNCTIONS grant', () => {
      assert.ok(!/ALL\s+TABLES\s+IN\s+SCHEMA/i.test(sqlWithoutLineComments));
      assert.ok(!/ALL\s+FUNCTIONS\s+IN\s+SCHEMA/i.test(sqlWithoutLineComments));
    });
  });

  describe('M83-21/M83-22/M83-23 — forbidden statement forms', () => {
    it('M83-21: no RLS policy statement', () => {
      assert.ok(!/CREATE\s+POLICY/i.test(sqlWithoutLineComments));
      assert.ok(!/ALTER\s+POLICY/i.test(sqlWithoutLineComments));
      assert.ok(!/DROP\s+POLICY/i.test(sqlWithoutLineComments));
    });

    it('M83-22: no table/function/trigger DDL', () => {
      const forbidden = [
        /CREATE\s+TABLE/i,
        /ALTER\s+TABLE/i,
        /DROP\s+TABLE/i,
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i,
        /ALTER\s+FUNCTION/i,
        /DROP\s+FUNCTION/i,
        /CREATE\s+TRIGGER/i,
        /DROP\s+TRIGGER/i,
        /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
        /DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,
      ];
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(sqlWithoutLineComments), `Migration must not match ${pattern}`);
      }
    });

    it('M83-23: no row DML statement (INSERT INTO / UPDATE ... SET / DELETE FROM / TRUNCATE / MERGE / CALL / DO)', () => {
      const forbidden = [
        /INSERT\s+INTO\s/i,
        /UPDATE\s+public\.\w+\s+SET\s/i,
        /DELETE\s+FROM\s/i,
        /\bTRUNCATE\b/i,
        /\bMERGE\b/i,
        /\bCALL\s/i,
        /\bDO\s*\$\$/i,
      ];
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(sqlWithoutLineComments), `Migration must not match ${pattern}`);
      }
    });
  });

  describe('M83-24 — no seed/data literals', () => {
    it('contains no VALUES clause or mapping vocabulary literal', () => {
      assert.ok(!/\bVALUES\s*\(/i.test(sqlWithoutLineComments));
      assert.ok(!sql.includes('apollo/organizations'));
      assert.ok(!sql.includes('lusha/company_prospecting_v3'));
    });
  });

  describe('M83-25 — publication signature unchanged', () => {
    it('publish RPC signature remains (uuid, uuid, bigint)', () => {
      assert.ok(sql.includes(PUBLISH_SIG));
    });
  });

  describe('M83-27 — no secrets or credential-like literals', () => {
    it('contains no secret/credential patterns', () => {
      const forbidden = [
        /sk-[a-zA-Z0-9]/,
        /service_role.{0,20}key/i,
        /postgres(?:ql)?:\/\/\S+:\S+@/i,
        /BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/i,
        /password\s*[:=]\s*['"][^'"]+['"]/i,
      ];
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(sql), `Migration must not match secret pattern ${pattern}`);
      }
    });
  });

  describe('DD-31 — migration 083 remains byte-identical to the frozen audit', () => {
    it('DD-31: migration 083 SHA-256 matches the frozen canonical hash', () => {
      const actualSha256 = createHash('sha256').update(sql, 'utf-8').digest('hex');
      assert.equal(
        actualSha256,
        FROZEN_MIGRATION_083_SHA256,
        'migration 083 bytes changed since the delete-DRAFT boundary audit — re-audit before any EXECUTE activation',
      );
    });
  });
});
