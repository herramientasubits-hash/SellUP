// Tests — supabase/migrations/085_activate_provider_industry_mapping_delete_draft.sql
// (Q3F-5AS.1)
//
// Static offline contract audit for migration 085: reads the migration SQL as
// local text and asserts its exact narrow delete-DRAFT EXECUTE-activation
// (G2) shape. No Supabase, no network, no DB connection, no provider, no AI,
// no RPC invocation.
//
// Statement-level parsing distinguishes the privilege keyword EXECUTE inside
// GRANT/REVOKE clauses from executable row-DML or lifecycle-RPC-invocation
// statements — no naive global token ban is used, so descriptive comments or
// GRANT/REVOKE clauses referencing a lifecycle RPC name cannot themselves
// create a false positive.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '085_activate_provider_industry_mapping_delete_draft.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILENAME);

const rawSql = readFileSync(MIGRATION_PATH, 'utf-8');

// M85-14: comment-stripped structural SQL representation, so descriptive
// comments cannot create false positives for DML/DDL/RPC-invocation checks.
function stripSqlComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const commentIndex = line.indexOf('--');
      return line.slice(0, commentIndex === -1 ? line.length : commentIndex);
    })
    .join('\n');
}

const STRUCTURAL_STATEMENT_SOURCE = stripSqlComments(rawSql);

function splitSqlStatements(source: string): string[] {
  return source
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0);
}

const structuralStatements = splitSqlStatements(STRUCTURAL_STATEMENT_SOURCE);

const ROLES = ['PUBLIC', 'anon', 'authenticated', 'service_role'];

const DELETE_DRAFT_SIG = 'public.delete_draft_provider_industry_mapping_snapshot(UUID, UUID)';
const ARCHIVE_NAME = 'archive_provider_industry_mapping_snapshot';
const PUBLISH_NAME = 'publish_provider_industry_mapping_snapshot';
const DELETE_DRAFT_NAME = 'delete_draft_provider_industry_mapping_snapshot';

// M85-23: frozen SHA-256 of migration 085 itself, captured after migration
// 085's bytes were finalized. If migration 085 is modified after this hash
// is frozen, DD-33 below must fail.
const FROZEN_MIGRATION_085_SHA256 =
  '8872210de243b3a6b3529424216e4d369da2d157c6e0fe9406ea4a3c6e5bacc9';

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

describe('Migration 085 — provider industry mapping delete-DRAFT EXECUTE activation', () => {
  describe('M85-1/M85-2 — migration slot', () => {
    it('M85-1: exact migration filename exists and is readable', () => {
      assert.doesNotThrow(() => readFileSync(MIGRATION_PATH, 'utf-8'));
    });

    it('M85-2: 085 is the only migration occupying slot 085', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^085[_.]/.test(f));
      assert.deepEqual(files, [MIGRATION_FILENAME]);
    });
  });

  describe('M85-3 — delete-DRAFT RPC EXECUTE baseline REVOKE', () => {
    for (const role of ROLES) {
      it(`revokes EXECUTE on ${DELETE_DRAFT_SIG} from ${role}`, () => {
        const matches = findRevokeStatements('EXECUTE', DELETE_DRAFT_SIG, role);
        assert.ok(matches.length >= 1, `Expected a REVOKE EXECUTE on ${DELETE_DRAFT_SIG} FROM ${role}`);
      });
    }
  });

  describe('M85-4 — exact delete-DRAFT RPC EXECUTE grant', () => {
    it('grants EXECUTE on the delete-DRAFT RPC to service_role exactly once', () => {
      const grants = findGrantStatementsForTarget(DELETE_DRAFT_SIG).filter(
        (s) => /EXECUTE/i.test(s) && /TO\s+service_role\b/i.test(s),
      );
      assert.equal(grants.length, 1);
    });
  });

  describe('M85-5/M85-6/M85-7 — no EXECUTE grant to non-service_role roles', () => {
    it('M85-5: authenticated receives no EXECUTE grant on the delete-DRAFT RPC', () => {
      const grants = findGrantStatementsForTarget(DELETE_DRAFT_SIG).filter((s) =>
        /TO\s+authenticated\b/i.test(s),
      );
      assert.equal(grants.length, 0);
    });

    it('M85-6: anon receives no EXECUTE grant on the delete-DRAFT RPC', () => {
      const grants = findGrantStatementsForTarget(DELETE_DRAFT_SIG).filter((s) => /TO\s+anon\b/i.test(s));
      assert.equal(grants.length, 0);
    });

    it('M85-7: PUBLIC receives no EXECUTE grant on the delete-DRAFT RPC', () => {
      const grants = findGrantStatementsForTarget(DELETE_DRAFT_SIG).filter((s) => /TO\s+PUBLIC\b/i.test(s));
      assert.equal(grants.length, 0);
    });
  });

  describe('M85-8/M85-9 — no GRANT on archive/publish RPCs', () => {
    it('M85-8: no GRANT statement references the archive RPC', () => {
      const grants = structuralStatements.filter(
        (s) => s.toUpperCase().startsWith('GRANT') && s.includes(ARCHIVE_NAME),
      );
      assert.equal(grants.length, 0);
    });

    it('M85-9: no GRANT statement references the publish RPC', () => {
      const grants = structuralStatements.filter(
        (s) => s.toUpperCase().startsWith('GRANT') && s.includes(PUBLISH_NAME),
      );
      assert.equal(grants.length, 0);
    });
  });

  describe('M85-10/M85-11 — no table privilege statement', () => {
    it('M85-10: no GRANT ... ON TABLE ... statement exists', () => {
      const grants = structuralStatements.filter(
        (s) => s.toUpperCase().startsWith('GRANT') && /ON\s+TABLE/i.test(s),
      );
      assert.equal(grants.length, 0);
    });

    it('M85-11: no REVOKE ... ON TABLE ... statement exists', () => {
      const revokes = structuralStatements.filter(
        (s) => s.toUpperCase().startsWith('REVOKE') && /ON\s+TABLE/i.test(s),
      );
      assert.equal(revokes.length, 0);
    });
  });

  describe('M85-12 — no RLS policy statement', () => {
    it('contains no CREATE POLICY / ALTER POLICY / DROP POLICY', () => {
      assert.ok(!/CREATE\s+POLICY/i.test(STRUCTURAL_STATEMENT_SOURCE));
      assert.ok(!/ALTER\s+POLICY/i.test(STRUCTURAL_STATEMENT_SOURCE));
      assert.ok(!/DROP\s+POLICY/i.test(STRUCTURAL_STATEMENT_SOURCE));
    });
  });

  describe('M85-13 — no table/function/trigger DDL', () => {
    it('contains none of the forbidden DDL forms', () => {
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
        assert.ok(!pattern.test(STRUCTURAL_STATEMENT_SOURCE), `Migration must not match ${pattern}`);
      }
    });
  });

  describe('M85-14 — no row-DML or executable procedural statement', () => {
    it('contains none of the forbidden DML/procedural forms', () => {
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
        assert.ok(!pattern.test(STRUCTURAL_STATEMENT_SOURCE), `Migration must not match ${pattern}`);
      }
    });
  });

  describe('M85-15 — no lifecycle RPC invocation', () => {
    it('no statement both leads with SELECT/CALL/PERFORM and invokes a lifecycle RPC', () => {
      const LIFECYCLE_RPC_NAMES = [PUBLISH_NAME, ARCHIVE_NAME, DELETE_DRAFT_NAME];
      const invocationLeaders = /^(SELECT|CALL|PERFORM)\b/i;

      const forbiddenInvocations = structuralStatements.filter((statement) => {
        const upper = statement.toUpperCase();
        if (upper.startsWith('GRANT') || upper.startsWith('REVOKE')) {
          return false;
        }
        if (!invocationLeaders.test(statement)) {
          return false;
        }
        return LIFECYCLE_RPC_NAMES.some((name) => new RegExp(`\\b${name}\\s*\\(`, 'i').test(statement));
      });

      assert.equal(forbiddenInvocations.length, 0);
    });
  });

  describe('M85-16 — no VALUES clause / no source-vocabulary data literal', () => {
    it('M85-16-A: no VALUES clause exists', () => {
      assert.ok(!/\bVALUES\s*\(/i.test(STRUCTURAL_STATEMENT_SOURCE));
    });

    it('M85-16-B: no source-vocabulary data literal exists', () => {
      assert.ok(!rawSql.includes('apollo_organization_industry'));
      assert.ok(!rawSql.includes('Apollo Organization Industry'));
    });
  });

  describe('M85-17 — no association/concept-entry/snapshot/vocabulary content mutation', () => {
    it('is proven by the M85-14 DML ban and M85-16-A/B structural evidence', () => {
      assert.ok(!/INSERT\s+INTO\s/i.test(STRUCTURAL_STATEMENT_SOURCE));
      assert.ok(!/UPDATE\s+public\.\w+\s+SET\s/i.test(STRUCTURAL_STATEMENT_SOURCE));
      assert.ok(!/DELETE\s+FROM\s/i.test(STRUCTURAL_STATEMENT_SOURCE));
      assert.ok(!/\bVALUES\s*\(/i.test(STRUCTURAL_STATEMENT_SOURCE));
      assert.ok(!rawSql.includes('apollo_organization_industry'));
    });
  });

  describe('M85-18 — migration 083 remains byte-identical to the frozen audit', () => {
    it('migration 083 SHA-256 matches the frozen canonical hash', () => {
      const migration083Path = join(
        MIGRATIONS_DIR,
        '083_activate_provider_industry_mapping_draft_and_publish.sql',
      );
      const migration083Sql = readFileSync(migration083Path, 'utf-8');
      const actualSha256 = createHash('sha256').update(migration083Sql, 'utf-8').digest('hex');
      assert.equal(
        actualSha256,
        'd17187e7f27411c5c7be98ed8831a60aa07675c8376747cdd487978788f1a7e2',
        'migration 083 bytes changed since the delete-DRAFT boundary audit — re-audit before relying on this contract',
      );
    });
  });

  describe('M85-19 — migration 084 remains byte-identical to the frozen audit', () => {
    it('migration 084 SHA-256 matches the frozen canonical hash', () => {
      const migration084Path = join(
        MIGRATIONS_DIR,
        '084_seed_apollo_organization_industry_vocabulary.sql',
      );
      const migration084Sql = readFileSync(migration084Path, 'utf-8');
      const actualSha256 = createHash('sha256').update(migration084Sql, 'utf-8').digest('hex');
      assert.equal(
        actualSha256,
        '0c071f62017c1be1eda612b708ea0490f84978d13402bab4fb14e290c3891df4',
        'migration 084 bytes changed since the delete-DRAFT boundary audit — re-audit before relying on this contract',
      );
    });
  });

  describe('M85-20 — no secret or credential-like literal', () => {
    it('contains no secret/credential patterns', () => {
      const forbidden = [
        /sk-[a-zA-Z0-9]/,
        /service_role.{0,20}key/i,
        /postgres(?:ql)?:\/\/\S+:\S+@/i,
        /BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/i,
        /password\s*[:=]\s*['"][^'"]+['"]/i,
      ];
      for (const pattern of forbidden) {
        assert.equal(pattern.test(rawSql), false, `Migration must not match secret pattern ${pattern}`);
      }
    });
  });

  describe('M85-21 — no canonical hyphenated UUID literal', () => {
    it('contains no canonical 8-4-4-4-12 hexadecimal UUID shape', () => {
      const M85_21_UUID_PATTERN =
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
      assert.equal(M85_21_UUID_PATTERN.test(rawSql), false);
    });
  });

  describe('M85-22 — no provider/API/AI-related vendor content', () => {
    const M85_22_PROVIDER_IDENTITY_LITERALS = ['apollo', 'lusha', 'tavily'];

    const M85_22_PROVIDER_OPERATION_KEY_LITERALS = [
      'apollo/organizations',
      'lusha/company_prospecting_v3',
      'organizations_search',
      'organization_enrichment',
    ];

    const M85_22_PRICING_USAGE_LITERALS = [
      'provider_pricing',
      'provider_usage_logs',
      'agent_runs',
      'ai_usage',
      'contact_enrichment',
    ];

    const M85_22_ENDPOINT_PATTERNS: RegExp[] = [];
    const M85_22_API_ROUTE_PATTERNS: RegExp[] = [];
    const M85_22_PROVIDER_HOSTNAME_LITERALS: string[] = [];
    const M85_22_RESPONSE_PAYLOAD_PATTERNS: RegExp[] = [];
    const M85_22_AI_PROVIDER_MODEL_LITERALS: string[] = [];
    const M85_22_AI_PROMPT_CONTENT_PATTERNS: RegExp[] = [];

    it('contains no provider identity literal', () => {
      for (const literal of M85_22_PROVIDER_IDENTITY_LITERALS) {
        assert.equal(
          rawSql.toLowerCase().includes(literal.toLowerCase()),
          false,
          `Migration must not reference provider identity literal "${literal}"`,
        );
      }
    });

    it('contains no provider operation key literal', () => {
      for (const literal of M85_22_PROVIDER_OPERATION_KEY_LITERALS) {
        assert.equal(
          rawSql.toLowerCase().includes(literal.toLowerCase()),
          false,
          `Migration must not reference provider operation key literal "${literal}"`,
        );
      }
    });

    it('contains no pricing/usage literal', () => {
      for (const literal of M85_22_PRICING_USAGE_LITERALS) {
        assert.equal(
          rawSql.toLowerCase().includes(literal.toLowerCase()),
          false,
          `Migration must not reference pricing/usage literal "${literal}"`,
        );
      }
    });

    it('performs zero checks against the explicit empty-set categories', () => {
      for (const pattern of M85_22_ENDPOINT_PATTERNS) assert.equal(pattern.test(rawSql), false);
      for (const pattern of M85_22_API_ROUTE_PATTERNS) assert.equal(pattern.test(rawSql), false);
      for (const literal of M85_22_PROVIDER_HOSTNAME_LITERALS)
        assert.equal(rawSql.toLowerCase().includes(literal.toLowerCase()), false);
      for (const pattern of M85_22_RESPONSE_PAYLOAD_PATTERNS) assert.equal(pattern.test(rawSql), false);
      for (const literal of M85_22_AI_PROVIDER_MODEL_LITERALS)
        assert.equal(rawSql.toLowerCase().includes(literal.toLowerCase()), false);
      for (const pattern of M85_22_AI_PROMPT_CONTENT_PATTERNS) assert.equal(pattern.test(rawSql), false);

      assert.equal(M85_22_ENDPOINT_PATTERNS.length, 0);
      assert.equal(M85_22_API_ROUTE_PATTERNS.length, 0);
      assert.equal(M85_22_PROVIDER_HOSTNAME_LITERALS.length, 0);
      assert.equal(M85_22_RESPONSE_PAYLOAD_PATTERNS.length, 0);
      assert.equal(M85_22_AI_PROVIDER_MODEL_LITERALS.length, 0);
      assert.equal(M85_22_AI_PROMPT_CONTENT_PATTERNS.length, 0);
    });

    it('does not forbid the bare token "provider" or the legitimate domain identifiers', () => {
      assert.ok(rawSql.toLowerCase().includes('provider_industry_mapping'));
      assert.ok(rawSql.includes('delete_draft_provider_industry_mapping_snapshot'));
    });
  });

  describe('M85-23 — frozen SHA-256 of migration 085 itself', () => {
    it('DD-33: migration 085 SHA-256 matches the frozen canonical hash', () => {
      const runtimeHash = createHash('sha256').update(rawSql, 'utf-8').digest('hex');
      assert.equal(
        runtimeHash,
        FROZEN_MIGRATION_085_SHA256,
        'migration 085 bytes changed after the frozen hash was captured — re-audit before relying on this contract',
      );
    });
  });
});
