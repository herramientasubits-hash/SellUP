/**
 * Q3F-5BB.10B1 — static safety guards for the provider-agnostic intake layer.
 *
 * Greps every NON-TEST source file under `src/server/agents/prospect-intake/` to
 * LOCK this milestone's boundary: the intake layer is a PURE contract/adapter
 * layer — no Supabase client, no process.env, no fetch, no provider runtime
 * clients, no HubSpot, no DB writes, no migrations, no identity_key.
 *
 * Comments are stripped before checking so the doc comments (which legitimately
 * describe what this layer must NOT do) don't cause false positives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INTAKE_ROOT = resolve(HERE, '..');

/** Recursively collect .ts source files, excluding the __tests__ tree. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block + line comments so forbidden-pattern checks target real CODE only. */
function readCode(p: string): string {
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SOURCE_FILES = collectSourceFiles(INTAKE_ROOT);

describe('Q3F-5BB.10B1 intake layer — static safety', () => {
  it('collects the expected pure source files', () => {
    assert.ok(SOURCE_FILES.length >= 5, 'should find types + normalize + 3 adapters + index');
    const names = SOURCE_FILES.map((p) => p.replace(INTAKE_ROOT + '/', ''));
    for (const expected of [
      'types.ts',
      'normalize.ts',
      'index.ts',
      'adapters/lusha.ts',
      'adapters/apollo.ts',
      'adapters/tavily.ts',
    ]) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });

  it('never imports a Supabase client', () => {
    for (const p of SOURCE_FILES) {
      assert.doesNotMatch(readCode(p), /supabase|createClient|createSupabaseAdminClient/i, p);
    }
  });

  it('never reads process.env', () => {
    for (const p of SOURCE_FILES) {
      assert.doesNotMatch(readCode(p), /process\.env/, p);
    }
  });

  it('never uses fetch / network', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /\bfetch\s*\(/, p);
      assert.doesNotMatch(code, /\baxios\b|XMLHttpRequest|require\(\s*['"]https?['"]\s*\)/, p);
    }
  });

  it('never imports provider runtime clients', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /lusha-client|lusha-preview|lusha-pending-review/i, p);
      assert.doesNotMatch(code, /apollo-organization-enrichment|apollo-organizations-usage/i, p);
      assert.doesNotMatch(code, /tavily-usage-logging|web-search-tool|web-search-providers/i, p);
    }
  });

  it('never imports HubSpot', () => {
    for (const p of SOURCE_FILES) {
      assert.doesNotMatch(readCode(p), /hubspot/i, p);
    }
  });

  it('never performs DB writes or db push', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /\.from\(\s*['"]/, p); // supabase-style table access
      assert.doesNotMatch(code, /\.(insert|upsert|delete)\s*\(/, p);
      assert.doesNotMatch(code, /supabase\s+db\s+push/i, p);
    }
  });

  it('never references migrations or identity_key', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /migrations?\//, p);
      assert.doesNotMatch(code, /identity_key/, p);
    }
  });
});
