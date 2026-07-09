// Tests — supabase/migrations/084_seed_apollo_organization_industry_vocabulary.sql
// (Q3F-5AO.2)
//
// Static offline contract audit for migration 084: reads the migration SQL
// as local text and asserts its exact narrow one-row configuration-bootstrap
// seed shape. No Supabase, no network, no DB connection, no provider, no AI.
//
// Statement-level parsing distinguishes the executable INSERT statement from
// SQL keywords appearing inside comments or string literals, so header
// commentary documenting forbidden forms (e.g. "no ON CONFLICT") cannot
// itself produce a false positive.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILENAME = '084_seed_apollo_organization_industry_vocabulary.sql';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_FILENAME);

const sql = readFileSync(MIGRATION_PATH, 'utf-8');

// Comment-stripped SQL for structural statement assertions. `sql` (with
// comments intact) is still used for header/documentation and
// forbidden-credential checks below.
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

const VOCAB_TABLE = 'public.provider_industry_source_vocabularies';
const FROZEN_KEY = 'apollo_organization_industry';
const FROZEN_LIFECYCLE = 'active';
const FROZEN_DISPLAY_NAME = 'Apollo Organization Industry';

const insertStatements = statements.filter((s) => /^INSERT\s+INTO\s/i.test(s));

describe('Migration 084 — Apollo organization-industry vocabulary bootstrap seed', () => {
  describe('M84-1/M84-2 — migration slot', () => {
    it('M84-1: exact migration filename exists', () => {
      assert.doesNotThrow(() => readFileSync(MIGRATION_PATH, 'utf-8'));
    });

    it('M84-2: 084 is the only migration occupying slot 084', () => {
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^084[_.]/.test(f));
      assert.deepEqual(files, [MIGRATION_FILENAME]);
    });
  });

  describe('M84-3 — exact target table', () => {
    it('references public.provider_industry_source_vocabularies', () => {
      assert.ok(sqlWithoutLineComments.includes(VOCAB_TABLE));
    });
  });

  describe('M84-4/M84-5 — exactly one executable INSERT into the vocabulary table', () => {
    it('M84-4: exactly one executable INSERT statement exists', () => {
      assert.equal(insertStatements.length, 1);
    });

    it('M84-5: the INSERT target is the vocabulary table', () => {
      assert.ok(insertStatements[0]!.includes(VOCAB_TABLE));
    });
  });

  describe('M84-6 — explicit insert column set', () => {
    it('is exactly source_vocabulary_key, lifecycle, display_name', () => {
      const insert = insertStatements[0]!;
      const columnListMatch = insert.match(/\(\s*([^)]+?)\s*\)\s*VALUES/i);
      assert.ok(columnListMatch, 'Expected an explicit column list before VALUES');
      const columns = columnListMatch![1]!.split(',').map((c) => c.trim());
      assert.deepEqual(columns, ['source_vocabulary_key', 'lifecycle', 'display_name']);
    });
  });

  describe('M84-7/M84-8/M84-9 — exact seeded values', () => {
    const insert = insertStatements[0]!;
    const valuesMatch = insert.match(/VALUES\s*\(\s*([^)]+?)\s*\)\s*$/i);
    assert.ok(valuesMatch, 'Expected a single VALUES(...) clause');
    const values = valuesMatch![1]!.split(',').map((v) => v.trim());

    it('M84-7: source_vocabulary_key exact value', () => {
      assert.equal(values[0], `'${FROZEN_KEY}'`);
    });

    it('M84-8: lifecycle exact value', () => {
      assert.equal(values[1], `'${FROZEN_LIFECYCLE}'`);
    });

    it('M84-9: display_name exact value', () => {
      assert.equal(values[2], `'${FROZEN_DISPLAY_NAME}'`);
    });
  });

  describe('M84-10 — exactly one row in the VALUES clause', () => {
    it('has no second row (no "), (" row separator after VALUES)', () => {
      const insert = insertStatements[0]!;
      const afterValues = insert.slice(insert.toUpperCase().indexOf('VALUES'));
      const rowSeparators = afterValues.match(/\)\s*,\s*\(/g) ?? [];
      assert.equal(rowSeparators.length, 0);
    });
  });

  describe('M84-11/M84-12 — created_at/updated_at use table defaults', () => {
    it('M84-11: created_at is not explicitly inserted', () => {
      const insert = insertStatements[0]!;
      assert.ok(!/\bcreated_at\b/i.test(insert));
    });

    it('M84-12: updated_at is not explicitly inserted', () => {
      const insert = insertStatements[0]!;
      assert.ok(!/\bupdated_at\b/i.test(insert));
    });
  });

  describe('M84-13 through M84-17 — no other vocabulary key seeded', () => {
    it('M84-13: no second vocabulary key literal is seeded', () => {
      const insert = insertStatements[0]!;
      // Only one string literal set exists per row; assert only the
      // frozen key appears as the first VALUES element across the file.
      const keyLiterals = [...sqlWithoutLineComments.matchAll(/VALUES\s*\(\s*'([^']+)'/gi)].map((m) => m[1]);
      assert.deepEqual(keyLiterals, [FROZEN_KEY]);
      assert.ok(insert.includes(FROZEN_KEY));
    });

    it('M84-14: no Lusha vocabulary is seeded', () => {
      assert.ok(!sql.includes('lusha'));
    });

    it('M84-15: no Tavily/web vocabulary is seeded', () => {
      assert.ok(!sql.toLowerCase().includes('tavily'));
      assert.ok(!/'web'/i.test(sqlWithoutLineComments));
    });

    it('M84-16: no apollo/organizations literal is used as seeded key', () => {
      assert.ok(!sqlWithoutLineComments.includes("'apollo/organizations'"));
      assert.ok(!sqlWithoutLineComments.includes("'apollo'"));
    });

    it('M84-17: no operation key is used as seeded vocabulary key', () => {
      assert.ok(!sqlWithoutLineComments.includes("'organizations_search'"));
      assert.ok(!sqlWithoutLineComments.includes("'organization_enrichment'"));
    });
  });

  describe('M84-18 through M84-23 — no conflict-handling / mutation semantics', () => {
    it('M84-18: no ON CONFLICT', () => {
      assert.ok(!/ON\s+CONFLICT/i.test(sqlWithoutLineComments));
    });

    it('M84-19: no WHERE NOT EXISTS', () => {
      assert.ok(!/WHERE\s+NOT\s+EXISTS/i.test(sqlWithoutLineComments));
    });

    it('M84-20: no MERGE/upsert semantics', () => {
      assert.ok(!/\bMERGE\b/i.test(sqlWithoutLineComments));
      assert.ok(!/\bUPSERT\b/i.test(sqlWithoutLineComments));
    });

    it('M84-21: no UPDATE row statement', () => {
      assert.ok(!/UPDATE\s+public\.\w+\s+SET\s/i.test(sqlWithoutLineComments));
    });

    it('M84-22: no DELETE row statement', () => {
      assert.ok(!/DELETE\s+FROM\s/i.test(sqlWithoutLineComments));
    });

    it('M84-23: no DO block', () => {
      assert.ok(!/\bDO\s*\$\$/i.test(sqlWithoutLineComments));
    });
  });

  describe('M84-24/M84-25/M84-26 — no privilege or RLS statement', () => {
    it('M84-24: no GRANT', () => {
      assert.ok(!/^\s*GRANT\b/im.test(sqlWithoutLineComments));
    });

    it('M84-25: no REVOKE', () => {
      assert.ok(!/^\s*REVOKE\b/im.test(sqlWithoutLineComments));
    });

    it('M84-26: no RLS/policy statement', () => {
      assert.ok(!/CREATE\s+POLICY/i.test(sqlWithoutLineComments));
      assert.ok(!/ALTER\s+POLICY/i.test(sqlWithoutLineComments));
      assert.ok(!/DROP\s+POLICY/i.test(sqlWithoutLineComments));
      assert.ok(!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sqlWithoutLineComments));
      assert.ok(!/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sqlWithoutLineComments));
    });
  });

  describe('M84-27 — no table/function/trigger DDL', () => {
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
      ];
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(sqlWithoutLineComments), `Migration must not match ${pattern}`);
      }
    });
  });

  describe('M84-28 — no lifecycle RPC invocation', () => {
    it('does not call the publish/archive/delete-draft RPCs', () => {
      assert.ok(!/\bpublish_provider_industry_mapping_snapshot\s*\(/i.test(sqlWithoutLineComments));
      assert.ok(!/\barchive_provider_industry_mapping_snapshot\s*\(/i.test(sqlWithoutLineComments));
      assert.ok(!/\bdelete_draft_provider_industry_mapping_snapshot\s*\(/i.test(sqlWithoutLineComments));
      assert.ok(!/\bSELECT\b/i.test(sqlWithoutLineComments));
      assert.ok(!/\bCALL\s/i.test(sqlWithoutLineComments));
    });
  });

  describe('M84-29 — no mapping snapshot/concept/association seed', () => {
    it('inserts into no table other than the vocabulary table', () => {
      for (const insert of insertStatements) {
        assert.ok(!insert.includes('provider_industry_mapping_snapshots'));
        assert.ok(!insert.includes('provider_industry_concept_entries'));
        assert.ok(!insert.includes('provider_industry_mapping_associations'));
      }
    });
  });

  describe('M84-30 — no provider-pricing/provider-usage/AI data mutation', () => {
    it('does not touch pricing/usage/agent-run/AI tables', () => {
      const forbiddenTables = [
        'provider_pricing',
        'provider_usage_logs',
        'agent_runs',
        'ai_usage',
        'contact_enrichment',
      ];
      for (const table of forbiddenTables) {
        assert.ok(!sqlWithoutLineComments.includes(table), `Migration must not reference ${table}`);
      }
    });
  });

  describe('M84-31 — no credential-like literal', () => {
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

  describe('M84-32/M84-33/M84-34/M84-35 — required header commentary', () => {
    it('M84-32: distinguishes vocabulary identity from Apollo operation identity', () => {
      assert.ok(/operation_key/i.test(sql));
      assert.ok(/organizations_search/.test(sql));
      assert.ok(/organization_enrichment/.test(sql));
      assert.ok(/source_vocabulary_key/i.test(sql));
    });

    it('M84-33: records industry vs industries[] as transport-shape variants of one vocabulary', () => {
      assert.ok(/industry:\s*string \| null/i.test(sql) || /`industry`/i.test(sql));
      assert.ok(/industries:\s*string\[\] \| null/i.test(sql) || /`industries`/i.test(sql));
      assert.ok(/transport-shape variant/i.test(sql));
    });

    it('M84-34: states ingestion/fan-out semantics remain out of scope', () => {
      assert.ok(/does NOT define raw-label ingestion/i.test(sql));
    });

    it('M84-35: states runtime vocabulary DML remains disabled', () => {
      assert.ok(/SELECT-only/i.test(sql));
      assert.ok(/Runtime DML on\s*[\s\S]*?remains disabled/i.test(sql));
    });
  });
});
