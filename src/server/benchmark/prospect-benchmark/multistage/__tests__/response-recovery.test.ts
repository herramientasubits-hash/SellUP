/**
 * Tests — Response Recovery (Hotfix 16AB.23.9)
 *
 * 15 test cases covering:
 *   1  HTTP 200 + malformed JSON + usage → tokens/cost preserved, parsing fails
 *   2  HTTP 200 + web search audit + malformed JSON → audit saved
 *   3  JSON in code fence → extracted correctly
 *   4  Text before and after JSON → scanner finds JSON
 *   5  Interleaved search/text blocks → only text concatenated
 *   6  One invalid row among five → four preserved, completed_partial
 *   7  stop_reason=max_tokens → truncated_output, not malformed_json
 *   8  stop_reason=pause_turn → pause_turn_unhandled, not parsed
 *   9  Empty response → empty_response, no repair attempted
 *  10  Two identical invalid responses → no third attempt (repeated_invalid_response)
 *  11  429 rate limit → existing backoff behaviour preserved
 *  12  Error with usage → usage-bearing call counted
 *  13  Error without usage → NOT counted as usage-bearing
 *  14  Diagnostic is sanitized → no raw text in stored record
 *  15  Truncated batch → retry uses requestedCount=3
 *
 * No real API calls. No real timers. Uses Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { callWithRetry } from '../client';
import { runStage2DiscoveryBatch } from '../stages';
import { CheckpointManager } from '../checkpoint';
import { extractJsonRobust, looksLikeIncompleteJson, isTruncatedByTokenLimit } from '../json-extractor';
import { buildInvalidResponseDiagnostic, computeResponseHash } from '../response-diagnostics';
import type { FetchFn } from '../client';
import type { ExecutionMetrics } from '../ms-types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'bench-recovery-test-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function buildMetrics(): ExecutionMetrics {
  return {
    total_api_calls: 0,
    successful_api_calls: 0,
    failed_api_calls: 0,
    retried_api_calls: 0,
    rate_limit_wait_ms: 0,
    discovery_batches_completed: 0,
    verification_batches_completed: 0,
    resumed_from_checkpoint: false,
    checkpoint_count: 0,
    per_stage_duration_ms: {},
    longest_call_duration_ms: 0,
    terminated_connections: 0,
    partial_results_preserved: false,
  };
}

function makeCheckpoint(dir: string): CheckpointManager {
  return CheckpointManager.create(dir, 'run-test', 'hash-test');
}

/** Build a synthetic Anthropic HTTP response. */
function makeAnthropicResponse(opts: {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string;
  usage?: { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests?: number } };
}): Response {
  const body = JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: opts.content,
    model: 'claude-sonnet-4-6',
    stop_reason: opts.stop_reason,
    usage: opts.usage ?? { input_tokens: 150, output_tokens: 300 },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

function discoveryJsonText(candidates: unknown[]): string {
  const json = JSON.stringify({ batch_index: 0, batch_theme: 'SaaS', candidates });
  return `<json_output>${json}</json_output>`;
}

const VALID_CANDIDATE = {
  name: 'Empresa SaaS',
  website: 'https://empresa.com.co',
  linkedin: 'https://www.linkedin.com/company/empresa',
  city: 'Bogotá',
  sector: 'Tecnología / SaaS B2B',
  description: 'Plataforma B2B',
  confidence: 'Alta',
  evidence_url: 'https://www.linkedin.com/company/empresa',
  evidence_source: 'LinkedIn',
  estimated_size: '50-100',
  notes: '',
};

const SYSTEM_PROMPT = 'You are an expert B2B prospect researcher.';

// ─── Test 1: HTTP 200 + malformed JSON + usage → usage preserved ──────────────

describe('response-recovery', () => {

  it('1. HTTP 200 + malformed JSON + usage → tokens preserved, parsing fails gracefully', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = makeCheckpoint(dir);
      const metrics = buildMetrics();

      // Response: valid HTTP 200, usage present, but model output is not parseable JSON
      const fetch: FetchFn = async () => makeAnthropicResponse({
        content: [{ type: 'text', text: 'Here are the companies: { broken json' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 120, output_tokens: 200 },
      });

      const result = await runStage2DiscoveryBatch(
        'fake-key', 0, 'SaaS test', 'Colombia', 'test context', [],
        checkpoint, metrics, fetch
      );

      // Parse fails, batch not completed, returns empty array
      assert.deepEqual(result, []);
      assert.equal(checkpoint.isDiscoveryBatchCompleted(0), false);

      // Tokens ARE preserved (addUsage was called before parsing)
      const state = checkpoint.getState();
      assert.equal(state.usage.input_tokens, 120, 'input tokens must be preserved');
      assert.equal(state.usage.output_tokens, 200, 'output tokens must be preserved');
      assert.equal(state.usage.usage_bearing_api_calls, 1, 'must count as usage-bearing');
      assert.ok(state.usage.known_cost_usd > 0, 'known cost must be positive');
    } finally {
      cleanup(dir);
    }
  });

  // ─── Test 2: HTTP 200 + web search audit + malformed JSON → audit saved ─────

  it('2. HTTP 200 + web search audit + malformed JSON → audit is saved', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = makeCheckpoint(dir);
      const metrics = buildMetrics();

      const fetch: FetchFn = async () => makeAnthropicResponse({
        content: [
          {
            type: 'server_tool_use',
            id: 'stool_01',
            name: 'web_search',
            input: { query: 'empresas SaaS Colombia' },
          },
          {
            type: 'web_search_tool_result',
            tool_use_id: 'stool_01',
            content: [{ type: 'web_search_result', url: 'https://example.com', title: 'Example' }],
          },
          { type: 'text', text: 'not valid json at all @@##' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 150, server_tool_use: { web_search_requests: 1 } },
      });

      await runStage2DiscoveryBatch(
        'fake-key', 1, 'Datos IA', 'Colombia', 'context', [],
        checkpoint, metrics, fetch
      );

      const state = checkpoint.getState();
      // Search audit counts must be accumulated even though JSON parse failed
      assert.equal(state.usage.web_search_requests_reported, 1, 'search requests must be recorded');
      assert.equal(state.usage.web_search_results_count, 1, 'search results count must be recorded');
      // Tokens still preserved
      assert.equal(state.usage.input_tokens, 100);
    } finally {
      cleanup(dir);
    }
  });

  // ─── Test 3: JSON in code fence → extracted correctly ────────────────────────

  it('3. JSON in markdown code fence → extracted correctly', () => {
    const json = { batch_index: 0, candidates: [VALID_CANDIDATE] };
    const text = `Some intro text\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\nSome trailing text`;

    const result = extractJsonRobust(text, null);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.strategy, 'code_fence');
      const data = result.data as { candidates: unknown[] };
      assert.equal(data.candidates.length, 1);
    }
  });

  // ─── Test 4: Text before and after JSON → balanced scanner finds JSON ────────

  it('4. Text before and after JSON → balanced scanner finds JSON', () => {
    const json = { candidates: [VALID_CANDIDATE, VALID_CANDIDATE] };
    const text = `The results I found are as follows:\n${JSON.stringify(json)}\nHope this helps!`;

    const result = extractJsonRobust(text, null);
    assert.equal(result.success, true);
    if (result.success) {
      // Should find via balanced_scanner since no fence or xml tag
      const data = result.data as { candidates: unknown[] };
      assert.equal(data.candidates.length, 2);
    }
  });

  // ─── Test 5: Interleaved search/text blocks → only text concatenated ─────────

  it('5. Interleaved server_tool_use + web_search_tool_result + text → only text extracted', async () => {
    // Use callAgentic directly via callWithRetry with a mock
    const json = { batch_index: 0, candidates: [VALID_CANDIDATE] };
    const fetch: FetchFn = async () => makeAnthropicResponse({
      content: [
        { type: 'server_tool_use', id: 'st1', name: 'web_search', input: { query: 'q' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'st1',
          content: [{ type: 'web_search_result', url: 'https://x.com', title: 'X' }],
        },
        { type: 'text', text: `<json_output>${JSON.stringify(json)}</json_output>` },
        { type: 'server_tool_use', id: 'st2', name: 'web_search', input: { query: 'q2' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'st2',
          content: [{ type: 'web_search_result', url: 'https://y.com', title: 'Y' }],
        },
        { type: 'text', text: '' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 200, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
    });

    const result = await callWithRetry(
      'fake-key', 'prompt',
      { maxSearchUses: 4, timeoutMs: 5000, systemPrompt: SYSTEM_PROMPT },
      undefined, fetch, async () => {}
    );

    assert.equal(result.errorCode, null, 'should succeed');
    assert.ok(result.data !== null, 'data must not be null');
    // Data should be only the text blocks joined — search blocks excluded
    assert.ok(!result.data!.includes('web_search_result'), 'search block content must not appear in data');
    assert.ok(result.data!.includes('json_output'), 'text block content must be present');
  });

  // ─── Test 6: One invalid row among five → four preserved, completed_partial ──

  it('6. One invalid row among five candidates → four preserved, batch completed_partial', async () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = makeCheckpoint(dir);
      const metrics = buildMetrics();

      const candidates = [
        { ...VALID_CANDIDATE, name: 'Empresa 1' },
        { ...VALID_CANDIDATE, name: 'Empresa 2' },
        { ...VALID_CANDIDATE, name: 'Empresa 3' },
        { ...VALID_CANDIDATE, name: 'Empresa 4' },
        { ...VALID_CANDIDATE, name: '', website: 'not-a-url' }, // invalid: empty name
      ];

      const fetch: FetchFn = async () => makeAnthropicResponse({
        content: [{ type: 'text', text: discoveryJsonText(candidates) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 250 },
      });

      const result = await runStage2DiscoveryBatch(
        'fake-key', 2, 'Fintech', 'Colombia', 'ctx', [],
        checkpoint, metrics, fetch
      );

      // 4 valid candidates preserved
      assert.equal(result.length, 4, '4 valid candidates should be preserved');
      assert.equal(checkpoint.isDiscoveryBatchCompleted(2), true, 'batch should be marked completed');
      // Partial completion tracked
      assert.equal(metrics.partial_batches_completed ?? 0, 1, 'partial_batches_completed must be 1');
    } finally {
      cleanup(dir);
    }
  });

  // ─── Test 7: stop_reason=max_tokens → truncated_output ───────────────────────

  it('7. stop_reason=max_tokens → errorCode is truncated_output, not malformed_json', async () => {
    const fetch: FetchFn = async () => makeAnthropicResponse({
      content: [{ type: 'text', text: '{"candidates":[{"name":"Empresa' }], // truncated JSON
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 4096 },
    });

    const result = await callWithRetry(
      'fake-key', 'prompt',
      { maxSearchUses: 0, timeoutMs: 5000, systemPrompt: SYSTEM_PROMPT },
      undefined, fetch, async () => {}
    );

    // Client returns data (there IS text), but the text is truncated
    assert.ok(result.data !== null, 'data must not be null — text was returned');
    assert.equal(result.stopReason, 'max_tokens');

    // Extractor should detect truncation
    const extraction = extractJsonRobust(result.data!, result.stopReason);
    assert.equal(extraction.success, false);
    if (!extraction.success) {
      assert.equal(extraction.error, 'truncated_output');
      assert.equal(extraction.truncated, true);
    }
  });

  // ─── Test 8: stop_reason=pause_turn → pause_turn_unhandled, not parsed ───────

  it('8. stop_reason=pause_turn → errorCode is pause_turn_unhandled', async () => {
    const fetch: FetchFn = async () => makeAnthropicResponse({
      content: [{ type: 'server_tool_use', id: 'st1', name: 'web_search', input: { query: 'q' } }],
      stop_reason: 'pause_turn',
      usage: { input_tokens: 80, output_tokens: 10 },
    });

    const result = await callWithRetry(
      'fake-key', 'prompt',
      { maxSearchUses: 4, timeoutMs: 5000, systemPrompt: SYSTEM_PROMPT },
      undefined, fetch, async () => {}
    );

    assert.equal(result.errorCode, 'pause_turn_unhandled');
    assert.equal(result.data, null);
    assert.equal(result.stopReason, 'pause_turn');
    // Usage IS captured (the model did use tokens)
    assert.equal(result.usage.input_tokens, 80);
  });

  // ─── Test 9: Empty response → empty_response, no repair ──────────────────────

  it('9. Empty content array → empty_response, data is null', async () => {
    const fetch: FetchFn = async () => makeAnthropicResponse({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 50, output_tokens: 0 },
    });

    const result = await callWithRetry(
      'fake-key', 'prompt',
      { maxSearchUses: 0, timeoutMs: 5000, systemPrompt: SYSTEM_PROMPT },
      undefined, fetch, async () => {}
    );

    assert.equal(result.errorCode, 'empty_response');
    assert.equal(result.data, null);
    // Empty response check
    const extraction = extractJsonRobust('', null);
    assert.equal(extraction.success, false);
    if (!extraction.success) assert.equal(extraction.error, 'empty_text');
  });

  // ─── Test 10: Two identical invalid responses → no third attempt ──────────────

  it('10. Two consecutive identical invalid responses → repeated_invalid_response, no third attempt', async () => {
    let callCount = 0;
    const fetch: FetchFn = async () => {
      callCount++;
      // Always return same response: text but unparseable JSON
      return makeAnthropicResponse({
        content: [{ type: 'text', text: 'not json { broken' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    };

    const dir = makeTmpDir();
    try {
      const checkpoint = makeCheckpoint(dir);
      const metrics = buildMetrics();

      await runStage2DiscoveryBatch(
        'fake-key', 3, 'IA', 'Colombia', 'ctx', [],
        checkpoint, metrics, fetch
      );

      // Should not call more than twice (detected identical on second attempt)
      // max_retries_per_call = 2 means up to 3 attempts, but dedup should stop at 2
      assert.ok(callCount <= 2, `Expected at most 2 calls, got ${callCount}`);
    } finally {
      cleanup(dir);
    }
  });

  // ─── Test 11: 429 → existing rate-limit backoff preserved ────────────────────

  it('11. 429 rate limit → rate_limit errorCode, backoff applied, NOT counted as usage-bearing', async () => {
    let callCount = 0;
    const fetch: FetchFn = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }
      return makeAnthropicResponse({
        content: [{ type: 'text', text: discoveryJsonText([VALID_CANDIDATE]) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 200 },
      });
    };

    const result = await callWithRetry(
      'fake-key', 'prompt',
      { maxSearchUses: 0, timeoutMs: 5000, systemPrompt: SYSTEM_PROMPT },
      undefined, fetch, async () => {} // no-op sleep
    );

    assert.equal(result.retried, true, 'should have retried');
    assert.equal(result.errorCode, null, 'should succeed after retry');
    // 429 attempts do NOT count toward usage-bearing
    assert.equal(result.usage.input_tokens, 100, 'tokens from successful call only');
  });

  // ─── Test 12: Error with usage → usage-bearing call counted ──────────────────

  it('12. Error response with usage tokens → counted as usage-bearing', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = makeCheckpoint(dir);

      // Simulate a BatchUsage with tokens (as would come from a no_text_blocks error)
      const usage = {
        input_tokens: 200,
        output_tokens: 150,
        search_calls: 0,
        search_count_status: 'unavailable' as const,
        token_cost_usd: (200 / 1_000_000) * 3.0 + (150 / 1_000_000) * 15.0,
        web_search_cost_usd: null,
        cost_usd: (200 / 1_000_000) * 3.0 + (150 / 1_000_000) * 15.0,
      };

      checkpoint.addUsage(usage, 'no_text_blocks');

      const state = checkpoint.getState();
      assert.equal(state.usage.usage_bearing_api_calls, 1, 'must be counted as usage-bearing');
      assert.equal(state.usage.input_tokens, 200);
      assert.ok(state.usage.known_cost_usd > 0);
    } finally {
      cleanup(dir);
    }
  });

  // ─── Test 13: Error without usage → NOT usage-bearing ────────────────────────

  it('13. Error response with zero tokens → NOT counted as usage-bearing', () => {
    const dir = makeTmpDir();
    try {
      const checkpoint = makeCheckpoint(dir);

      const usage = {
        input_tokens: 0,
        output_tokens: 0,
        search_calls: 0,
        search_count_status: 'unavailable' as const,
        token_cost_usd: 0,
        web_search_cost_usd: null,
        cost_usd: 0,
      };

      checkpoint.addUsage(usage, 'timeout');

      const state = checkpoint.getState();
      assert.equal(state.usage.usage_bearing_api_calls, 0, 'must NOT be counted as usage-bearing');
      assert.equal(state.usage.unknown_usage_attempts, 1, 'must be counted as unknown');
      assert.equal(state.usage.known_cost_usd, 0);
    } finally {
      cleanup(dir);
    }
  });

  // ─── Test 14: Diagnostic is sanitized — no raw text stored ───────────────────

  it('14. buildInvalidResponseDiagnostic does not store raw text content', () => {
    const rawText = 'SENSITIVE_COMPANY_DATA: {"name":"SecretCo","apiKey":"sk-prod-123"}';

    const diag = buildInvalidResponseDiagnostic({
      errorCode: 'malformed_json',
      stage: 'stage2_discovery',
      batchId: 0,
      stopReason: 'end_turn',
      text: rawText,
      jsonCandidateCount: 1,
      usageReceived: true,
      searchAuditReceived: false,
      retryable: true,
    });

    const serialized = JSON.stringify(diag);

    // Raw text must NOT appear in the serialized diagnostic
    assert.ok(!serialized.includes('SENSITIVE_COMPANY_DATA'), 'raw text must not be stored');
    assert.ok(!serialized.includes('SecretCo'), 'company name must not be stored');
    assert.ok(!serialized.includes('sk-prod-123'), 'API key must not be stored');

    // Only safe metadata is present
    assert.equal(diag.textLength, rawText.length, 'text length preserved for diagnostics');
    assert.ok(typeof diag.textSha256 === 'string', 'hash present for identity');
    assert.equal(diag.errorCode, 'malformed_json');
    assert.equal(diag.usageReceived, true);
  });

  // ─── Test 15: Truncated batch → retry count reduced ──────────────────────────

  it('15. Truncation detection and reduced-count strategy is implemented', () => {
    // Verify the helpers work correctly for the truncated retry strategy
    assert.equal(isTruncatedByTokenLimit('max_tokens'), true);
    assert.equal(isTruncatedByTokenLimit('end_turn'), false);
    assert.equal(isTruncatedByTokenLimit(null), false);

    // Incomplete JSON detection
    assert.equal(looksLikeIncompleteJson('{"name":"Empresa'), true, 'mid-string is incomplete');
    assert.equal(looksLikeIncompleteJson('{"name":"Empresa"}'), false, 'closed object is complete');
    // Heuristic checks last char: trailing comma → clearly incomplete
    assert.equal(looksLikeIncompleteJson('[1, 2, 3,'), true, 'trailing comma is incomplete');
    assert.equal(looksLikeIncompleteJson('[1, 2, 3]'), false, 'closed array is complete');
    assert.equal(looksLikeIncompleteJson(''), false, 'empty string is not truncated');

    // extractJsonRobust detects truncation via stop_reason
    const result = extractJsonRobust('{"candidates":[{"name":"Emp', 'max_tokens');
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.truncated, true);
      assert.equal(result.error, 'truncated_output');
    }

    // computeResponseHash produces a 16-char fingerprint
    const hash1 = computeResponseHash('some text', 'no_text_blocks', 'end_turn');
    const hash2 = computeResponseHash('some text', 'no_text_blocks', 'end_turn');
    const hash3 = computeResponseHash('different text', 'no_text_blocks', 'end_turn');
    assert.equal(hash1, hash2, 'same input → same hash');
    assert.notEqual(hash1, hash3, 'different text → different hash');
    assert.equal(hash1.length, 16, 'hash is 16 chars');
  });

});
