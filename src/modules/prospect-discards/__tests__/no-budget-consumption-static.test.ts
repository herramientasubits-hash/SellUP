// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — static proof that nothing in this
// module reads or writes budget/credit tables or RPCs. "Enviar a revisión"
// must consume zero additional credits (issue #389, absolute requirement).
//
// Test K: no credit consumption.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MODULE_DIR = path.join(__dirname, '..');

const FORBIDDEN_BUDGET_PATTERNS: RegExp[] = [
  /wizard_monthly_budget_periods/,
  /wizard_budget_period_changes/,
  /try_reserve_wizard_credits/,
  /confirm_wizard_credits/,
  /release_wizard_credits/,
  /admin_set_wizard_budget_period/,
  /admin_set_wizard_max_credits_per_execution/,
  /budget_credits/,
  /credits_consumed/,
  /credits_reserved/,
  /tool_catalog/,
  /monthly_credits_allowance/,
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

describe('prospect-discards module — zero budget/credit references (Test K)', () => {
  const files = listSourceFiles(MODULE_DIR);

  for (const file of files) {
    const relative = path.relative(MODULE_DIR, file);
    it(`${relative} never references a budget/credit table or RPC`, () => {
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_BUDGET_PATTERNS) {
        assert.ok(!pattern.test(content), `${relative} references forbidden budget symbol: ${pattern}`);
      }
    });
  }
});

describe('the pipeline hook in production-runner.server.ts touches no budget symbol', () => {
  it('the persistApolloRejectedDispositions call site does not read/write budget/credit state', () => {
    const runnerPath = path.join(
      MODULE_DIR,
      '..',
      '..',
      'server',
      'agents',
      'prospecting-toolkit',
      'apollo-two-round',
      'production-runner.server.ts',
    );
    const content = readFileSync(runnerPath, 'utf8');
    const hookStart = content.indexOf('AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — durable, per-company record');
    assert.ok(hookStart >= 0, 'expected to find the hook comment in production-runner.server.ts');
    const hookBlock = content.slice(hookStart, hookStart + 1500);
    for (const pattern of FORBIDDEN_BUDGET_PATTERNS) {
      assert.ok(!pattern.test(hookBlock), `pipeline hook references forbidden budget symbol: ${pattern}`);
    }
  });
});
