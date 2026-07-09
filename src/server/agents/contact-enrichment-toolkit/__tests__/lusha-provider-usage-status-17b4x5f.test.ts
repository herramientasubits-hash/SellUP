/**
 * Tests — Lusha Provider Usage Technical Status · Agente 2A · 17B.4X.5F
 *
 * Closes G8 (PROVIDER_USAGE_STATUS_BUSINESS_OUTCOME_COLLISION): a technically
 * successful Lusha provider call must always write
 * provider_usage_logs.status = 'success', independent of downstream
 * candidate/dedup/filter outcomes. Business outcome (no_reviewable_candidate,
 * etc.) belongs in contact_enrichment_runs.summary / LushaRunnerResult.status
 * only — never in provider_usage_logs.status.
 *
 * These two write sites sit inside large DB/network-heavy runner functions
 * that are not independently invocable without a live Supabase + Lusha API
 * (mirrors the existing pattern in lusha-zero-result-usage-17b4x5c.test.ts),
 * so — like that sibling file — behavior is verified via exact source-block
 * assertions anchored on stable, unique markers already present in the file.
 *
 * All pure / source-text based. No live Supabase. No provider calls. No DB writes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { aggregateOperationStats, type OperationStat } from '../../../../modules/ai-usage/queries';

async function readRunnerSource(): Promise<string> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  return fs.readFile(
    path.join(import.meta.dirname, '..', 'lusha-enrichment-runner.ts'),
    'utf-8',
  );
}

// ─── TEST 1/2/3 — prospecting (company_first_discovery) success write ──────

describe('lusha-enrichment-runner source — prospecting technical-success usage write', () => {
  it('TEST 1: writes status success unconditionally, independent of prospectCandidatesCreated', async () => {
    const src = await readRunnerSource();

    const startMarker =
      'const prospectSuccessCostFields = buildLushaRunCostSummaryFields([prospectSuccessCostComponent]);';
    const startIdx = src.indexOf(startMarker);
    assert.ok(startIdx > -1, 'prospecting success cost-fields marker must exist');

    const endIdx = src.indexOf('if (enrichStep) {', startIdx);
    assert.ok(endIdx > startIdx, 'prospecting success block must be followed by the enrichStep finish block');

    const block = src.slice(startIdx, endIdx);
    const usageCalls = block.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(usageCalls.length, 1, 'exactly one logProviderUsage call in this block');

    assert.match(block, /status:\s*'success',/, 'status must be the literal success, not a ternary');
    assert.doesNotMatch(
      block,
      /prospectCandidatesCreated\s*>\s*0\s*\?\s*'success'\s*:\s*'error'/,
      'the business-outcome-driven ternary (G8) must be gone',
    );
  });

  it('TEST 2: credits/cost fields in the same block are byte-identical to before the fix', async () => {
    const src = await readRunnerSource();

    const startMarker =
      'const prospectSuccessCostFields = buildLushaRunCostSummaryFields([prospectSuccessCostComponent]);';
    const startIdx = src.indexOf(startMarker);
    const endIdx = src.indexOf('if (enrichStep) {', startIdx);
    const block = src.slice(startIdx, endIdx);

    assert.match(block, /credits_used:\s*prospectTotalCredits\s*\?\?\s*undefined,/);
    assert.match(block, /results_returned:\s*prospectCandidatesCreated,/);
    assert.match(block, /estimated_cost_usd:\s*prospectSuccessCostComponent\.estimatedCostUsd,/);
    assert.match(block, /real_cost_usd:\s*prospectSuccessCostComponent\.realCostUsd,/);
    assert.match(block, /cost:\s*prospectSuccessCostComponent\.costTrace,/);
  });

  it('TEST 3: the status literal does not vary by candidate count (zero and positive share one code path)', async () => {
    const src = await readRunnerSource();

    const startMarker =
      'const prospectSuccessCostFields = buildLushaRunCostSummaryFields([prospectSuccessCostComponent]);';
    const startIdx = src.indexOf(startMarker);
    const endIdx = src.indexOf('if (enrichStep) {', startIdx);
    const block = src.slice(startIdx, endIdx);

    // Only one status literal in this block, and it is unconditional —
    // there is no branch that could diverge between
    // prospectCandidatesCreated === 0 and prospectCandidatesCreated > 0.
    const statusMatches = block.match(/status:\s*'[a-z_]+',/g) ?? [];
    assert.equal(statusMatches.length, 1);
    assert.equal(statusMatches[0], "status: 'success',");
  });

  it('TEST 4 (regression): the zero-result Path B usage write (17B.4X.5C) is still success', async () => {
    const src = await readRunnerSource();

    const pathBStart = src.indexOf('// Path B — no results');
    const pathCStart = src.indexOf('// Path C — results: filter');
    assert.ok(pathBStart > -1 && pathCStart > pathBStart);

    const block = src.slice(pathBStart, pathCStart);
    assert.match(block, /buildLushaZeroResultProspectingUsageLogInput/);
    assert.doesNotMatch(block, /status:\s*'error',/);
  });
});

// ─── TEST 5/6/7 — company-search batch enrich success write ───────────────

describe('lusha-enrichment-runner source — batch enrich technical-success usage write', () => {
  it('TEST 5: writes status success unconditionally, independent of candidatesCreated', async () => {
    const src = await readRunnerSource();

    const startMarker = '// 8. Enrich up to maxCandidates results';
    const endMarker = '// 10. Update run → ready_for_review';
    const startIdx = src.indexOf(startMarker);
    const endIdx = src.indexOf(endMarker, startIdx);
    assert.ok(startIdx > -1 && endIdx > startIdx, 'batch-enrich block markers must exist');

    const block = src.slice(startIdx, endIdx);
    const usageCalls = block.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(usageCalls.length, 1, 'exactly one logProviderUsage call in the batch-enrich block');

    assert.doesNotMatch(
      block,
      /candidatesCreated\s*>\s*0\s*\?\s*'success'\s*:\s*'error'/,
      'the business-outcome-driven ternary (G8) must be gone',
    );
    assert.doesNotMatch(
      block,
      /candidatesCreated\s*>\s*0\s*\?\s*'success'\s*:\s*'success'/,
      'the dead ternary must have been simplified',
    );

    // Exactly two status:'success' literals remain in this block: the
    // provider_usage_logs write and the finishAgentRunStep write.
    const successLiterals = block.match(/status:\s*'success',/g) ?? [];
    assert.equal(successLiterals.length, 2);
  });

  it('TEST 6: credits/cost fields in the same block are byte-identical to before the fix', async () => {
    const src = await readRunnerSource();

    const startIdx = src.indexOf('// 8. Enrich up to maxCandidates results');
    const endIdx = src.indexOf('// 10. Update run → ready_for_review', startIdx);
    const block = src.slice(startIdx, endIdx);

    assert.match(block, /credits_used:\s*totalCreditsUsed\s*\?\?\s*undefined,/);
    assert.match(block, /results_returned:\s*candidatesCreated,/);
    assert.match(block, /estimated_cost_usd:\s*enrichBatchCostComponent\.estimatedCostUsd,/);
    assert.match(block, /real_cost_usd:\s*enrichBatchCostComponent\.realCostUsd,/);
    assert.match(block, /cost:\s*enrichBatchCostComponent\.costTrace,/);
  });

  it('TEST 7: the status literal does not vary by candidate count (zero and positive share one code path)', async () => {
    const src = await readRunnerSource();

    const startIdx = src.indexOf('// 8. Enrich up to maxCandidates results');
    const endIdx = src.indexOf('// 10. Update run → ready_for_review', startIdx);
    const block = src.slice(startIdx, endIdx);

    // logProviderUsage's status and finishAgentRunStep's status are each a
    // single unconditional literal now — no ternary keyed on candidatesCreated.
    assert.doesNotMatch(block, /candidatesCreated\s*>\s*0\s*\?/);
  });
});

// ─── TEST 8/9 — genuine provider/API error paths remain error ──────────────

describe('lusha-enrichment-runner source — genuine error paths untouched', () => {
  it('TEST 8: prospecting Path A (provider error) still writes status error exactly once', async () => {
    const src = await readRunnerSource();

    const pathAStart = src.indexOf('// Path A — provider error');
    const pathBStart = src.indexOf('// Path B — no results');
    assert.ok(pathAStart > -1 && pathBStart > pathAStart);

    const block = src.slice(pathAStart, pathBStart);
    const usageCalls = block.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(usageCalls.length, 1);
    assert.match(block, /status:\s*'error',/);
  });

  it('TEST 8b: company-search Path A (provider error) still writes status error exactly once', async () => {
    const src = await readRunnerSource();

    const pathAStart = src.indexOf('// Path A — provider error: real failure, not a no-results case.');
    const pathBStart = src.indexOf('// Path B — provider responded OK but found no contacts (not an error).');
    assert.ok(pathAStart > -1 && pathBStart > pathAStart);

    const block = src.slice(pathAStart, pathBStart);
    const usageCalls = block.match(/await logProviderUsage\(/g) ?? [];
    assert.equal(usageCalls.length, 1);
    assert.match(block, /status:\s*'error',/);
  });

  it('TEST 9: genuine error cost/credit expressions are unchanged (search stays unknown-cost, prospecting keeps its charged credits)', async () => {
    const src = await readRunnerSource();

    const prospectPathAStart = src.indexOf('// Path A — provider error');
    const prospectPathBStart = src.indexOf('// Path B — no results');
    const prospectBlock = src.slice(prospectPathAStart, prospectPathBStart);
    assert.match(prospectBlock, /credits_used:\s*prospectResult\.prospectingCreditsCharged\s*\?\?\s*undefined,/);

    const searchPathAStart = src.indexOf('// Path A — provider error: real failure, not a no-results case.');
    const searchPathBStart = src.indexOf('// Path B — provider responded OK but found no contacts (not an error).');
    const searchBlock = src.slice(searchPathAStart, searchPathBStart);
    assert.match(searchBlock, /lushaSearchUnknownCostComponent\(\)/);
  });
});

// ─── TEST 10 — provider error-rate stat reflects the corrected semantics ───

describe('aggregateOperationStats — TEST 10: corrected G8 rows count as success, genuine errors count as error', () => {
  it('a technically-successful all-duplicates/zero-candidate row is a success_call; a genuine provider error stays an error_call', () => {
    const rows: Array<{
      operation_key: string | null;
      status: string | null;
      credits_used: number | null;
      estimated_cost_usd: number | null;
    }> = [
      // Corrected G8 row — provider succeeded technically (e.g. Apuesta Total:
      // 25 raw results, all deduped, 0 candidates created).
      {
        operation_key: 'lusha_contact_prospecting',
        status: 'success',
        credits_used: 2,
        estimated_cost_usd: 0.176471,
      },
      // Genuine provider/API failure — must remain classified as an error.
      {
        operation_key: 'lusha_contact_prospecting',
        status: 'error',
        credits_used: null,
        estimated_cost_usd: null,
      },
    ];

    const stats: OperationStat[] = aggregateOperationStats(rows);
    const target = stats.find((s) => s.operation_key === 'lusha_contact_prospecting');
    assert.ok(target, 'expected an aggregated row for lusha_contact_prospecting');
    assert.equal(target!.total_calls, 2);
    assert.equal(target!.success_calls, 1, 'the corrected all-duplicates row must count as a success call');
    assert.equal(target!.error_calls, 1, 'the genuine error row must still count as an error call');
  });
});
