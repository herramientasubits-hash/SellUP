/**
 * Tests — Contact Enrichment Conversational Wizard reducer (Hito 17A.2B)
 *
 * Pure unit tests. No network, no DOM. Uses Node.js built-in test runner.
 *
 * Sections:
 *   A — Initial state (blank + preloaded)
 *   B — Query classification + resolve input
 *   C — Resolution planning (planResolution)
 *   D — Reducer transitions
 *   E — Message integrity (unique ids, snapshot preservation)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactEnrichmentChatReducer,
  createInitialContactEnrichmentChatState,
  classifyCompanyQuery,
  buildResolveInput,
  planResolution,
} from '../contact-enrichment-chat-reducer';
import type { ContactEnrichmentChatState } from '../contact-enrichment-chat-types';
import type {
  CompanyCandidate,
  CompanyResolutionResult,
  ContactEnrichmentRunResult,
} from '@/modules/contact-enrichment/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

function sellupCandidate(overrides: Partial<CompanyCandidate> = {}): CompanyCandidate {
  return {
    source: 'sellup',
    name: 'Bancolombia',
    domain: 'bancolombia.com',
    country: 'CO',
    sellupAccountId: 'acc-1',
    matchConfidence: 1,
    ...overrides,
  };
}

function resolution(overrides: Partial<CompanyResolutionResult> = {}): CompanyResolutionResult {
  return {
    resolved: true,
    singleMatch: false,
    candidates: [],
    skippedHubSpot: false,
    ...overrides,
  };
}

function runResult(): ContactEnrichmentRunResult {
  return {
    runId: 'run-1',
    agentRunId: 'agent-1',
    status: 'ready_to_enrich',
    candidatesCount: 0,
    existingContactsSnapshot: {
      sellup: { status: 'skipped', contacts: [], count: 0, reason: 'Sin account ID de SellUp' },
      hubspot: { status: 'skipped', contacts: [], count: 0, reason: 'Sin HubSpot Company ID' },
      combined: {
        totalExistingContacts: 0,
        existingContactNames: [],
        existingEmails: [],
        existingLinkedinUrls: [],
        incompleteContacts: { missingEmail: 0, missingPhone: 0, missingLinkedin: 0 },
        sourceCounts: { sellup: 0, hubspot: 0 },
      },
    },
  };
}

// ── A — Initial state ─────────────────────────────────────────────────────────

describe('A — initial state', () => {
  it('A1 blank state starts at await_company with one assistant greeting', () => {
    const state = createInitialContactEnrichmentChatState();
    assert.equal(state.step, 'await_company');
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, 'assistant');
    assert.equal(state.selectedCandidate, null);
  });

  it('A2 preloaded company starts at confirming with selected candidate', () => {
    const state = createInitialContactEnrichmentChatState({
      name: 'Empresa QA',
      domain: 'qa.example.com',
      country: 'CO',
      sellupAccountId: 'acc-9',
    });
    assert.equal(state.step, 'confirming');
    assert.ok(state.selectedCandidate);
    assert.equal(state.selectedCandidate?.name, 'Empresa QA');
    assert.equal(state.selectedCandidate?.source, 'sellup');
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].role, 'assistant');
  });
});

// ── B — Query classification ────────────────────────────────────────────────

describe('B — query classification', () => {
  it('B1 plain name', () => {
    assert.equal(classifyCompanyQuery('Empresa QA Snapshot Vercel 2'), 'name');
  });
  it('B2 domain', () => {
    assert.equal(classifyCompanyQuery('qa-vercel-2.example.com'), 'domain');
  });
  it('B3 hubspot id', () => {
    assert.equal(classifyCompanyQuery('1234567'), 'hubspot_id');
  });
  it('B4 buildResolveInput maps to the right field', () => {
    assert.deepEqual(buildResolveInput('Acme'), { companyName: 'Acme' });
    assert.deepEqual(buildResolveInput('acme.com'), { companyDomain: 'acme.com' });
    assert.deepEqual(buildResolveInput('9988776'), { hubspotCompanyId: '9988776' });
  });
});

// ── C — Resolution planning ─────────────────────────────────────────────────

describe('C — planResolution', () => {
  it('C1 no candidates + name → needs extra data', () => {
    const action = planResolution('Acme', resolution({ candidates: [] }));
    assert.equal(action.type, 'RESOLVED_NONE_NEEDS_DATA');
  });

  it('C2 no candidates + domain → manual candidate', () => {
    const action = planResolution('acme.com', resolution({ candidates: [] }));
    assert.equal(action.type, 'RESOLVED_MANUAL');
    if (action.type === 'RESOLVED_MANUAL') {
      assert.equal(action.candidate.source, 'manual');
      assert.equal(action.candidate.domain, 'acme.com');
    }
  });

  it('C3 single match → single', () => {
    const selected = sellupCandidate();
    const action = planResolution('Bancolombia', resolution({
      singleMatch: true,
      selected,
      candidates: [selected],
    }));
    assert.equal(action.type, 'RESOLVED_SINGLE');
  });

  it('C4 multiple matches → multiple', () => {
    const action = planResolution('Banco', resolution({
      candidates: [sellupCandidate(), sellupCandidate({ name: 'Banco B', source: 'hubspot' })],
    }));
    assert.equal(action.type, 'RESOLVED_MULTIPLE');
  });
});

// ── D — Reducer transitions ─────────────────────────────────────────────────

describe('D — reducer transitions', () => {
  const blank = (): ContactEnrichmentChatState => createInitialContactEnrichmentChatState();

  it('D1 SUBMIT_QUERY → resolving + user bubble', () => {
    const next = contactEnrichmentChatReducer(blank(), { type: 'SUBMIT_QUERY', query: '  Acme  ' });
    assert.equal(next.step, 'resolving');
    assert.equal(next.query, 'Acme');
    assert.equal(next.messages.at(-1)?.role, 'user');
    assert.equal(next.messages.at(-1)?.content, 'Acme');
  });

  it('D2 empty query is ignored', () => {
    const start = blank();
    const next = contactEnrichmentChatReducer(start, { type: 'SUBMIT_QUERY', query: '   ' });
    assert.equal(next, start);
  });

  it('D3 RESOLVED_SINGLE → confirming with selected + assistant bubble', () => {
    const candidate = sellupCandidate();
    const next = contactEnrichmentChatReducer(blank(), {
      type: 'RESOLVED_SINGLE',
      candidate,
      skippedHubSpot: false,
    });
    assert.equal(next.step, 'confirming');
    assert.equal(next.selectedCandidate?.name, 'Bancolombia');
    assert.equal(next.messages.at(-1)?.role, 'assistant');
  });

  it('D4 RESOLVED_MULTIPLE → selecting_company with candidates', () => {
    const next = contactEnrichmentChatReducer(blank(), {
      type: 'RESOLVED_MULTIPLE',
      candidates: [sellupCandidate(), sellupCandidate({ name: 'B' })],
      skippedHubSpot: false,
    });
    assert.equal(next.step, 'selecting_company');
    assert.equal(next.candidates.length, 2);
  });

  it('D5 skippedHubSpot adds a warning system message', () => {
    const next = contactEnrichmentChatReducer(blank(), {
      type: 'RESOLVED_SINGLE',
      candidate: sellupCandidate(),
      skippedHubSpot: true,
    });
    const warning = next.messages.find((m) => m.role === 'system' && m.tone === 'warning');
    assert.ok(warning, 'expected a warning system message');
  });

  it('D6 SELECT_CANDIDATE → confirming + user + assistant bubbles', () => {
    const start = contactEnrichmentChatReducer(blank(), {
      type: 'RESOLVED_MULTIPLE',
      candidates: [sellupCandidate(), sellupCandidate({ name: 'B' })],
      skippedHubSpot: false,
    });
    const next = contactEnrichmentChatReducer(start, {
      type: 'SELECT_CANDIDATE',
      candidate: sellupCandidate(),
    });
    assert.equal(next.step, 'confirming');
    assert.equal(next.selectedCandidate?.name, 'Bancolombia');
  });

  it('D7 SUBMIT_EXTRA_DATA → confirming with manual candidate carrying domain/country', () => {
    const start = contactEnrichmentChatReducer(blank(), {
      type: 'SUBMIT_QUERY',
      query: 'Empresa QA Snapshot Vercel 2',
    });
    const next = contactEnrichmentChatReducer(start, {
      type: 'SUBMIT_EXTRA_DATA',
      domain: 'qa-vercel-2.example.com',
      country: 'CO',
    });
    assert.equal(next.step, 'confirming');
    assert.equal(next.selectedCandidate?.source, 'manual');
    assert.equal(next.selectedCandidate?.name, 'Empresa QA Snapshot Vercel 2');
    assert.equal(next.selectedCandidate?.domain, 'qa-vercel-2.example.com');
    assert.equal(next.selectedCandidate?.country, 'CO');
  });

  it('D8 CONFIRM → creating_run + "Confirmar empresa" bubble', () => {
    const start = contactEnrichmentChatReducer(blank(), {
      type: 'RESOLVED_SINGLE',
      candidate: sellupCandidate(),
      skippedHubSpot: false,
    });
    const next = contactEnrichmentChatReducer(start, { type: 'CONFIRM' });
    assert.equal(next.step, 'creating_run');
    assert.equal(next.messages.at(-1)?.content, 'Confirmar empresa');
  });

  it('D9 CONFIRM without selected candidate is a no-op', () => {
    const start = blank();
    const next = contactEnrichmentChatReducer(start, { type: 'CONFIRM' });
    assert.equal(next, start);
  });

  it('D10 RUN_SUCCEEDED → done with runResult', () => {
    const start = contactEnrichmentChatReducer(
      contactEnrichmentChatReducer(blank(), {
        type: 'RESOLVED_SINGLE',
        candidate: sellupCandidate(),
        skippedHubSpot: false,
      }),
      { type: 'CONFIRM' },
    );
    const next = contactEnrichmentChatReducer(start, { type: 'RUN_SUCCEEDED', result: runResult() });
    assert.equal(next.step, 'done');
    assert.equal(next.runResult?.runId, 'run-1');
    assert.ok(next.runResult?.existingContactsSnapshot, 'snapshot must be preserved');
  });

  it('D11 RUN_FAILED → error with message', () => {
    const next = contactEnrichmentChatReducer(blank(), {
      type: 'RUN_FAILED',
      message: 'boom',
    });
    assert.equal(next.step, 'error');
    assert.equal(next.errorMessage, 'boom');
    assert.equal(next.messages.at(-1)?.tone, 'error');
  });

  it('D12 RESET returns a fresh greeting', () => {
    const dirty = contactEnrichmentChatReducer(blank(), { type: 'RUN_FAILED', message: 'x' });
    const next = contactEnrichmentChatReducer(dirty, { type: 'RESET' });
    assert.equal(next.step, 'await_company');
    assert.equal(next.messages.length, 1);
    assert.equal(next.errorMessage, null);
  });
});

// ── F — Request/attempt cutover (Hito 17B.4X.7C.2) ──────────────────────────

describe('F — request/attempt cutover', () => {
  function confirmedState(): ContactEnrichmentChatState {
    const resolved = contactEnrichmentChatReducer(createInitialContactEnrichmentChatState(), {
      type: 'RESOLVED_SINGLE',
      candidate: sellupCandidate(),
      skippedHubSpot: false,
    });
    return contactEnrichmentChatReducer(resolved, { type: 'CONFIRM' });
  }

  it('F1 REQUEST_CREATED → done with requestId, runResult stays null (no attempt yet)', () => {
    const next = contactEnrichmentChatReducer(confirmedState(), {
      type: 'REQUEST_CREATED',
      requestId: 'req-1',
    });
    assert.equal(next.step, 'done');
    assert.equal(next.requestId, 'req-1');
    assert.equal(next.runResult, null);
  });

  it('F2 desde REQUEST_CREATED, SELECT_PROVIDER funciona (step ya es done)', () => {
    const afterRequest = contactEnrichmentChatReducer(confirmedState(), {
      type: 'REQUEST_CREATED',
      requestId: 'req-2',
    });
    const next = contactEnrichmentChatReducer(afterRequest, {
      type: 'SELECT_PROVIDER',
      provider: 'lusha',
    });
    assert.equal(next.selectedProvider, 'lusha');
  });

  it('F3 APOLLO_SUCCEEDED con runResult adjunto lo escribe en el estado (attempt result)', () => {
    const afterRequest = contactEnrichmentChatReducer(confirmedState(), {
      type: 'REQUEST_CREATED',
      requestId: 'req-3',
    });
    const attemptResult = runResult();
    const next = contactEnrichmentChatReducer(afterRequest, {
      type: 'APOLLO_SUCCEEDED',
      result: {
        status: 'ready_for_review',
        candidatesCreated: 2,
        duplicatesSkipped: 0,
        possibleDuplicates: 0,
        totalCandidates: 2,
        rawResultsCount: 2,
        rejectedByRelevance: 0,
        noReviewableContactsFound: false,
        completionAttempted: 0,
        actionableContactsCount: 2,
        noActionableContactsFound: false,
        providerStatus: 'success',
        estimatedCostUsd: 0.01,
      },
      runResult: attemptResult,
    });
    assert.equal(next.step, 'done');
    assert.equal(next.requestId, 'req-3');
    assert.equal(next.runResult?.runId, attemptResult.runId);
    assert.equal(next.apolloResult?.candidatesCreated, 2);
  });

  it('F4 LUSHA_SUCCEEDED con runResult adjunto lo escribe en el estado (attempt result)', () => {
    const afterRequest = contactEnrichmentChatReducer(confirmedState(), {
      type: 'REQUEST_CREATED',
      requestId: 'req-4',
    });
    const attemptResult = runResult();
    const next = contactEnrichmentChatReducer(afterRequest, {
      type: 'LUSHA_SUCCEEDED',
      result: {
        status: 'ready_for_review',
        candidatesCreated: 1,
        duplicatesSkipped: 0,
        rawResultsCount: 1,
        creditsUsed: 1,
        providerStatus: 'success',
        noReviewableContactsFound: false,
      },
      runResult: attemptResult,
    });
    assert.equal(next.step, 'done');
    assert.equal(next.runResult?.runId, attemptResult.runId);
    assert.equal(next.lushaResult?.candidatesCreated, 1);
  });

  it('F5 APOLLO_SUCCEEDED sin runResult adjunto no rompe el estado (runResult permanece null)', () => {
    const afterRequest = contactEnrichmentChatReducer(confirmedState(), {
      type: 'REQUEST_CREATED',
      requestId: 'req-5',
    });
    const next = contactEnrichmentChatReducer(afterRequest, {
      type: 'APOLLO_SUCCEEDED',
      result: {
        status: 'completed',
        candidatesCreated: 0,
        duplicatesSkipped: 0,
        possibleDuplicates: 0,
        totalCandidates: 0,
        rawResultsCount: 0,
        rejectedByRelevance: 0,
        noReviewableContactsFound: true,
        completionAttempted: 0,
        actionableContactsCount: 0,
        noActionableContactsFound: false,
        providerStatus: 'success',
        estimatedCostUsd: 0,
      },
    });
    assert.equal(next.runResult, null);
  });

  it('F6 el estado inicial siempre trae requestId=null', () => {
    const state = createInitialContactEnrichmentChatState();
    assert.equal(state.requestId, null);
  });
});

// ── E — Message integrity ───────────────────────────────────────────────────

describe('E — message integrity', () => {
  it('E1 every message id is unique across a full flow', () => {
    let state = createInitialContactEnrichmentChatState();
    state = contactEnrichmentChatReducer(state, { type: 'SUBMIT_QUERY', query: 'Acme' });
    state = contactEnrichmentChatReducer(state, {
      type: 'RESOLVED_MULTIPLE',
      candidates: [sellupCandidate(), sellupCandidate({ name: 'B' })],
      skippedHubSpot: true,
    });
    state = contactEnrichmentChatReducer(state, {
      type: 'SELECT_CANDIDATE',
      candidate: sellupCandidate(),
    });
    state = contactEnrichmentChatReducer(state, { type: 'CONFIRM' });
    state = contactEnrichmentChatReducer(state, { type: 'RUN_SUCCEEDED', result: runResult() });

    const ids = state.messages.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, 'message ids must be unique');
  });
});
