// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — static proof that NOTHING in this
// module imports an Apollo/Lusha/Tavily/HubSpot client or integration file.
// Complements the runtime tests (pipeline-writer.test.ts,
// send-to-review-actions.test.ts), which prove behaviour under a fake
// Supabase; this test proves the SOURCE never references a provider module
// at all, so no future edit can silently add a provider call without also
// changing an import statement this test reads.
//
// Test F: "Enviar a revisión" — no invoca ningún proveedor.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MODULE_DIR = path.join(__dirname, '..');

const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
  /apollo-organizations/i,
  /apollo-two-round/i,
  /prospecting-toolkit\/apollo/i,
  /hubspot-contact-sync/i,
  /hubspot-company-create/i,
  /hubspot-duplicate-checker/i,
  /hubspot-commercial-checker/i,
  /services\/hubspot/i,
  /lusha/i,
  /tavily/i,
  /web-search/i,
];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '__tests__') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('prospect-discards module — zero provider imports (Test F)', () => {
  const files = listSourceFiles(MODULE_DIR);

  it('found the expected module files (sanity check the scan itself ran)', () => {
    assert.ok(files.length >= 5, `expected at least 5 source files, found ${files.length}`);
  });

  for (const file of files) {
    const relative = path.relative(MODULE_DIR, file);
    it(`${relative} does not import any Apollo/Lusha/Tavily/HubSpot module`, () => {
      const content = readFileSync(file, 'utf8');
      const importLines = content
        .split('\n')
        .filter((line) => /^\s*import\b/.test(line) || /^\s*}\s*from\s+['"]/.test(line));
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        for (const line of importLines) {
          assert.ok(
            !pattern.test(line),
            `${relative} imports a provider-shaped module (matches ${pattern}): "${line.trim()}"`,
          );
        }
      }
    });
  }
});

describe('send-to-review-actions.ts — no fetch/HTTP call of its own', () => {
  it('never calls fetch(), XMLHttpRequest, or axios directly', () => {
    const content = readFileSync(path.join(MODULE_DIR, 'send-to-review-actions.ts'), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(content));
    assert.ok(!/axios/.test(content));
    assert.ok(!/XMLHttpRequest/.test(content));
  });
});

describe('pipeline-writer.server.ts — no fetch/HTTP call of its own', () => {
  it('never calls fetch(), XMLHttpRequest, or axios directly', () => {
    const content = readFileSync(path.join(MODULE_DIR, 'pipeline-writer.server.ts'), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(content));
    assert.ok(!/axios/.test(content));
    assert.ok(!/XMLHttpRequest/.test(content));
  });
});
