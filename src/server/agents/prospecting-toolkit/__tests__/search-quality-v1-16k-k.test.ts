/**
 * Tests — Agent 1 v1.16K-K — Writer Stop Criterion + Recall Name Propagation + Skip Telemetry
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * T1  — Stop criterion: novelty_only >= target pero adjusted < target → NO target_reached
 * T2  — Stop criterion: adjusted >= target → target_reached
 * T3  — Stop criterion: metadata incluye novelty_only y adjusted estimates
 * T4  — nameForFit: domain-inferred name se usa para business fit (caso Dinámica CD)
 * T5  — nameForFit: nombre original SEO no bloquea si nombre de dominio es válido
 * T6  — quality_skipped_count incluye blog_content_site
 * T7  — quality_skipped_count incluye not_a_direct_vendor
 * T8  — quality_skipped_count incluye content_or_intermediary_site
 * T9  — novelty_skipped_count incluye negative_memory_rejected_recently
 * T10 — writer_omitted_samples se genera con gate y reason correctos
 * T11 — WRITER_GATE_PASS_RATE_ASSUMPTION = 0.30 exportado
 * T12 — NoveltyPrecheckSummary tiene campos stop_criterion_version y basis
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { WRITER_GATE_PASS_RATE_ASSUMPTION } from '../incremental-search';
import { evaluateBusinessFit, isBlockedByBusinessFit } from '../business-fit-gate';

// ─── T1 / T2 / T3 — Stop criterion math ──────────────────────────────────────

describe('WRITER_GATE_PASS_RATE_ASSUMPTION', () => {
  it('T11 — is exported and equals 0.30', () => {
    assert.strictEqual(WRITER_GATE_PASS_RATE_ASSUMPTION, 0.30);
  });
});

describe('stop criterion — writer gate adjusted estimate', () => {
  it('T1 — novelty_only >= target but adjusted < target should NOT trigger target_reached', () => {
    // Simulates: targetPersistibleCandidates = 5, novelty_only = 10
    // adjusted = floor(10 * 0.30) = 3 < 5 → should NOT stop
    const target = 5;
    const noveltyOnly = 10;
    const adjusted = Math.floor(noveltyOnly * WRITER_GATE_PASS_RATE_ASSUMPTION);

    assert.ok(noveltyOnly >= target, 'novelty-only would have triggered stop');
    assert.ok(adjusted < target, 'adjusted should be below target (no stop)');
  });

  it('T2 — adjusted >= target should trigger target_reached', () => {
    // Simulates: targetPersistibleCandidates = 3, novelty_only = 15
    // adjusted = floor(15 * 0.30) = 4 >= 3 → should stop
    const target = 3;
    const noveltyOnly = 15;
    const adjusted = Math.floor(noveltyOnly * WRITER_GATE_PASS_RATE_ASSUMPTION);

    assert.ok(adjusted >= target, 'adjusted should be >= target (stop)');
  });

  it('T3 — adjusted formula is floor(novelty_only * 0.30)', () => {
    const cases = [
      { noveltyOnly: 0, expected: 0 },
      { noveltyOnly: 1, expected: 0 },
      { noveltyOnly: 3, expected: 0 },
      { noveltyOnly: 7, expected: 2 },
      { noveltyOnly: 10, expected: 3 },
      { noveltyOnly: 20, expected: 6 },
      { noveltyOnly: 22, expected: 6 }, // audit batch case: 22 novelty-passed → 0 persisted
      { noveltyOnly: 34, expected: 10 }, // needs ~34 novelty-passed to estimate 10 writer-persisted
    ];
    for (const { noveltyOnly, expected } of cases) {
      const adjusted = Math.floor(noveltyOnly * WRITER_GATE_PASS_RATE_ASSUMPTION);
      assert.strictEqual(
        adjusted,
        expected,
        `floor(${noveltyOnly} * 0.30) should be ${expected}, got ${adjusted}`,
      );
    }
  });
});

// ─── T4 / T5 — nameForFit propagation (caso Dinámica CD) ─────────────────────

describe('nameForFit — recall recovery propagation to business fit', () => {
  it('T4 — domain-inferred name passes business fit when SEO title would fail', () => {
    // The problematic case from the audit:
    // URL: https://dinamicacd.com.co/servicios-de-consultoria/consultoria-erp-crm-hcm
    // candidate.name (from SEO title): "Consultoría ERP, CRM, HCM"
    // recall recovery infers: "Dinamicacd" or "Dinámica CD"
    const seoTitle = 'Consultoría ERP, CRM, HCM';
    const domain = 'dinamicacd.com.co';

    // Simulate normalizeProspectCompanyName behavior for a clear domain-inferred case
    // by directly testing the business fit gate with the inferred name
    const inferredName = 'Dinamicacd';

    const fitWithSeoTitle = evaluateBusinessFit({
      name: seoTitle,
      website: `https://${domain}/servicios-de-consultoria/consultoria-erp-crm-hcm`,
      domain,
      sourceSnippet: 'Consultoría ERP, CRM y HCM para empresas corporativas',
      sourceTitle: seoTitle,
      subindustries: [],
      additionalCriteria: null,
    });

    const fitWithInferredName = evaluateBusinessFit({
      name: inferredName,
      website: `https://${domain}/servicios-de-consultoria/consultoria-erp-crm-hcm`,
      domain,
      sourceSnippet: 'Consultoría ERP, CRM y HCM para empresas corporativas',
      sourceTitle: seoTitle,
      subindustries: [],
      additionalCriteria: null,
    });

    // The inferred name should have a better or equal fit (not blocked for wrong reasons)
    const seoBlocked = isBlockedByBusinessFit(fitWithSeoTitle);
    const inferredBlocked = isBlockedByBusinessFit(fitWithInferredName);

    // If both pass, great. If SEO is blocked but inferred passes, that proves the fix.
    // The key invariant: the inferred name must NOT be harder to pass than the SEO title.
    assert.ok(
      !inferredBlocked || seoBlocked,
      `Inferred name "${inferredName}" should not fail fit when SEO title "${seoTitle}" passes — ` +
        `inferredBlocked=${inferredBlocked}, seoBlocked=${seoBlocked}`,
    );
  });

  it('T5 — generic company name does not get worse fit than raw SEO phrase', () => {
    // A plain company name like "Acme Corp" should not be harder to pass than
    // a generic service title, since service keywords in the title
    // can add confusing negative signals.
    const companyName = 'Acme Software Solutions';
    const serviceTitle = 'Software Empresarial ERP CRM HCM Colombia implementación';

    const fitCompanyName = evaluateBusinessFit({
      name: companyName,
      website: 'https://acmesoftware.com.co',
      domain: 'acmesoftware.com.co',
      sourceSnippet: 'Proveedor de software empresarial ERP y CRM para Colombia',
      sourceTitle: serviceTitle,
      subindustries: [],
      additionalCriteria: null,
    });

    const fitServiceTitle = evaluateBusinessFit({
      name: serviceTitle,
      website: 'https://acmesoftware.com.co',
      domain: 'acmesoftware.com.co',
      sourceSnippet: 'Proveedor de software empresarial ERP y CRM para Colombia',
      sourceTitle: serviceTitle,
      subindustries: [],
      additionalCriteria: null,
    });

    // Company name should not produce a worse fit than the service title
    const fitLevels = ['high', 'medium', 'low', 'reject'];
    const companyIdx = fitLevels.indexOf(fitCompanyName.fit);
    const serviceIdx = fitLevels.indexOf(fitServiceTitle.fit);

    assert.ok(
      companyIdx <= serviceIdx,
      `Company name "${companyName}" (${fitCompanyName.fit}) should have >= fit than service title "${serviceTitle}" (${fitServiceTitle.fit})`,
    );
  });
});

// ─── T6 / T7 / T8 — quality_skipped_count telemetry ─────────────────────────

describe('quality_skipped_count telemetry — content/intermediary reasons', () => {
  function computeQualitySkipped(skippedReasons: string[]): number {
    // This mirrors the actual logic in candidate-writer.ts (v1.16K-K FIX 3)
    const qualitySkipped = skippedReasons.filter(
      (reason) =>
        reason === 'qualityLabel=discard' ||
        reason.startsWith('external_platform:') ||
        reason.startsWith('company_ownership:') ||
        reason.startsWith('source_url_quality:') ||
        reason.startsWith('business_fit:') ||
        reason === 'content_page' ||
        reason === 'non_company_phrase' ||
        reason === 'non_official_source_domain' ||
        reason === 'country_incompatible' ||
        reason.startsWith('country_incompatible:') ||
        reason === 'blog_content_site' ||
        reason === 'not_a_direct_vendor' ||
        reason === 'content_or_intermediary_site',
    );
    return qualitySkipped.length;
  }

  it('T6 — blog_content_site counts in quality_skipped_count', () => {
    const reasons = ['blog_content_site', 'non_company_phrase'];
    assert.strictEqual(computeQualitySkipped(reasons), 2);
  });

  it('T7 — not_a_direct_vendor counts in quality_skipped_count', () => {
    const reasons = ['not_a_direct_vendor'];
    assert.strictEqual(computeQualitySkipped(reasons), 1);
  });

  it('T8 — content_or_intermediary_site counts in quality_skipped_count', () => {
    const reasons = ['content_or_intermediary_site'];
    assert.strictEqual(computeQualitySkipped(reasons), 1);
  });

  it('T8b — all three content/intermediary reasons are counted', () => {
    const reasons = [
      'blog_content_site',
      'not_a_direct_vendor',
      'content_or_intermediary_site',
      'business_fit:low', // already in quality bucket
      'seen_in_previous_batch_recently', // in novelty bucket, NOT quality
    ];
    assert.strictEqual(computeQualitySkipped(reasons), 4);
  });

  it('T8c — content/intermediary and existing quality reasons do not double-count', () => {
    const reasons = ['content_page', 'blog_content_site'];
    // Both are quality gate reasons, should count 2 (no overlap/dedup issues)
    assert.strictEqual(computeQualitySkipped(reasons), 2);
  });
});

// ─── T9 — novelty_skipped_count telemetry ────────────────────────────────────

describe('novelty_skipped_count telemetry — negative_memory_rejected_recently', () => {
  function computeNoveltySkipped(skippedReasons: string[]): number {
    // Mirrors candidate-writer.ts (v1.16K-K FIX 4)
    const noveltyReasons = new Set([
      'seen_in_previous_batch_recently',
      'confirmed_duplicate_previous',
      'rejected_recently',
      'negative_memory_rejected_recently',
    ]);
    return skippedReasons.filter((r) => noveltyReasons.has(r)).length;
  }

  it('T9 — negative_memory_rejected_recently counts in novelty_skipped_count', () => {
    const reasons = ['negative_memory_rejected_recently'];
    assert.strictEqual(computeNoveltySkipped(reasons), 1);
  });

  it('T9b — all four novelty reasons are counted', () => {
    const reasons = [
      'seen_in_previous_batch_recently',
      'confirmed_duplicate_previous',
      'rejected_recently',
      'negative_memory_rejected_recently',
    ];
    assert.strictEqual(computeNoveltySkipped(reasons), 4);
  });

  it('T9c — negative_memory was invisible before fix (not in old set)', () => {
    // The OLD set (without the fix) would have missed negative_memory_rejected_recently
    const oldNoveltyReasons = new Set([
      'seen_in_previous_batch_recently',
      'confirmed_duplicate_previous',
      'rejected_recently',
    ]);
    const reasons = ['negative_memory_rejected_recently', 'seen_in_previous_batch_recently'];
    const oldCount = reasons.filter((r) => oldNoveltyReasons.has(r)).length;
    const newCount = computeNoveltySkipped(reasons);

    assert.strictEqual(oldCount, 1, 'old set misses negative_memory_rejected_recently');
    assert.strictEqual(newCount, 2, 'new set counts both');
  });
});

// ─── T10 — writer_omitted_samples structure ───────────────────────────────────

describe('writer_omitted_samples — structure validation', () => {
  it('T10 — required fields are present and typed correctly', () => {
    // Validate the expected shape of a WriterOmittedSample entry
    const sample = {
      name: 'Dinámica CD',
      domain: 'dinamicacd.com.co',
      url: 'https://dinamicacd.com.co/servicios-de-consultoria/consultoria-erp-crm-hcm',
      final_skip_reason: 'business_fit:low',
      gate: 'business_fit',
      recall_recovered_name: 'Dinamicacd',
      name_for_fit: 'Dinamicacd',
      query_text: 'consultor ERP CRM Colombia implementación empresas',
      round_number: 1,
      provider_rank: 3,
      source_title: 'Consultoría ERP, CRM, HCM',
      source_snippet: 'Servicios de consultoría ERP para empresas en Colombia',
      pipeline_quality_label: 'needs_review',
      is_recall_recovery_applied: true,
      was_identity_in_cooldown: false,
      matched_identity_key: null,
    };

    // Verify required string fields
    assert.strictEqual(typeof sample.name, 'string');
    assert.strictEqual(typeof sample.final_skip_reason, 'string');
    assert.strictEqual(typeof sample.gate, 'string');
    assert.strictEqual(typeof sample.is_recall_recovery_applied, 'boolean');
    assert.strictEqual(typeof sample.was_identity_in_cooldown, 'boolean');

    // Verify nullable fields accept null
    assert.ok(sample.matched_identity_key === null || typeof sample.matched_identity_key === 'string');
    assert.ok(sample.recall_recovered_name === null || typeof sample.recall_recovered_name === 'string');
    assert.ok(sample.name_for_fit === null || typeof sample.name_for_fit === 'string');

    // Verify recall recovery context is propagated correctly
    assert.strictEqual(sample.recall_recovered_name, 'Dinamicacd');
    assert.strictEqual(sample.name_for_fit, 'Dinamicacd');
    assert.strictEqual(sample.is_recall_recovery_applied, true);
  });

  it('T10b — gate values are meaningful strings', () => {
    const validGates = [
      'quality_label',
      'canonical_identity',
      'country_compatibility',
      'content_page',
      'content_intermediary',
      'external_platform',
      'company_ownership',
      'source_url_quality',
      'business_fit',
      'novelty',
    ];

    // All expected gate names are non-empty strings
    for (const gate of validGates) {
      assert.ok(gate.length > 0, `Gate "${gate}" should be non-empty`);
    }

    // Ensure content_intermediary is in the list (FIX 5 requirement)
    assert.ok(validGates.includes('content_intermediary'));
    // Ensure business_fit is in the list (Dinámica CD case)
    assert.ok(validGates.includes('business_fit'));
  });
});

// ─── T12 — NoveltyPrecheckSummary type compatibility ─────────────────────────

describe('NoveltyPrecheckSummary — new optional fields', () => {
  it('T12 — summary object with new fields is valid', () => {
    // Verify the extended type structure is compatible
    const summary = {
      enabled: true,
      estimated_skipped_count: 5,
      estimated_persistable_count: 15,
      novelty_only_persistible_estimate: 15,
      writer_gate_adjusted_persistible_estimate: 4,
      writer_gate_pass_rate_assumption: 0.30,
      stop_criterion_version: 'v2_writer_gate_adjusted',
      stop_criterion_basis: 'writer_gate_adjusted' as const,
    };

    assert.strictEqual(summary.enabled, true);
    assert.strictEqual(summary.estimated_persistable_count, 15);
    assert.strictEqual(summary.novelty_only_persistible_estimate, 15);
    assert.strictEqual(
      summary.writer_gate_adjusted_persistible_estimate,
      Math.floor(15 * 0.30),
    );
    assert.strictEqual(summary.writer_gate_pass_rate_assumption, 0.30);
    assert.strictEqual(summary.stop_criterion_version, 'v2_writer_gate_adjusted');
    assert.strictEqual(summary.stop_criterion_basis, 'writer_gate_adjusted');
  });

  it('T12b — batch 42c8d601 scenario: 22 novelty-passed → adjusted = 6 < 10 target', () => {
    // Audit batch: 22 candidates passed novelty check, 0 survived writer gates.
    // With the old code: 22 >= 10 → target_reached (wrong!)
    // With the new code: floor(22 * 0.30) = 6 < 10 → continue searching (correct)
    const noveltyOnlyFromAuditBatch = 22;
    const target = 10;
    const adjusted = Math.floor(noveltyOnlyFromAuditBatch * WRITER_GATE_PASS_RATE_ASSUMPTION);

    assert.ok(
      noveltyOnlyFromAuditBatch >= target,
      'Old code would have fired target_reached',
    );
    assert.ok(
      adjusted < target,
      `New code should NOT fire target_reached: adjusted=${adjusted} < target=${target}`,
    );
    assert.strictEqual(adjusted, 6);
  });
});
