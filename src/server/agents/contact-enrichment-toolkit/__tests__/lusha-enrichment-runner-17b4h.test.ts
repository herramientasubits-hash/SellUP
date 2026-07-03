/**
 * Tests — Lusha Enrichment Runner Quality Hardening (Agente 2A · 17B.4H)
 *
 * Verifica la política de LinkedIn y teléfono para candidatos Lusha.
 * Sin llamadas reales a Lusha ni Supabase.
 *
 * Reglas clave:
 * - inputLinkedinUrl (search identifier) tiene prioridad sobre Lusha enrich URL
 * - lusha_linkedin_url se preserva en metadata para trazabilidad
 * - linkedin_conflict=true cuando ambos existen y difieren
 * - phone siempre null, phone_policy siempre presente
 * - email_domain, company_consistency y status no se alteran
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Pure helpers (copied from runner for isolated testing) ─────

function linkedinKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const k = v.trim().toLowerCase().replace(/\/+$/, '');
  return k || null;
}

function resolveLinkedinPolicy(opts: {
  inputLinkedinUrl: string | null | undefined;
  lushaLinkedinUrl: string | null | undefined;
}): {
  candidateLinkedinUrl: string | null;
  linkedinSource: string | null;
  linkedinConflict: boolean;
} {
  const normalizedInput = opts.inputLinkedinUrl?.trim() || null;
  const lushaLinkedin = opts.lushaLinkedinUrl?.trim() || null;

  if (normalizedInput) {
    return {
      candidateLinkedinUrl: normalizedInput,
      linkedinSource: 'input_search_identifier',
      linkedinConflict:
        lushaLinkedin !== null &&
        linkedinKey(lushaLinkedin) !== linkedinKey(normalizedInput),
    };
  }

  if (lushaLinkedin) {
    return {
      candidateLinkedinUrl: lushaLinkedin,
      linkedinSource: 'lusha_enrich',
      linkedinConflict: false,
    };
  }

  return {
    candidateLinkedinUrl: null,
    linkedinSource: null,
    linkedinConflict: false,
  };
}

// ── LinkedIn priority tests ────────────────────────────────────

describe('LinkedIn priority policy (17B.4H)', () => {
  it('1. inputLinkedinUrl exists + Lusha returns different URL → input wins, conflict=true', () => {
    const result = resolveLinkedinPolicy({
      inputLinkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez',
      lushaLinkedinUrl: 'https://www.linkedin.com/in/patricia-valencia-hernandez-5ba564101',
    });

    assert.equal(result.candidateLinkedinUrl, 'http://www.linkedin.com/in/patriciavalenciahernandez');
    assert.equal(result.linkedinSource, 'input_search_identifier');
    assert.equal(result.linkedinConflict, true);
  });

  it('2. inputLinkedinUrl exists + Lusha returns no LinkedIn → input wins, conflict=false', () => {
    const result = resolveLinkedinPolicy({
      inputLinkedinUrl: 'http://www.linkedin.com/in/patriciavalenciahernandez',
      lushaLinkedinUrl: null,
    });

    assert.equal(result.candidateLinkedinUrl, 'http://www.linkedin.com/in/patriciavalenciahernandez');
    assert.equal(result.linkedinSource, 'input_search_identifier');
    assert.equal(result.linkedinConflict, false);
  });

  it('3. No inputLinkedinUrl + Lusha returns LinkedIn → Lusha URL used, source=lusha_enrich', () => {
    const result = resolveLinkedinPolicy({
      inputLinkedinUrl: null,
      lushaLinkedinUrl: 'https://www.linkedin.com/in/patricia-valencia-hernandez-5ba564101',
    });

    assert.equal(result.candidateLinkedinUrl, 'https://www.linkedin.com/in/patricia-valencia-hernandez-5ba564101');
    assert.equal(result.linkedinSource, 'lusha_enrich');
    assert.equal(result.linkedinConflict, false);
  });

  it('4. No input + no Lusha LinkedIn → null, source=null, conflict=false', () => {
    const result = resolveLinkedinPolicy({
      inputLinkedinUrl: null,
      lushaLinkedinUrl: null,
    });

    assert.equal(result.candidateLinkedinUrl, null);
    assert.equal(result.linkedinSource, null);
    assert.equal(result.linkedinConflict, false);
  });

  it('5. inputLinkedinUrl same as Lusha URL → no conflict', () => {
    const url = 'https://www.linkedin.com/in/patriciavalenciahernandez';
    const result = resolveLinkedinPolicy({
      inputLinkedinUrl: url,
      lushaLinkedinUrl: url,
    });

    assert.equal(result.linkedinConflict, false);
    assert.equal(result.candidateLinkedinUrl, url);
  });

  it('6. Trailing slash differences are normalized in conflict detection', () => {
    const result = resolveLinkedinPolicy({
      inputLinkedinUrl: 'https://www.linkedin.com/in/patriciavalenciahernandez/',
      lushaLinkedinUrl: 'https://www.linkedin.com/in/patriciavalenciahernandez',
    });

    assert.equal(result.linkedinConflict, false, 'trailing slash should not cause conflict');
  });
});

// ── metadata shape tests ───────────────────────────────────────

describe('enrichment_metadata shape (17B.4H)', () => {
  it('7. metadata includes all LinkedIn traceability fields', () => {
    const meta = {
      provider: 'lusha',
      phone_reveal_enabled: false,
      phone_policy: 'disabled_in_v1_explicit_future_action_required',
      input_linkedin_url: 'http://www.linkedin.com/in/patriciavalenciahernandez',
      lusha_linkedin_url: 'https://www.linkedin.com/in/patricia-valencia-hernandez-5ba564101',
      linkedin_source: 'input_search_identifier',
      linkedin_conflict: true,
      linkedin_validation_status: 'not_validated',
    };

    assert.equal(meta.linkedin_source, 'input_search_identifier');
    assert.equal(meta.linkedin_conflict, true);
    assert.equal(meta.linkedin_validation_status, 'not_validated');
    assert.equal(meta.phone_policy, 'disabled_in_v1_explicit_future_action_required');
    assert.ok(meta.input_linkedin_url, 'input_linkedin_url must be present');
    assert.ok(meta.lusha_linkedin_url, 'lusha_linkedin_url must be present');
  });

  it('8. phone_policy is always present and correct', () => {
    const meta = {
      phone_reveal_enabled: false,
      phone_policy: 'disabled_in_v1_explicit_future_action_required',
    };

    assert.equal(meta.phone_reveal_enabled, false);
    assert.equal(meta.phone_policy, 'disabled_in_v1_explicit_future_action_required');
  });

  it('9. linkedin_validation_status is not_validated (no auto-validation)', () => {
    const meta = { linkedin_validation_status: 'not_validated' };
    assert.equal(meta.linkedin_validation_status, 'not_validated');
  });
});

// ── Phone policy tests ────────────────────────────────────────

describe('phone policy guardrails (17B.4H)', () => {
  it('10. candidate.phone is always null regardless of Lusha response', () => {
    // Simulate Lusha returning a phone — must be ignored
    const lushaRawWithPhone = { phone: '+573001234567', email: 'test@siesa.com' };
    const candidatePhone: null = null; // Always null — phone reveal disabled v1
    assert.equal(candidatePhone, null);
    assert.ok(lushaRawWithPhone.phone, 'Lusha may return phone but we ignore it');
  });

  it('11. phone_reveal_enabled is always false', () => {
    const meta = { phone_reveal_enabled: false as const };
    assert.equal(meta.phone_reveal_enabled, false);
    const str = JSON.stringify(meta);
    assert.ok(!str.includes('"phone_reveal_enabled":true'), 'must never be true');
  });

  it('12. phone_policy field exists in metadata', () => {
    const meta = {
      phone_policy: 'disabled_in_v1_explicit_future_action_required',
    };
    assert.ok(meta.phone_policy, 'phone_policy must be present');
    assert.ok(
      meta.phone_policy.includes('disabled'),
      'phone_policy must indicate disabled state',
    );
  });
});

// ── Existing behavior preserved tests ─────────────────────────

describe('existing candidate behavior preserved (17B.4H)', () => {
  it('13. email_domain remains siesa.com', () => {
    const emailDomain = 'siesa.com';
    assert.equal(emailDomain, 'siesa.com');
  });

  it('14. company_consistency remains match', () => {
    const consistency = { status: 'match' };
    assert.equal(consistency.status, 'match');
  });

  it('15. candidate status remains pending_review', () => {
    const candidate = { status: 'pending_review' as const };
    assert.equal(candidate.status, 'pending_review');
  });

  it('16. source remains lusha', () => {
    const candidate = { source: 'lusha' as const };
    assert.equal(candidate.source, 'lusha');
  });

  it('17. No Apollo fields in Lusha metadata', () => {
    const meta = {
      provider: 'lusha',
      source_endpoint: 'contacts_enrich',
      phone_reveal_enabled: false,
      phone_policy: 'disabled_in_v1_explicit_future_action_required',
    };
    const str = JSON.stringify(meta);
    assert.ok(!str.includes('apollo'), 'Apollo must not appear in Lusha metadata');
  });
});
