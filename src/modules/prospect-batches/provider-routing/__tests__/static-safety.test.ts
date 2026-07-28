/**
 * Q3F-5BB.11B — static safety guards for the provider-routing core.
 *
 * Greps every NON-TEST source file under
 * `src/modules/prospect-batches/provider-routing/` to LOCK this slice's
 * boundary: it is a PURE contract + registry + resolver — no Supabase client,
 * no process.env, no fetch, no provider runtime clients, no HubSpot, no DB
 * writes, no migrations, no next/cache revalidation.
 *
 * Comments are stripped before checking so doc comments that legitimately
 * describe what this layer must NOT do don't cause false positives.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

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

const SOURCE_FILES = collectSourceFiles(ROOT);

describe('Q3F-5BB.11B provider-routing — static safety', () => {
  it('collects the expected pure source files', () => {
    assert.ok(SOURCE_FILES.length >= 5, 'should find types + registry + resolver + metadata + index');
    const names = SOURCE_FILES.map((p) => p.replace(ROOT + '/', ''));
    for (const expected of [
      'types.ts',
      'provider-registry.ts',
      'resolve-provider-routing-plan.ts',
      // Q3F-5BB.11C — additive metadata contract (pure).
      'metadata-contract.ts',
      'index.ts',
    ]) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });

  it('never reads a clock (pure — timestamps arrive via context)', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /Date\.now\s*\(|new\s+Date\s*\(/, p);
    }
  });

  it('never imports a Supabase / admin DB client', () => {
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
      assert.doesNotMatch(code, /lusha-client|lusha-preview|lusha-pending-review|lusha-company/i, p);
      assert.doesNotMatch(code, /apollo-organization|apollo-executor|apollo-phone/i, p);
      assert.doesNotMatch(code, /tavily-usage|web-search-tool|web-search-providers/i, p);
    }
  });

  it('never imports HubSpot', () => {
    for (const p of SOURCE_FILES) {
      assert.doesNotMatch(readCode(p), /hubspot/i, p);
    }
  });

  it('never imports feature-flag readers (config is passed in, not read here)', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /feature-flags|isLushaPreviewEnabled|isApollo\w*Enabled/i, p);
    }
  });

  it('never revalidates or touches next/cache', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /next\/cache|revalidatePath|revalidateTag/, p);
      assert.doesNotMatch(code, /['"]server-only['"]/, p);
    }
  });

  it('never performs DB writes or db push', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      assert.doesNotMatch(code, /\.from\(\s*['"]/, p);
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

  it('only imports from its own dir or the pure intake types', () => {
    for (const p of SOURCE_FILES) {
      const code = readCode(p);
      const importRe = /import\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(code)) !== null) {
        const spec = m[1];
        const isRelative = spec.startsWith('.');
        const isIntakeTypes = spec === '@/server/agents/prospect-intake/types';
        assert.ok(
          isRelative || isIntakeTypes,
          `${p} imports unexpected module "${spec}" (only relative or intake types allowed)`,
        );
      }
    }
  });
});
