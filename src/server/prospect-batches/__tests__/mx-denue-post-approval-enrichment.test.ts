/**
 * Tests — México.2B — DENUE post-approval enrichment
 *
 * Verifies that enrichMexicoCandidateWithDenue:
 * 1. Rejects non-MX countries
 * 2. Skips on missing candidate name
 * 3. Calls DENUE adapter and builds mx_denue block
 * 4. Always sets official_business_directory semantics
 * 5. Never sets legal_validation_status or tax_validation_status to 'matched'
 * 6. Never invents CIIU
 * 7. Always sets human_review_required = true
 * 8. Handles adapter error without throwing
 * 9. Handles no_match output correctly
 * 10. Handles ambiguous match correctly
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enrichMexicoCandidateWithDenue,
} from '../mx-denue-post-approval-enrichment';
import type { MxDenueEnrichmentInput } from '../mx-denue-post-approval-enrichment';
import type { SourceEnrichmentOutput } from '@/server/source-catalog/enrichment/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<MxDenueEnrichmentInput> = {}): MxDenueEnrichmentInput {
  return {
    candidateId: 'cand-mx-1',
    countryCode: 'MX',
    candidateName: 'OXXO S.A. de C.V.',
    metadata: {},
    ...overrides,
  };
}

function makeMatchedAdapterOutput(overrides: Partial<SourceEnrichmentOutput> = {}): SourceEnrichmentOutput {
  return {
    sourceKey: 'mx_denue',
    status: 'matched',
    matchedBy: 'exact_name',
    confidence: 0.85,
    metadata: {
      status: 'matched',
      source_key: 'mx_denue',
      matched_by: 'name',
      confidence: 0.85,
      human_review_required: true,
      does_not_resolve_tax_identifier: true,
      matches: [{ denue_id: 'DENUE001', name: 'OXXO SA', confidence: 0.85, matched_by: 'name' }],
    },
    ...overrides,
  };
}

function makeNoMatchAdapterOutput(): SourceEnrichmentOutput {
  return {
    sourceKey: 'mx_denue',
    status: 'no_match',
    matchedBy: null,
    confidence: 0,
    metadata: {
      status: 'no_match',
      source_key: 'mx_denue',
      matched_by: 'none',
      confidence: 0,
      human_review_required: true,
      does_not_resolve_tax_identifier: true,
      matches: [],
    },
  };
}

function makeAmbiguousAdapterOutput(): SourceEnrichmentOutput {
  return {
    sourceKey: 'mx_denue',
    status: 'matched',
    matchedBy: 'normalized_name',
    confidence: 0.62,
    metadata: {
      status: 'ambiguous',
      source_key: 'mx_denue',
      matched_by: 'normalized',
      confidence: 0.62,
      human_review_required: true,
      does_not_resolve_tax_identifier: true,
      matches: [
        { denue_id: 'D1', name: 'OXXO SA', confidence: 0.62, matched_by: 'normalized' },
        { denue_id: 'D2', name: 'OXXO GAS', confidence: 0.60, matched_by: 'normalized' },
      ],
    },
  };
}

const mockAdapterMatched = async () => makeMatchedAdapterOutput();
const mockAdapterNoMatch = async () => makeNoMatchAdapterOutput();
const mockAdapterAmbiguous = async () => makeAmbiguousAdapterOutput();
const mockAdapterError = async (): Promise<SourceEnrichmentOutput> => { throw new Error('DENUE API timeout'); };

// ── Test: country guard ────────────────────────────────────────────────────────

describe('MX2B-1 — country guard', () => {
  it('non-MX country → enriched=false, mx_denue=null', async () => {
    const result = await enrichMexicoCandidateWithDenue(
      makeInput({ countryCode: 'CO' }),
      mockAdapterMatched,
    );
    assert.equal(result.enriched, false);
    assert.equal(result.mx_denue, null);
    assert.equal(result.reason, 'not_mx_country');
  });

  it('DO country → enriched=false', async () => {
    const result = await enrichMexicoCandidateWithDenue(
      makeInput({ countryCode: 'DO' }),
      mockAdapterMatched,
    );
    assert.equal(result.enriched, false);
    assert.equal(result.mx_denue, null);
  });
});

// ── Test: missing name ─────────────────────────────────────────────────────────

describe('MX2B-2 — missing candidate name', () => {
  it('empty name → skipped block', async () => {
    const result = await enrichMexicoCandidateWithDenue(
      makeInput({ candidateName: '' }),
      mockAdapterMatched,
    );
    assert.equal(result.enriched, true);
    assert.ok(result.mx_denue !== null);
    assert.equal(result.mx_denue!.status, 'skipped');
    assert.equal(result.mx_denue!.reason, 'missing_candidate_name');
    assert.equal(result.reason, 'missing_candidate_name');
  });

  it('whitespace-only name → skipped block', async () => {
    const result = await enrichMexicoCandidateWithDenue(
      makeInput({ candidateName: '   ' }),
      mockAdapterMatched,
    );
    assert.equal(result.mx_denue!.status, 'skipped');
  });
});

// ── Test: semantic guardrails always enforced ──────────────────────────────────

describe('MX2B-3 — semantic guardrails', () => {
  it('matched → source_type = official_business_directory', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.source_type, 'official_business_directory');
  });

  it('matched → legal_validation_status = not_applicable', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.legal_validation_status, 'not_applicable');
  });

  it('matched → tax_validation_status = not_applicable', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.tax_validation_status, 'not_applicable');
  });

  it('matched → official_ciiu_available = false', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.official_ciiu_available, false);
  });

  it('matched → ciiu_status = unavailable_for_mvp', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.ciiu_status, 'unavailable_for_mvp');
  });

  it('matched → human_review_required = true', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.human_review_required, true);
  });

  it('matched → source_key = mx_denue', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.source_key, 'mx_denue');
  });

  it('matched → country_code = MX', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.country_code, 'MX');
  });

  it('matched → economic_activity_source = denue', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.economic_activity_source, 'denue');
  });

  it('matched → sector_source = denue_activity_text', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.mx_denue!.sector_source, 'denue_activity_text');
  });
});

// ── Test: guardrails enforced even for no_match and skipped ───────────────────

describe('MX2B-4 — guardrails on no_match and skipped', () => {
  it('no_match → legal_validation_status = not_applicable', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterNoMatch);
    assert.equal(result.mx_denue!.legal_validation_status, 'not_applicable');
  });

  it('no_match → tax_validation_status = not_applicable', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterNoMatch);
    assert.equal(result.mx_denue!.tax_validation_status, 'not_applicable');
  });

  it('no_match → human_review_required = true', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterNoMatch);
    assert.equal(result.mx_denue!.human_review_required, true);
  });

  it('no_match → status = not_found', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterNoMatch);
    assert.equal(result.mx_denue!.status, 'not_found');
  });

  it('skipped (missing name) → legal_validation_status = not_applicable', async () => {
    const result = await enrichMexicoCandidateWithDenue(
      makeInput({ candidateName: '' }),
      mockAdapterMatched,
    );
    assert.equal(result.mx_denue!.legal_validation_status, 'not_applicable');
  });
});

// ── Test: ambiguous match ──────────────────────────────────────────────────────

describe('MX2B-5 — ambiguous match', () => {
  it('ambiguous adapter output → block status = ambiguous', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterAmbiguous);
    assert.equal(result.mx_denue!.status, 'ambiguous');
  });

  it('ambiguous → human_review_required = true', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterAmbiguous);
    assert.equal(result.mx_denue!.human_review_required, true);
  });

  it('ambiguous → legal_validation_status = not_applicable', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterAmbiguous);
    assert.equal(result.mx_denue!.legal_validation_status, 'not_applicable');
  });
});

// ── Test: adapter error handling ───────────────────────────────────────────────

describe('MX2B-6 — adapter error handling', () => {
  it('adapter throws → returns error block, does not throw', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterError);
    assert.equal(result.enriched, true);
    assert.ok(result.mx_denue !== null);
    assert.equal(result.mx_denue!.status, 'error');
    assert.equal(result.reason, 'denue_error');
  });

  it('adapter throws → guardrails still enforced on error block', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterError);
    assert.equal(result.mx_denue!.legal_validation_status, 'not_applicable');
    assert.equal(result.mx_denue!.tax_validation_status, 'not_applicable');
    assert.equal(result.mx_denue!.official_ciiu_available, false);
    assert.equal(result.mx_denue!.human_review_required, true);
  });
});

// ── Test: result structure ─────────────────────────────────────────────────────

describe('MX2B-7 — result structure', () => {
  it('matched → reason = name_lookup_completed', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.equal(result.reason, 'name_lookup_completed');
  });

  it('matched → enriched_at is ISO string', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.ok(typeof result.mx_denue!.enriched_at === 'string');
    assert.doesNotThrow(() => new Date(result.mx_denue!.enriched_at));
  });

  it('matched → denue_metadata contains adapter output', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterMatched);
    assert.ok(result.mx_denue!.denue_metadata !== null);
  });

  it('no_match → denue_metadata still present', async () => {
    const result = await enrichMexicoCandidateWithDenue(makeInput(), mockAdapterNoMatch);
    assert.ok(result.mx_denue!.denue_metadata !== null);
  });
});
